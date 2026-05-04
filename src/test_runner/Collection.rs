//! for the collection phase of test execution where we discover all the test() calls

use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, Strong};

use crate::bun_test::{
    self, BunTest, BunTestPtr, BunTestRoot, DescribeScope, HandleUncaughtExceptionResult,
    StepResult,
};
use crate::bun_test::debug::group;
// TODO(port): jsc.Jest.Jest.runner / jsc.ConsoleObject live under bun_jsc::jest / bun_jsc::console_object — verify module paths in Phase B
use bun_jsc::jest::Jest;
use bun_jsc::console_object::Formatter as ConsoleFormatter;

pub struct Collection {
    /// set to true after collection phase ends
    pub locked: bool,
    pub describe_callback_queue: Vec<QueuedDescribe<'static>>,
    pub current_scope_callback_queue: Vec<QueuedDescribe<'static>>,
    // TODO(port): the two Vec<QueuedDescribe<'static>> above are self-referential — the
    // &'a DescribeScope fields borrow into the tree rooted at `root_scope`. LIFETIMES.tsv
    // classifies them BORROW_PARAM, but Phase B will likely need NonNull<DescribeScope>
    // (same as `active_scope`) to express this without a self-borrow.

    pub root_scope: Box<DescribeScope>,
    pub active_scope: NonNull<DescribeScope>,

    pub filter_buffer: Vec<u8>,
}

pub struct QueuedDescribe<'a> {
    callback: Strong, // jsc.Strong.Deprecated
    active_scope: &'a DescribeScope,
    new_scope: &'a DescribeScope,
}
// Zig `deinit` only called `callback.deinit()`; `Strong: Drop` covers it — no explicit Drop needed.

impl Collection {
    pub fn init(bun_test_root: &mut BunTestRoot) -> Collection {
        // TODO(port): @src() source-location for debug tracing — consider #[track_caller] + Location::caller()
        group::begin();
        let _g = scopeguard::guard((), |_| group::end());

        let only = if let Some(runner) = Jest::runner() {
            if runner.only { bun_test::Only::Contains } else { bun_test::Only::No }
        } else {
            bun_test::Only::No
        };

        let mut root_scope = DescribeScope::create(bun_test::DescribeScopeInit {
            parent: bun_test_root.hook_scope,
            name: None,
            concurrent: false,
            mode: bun_test::Mode::Normal,
            only,
            has_callback: false,
            test_id_for_debugger: 0,
            line_no: 0,
        });
        // TODO(port): DescribeScope::create signature — Zig took a struct-literal of options; field names preserved.

        let active_scope = NonNull::from(&mut *root_scope);

        Collection {
            locked: false,
            describe_callback_queue: Vec::new(),
            current_scope_callback_queue: Vec::new(),
            root_scope,
            active_scope,
            filter_buffer: Vec::new(),
        }
    }

    // Zig `deinit` freed root_scope, drained both queues calling item.deinit(), and freed
    // filter_buffer. All of that is covered by field Drop (Box, Vec<QueuedDescribe>, Vec<u8>).
    // No explicit `impl Drop for Collection` needed.

    fn bun_test(&mut self) -> &mut BunTest {
        // SAFETY: self points to BunTest.collection (Collection is only ever embedded there).
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(core::mem::offset_of!(BunTest, collection))
                .cast::<BunTest>()
        }
    }

    pub fn enqueue_describe_callback(
        &mut self,
        new_scope: &mut DescribeScope,
        callback: Option<JSValue>,
    ) -> JsResult<()> {
        group::begin();
        let _g = scopeguard::guard((), |_| group::end());

        debug_assert!(!self.locked);
        let _buntest = self.bun_test();
        // PORT NOTE: reshaped for borrowck — Zig used `buntest.gpa` for Strong.init; allocator param dropped.

        if let Some(cb) = callback {
            group::log(format_args!(
                "enqueueDescribeCallback / {} / in scope: {}",
                bstr::BStr::new(new_scope.base.name.as_deref().unwrap_or(b"(unnamed)")),
                // SAFETY: active_scope is always a valid cursor into root_scope's tree.
                bstr::BStr::new(unsafe { self.active_scope.as_ref() }.base.name.as_deref().unwrap_or(b"(unnamed)")),
            ));

            // SAFETY: active_scope is a valid cursor into root_scope's tree for the lifetime of Collection.
            let active_scope: &DescribeScope = unsafe { self.active_scope.as_ref() };
            self.current_scope_callback_queue.push(QueuedDescribe {
                // TODO(port): lifetime — see note on Collection field; transmuting borrow to 'static here.
                // SAFETY: borrow points into root_scope's tree which outlives every QueuedDescribe
                // stored in self; 'static is a Phase-A placeholder (see TODO above).
                active_scope: unsafe { core::mem::transmute::<&DescribeScope, &'static DescribeScope>(active_scope) },
                callback: Strong::new(cb),
                // SAFETY: borrow points into root_scope's tree which outlives every QueuedDescribe
                // stored in self; 'static is a Phase-A placeholder (see TODO above).
                new_scope: unsafe { core::mem::transmute::<&DescribeScope, &'static DescribeScope>(new_scope) },
            });
        }
        Ok(())
    }

    pub fn run_one_completed(
        &mut self,
        global_this: &JSGlobalObject,
        _: Option<JSValue>,
        data: bun_test::bun_test_ref_data_value::RefDataValue,
    ) -> JsResult<()> {
        group::begin();
        let _g = scopeguard::guard((), |_| group::end());

        let _formatter = ConsoleFormatter { global_this, quote_strings: true, ..Default::default() };
        // TODO(port): ConsoleObject.Formatter construction — Zig used struct-literal; verify Rust ctor shape.

        let prev_scope: &DescribeScope = match data {
            bun_test::bun_test_ref_data_value::RefDataValue::Collection(c) => c.active_scope,
            _ => 'blk: {
                debug_assert!(false); // this probably can't happen
                // SAFETY: active_scope is always valid while Collection lives.
                break 'blk unsafe { self.active_scope.as_ref() };
            }
        };

        group::log(format_args!(
            "collection:runOneCompleted reset scope back from {}",
            // SAFETY: active_scope is always valid while Collection lives.
            bstr::BStr::new(unsafe { self.active_scope.as_ref() }.base.name.as_deref().unwrap_or(b"undefined")),
        ));
        self.active_scope = NonNull::from(prev_scope);
        group::log(format_args!(
            "collection:runOneCompleted reset scope back to {}",
            // SAFETY: active_scope is always valid while Collection lives.
            bstr::BStr::new(unsafe { self.active_scope.as_ref() }.base.name.as_deref().unwrap_or(b"undefined")),
        ));
        Ok(())
    }

    pub fn step(
        buntest_strong: BunTestPtr,
        global_this: &JSGlobalObject,
        data: bun_test::bun_test_ref_data_value::RefDataValue,
    ) -> JsResult<StepResult> {
        group::begin();
        let _g = scopeguard::guard((), |_| group::end());
        let buntest = buntest_strong.get();
        let this = &mut buntest.collection;

        if !matches!(data, bun_test::bun_test_ref_data_value::RefDataValue::Start) {
            this.run_one_completed(global_this, None, data)?;
        }

        let _formatter = ConsoleFormatter { global_this, quote_strings: true, ..Default::default() };
        // TODO(port): ConsoleObject.Formatter construction — verify Rust ctor shape.

        // append queued callbacks, in reverse order because items will be pop()ed from the end
        // PORT NOTE: reshaped for borrowck — Zig indexed `items[i]` then clearRetainingCapacity;
        // drain(..).rev() moves each item out exactly once and leaves capacity intact.
        for item in this.current_scope_callback_queue.drain(..).rev() {
            if item.new_scope.failed {
                // if there was an error in the describe callback, don't run any describe callbacks in this scope
                drop(item); // Zig: item.deinit() — Strong released here
            } else {
                this.describe_callback_queue.push(item);
            }
        }
        // PERF(port): was clearRetainingCapacity — drain(..) retains capacity.

        while !this.describe_callback_queue.is_empty() {
            group::log(format_args!("runOne -> call next"));
            let first = this.describe_callback_queue.pop().unwrap();
            // `defer first.deinit()` — handled by Drop at end of loop body / continue.

            if first.active_scope.failed {
                continue; // do not execute callbacks that came from a failed describe scope
            }

            let callback = &first.callback;
            let active_scope = first.active_scope;
            let new_scope = first.new_scope;

            let previous_scope = active_scope;

            group::log(format_args!(
                "collection:runOne set scope from {}",
                // SAFETY: active_scope is always valid while Collection lives.
                bstr::BStr::new(unsafe { this.active_scope.as_ref() }.base.name.as_deref().unwrap_or(b"undefined")),
            ));
            this.active_scope = NonNull::from(new_scope);
            group::log(format_args!(
                "collection:runOne set scope to {}",
                // SAFETY: active_scope is always valid while Collection lives.
                bstr::BStr::new(unsafe { this.active_scope.as_ref() }.base.name.as_deref().unwrap_or(b"undefined")),
            ));

            if let Some(cfg_data) = BunTest::run_test_callback(
                buntest_strong,
                global_this,
                callback.get(),
                false,
                bun_test::bun_test_ref_data_value::RefDataValue::Collection(
                    bun_test::bun_test_ref_data_value::CollectionData { active_scope: previous_scope },
                ),
                &bun_test::Epoch::EPOCH,
                // TODO(port): `&.epoch` — Zig decl-literal; verify constant name/path.
            ) {
                // the result is available immediately; queue
                buntest.add_result(cfg_data);
            }

            return Ok(StepResult::Waiting(Default::default()));
        }
        Ok(StepResult::Complete)
    }

    pub fn handle_uncaught_exception(
        &mut self,
        _: bun_test::bun_test_ref_data_value::RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        group::begin();
        let _g = scopeguard::guard((), |_| group::end());

        // SAFETY: active_scope is always a valid cursor into root_scope's tree.
        unsafe { self.active_scope.as_mut() }.failed = true;

        HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe // unhandled because it needs to exit with code 1
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/Collection.zig (170 lines)
//   confidence: medium
//   todos:      8
//   notes:      QueuedDescribe<'a> is self-referential into root_scope tree — Phase B likely needs NonNull instead of &'a; group.begin/end/log debug-tracing API shape guessed.
// ──────────────────────────────────────────────────────────────────────────
