//! `// @vitest-environment jsdom`, `[test] environment`, `--environment`; src/js/internal/test/environment.ts makes the window.

use super::jest::Jest;
use bun_core::Output;
use bun_core::lexer::{self, end_of_run};
use bun_core::strings::{self, CodePoint};
use bun_jsc::event_loop::TopLevelWaitError;
use bun_jsc::virtual_machine::{VirtualMachine, runtime_hooks};
use bun_jsc::{
    JSInternalPromise, JSPromise, JSValue, JsError, JsResult, StringJsc as _, Strong,
    bun_string_jsc, js_promise,
};
use bun_options_types::context::TestEnvironment;

#[derive(Default)]
struct Pragmas<'a> {
    environment: Option<&'a [u8]>,
    options: Option<&'a [u8]>,
}

fn is_line_terminator(c: CodePoint) -> bool {
    matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029)
}

impl<'a> Pragmas<'a> {
    /// As vitest: the text's first `/@(?:vitest|jest)-environment\s+([\w-]+)\b/` and `/@(?:vitest|jest)-environment-options\s+(.+)/`.
    fn find(source: &'a [u8]) -> Self {
        const ENVIRONMENT: &[u8] = b"-environment";
        const OPTIONS: &[u8] = b"-options";

        let mut found = Self::default();
        let mut at = 0;
        while let Some(offset) = strings::index_of(&source[at..], ENVIRONMENT) {
            let prefix = &source[..at + offset];
            at += offset + ENVIRONMENT.len();
            if !prefix.ends_with(b"@vitest") && !prefix.ends_with(b"@jest") {
                continue;
            }
            let is_options = source[at..].starts_with(OPTIONS);
            let spaces = if is_options { at + OPTIONS.len() } else { at };
            let start = end_of_run(source, spaces, |c| {
                lexer::is_whitespace(c) || is_line_terminator(c)
            });
            if start == spaces {
                continue;
            }
            if is_options {
                let line = &source[start..end_of_run(source, start, |c| !is_line_terminator(c))];
                if found.options.is_none() && !line.is_empty() {
                    found.options = Some(line.strip_suffix(b"*/").unwrap_or(line));
                }
            } else {
                let end = end_of_run(source, start, |c| {
                    u8::try_from(c)
                        .is_ok_and(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
                });
                let name = strings::trim_right(&source[start..end], b"-");
                if found.environment.is_none() && !name.is_empty() {
                    found.environment = Some(name);
                }
            }
            if found.environment.is_some() && found.options.is_some() {
                break;
            }
        }
        found
    }
}

pub(crate) struct Environment {
    /// What a comment in the file names. `Err` is a name `bun test` has no environment for.
    comment: Option<Result<TestEnvironment, Box<[u8]>>>,
    /// JSON, as written in the file.
    options: Option<Box<[u8]>>,
    project: TestEnvironment,
    is_entered: bool,
    teardown: Option<Strong>,
}

impl Environment {
    pub(crate) fn of_file(path: &[u8], project: Option<TestEnvironment>) -> Self {
        let project = project.unwrap_or(TestEnvironment::Node);
        // A file that cannot be read is the module loader's to report.
        let source = bun_sys::File::read_from(bun_sys::Fd::cwd(), path).unwrap_or_default();
        let pragmas = Pragmas::find(&source);
        Self {
            comment: pragmas
                .environment
                .map(|name| TestEnvironment::from_name(name).ok_or_else(|| name.into())),
            options: pragmas.options.map(Box::from),
            project,
            is_entered: false,
            teardown: None,
        }
    }

    /// The environment stays until `teardown`. If the project's cannot be set up the file fails to load: a rejected promise.
    pub(crate) fn load_entry_point(
        &mut self,
        vm: &mut VirtualMachine,
        path: &[u8],
    ) -> crate::Result<*mut JSInternalPromise> {
        if !core::mem::replace(&mut self.is_entered, true) {
            if let Some(rejected) = self.enter(vm, path)? {
                return Ok(rejected);
            }
        }
        Ok(vm.load_entry_point_for_test_runner(path)?)
    }

    /// `bun test` used to ignore the comments: one it cannot follow is a warning, and the file runs as it did.
    fn enter(
        &mut self,
        vm: &mut VirtualMachine,
        path: &[u8],
    ) -> crate::Result<Option<*mut JSInternalPromise>> {
        let kind = match &self.comment {
            None => self.project,
            Some(Ok(kind)) => *kind,
            Some(Err(name)) => {
                print_file_name();
                bun_core::warn!(
                    "The {} test environment of {} is not supported",
                    bun_core::fmt::quote(name),
                    bun_core::fmt::quote(path),
                );
                bun_core::note!(
                    "the supported environments are \"node\", \"jsdom\" and \"happy-dom\""
                );
                Output::flush();
                TestEnvironment::Node
            }
        };

        // Without --isolate preloads run once, for every file: in the project's environment, whichever file is first.
        if !vm.test_isolation_enabled
            && !vm.preload.is_empty()
            && (kind != self.project || self.options.is_some())
        {
            let project = match setup(vm, self.project, None, path, false) {
                Ok(project) => project,
                Err(err) => return rejected(vm, err).map(Some),
            };
            vm.set_main(path);
            let _ = vm.ensure_debugger(true);
            let hooks = runtime_hooks().expect("RuntimeHooks not installed");
            // SAFETY: `vm` is the live per-thread VM.
            let rejected_preload = unsafe { (hooks.load_preloads)(vm) }?;
            if let Some(project) = project {
                teardown(vm, &project);
            }
            if !rejected_preload.is_null() {
                return Ok(Some(rejected_preload));
            }
        }

        let options = self.options.as_deref();
        self.teardown = match setup(vm, kind, options, path, self.comment.is_some()) {
            Ok(teardown) => teardown,
            Err(err) => return rejected(vm, err).map(Some),
        };
        Ok(None)
    }

    pub(crate) fn teardown(&mut self, vm: &mut VirtualMachine) {
        if let Some(function) = self.teardown.take() {
            teardown(vm, &function);
        }
    }
}

fn rejected(vm: &VirtualMachine, err: JsError) -> crate::Result<*mut JSInternalPromise> {
    let promise = JSPromise::rejected_promise_with_caught_exception(vm.global(), err)?;
    promise.set_handled();
    Ok(std::ptr::from_mut(promise))
}

/// The reporter prints it lazily, before what it has to say about a file.
fn print_file_name() {
    if let Some(runner) = Jest::runner() {
        runner.bun_test_root.on_before_print();
    }
}

/// Returns the function that undoes it.
fn setup(
    vm: &VirtualMachine,
    kind: TestEnvironment,
    options: Option<&[u8]>,
    path: &[u8],
    is_from_comment: bool,
) -> JsResult<Option<Strong>> {
    if kind == TestEnvironment::Node {
        return Ok(None);
    }
    let global = vm.global();
    let teardown = bun_jsc::cpp::Bun__TestEnvironment__setupFunction(global)?.call(
        global,
        JSValue::UNDEFINED,
        &[
            bun_core::String::static_(kind.name()).to_js(global)?,
            match options {
                Some(options) => bun_string_jsc::create_utf8_for_js(global, options)?,
                None => JSValue::UNDEFINED,
            },
            bun_string_jsc::create_utf8_for_js(global, path)?,
            JSValue::from(!vm.test_isolation_enabled),
            JSValue::from(is_from_comment),
        ],
    )?;
    if teardown.is_string() {
        print_file_name();
        bun_core::warn!("{}", teardown.to_bun_string(global)?);
        Output::flush();
        return Ok(None);
    }
    Ok(teardown
        .is_callable()
        .then(|| Strong::create(teardown, global)))
}

fn teardown(vm: &mut VirtualMachine, function: &Strong) {
    let global = vm.global();
    let error = match function.get().call(global, JSValue::UNDEFINED, &[]) {
        Ok(result) => {
            let Some(promise) = result.as_any_promise() else {
                return;
            };
            let _protected = result.protected();
            promise.set_handled(global.vm());
            let waited = vm
                .event_loop_ref()
                .wait_at_top_level(|| promise.status() != js_promise::Status::Pending);
            if let Err(nothing_left @ TopLevelWaitError::NothingLeft) = waited {
                global.create_error_instance(format_args!(
                    "The test environment never finished closing\nnote: {nothing_left}"
                ))
            } else if promise.status() == js_promise::Status::Rejected {
                promise.result(global.vm())
            } else {
                return;
            }
        }
        Err(err) => global.take_exception(err),
    };
    let _ = vm.uncaught_exception(global, error, false);
}
