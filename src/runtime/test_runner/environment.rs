//! Picks each test file's environment. src/js/internal/test/environment.ts creates the window.

use super::jest::Jest;
use bun_core::lexer::end_of_run;
use bun_core::{Output, Timespec, TimespecMockMode};
use bun_core::strings;
use bun_jsc::event_loop::TopLevelWaitError;
use bun_jsc::virtual_machine::{VirtualMachine, runtime_hooks};
use bun_jsc::{
    JSInternalPromise, JSPromise, JSValue, JsError, JsResult,
    StringJsc as _, Strong, bun_string_jsc, js_promise,
};
use bun_options_types::context::TestEnvironment;

#[derive(Default)]
struct Pragmas<'a> {
    environment: Option<&'a [u8]>,
    options: Option<&'a [u8]>,
}

/// The file's leading comment without its `*/`, matched like jest-docblock's `/^\s*(\/\*\*?(.|\r?\n)*?\*\/)/`.
fn leading_docblock(source: &[u8]) -> core::ops::Range<usize> {
    let start = end_of_run(source, 0, |c| strings::is_js_whitespace(c as u32));
    if !source[start..].starts_with(b"/*") {
        return 0..0;
    }
    strings::index_of(&source[start + 2..], b"*/").map_or(0..0, |offset| start..start + 2 + offset)
}

/// The line behind `after`'s line break, without its ` * `, if jest-docblock's `multilineRe` joins it to a pragma's value.
fn continuation_line(after: &[u8]) -> Option<&[u8]> {
    let line = after
        .strip_prefix(b"\r\n")
        .or_else(|| after.strip_prefix(b"\n"))?;
    let line = strings::trim_left(line, b" ");
    let line = line
        .strip_prefix(b"*")
        .map_or(line, |line| strings::trim_left(line, b" "));
    let (line, after) = line.split_at(strings::index_of_any(line, b"\r\n")?);
    let is_joined = (after.starts_with(b"\n") || after.starts_with(b"\r\n"))
        && bun_format::pragma::is_continuation_line(line);
    is_joined.then_some(line)
}

/// A `@jest-environment`'s value as jest-docblock's `/(?:^|\r?\n) *@(\S+) *([^\n\r]*)/` reads it. Empty if it doesn't begin its line.
#[inline(never)] // Inlined, its slice arithmetic is hoisted in front of `find`'s search loop, which every test file runs.
fn value_of_jest_environment<'a>(comment_before: &[u8], comment_after: &'a [u8]) -> &'a [u8] {
    // jest-docblock first strips the comment's `/**` and each line's ` * `: `/^\/\*\*?/` and `/(\r?\n|^) *\* ?/g`.
    let line = strings::trim_right(comment_before, b" ");
    let line = line
        .strip_suffix(b"*")
        .map_or(line, |rest| strings::trim_right(rest, b" "));
    if !line.ends_with(b"\n") && !matches!(line, b"/" | b"/*" | b"/**") {
        return &[];
    }
    let line_end = end_of_run(comment_after, 0, |c| {
        !strings::is_js_line_terminator(c as u32)
    });
    let (value, after) = comment_after.split_at(line_end);
    // A plain name has no `/`, so it skips the search for `// ..`.
    let value = if strings::contains_char(value, b'/') {
        bun_format::pragma::without_line_comment(value)
    } else if strings::is_all_js_whitespace(value) {
        continuation_line(after).unwrap_or(value)
    } else {
        value
    };
    strings::trim_js_whitespace(value)
}

impl<'a> Pragmas<'a> {
    /// Like Vitest, takes the text's first `/@vitest-environment\s+([\w-]+)\b/` and `/@vitest-environment-options\s+(.+)/`.
    /// `@jest-` pragmas only count inside the file's leading comment, like Jest. The options match the same way, the name as in Jest.
    fn find(source: &'a [u8]) -> Self {
        const ENVIRONMENT: &[u8] = b"-environment";
        const OPTIONS: &[u8] = b"-options";
        const JEST: &[u8] = b"@jest";

        let docblock = leading_docblock(source);
        let mut found = Self::default();
        let mut at = 0;
        while let Some(offset) = strings::index_of(&source[at..], ENVIRONMENT) {
            let prefix = &source[..at + offset];
            at += offset + ENVIRONMENT.len();
            let is_vitest = prefix.ends_with(b"@vitest");
            if !is_vitest && !(prefix.ends_with(JEST) && at < docblock.end) {
                continue;
            }
            let is_options = source[at..].starts_with(OPTIONS);
            let first = if is_options {
                found.options
            } else {
                found.environment
            };
            if first.is_some() {
                continue;
            }
            let spaces = if is_options { at + OPTIONS.len() } else { at };
            let start = end_of_run(source, spaces, |c| strings::is_js_whitespace(c as u32));
            if start == spaces {
                continue;
            }
            if is_options {
                let line = &source[start..end_of_run(source, start, |c| !strings::is_js_line_terminator(c as u32))];
                if !line.is_empty() {
                    found.options = Some(line.strip_suffix(b"*/").unwrap_or(line));
                }
            } else if is_vitest {
                let end = end_of_run(source, start, |c| {
                    u8::try_from(c)
                        .is_ok_and(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
                });
                let name = strings::trim_right(&source[start..end], b"-");
                if !name.is_empty() {
                    found.environment = Some(name);
                }
            } else {
                let before = &prefix[docblock.start..prefix.len() - JEST.len()];
                let value = value_of_jest_environment(before, &source[at..docblock.end]);
                found.environment = Some(value).filter(|value| !value.is_empty());
            }
            if found.environment.is_some() && found.options.is_some() {
                break;
            }
        }
        found
    }
}

pub(crate) struct Environment {
    /// The environment a pragma names. `Err` holds a name `bun test` doesn't support.
    comment: Option<Result<TestEnvironment, Box<[u8]>>>,
    options: Option<Box<[u8]>>,
    project: TestEnvironment,
    is_entered: bool,
    teardown: Option<Strong>,
}

impl Environment {
    pub(crate) fn of_file(path: &[u8], project: Option<TestEnvironment>) -> Self {
        let project = project.unwrap_or(TestEnvironment::Node);
        // Read errors are ignored here because the module loader reports them.
        let source = bun_sys::File::read_from(bun_sys::Fd::cwd(), path).unwrap_or_default();
        let pragmas = Pragmas::find(&source);
        Self {
            comment: pragmas
                .environment
                .map(|name| TestEnvironment::from_name(name).ok_or_else(|| name.into())),
            // Vitest does `JSON.parse(text || "null")`.
            options: pragmas
                .options
                .filter(|text| !text.is_empty())
                .map(Box::from),
            project,
            is_entered: false,
            teardown: None,
        }
    }

    pub(crate) fn has_window(&self) -> bool {
        match &self.comment {
            None => self.project != TestEnvironment::Node,
            Some(Ok(kind)) => *kind != TestEnvironment::Node,
            Some(Err(_)) => false,
        }
    }

    pub(crate) fn load_entry_point(
        &mut self,
        vm: &mut VirtualMachine,
        path: &[u8],
    ) -> crate::Result<*mut JSInternalPromise> {
        if !core::mem::replace(&mut self.is_entered, true) {
            if let Some(rejected) = self.enter(vm, path)? {
                return Ok(rejected);
            }
        } else if let Some(function) = &self.teardown {
            // --rerun-each loads the file again. It only needs a new environment if the window was closed.
            let is_closed = match function
                .get()
                .call(vm.global(), JSValue::UNDEFINED, &[JSValue::TRUE])
            {
                Ok(is_closed) => is_closed.to_boolean(),
                Err(err) => return rejected(vm, err),
            };
            if is_closed {
                self.teardown(vm);
                if let Some(rejected) = self.enter(vm, path)? {
                    return Ok(rejected);
                }
            }
        }
        Ok(vm.load_entry_point_for_test_runner(path)?)
    }

    /// An unsupported pragma only warns, so files with pragmas that older `bun test` versions ignored keep running.
    #[optimize(size)]
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
                    "The {} test environment requested by {} is not supported",
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

        // Without --isolate preloads run only once, so run them in the project's environment, not the first file's.
        if !vm.test_isolation_enabled
            && !vm.preload.is_empty()
            && (kind != self.project || self.options.is_some())
        {
            let project = match setup(vm, self.project, None, path, false) {
                Ok(project) => project,
                Err(err) => return rejected(vm, err).map(Some),
            };
            vm.set_main(Some(path));
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

    #[optimize(size)]
    pub(crate) fn teardown(&mut self, vm: &mut VirtualMachine) {
        if let Some(function) = self.teardown.take() {
            teardown(vm, &function);
        }
    }
}

pub(crate) fn is_in_preload() -> bool {
    VirtualMachine::get().is_in_preload
}

fn rejected(vm: &VirtualMachine, err: JsError) -> crate::Result<*mut JSInternalPromise> {
    let promise = JSPromise::rejected_promise_with_caught_exception(vm.global(), err)?;
    promise.set_handled();
    Ok(std::ptr::from_mut(promise))
}

/// The reporter prints the file name lazily, so force it out before printing a warning about the file.
fn print_file_name() {
    if let Some(runner) = Jest::runner() {
        runner.bun_test_root.on_before_print();
    }
}

#[optimize(size)]
fn setup(
    vm: &VirtualMachine,
    kind: TestEnvironment,
    options: Option<&[u8]>,
    path: &[u8],
    is_from_comment: bool,
) -> JsResult<Option<Strong>> {
    let is_left =
        Jest::runner().is_some_and(|runner| core::mem::take(&mut runner.environment_is_left));
    if kind == TestEnvironment::Node && !is_left && !vm.test_isolation_state.shares_global {
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
            JSValue::from(vm.test_isolation_state.shares_global),
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

#[optimize(size)]
fn teardown(vm: &mut VirtualMachine, function: &Strong) {
    let global = vm.global();
    let error = match function
        .get()
        .call(global, JSValue::UNDEFINED, &[JSValue::FALSE])
    {
        Ok(result) => {
            let Some(promise) = result.as_any_promise() else {
                if let (true, Some(runner)) = (result == JSValue::TRUE, Jest::runner()) {
                    runner.environment_is_left = true;
                }
                return;
            };
            let _protected = result.protected();
            promise.set_handled(global.vm());
            // Same time limit as a hook. No timer is armed for it, so it's only checked when the event loop wakes up.
            let timeout = Jest::runner().map_or(0, |runner| runner.default_timeout_ms);
            let deadline = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, timeout.into());
            let waited = vm.event_loop_ref().wait_at_top_level(|| {
                promise.status() != js_promise::Status::Pending
                    || (timeout != 0
                        && Timespec::now(TimespecMockMode::ForceRealTime).greater(&deadline))
            });
            if let Err(nothing_left @ TopLevelWaitError::NothingLeft) = waited {
                global.create_error_instance(format_args!(
                    "The test environment never finished closing\nnote: {nothing_left}"
                ))
            } else if waited.is_ok() && promise.status() == js_promise::Status::Pending {
                global.create_error_instance(format_args!(
                    "The test environment did not finish closing within {timeout}ms"
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
