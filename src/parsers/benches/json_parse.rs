//! Throughput benchmark for the JSON parser on a corpus of real package.json
//! files and npm registry responses.
//!
//! Run via `scripts/bench-json-rust.sh [criterion args]` — it compiles the
//! small native support archive (mimalloc, simdutf, the highway JSON kernel)
//! from the repo's vendored sources and sets RUSTFLAGS to link it.
//!
//! Fixture directory: `BUN_JSON_BENCH_FIXTURES` (default `bench/json-corpus`),
//! populated by `bench/json-corpus/fetch.sh`.
use bun_alloc::Arena as Bump;
use bun_ast as js_ast;
use bun_parsers::json;
use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};

// Native symbols normally provided by Bun's C++ side; see the module docs.
#[path = "../native_test_shims.rs"]
mod native_test_shims;

fn fixtures_dir() -> std::path::PathBuf {
    if let Ok(d) = std::env::var("BUN_JSON_BENCH_FIXTURES") {
        return d.into();
    }
    let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p.push("bench/json-corpus");
    p
}

fn bench_json(c: &mut Criterion) {
    let dir = fixtures_dir();
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("fixture dir {:?}: {e}; run bench/json-corpus/fetch.sh", dir))
        .filter_map(|e| {
            let p = e.ok()?.path();
            (p.extension()? == "json").then_some(p)
        })
        .collect();
    files.sort();
    bun_ast::initialize_store();

    let mut group = c.benchmark_group("json_parse");
    for path in &files {
        let contents = std::fs::read(path).unwrap();
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        group.throughput(Throughput::Bytes(contents.len() as u64));
        // Stage 1 alone: drive the streaming structural index to the end of
        // the document (SIMD kernel + window refills), like stage 2 does.
        group.bench_function(BenchmarkId::new("stage1", &name), |b| {
            b.iter(|| {
                let mut x = bun_parsers::json_index::StructuralIndex::new(&contents);
                let mut i = 0usize;
                let mut sum = 0usize;
                loop {
                    let p = x.at(i);
                    if p == contents.len() {
                        break;
                    }
                    sum += p;
                    i += 1;
                }
                std::hint::black_box((sum, i))
            })
        });
        // Like parse_utf8 but with duplicate-key warnings off (what a registry
        // manifest caller would pass): isolates the duplicate-detection cost.
        group.bench_function(BenchmarkId::new("parse_nowarn", &name), |b| {
            let mut bump = Bump::new();
            b.iter(|| {
                let _store_scope = js_ast::StoreResetGuard::new();
                let mut log = js_ast::Log::init();
                bump.reset();
                let source = js_ast::Source::init_path_string("fixture.json", &contents[..]);
                let opts = json::JSONOptions {
                    json_warn_duplicate_keys: false,
                    ..json::JSONOptions::DEFAULT
                };
                let e = json::parse_package_json_utf8_with_opts(opts, &source, &mut log, &bump)
                    .expect("parse failed");
                std::hint::black_box(&e);
            })
        });
        // The row AST alone (`E::ObjectJSON`): what JSON-data consumers
        // (registry manifests, `Bun.JSONC.parse`) get. Same options as
        // parse_nowarn but without the materialize step. No arena: the
        // document's `JsonTape` (returned in the result and dropped at the
        // end of every iteration) owns everything the parse allocates, so
        // this measures parse + free of the whole document.
        group.bench_function(BenchmarkId::new("parse_rows", &name), |b| {
            b.iter(|| {
                let _store_scope = js_ast::StoreResetGuard::new();
                let mut log = js_ast::Log::init();
                let source = js_ast::Source::init_path_string("fixture.json", &contents[..]);
                let e =
                    json::ParsedJson::parse_npm_manifest(&source, &mut log).expect("parse failed");
                std::hint::black_box(&e);
            })
        });
        // Like parse_nowarn but with a *retained* arena heap
        // (`reset_retain_with_limit`) instead of a fresh `mi_heap_new` per
        // parse. This mirrors classic-AST callers with a long-lived arena
        // (the resolver's `JsonCache`, whose arena is never reset),
        // isolating the parser-only delta on small documents from the flat
        // ~5us mi_heap lifecycle. (The row AST never touches an arena, so it
        // has no "warm" variant.)
        group.bench_function(BenchmarkId::new("parse_nowarn_warm", &name), |b| {
            let mut bump = Bump::new();
            b.iter(|| {
                let _store_scope = js_ast::StoreResetGuard::new();
                let mut log = js_ast::Log::init();
                bump.reset_retain_with_limit(64 << 20);
                let source = js_ast::Source::init_path_string("fixture.json", &contents[..]);
                let opts = json::JSONOptions {
                    json_warn_duplicate_keys: false,
                    ..json::JSONOptions::DEFAULT
                };
                let e = json::parse_package_json_utf8_with_opts(opts, &source, &mut log, &bump)
                    .expect("parse failed");
                std::hint::black_box(&e);
            })
        });
        // Mirrors the real callers (npm.rs PackageManifest::parse, package_json.rs):
        // thread-local AST stores reset per parse, fresh Log + Bump per parse.
        group.bench_function(BenchmarkId::new("parse_utf8", &name), |b| {
            let mut bump = Bump::new();
            b.iter(|| {
                let _store_scope = js_ast::StoreResetGuard::new();
                let mut log = js_ast::Log::init();
                bump.reset();
                let source = js_ast::Source::init_path_string("fixture.json", &contents[..]);
                let e = json::parse_utf8(&source, &mut log, &bump).expect("parse failed");
                std::hint::black_box(&e);
            })
        });
    }
    // The fixed per-parse cost every caller pays regardless of the parser:
    // thread-local AST store reset + a fresh arena + a fresh Log, measured by
    // parsing a 2-byte document.
    group.throughput(Throughput::Elements(1));
    group.bench_function("per_parse_overhead/empty_object", |b| {
        let two = b"{}".to_vec();
        b.iter(|| {
            let _store_scope = js_ast::StoreResetGuard::new();
            let mut log = js_ast::Log::init();
            let bump = Bump::new();
            let source = js_ast::Source::init_path_string("fixture.json", &two[..]);
            let e = json::parse_utf8(&source, &mut log, &bump).expect("parse failed");
            std::hint::black_box(&e);
        })
    });
    group.finish();
}

criterion_group!(
    name = benches;
    config = Criterion::default().sample_size(20).warm_up_time(std::time::Duration::from_millis(300)).measurement_time(std::time::Duration::from_secs(2));
    targets = bench_json
);
criterion_main!(benches);
