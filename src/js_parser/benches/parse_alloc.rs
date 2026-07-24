//! Throughput benchmark for `bun_js_parser::Parser::{init, parse}` to measure
//! node-allocation throughput with the passed `AstAlloc` handle.
//! Run via `scripts/bench-jsparser-rust.sh [criterion args]`.
use bun_alloc::{Arena, AstArena};
use bun_ast as js_ast;
use bun_js_parser::{Define, Parser, ParserOptions};
use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};

#[path = "native_test_shims.rs"]
mod native_test_shims;

fn repo_root() -> std::path::PathBuf {
    let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p
}

fn fixtures() -> Vec<(&'static str, std::path::PathBuf)> {
    let root = repo_root();
    let mut v = vec![(
        "lots-of-for-loop",
        root.join("test/bundler/transpiler/fixtures/lots-of-for-loop.js"),
    )];
    if let Ok(out) = std::process::Command::new("find")
        .arg(&root)
        .args(["-name", "react-dom.development.js", "-print", "-quit"])
        .output()
    {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            v.push(("react-dom.development", p.into()));
        }
    }
    v
}

fn bench_parse(c: &mut Criterion) {
    let define = Define::default();
    let mut group = c.benchmark_group("parse_alloc");
    for (name, path) in fixtures() {
        let Ok(contents) = std::fs::read(&path) else {
            eprintln!("skip {name}: {path:?} not found");
            continue;
        };
        let source = js_ast::Source::init_path_string(b"fixture.js", &contents[..]);
        group.throughput(Throughput::Bytes(contents.len() as u64));
        group.bench_function(BenchmarkId::new("parse", name), |b| {
            let mut bump = Arena::new();
            let mut ast_arena = AstArena::new();
            b.iter(|| {
                bump.reset();
                ast_arena.reset();
                let mut log = js_ast::Log::init();
                let parser = Parser::init(
                    ParserOptions::default(),
                    &mut log,
                    &source,
                    &define,
                    &bump,
                    ast_arena.alloc(),
                )
                .expect("init");
                let _ = std::hint::black_box(parser.parse());
            })
        });
    }
    group.finish();
}

criterion_group!(
    name = benches;
    config = Criterion::default()
        .sample_size(10)
        .warm_up_time(std::time::Duration::from_millis(500))
        .measurement_time(std::time::Duration::from_secs(3));
    targets = bench_parse
);
criterion_main!(benches);
