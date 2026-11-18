//! From the creation of a `Vm` to the exit code.

use core::time::Duration;
use std::io::{BufRead, Write};

use bun_engine_inspector::profiling::{Coverage, SamplingProfiler};
use bun_engine_text::{StringBuilder, names};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::{
    JsFunctionWithFields, RunLoop, SourceType, errors, evaluate_module_source, evaluate_script,
    load_and_evaluate_module, options,
};

use crate::command_line::{CommandLine, Script};
use crate::functions::{drain_microtasks, to_console_text, to_utf8, use_disk_cache};
use crate::prelude::*;
use crate::{files, global, inspector};

pub(crate) const EXIT_EXCEPTION: i32 = 3;
const COMMAND_LINE: &str = "[Command Line]";

pub(crate) fn exit(code: i32) -> ! {
    let _ = std::io::stdout().flush();
    std::process::exit(code)
}

fn print_line(parts: &[&[u8]]) {
    let mut out = std::io::stdout().lock();
    for part in parts {
        let _ = out.write_all(part);
    }
    let _ = out.write_all(b"\n");
}

fn try_dump_exception(cx: &mut Cx, exception: Value) -> JsResult<()> {
    let text = to_utf8(cx, exception).or_else(|thrown| {
        cx.catch(thrown)?;
        let mut description = StringBuilder::new();
        errors::describe_value(cx, exception, &mut description);
        let description = cx.finish_string(description)?;
        to_utf8(cx, description.into())
    })?;
    print_line(&[b"Exception: ", &text]);
    let name = exception.get(cx, names::name)?;
    let url = exception.get(cx, names::sourceURL)?;
    let line = exception.get(cx, names::line)?;
    let stack = exception.get(cx, names::stack)?;
    if to_utf8(cx, name)? == b"SyntaxError"
        && !(url.is_undefined_or_null() && line.is_undefined_or_null())
    {
        print_line(&[b"at ", &to_utf8(cx, url)?, b":", &to_utf8(cx, line)?]);
    }
    if !stack.is_undefined_or_null() {
        let stack = to_utf8(cx, stack)?;
        if !stack.is_empty() {
            print_line(&[&stack]);
        }
    }
    Ok(())
}

pub(crate) fn dump_exception(cx: &mut Cx, exception: Value) {
    if try_dump_exception(cx, exception).is_err() {
        cx.clear_exception();
    }
}

fn is_expected_exception(cx: &mut Cx, exception: Option<Value>, expected: &str) -> bool {
    let complain = |reason: &str| {
        println!("Expected uncaught exception with name '{expected}' but {reason}");
        false
    };
    let Some(exception) = exception else {
        return complain("none was thrown");
    };
    let name = Identifier::new(StringRef::from_str(expected).text());
    let Ok(Some(class)) = cx.global().get(cx, name.name()).map(Value::as_object) else {
        cx.clear_exception();
        return complain("given exception class is not defined");
    };
    match class.has_instance(cx, exception) {
        Ok(true) => {
            if State::of(cx).command_line().dumps_expected_exception {
                dump_exception(cx, exception);
            }
            true
        }
        Ok(false) => {
            complain("exception value is not instance of this exception class");
            dump_exception(cx, exception);
            false
        }
        Err(_) => {
            cx.clear_exception();
            complain("given exception class fails performing hasInstance")
        }
    }
}

/// Notes a failure if what a script or a module threw is not what the command line expects.
pub(crate) fn check_exception(cx: &mut Cx, exception: Option<Value>, is_last_script: bool) {
    let state = State::of(cx);
    let command_line = state.command_line();
    if exception == Some(cx.termination_exception().value()) {
        cx.is_execution_forbidden().set(true);
        if command_line.accepts_termination {
            return;
        }
    }
    let ignores = command_line.ignores_uncaught_exceptions;
    let is_fine = match (&command_line.expected_exception, exception) {
        (Some(expected), _) if is_last_script => is_expected_exception(cx, exception, expected),
        (_, Some(exception)) if !ignores => {
            dump_exception(cx, exception);
            false
        }
        _ => true,
    };
    if !is_fine && !ignores {
        state.has_failed.set(true);
    }
}

pub(crate) fn take_exception<T>(cx: &Cx, result: JsResult<T>) -> Option<Value> {
    let _ = result.err()?;
    Some(cx.clear_exception()?.value())
}

#[native_abi]
fn did_evaluate_module<const THREW: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [is_last, _] = JsFunctionWithFields::fields_of_callee(frame);
    check_exception(cx, THREW.then(|| frame.argument(0)), is_last.is_true());
    Ok(Value::UNDEFINED)
}

fn run_module(cx: &mut Cx, script: &Script, is_last: bool) -> JsResult<()> {
    let promise = match script {
        Script::Text(text) => {
            let source = files::source_at(COMMAND_LINE, text.as_bytes(), SourceType::Module);
            evaluate_module_source(cx, source)?
        }
        Script::Piped(bytes) => {
            evaluate_module_source(cx, files::source_at("-", bytes, SourceType::Module))?
        }
        Script::File { path, .. } => {
            let name = StringRef::from_str(&files::absolute_url(path));
            load_and_evaluate_module(cx, &Identifier::new(name.text()), None)?
        }
    };
    let handler = |function| {
        JsFunctionWithFields::new(cx, 1, function, [is_last.into(), Value::UNDEFINED]).into()
    };
    let on_fulfilled = handler(did_evaluate_module::<false>);
    let on_rejected = handler(did_evaluate_module::<true>);
    promise.perform_then(cx, on_fulfilled, on_rejected, Value::UNDEFINED);
    drain_microtasks(cx)
}

pub(crate) fn run_scripts(cx: &mut Cx, command_line: &CommandLine) {
    for (index, script) in command_line.scripts.iter().enumerate() {
        let is_last = index + 1 == command_line.scripts.len();
        if command_line.runs_modules || script.is_module() {
            let result = run_module(cx, script, is_last);
            if let Some(exception) = take_exception(cx, result) {
                check_exception(cx, Some(exception), is_last);
            }
            continue;
        }
        let source = match script {
            Script::Text(text) => {
                files::source_at(COMMAND_LINE, text.as_bytes(), SourceType::Program)
            }
            Script::Piped(bytes) => files::source_at("-", bytes, SourceType::Program),
            Script::File {
                path, is_strict, ..
            } => {
                let Some(mut bytes) = files::read_code(path) else {
                    return State::of(cx).has_failed.set(true);
                };
                if *is_strict {
                    bytes.splice(..0, *b"\"use strict\";\n");
                }
                let source = files::source_at(path, &bytes, SourceType::Program);
                use_disk_cache(cx, &source, path);
                source
            }
        };
        let result = evaluate_script(cx, &source, Value::UNDEFINED);
        let exception = take_exception(cx, result);
        check_exception(cx, exception, is_last);
    }
}

fn run_interactively(cx: &mut Cx) {
    let url = files::resolve(&files::url_of_working_directory(), "./interpreter");
    let origin = files::origin(&url);
    let mut line = Vec::new();
    loop {
        print!(">>> ");
        let _ = std::io::stdout().flush();
        line.clear();
        let _ = std::io::stdin().lock().read_until(b'\n', &mut line);
        if line.trim_ascii().is_empty() {
            return println!();
        }
        let text = files::decode(&line);
        let source = files::source(text, Some(&origin), Some(&url), SourceType::Program);
        let result = evaluate_script(cx, &source, Value::UNDEFINED);
        match result.and_then(|value| to_console_text(cx, value)) {
            Ok(text) => print_line(&[&text]),
            Err(_) => {
                let exception = cx.clear_exception().map_or_default(|it| it.value());
                let text = to_utf8(cx, exception).unwrap_or_default();
                cx.clear_exception();
                print_line(&[b"Exception: ", &text]);
            }
        }
        if drain_microtasks(cx).is_err() {
            return;
        }
    }
}

/// On a new `Vm`. Returns the exit code.
pub(crate) fn run(command_line: &CommandLine, body: impl FnOnce(&mut Cx)) -> i32 {
    let vm = bun_engine::create_vm(HeapKind::Large);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe {
        let _ = State::of(vm.get()).command_line.set(command_line.clone());
        Cx::from_global(global::create(vm.get()))
    };
    if options().collect_coverage {
        Coverage::of(cx).enable(cx);
    }
    if options().use_sampling_profiler {
        SamplingProfiler::start(cx);
    }
    let run_loop = RunLoop::install(cx);
    let state = State::of(cx);
    (state.expected_async_passes).set(command_line.expected_async_passes);
    if !command_line.arguments.is_empty() {
        let arguments = cx.new_array();
        for argument in &command_line.arguments {
            let argument = JsString::new(cx, StringRef::from_str(argument));
            let _ = arguments.push(cx, argument.into());
        }
        global::define_hidden(cx, "arguments", arguments.into());
    }

    (cx.embedder().must_not_block).set(command_line.cannot_block);
    if let Some(milliseconds) = command_line.watchdog_milliseconds {
        cx.add_termination_deadline(Duration::from_millis(milliseconds));
    }

    if command_line.is_inspected {
        inspector::connect(cx);
    }
    body(cx);
    if !cx.is_execution_forbidden().get() {
        let result = (drain_microtasks(cx).and_then(|()| run_loop.run(cx)))
            .and_then(|()| inspector::serve(cx, &run_loop));
        if let Some(termination) = take_exception(cx, result) {
            check_exception(cx, Some(termination), false);
        }
        if command_line.is_interactive && !state.has_failed.get() {
            run_interactively(cx);
        }
    }

    let (passes, expected) = (state.async_passes.get(), state.expected_async_passes.get());
    let code = if state.has_failed.get() || passes != expected {
        EXIT_EXCEPTION
    } else {
        0
    };
    if command_line.prints_exit_code {
        print!("exiting {code}");
        if passes != expected {
            print!(
                " because expected: {expected} async test passes but got: {passes} async test passes"
            );
        }
        println!();
    }
    if command_line.prints_samples {
        eprint!("{}", SamplingProfiler::top_functions_report(cx));
        eprint!("{}", SamplingProfiler::top_bytecodes_report(cx));
    }
    if command_line.collects_at_end {
        cx.heap.collect_and_sweep(Some(Scope::Full));
    }
    cx.global().keep_alive();
    if !command_line.destroys_vm {
        vm.into_raw();
    }
    code
}
