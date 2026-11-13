use super::bun_test::{self, AddedInPhase};
use super::test_context_parameter::Bun__JSFunction__sourceFromParameters;
use bun_jsc::{JSGlobalObject, JSValue};

/// Also true inside a hook that a preload registered, because a preload's `beforeAll` runs once for all test files.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isInPreload(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    if vm.is_in_preload {
        return true;
    }
    // Only the main thread has a runner. Workers and the VMs of macros have none.
    if !vm.is_main_thread {
        return false;
    }
    let Some(buntest_strong) = bun_test::clone_active_strong() else {
        return false;
    };
    let buntest = buntest_strong.get();
    if buntest.phase != bun_test::Phase::Execution
        || buntest.execution.active_group_ref().is_none()
    {
        return false;
    }
    buntest
        .get_current_state_data()
        .entry(buntest)
        .is_some_and(|entry| entry.added_in_phase == AddedInPhase::Preload)
}

/// A plain run prints a module with the minifier and without its dead code. `--coverage`, the inspector, `bun -p` and the REPL do not.
#[unsafe(no_mangle)]
extern "C" fn JSMock__printsUnlikePlainRun(global: &JSGlobalObject) -> bool {
    let options = &global.bun_vm().transpiler.options;
    !options.minify_syntax || !options.dead_code_elimination
}

/// The text of `factory` as a plain run prints it, for the mock call that reads it. `DEAD` if the text does not parse by itself.
#[unsafe(no_mangle)]
extern "C" fn JSMock__printAsPlainRun(factory: JSValue) -> bun_core::String {
    let mut is_arrow_function = false;
    let from_parameters = Bun__JSFunction__sourceFromParameters(factory, &mut is_arrow_function);
    if from_parameters.is_dead() {
        return bun_core::String::DEAD;
    }
    let from_parameters = from_parameters.to_utf8();
    // In a method, `this` and `super.x` stay as written. `async` and `*` let `await` and `yield` parse. The assignments keep the function from being dropped as unused.
    let (before, after): (&[u8], &[u8]) = if is_arrow_function {
        (b"x={m(){x=async ", b"}}")
    } else {
        (b"x={async*m", b"}")
    };
    print_minified(&[before, from_parameters.slice(), after].concat())
        .unwrap_or(bun_core::String::DEAD)
}

fn print_minified(text: &[u8]) -> Option<bun_core::String> {
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    let source = bun_ast::Source::init_path_string(&b"factory.js"[..], text);
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), bun_ast::Loader::Js);
    options.undeclared_private_names = true;
    // What the runtime transpiler sets in a plain run.
    options.tree_shaking = true;
    options.features.minify_syntax = true;
    options.features.dead_code_elimination = true;
    options.features.inlining = true;
    options.features.top_level_await = true;
    options.features.lower_using = false;
    options.features.ascii_only = true;
    options.features.no_macros = true;
    // Not the defines of the user: a name that the file of the factory binds is a free name in this text.
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    let bun_js_parser::Result::Ast(mut ast) = parser.parse().ok()? else {
        return None;
    };
    if log.errors > 0 {
        return None;
    }

    let symbols_arena = *ast.symbols.allocator();
    let symbols = bun_ast::symbol::Map::init_with_one_list(
        core::mem::replace(&mut ast.symbols, bun_alloc::ArenaVec::new_in(symbols_arena))
            .into_iter()
            .collect(),
    );
    let mut printer = bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
    // `true` is ASCII only, as the runtime prints: the scan compares a path by its escaped text.
    bun_js_printer::print_ast::<_, true, false>(
        &mut printer,
        &arena,
        &ast,
        symbols,
        &source,
        bun_js_printer::Options {
            minify_syntax: true,
            require_ref: Some(ast.require_ref),
            import_meta_ref: ast.import_meta_ref,
            ..Default::default()
        },
    )
    .ok()?;
    Some(bun_core::String::clone_utf8(printer.ctx.get_written()))
}
