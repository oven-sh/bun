//! Probe: the per-file part of a C1 lint run, as the findings describe it. Prints what Log::print gives, between markers.
mod shims;

fn loader_of(path: &str) -> Option<bun_ast::Loader> {
    let ext = path.rsplit_once('.').map(|(_, e)| e)?;
    Some(match ext {
        "js" | "jsx" => bun_ast::Loader::Jsx,
        "mjs" | "cjs" => bun_ast::Loader::Js,
        "ts" | "mts" | "cts" => bun_ast::Loader::Ts,
        "tsx" => bun_ast::Loader::Tsx,
        _ => return None,
    })
}

fn check_file(path: &str, mode: &str) -> (String, u32, u32) {
    let text = std::fs::read(path).unwrap();
    let loader = loader_of(path).unwrap();
    bun_ast::expr::data::Store::create();
    bun_ast::stmt::data::Store::create();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let source = bun_ast::Source::init_path_string(path.as_bytes(), &text[..]);
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    match mode {
        "lint" => {
            options.features.no_macros = true;
            options.features.is_macro_runtime = true;
            options.features.top_level_await = true;
            options.features.standard_decorators = true;
        }
        "nomacros" => {
            options.features.no_macros = true;
            options.features.top_level_await = true;
            options.features.standard_decorators = true;
        }
        "defaults" => {}
        _ => unreachable!(),
    }
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    log.level = bun_ast::Level::Warn;
    match bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => {
            if let Err(err) = parser.parse() {
                if log.errors == 0 {
                    log.add_range_error(Some(&source), bun_ast::Range::None, err.name().as_bytes());
                }
            }
        }
        Err(err) => {
            if log.errors == 0 {
                log.add_range_error(Some(&source), bun_ast::Range::None, err.name().as_bytes());
            }
        }
    }
    let mut out = String::new();
    let _ = log.print(&mut out);
    (out, log.errors, log.warnings)
}

fn run(mode: String, paths: Vec<String>) {
    for path in paths {
        let (out, errors, warnings) = check_file(&path, &mode);
        println!("=== {path} [{mode}] errors={errors} warnings={warnings} bytes={}", out.len());
        print!("{}", out.escape_debug().to_string().replace("\\n", "\\n\n"));
        println!("===");
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap();
    let paths: Vec<String> = args.collect();
    const STACK: usize = 16 * 1024 * 1024;
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let probe = 0u8;
            shims::STACK_TOP.store((&raw const probe) as usize, core::sync::atomic::Ordering::Relaxed);
            shims::STACK_SIZE.store(STACK, core::sync::atomic::Ordering::Relaxed);
            bun_core::StackCheck::configure_thread();
            run(mode, paths);
        })
        .unwrap()
        .join()
        .unwrap();
}
