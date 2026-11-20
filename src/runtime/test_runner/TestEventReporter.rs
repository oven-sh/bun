//! `bun test --reporter=ndjson` and `--reporter=<module>`: the run as a stream of events, one JSON object each.
//! `ndjson` writes them to the outfile a line at a time. A reporter module gets them through
//! src/js/internal/test/reporter.ts, which calls the module's `on<Type>` hook with the parsed object.

use core::cell::{Cell, OnceCell};

use bun_core::{Output, fmt as bun_fmt};
use bun_io::Write as _;
use bun_jsc::event_loop::TopLevelWaitError;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSValue, Strong, bun_string_jsc, js_promise};
use bun_sys::File;

use super::bun_test::{self, BunTest, DescribeScope, EntryId, ExecutionEntry, ScopeId, TestScheduleEntry};
use crate::cli::test_command::{TestCaseReport, TestFailure};

pub(crate) struct TestEventReporter {
    ndjson: Option<File>,
    /// `--reporter` names that are not built in, as given.
    modules: Box<[Box<[u8]>]>,
    /// The function that src/js/internal/test/reporter.ts returned for `modules`.
    dispatch: OnceCell<Strong>,
    /// A reporter module threw or rejected, which fails the run. The modules get no event after that.
    pub(crate) failed: Cell<bool>,
}

impl TestEventReporter {
    /// Opens the `ndjson` outfile. Exits when it can't, before any test runs.
    pub(crate) fn init(ndjson_outfile: Option<&[u8]>, modules: Box<[Box<[u8]>]>) -> Option<TestEventReporter> {
        if ndjson_outfile.is_none() && modules.is_empty() {
            return None;
        }
        let ndjson = ndjson_outfile.map(|path| {
            match File::make_open(path, bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC, 0o664) {
                bun_sys::Result::Ok(fd) => fd,
                bun_sys::Result::Err(err) => {
                    Output::err_generic(
                        "can't open the --reporter=ndjson outfile {}: {}",
                        (bun_fmt::quote(path), err),
                    );
                    bun_core::Global::exit(1);
                }
            }
        });
        Some(TestEventReporter { ndjson, modules, dispatch: OnceCell::new(), failed: Cell::new(false) })
    }

    /// Loads the reporter modules. Called once, before the first test file.
    pub(crate) fn load_modules(&self, vm: &VirtualMachine) {
        if self.modules.is_empty() {
            return;
        }
        let global = vm.global();
        let loaded = (|| {
            let load = bun_jsc::cpp::Bun__TestReporter__loadFunctionOfLastingRealm(global)?;
            let specifiers = JSValue::create_empty_array(global, self.modules.len())?;
            for (i, specifier) in self.modules.iter().enumerate() {
                specifiers.put_index(global, i as u32, bun_string_jsc::create_utf8_for_js(global, specifier)?)?;
            }
            let cwd = bun_string_jsc::create_utf8_for_js(global, bun_resolver::fs::FileSystem::get().top_level_dir())?;
            load.call(global, JSValue::UNDEFINED, &[specifiers, cwd])
        })();
        match loaded {
            Ok(dispatch) => {
                let _ = self.dispatch.set(Strong::create(dispatch, global));
            }
            Err(err) => {
                // Without its reporter the run would report nothing to whoever asked for it.
                bun_test::print_error(vm, global, global.take_exception(err), None);
                bun_core::note!(
                    "a --reporter that isn't \"junit\", \"ndjson\" or \"dots\" is a module, loaded from {}",
                    bun_fmt::quote(bun_resolver::fs::FileSystem::get().top_level_dir())
                );
                Output::flush();
                bun_core::Global::exit(1);
            }
        }
    }

    /// Writes the event to the `ndjson` outfile and passes it to the reporter modules.
    /// A promise that a module's `onFileEnd` or `onRunEnd` hook returns is waited for.
    fn emit(&self, event: Event) {
        let kind = event.kind;
        let mut line = event.text;
        line.push(b'}');
        if let Some(file) = &self.ndjson {
            line.push(b'\n');
            if let bun_sys::Result::Err(err) = file.write_all(&line) {
                Output::err_generic("can't write to the --reporter=ndjson outfile: {}", (err,));
                bun_core::Global::exit(1);
            }
            line.pop();
        }
        let Some(dispatch) = self.dispatch.get().filter(|_| !self.failed.get()) else {
            return;
        };
        let vm = VirtualMachine::get();
        let global = vm.global();
        let error = match bun_string_jsc::create_utf8_for_js(global, &line)
            .and_then(|text| dispatch.get().call(global, JSValue::UNDEFINED, &[text]))
        {
            Ok(result) => {
                let Some(promise) = result.as_any_promise() else {
                    return;
                };
                let _protected = result.protected();
                promise.set_handled(global.vm());
                let waited = vm.event_loop().wait_at_top_level(|| promise.status() != js_promise::Status::Pending);
                if let Err(nothing_left @ TopLevelWaitError::NothingLeft) = waited {
                    global.create_error_instance(format_args!("A reporter's promise never settled\nnote: {nothing_left}"))
                } else if promise.status() == js_promise::Status::Rejected {
                    promise.result(global.vm())
                } else {
                    return;
                }
            }
            Err(err) => global.take_exception(err),
        };
        self.failed.set(true);
        bun_test::print_error(vm, global, error, None);
        bun_core::note!("a --reporter module failed while handling a {} event, so it gets no more events", bun_fmt::quote(kind.as_bytes()));
        Output::flush();
    }

    pub(crate) fn run_start(&self, files: &[bun_ptr::Interned]) {
        let mut event = Event::new("runStart");
        event.key(b"files");
        event.text.push(b'[');
        for (i, file) in files.iter().enumerate() {
            if i > 0 {
                event.text.push(b',');
            }
            event.string_value(file.as_bytes());
        }
        event.text.push(b']');
        self.emit(event);
    }

    pub(crate) fn run_end(&self, summary: &super::jest::Summary, elapsed_ns: u64) {
        let mut event = Event::new("runEnd");
        event.number(b"pass", summary.pass);
        event.number(b"fail", summary.fail);
        event.number(b"skip", summary.skip);
        event.number(b"todo", summary.todo);
        event.number(b"filtered", summary.skipped_because_label);
        event.number(b"files", summary.files);
        event.duration(elapsed_ns);
        self.emit(event);
    }

    pub(crate) fn file_start(&self, path: &[u8]) {
        let mut event = Event::new("fileStart");
        event.string(b"file", path);
        self.emit(event);
    }

    pub(crate) fn file_end(&self, path: &[u8], elapsed_ns: u64, failed_to_load: bool) {
        let mut event = Event::new("fileEnd");
        event.string(b"file", path);
        event.duration(elapsed_ns);
        event.boolean(b"failedToLoad", failed_to_load);
        self.emit(event);
    }

    /// Every `describe()` and `test()` of the file, in the order they were declared, parents first.
    pub(crate) fn file_collected(&self, buntest: &BunTest) {
        let mut event = Event::new("fileCollected");
        event.string(b"file", buntest.file.path);
        event.key(b"tests");
        event.text.push(b'[');
        let mut first = true;
        collect_children(&mut event, buntest, buntest.scope(ScopeId::ROOT), &mut first);
        event.text.push(b']');
        self.emit(event);
    }

    pub(crate) fn test_start(&self, buntest: &BunTest, id: EntryId, attempt: u32) {
        let mut event = Event::new("testStart");
        event.string(b"file", buntest.file.path);
        event.test_id(b"id", id);
        event.number(b"attempt", attempt);
        self.emit(event);
    }

    /// A test finished with its last attempt, or a hook (`test` is `None`) failed.
    pub(crate) fn test_end(
        &self,
        buntest: &BunTest,
        test: Option<EntryId>,
        entry: &ExecutionEntry,
        report: &TestCaseReport<'_>,
        attempt: u32,
    ) {
        let mut event = Event::new(if test.is_some() { "testEnd" } else { "hookFailure" });
        event.string(b"file", buntest.file.path);
        if let Some(id) = test {
            event.test_id(b"id", id);
            event.string(b"name", report.name);
            event.key(b"fullName");
            let mut full_name = Vec::new();
            for (scope, _) in &report.scopes {
                full_name.extend_from_slice(scope);
                full_name.extend_from_slice(b" > ");
            }
            full_name.extend_from_slice(report.name);
            event.string_value(&full_name);
        }
        event.parent_id(entry.base.parent);
        let (status, reason) = status_of(report.status);
        event.string(b"status", status.as_bytes());
        if let Some(reason) = reason {
            event.string(b"reason", reason.as_bytes());
        }
        event.duration(report.elapsed_ns);
        event.number(b"assertions", report.assertions);
        event.number(b"attempt", attempt);
        event.key(b"errors");
        event.failures(report.failure.as_slice());
        event.key(b"earlierAttemptErrors");
        event.failures(&report.earlier_failures);
        self.emit(event);
    }

    pub(crate) fn unhandled_error(&self, path: &[u8], failure: &TestFailure) {
        let mut event = Event::new("unhandledError");
        event.string(b"file", path);
        event.key(b"error");
        event.failure(failure);
        self.emit(event);
    }
}

fn collect_children(event: &mut Event, buntest: &BunTest, scope: &DescribeScope, first: &mut bool) {
    let entries = scope.entries.take();
    for entry in &entries {
        if !core::mem::take(first) {
            event.text.push(b',');
        }
        match *entry {
            TestScheduleEntry::Describe(id) => {
                let describe = buntest.scope(id);
                event.node(b"describe", &describe.base);
                event.describe_id(b"id", id);
                event.text.push(b'}');
                collect_children(event, buntest, describe, first);
            }
            TestScheduleEntry::TestCallback(id) => {
                event.node(b"test", &buntest.entry(id).base);
                event.test_id(b"id", id);
                event.text.push(b'}');
            }
        }
    }
    scope.entries.set(entries);
}

/// (`status`, `reason`) of a result. `status` is "pass", "fail", "skip" or "todo".
fn status_of(result: bun_test::Execution::Result) -> (&'static str, Option<&'static str>) {
    use bun_test::Execution::Result as R;
    match result {
        R::Pass => ("pass", None),
        R::Fail => ("fail", None),
        R::Skip => ("skip", None),
        R::SkippedBecauseLabel => ("skip", Some("filtered")),
        R::Todo => ("todo", None),
        R::FailBecauseTimeout | R::FailBecauseTimeoutWithDoneCallback => ("fail", Some("timeout")),
        R::FailBecauseHookTimeout | R::FailBecauseHookTimeoutWithDoneCallback => ("fail", Some("hookTimeout")),
        R::FailBecauseFailingTestPassed | R::FailBecauseFailsTestPassed => ("fail", Some("failingTestPassed")),
        R::FailBecauseTodoPassed => ("fail", Some("todoPassed")),
        R::FailBecauseExpectedHasAssertions => ("fail", Some("noAssertions")),
        R::FailBecauseExpectedAssertionCount => ("fail", Some("assertionCount")),
        // Never reported: `on_sequence_completed` settles a pending result first.
        R::Pending => ("fail", Some("pending")),
    }
}

/// One event's JSON object, without its closing brace.
struct Event {
    kind: &'static str,
    text: Vec<u8>,
}

impl Event {
    fn new(kind: &'static str) -> Event {
        let mut event = Event { kind, text: Vec::with_capacity(128) };
        event.text.extend_from_slice(b"{\"type\":");
        event.string_value(kind.as_bytes());
        event
    }

    fn key(&mut self, key: &[u8]) {
        if self.text.last() != Some(&b'{') {
            self.text.push(b',');
        }
        self.text.push(b'"');
        self.text.extend_from_slice(key);
        self.text.extend_from_slice(b"\":");
    }

    fn string_value(&mut self, value: &[u8]) {
        let _ = write!(self.text, "{}", bun_fmt::format_json_string_utf8(value, Default::default()));
    }

    fn string(&mut self, key: &[u8], value: &[u8]) {
        self.key(key);
        self.string_value(value);
    }

    fn number(&mut self, key: &[u8], value: u32) {
        self.key(key);
        let _ = write!(self.text, "{value}");
    }

    fn boolean(&mut self, key: &[u8], value: bool) {
        self.key(key);
        self.text.extend_from_slice(if value { b"true" } else { b"false" });
    }

    /// `duration`, in milliseconds.
    fn duration(&mut self, elapsed_ns: u64) {
        self.key(b"duration");
        let _ = write!(self.text, "{}", elapsed_ns as f64 / bun_core::time::NS_PER_MS as f64);
    }

    /// Tests and `describe` blocks have ids of their own kind, so a test and a block can't share one.
    fn test_id(&mut self, key: &[u8], id: EntryId) {
        self.key(key);
        let _ = write!(self.text, "\"t{}\"", id.index());
    }

    fn describe_id(&mut self, key: &[u8], id: ScopeId) {
        self.key(key);
        let _ = write!(self.text, "\"d{}\"", id.index());
    }

    /// `parentId`: the enclosing `describe` block, or null at the top level of the file.
    fn parent_id(&mut self, parent: Option<ScopeId>) {
        match parent.filter(|parent| *parent != ScopeId::ROOT && !parent.is_preload()) {
            Some(parent) => self.describe_id(b"parentId", parent),
            None => {
                self.key(b"parentId");
                self.text.extend_from_slice(b"null");
            }
        }
    }

    /// The opening of a `fileCollected` node, without its `id` and closing brace.
    fn node(&mut self, kind: &[u8], base: &bun_test::BaseScope) {
        self.text.push(b'{');
        self.string(b"type", kind);
        self.string(b"name", base.name.as_deref().unwrap_or(b""));
        self.parent_id(base.parent);
        self.number(b"line", base.line_no);
        self.number(b"column", base.column_no);
        self.string(b"mode", base.mode.tag_name().as_bytes());
        self.boolean(b"only", base.only.get() == bun_test::Only::Yes);
        self.boolean(b"concurrent", base.concurrent);
    }

    fn failures(&mut self, failures: &[TestFailure]) {
        self.text.push(b'[');
        for (i, failure) in failures.iter().enumerate() {
            if i > 0 {
                self.text.push(b',');
            }
            self.failure(failure);
        }
        self.text.push(b']');
    }

    fn failure(&mut self, failure: &TestFailure) {
        self.text.push(b'{');
        self.string(b"name", &failure.name);
        self.string(b"message", &failure.message);
        self.string(b"stack", &failure.body);
        if let (Some(expected), Some(actual)) = (&failure.expected, &failure.actual) {
            self.string(b"expected", expected);
            self.string(b"actual", actual);
        }
        self.boolean(b"uncaught", failure.uncaught);
        self.text.push(b'}');
    }
}
