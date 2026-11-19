//! for the collection phase of test execution where we discover all the test() calls

use core::cell::Cell;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, ProtectedJSValue};
use bun_core::Timespec;
use bun_ptr::CellExt as _;

use crate::test_runner::bun_test::{
    BunTest, BunTestPtr, HandleUncaughtExceptionResult, RefDataValue, ScopeId, StepResult,
};
use crate::test_runner::bun_test::debug::group;

pub(crate) struct Collection {
    describe_callback_queue: Cell<Vec<QueuedDescribe>>,
    current_scope_callback_queue: Cell<Vec<QueuedDescribe>>,

    pub(crate) active_scope: Cell<ScopeId>,

    pub(crate) filter_buffer: Cell<Vec<u8>>,
}

struct QueuedDescribe {
    callback: ProtectedJSValue,
    active_scope: ScopeId,
    new_scope: ScopeId,
}

impl Collection {
    pub(crate) fn init() -> Collection {
        Collection {
            describe_callback_queue: Cell::default(),
            current_scope_callback_queue: Cell::default(),
            active_scope: Cell::new(ScopeId::ROOT),
            filter_buffer: Cell::default(),
        }
    }

    pub(crate) fn enqueue_describe_callback(
        buntest: &BunTest,
        new_scope: ScopeId,
        callback: Option<JSValue>,
    ) -> JsResult<()> {
        let _g = group::begin();

        if let Some(cb) = callback {
            group::log(format_args!(
                "enqueueDescribeCallback / {} / in scope: {}",
                bstr::BStr::new(buntest.scope(new_scope).base.name.as_deref().unwrap_or(b"(unnamed)")),
                bstr::BStr::new(buntest.active_scope().base.name.as_deref().unwrap_or(b"(unnamed)")),
            ));

            let queued = QueuedDescribe {
                active_scope: buntest.collection.active_scope.get(),
                callback: cb.protected(),
                new_scope,
            };
            buntest.collection.current_scope_callback_queue.with_taken(|queue| queue.push(queued));
        }
        Ok(())
    }

    fn run_one_completed(buntest: &BunTest, data: &RefDataValue) {
        let _g = group::begin();

        let prev_scope: ScopeId = match data {
            RefDataValue::Collection { active_scope } => *active_scope,
            _ => {
                debug_assert!(false); // this probably can't happen
                buntest.collection.active_scope.get()
            }
        };

        group::log(format_args!(
            "collection:runOneCompleted reset scope back from {}",
            bstr::BStr::new(buntest.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
        ));
        buntest.collection.active_scope.set(prev_scope);
        group::log(format_args!(
            "collection:runOneCompleted reset scope back to {}",
            bstr::BStr::new(buntest.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
        ));
    }

    fn take_next_callback(buntest: &BunTest) -> Option<QueuedDescribe> {
        let this = &buntest.collection;
        this.describe_callback_queue.with_taken(|queue| {
            // append queued callbacks, in reverse order because items will be pop()ed from the end
            this.current_scope_callback_queue.with_taken(|current| {
                // if there was an error in the describe callback, don't run any describe callbacks in this scope
                queue.extend(current.drain(..).rev().filter(|item| !buntest.scope(item.new_scope).failed.get()));
            });
            // do not execute callbacks that came from a failed describe scope
            core::iter::from_fn(|| queue.pop()).find(|item| !buntest.scope(item.active_scope).failed.get())
        })
    }

    pub(crate) fn step(
        buntest: &BunTestPtr,
        global_this: &JSGlobalObject,
        data: &RefDataValue,
    ) -> JsResult<StepResult> {
        let _g = group::begin();

        if !matches!(data, RefDataValue::Start) {
            Self::run_one_completed(buntest, data);
        }

        let Some(first) = Self::take_next_callback(buntest) else {
            return Ok(StepResult::Complete);
        };

        group::log(format_args!(
            "collection:runOne set scope from {}",
            bstr::BStr::new(buntest.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
        ));
        buntest.collection.active_scope.set(first.new_scope);
        group::log(format_args!(
            "collection:runOne set scope to {}",
            bstr::BStr::new(buntest.active_scope().base.name.as_deref().unwrap_or(b"undefined")),
        ));

        if let Some(cfg_data) = BunTest::run_test_callback(
            buntest,
            global_this,
            first.callback.value(),
            &[],
            false,
            RefDataValue::Collection { active_scope: first.active_scope },
            &Timespec::EPOCH,
        ) {
            // the result is available immediately; queue
            buntest.add_result(cfg_data);
        }

        Ok(StepResult::Waiting { timeout: Timespec::EPOCH })
    }

    pub(crate) fn handle_uncaught_exception(
        buntest: &BunTest,
        data: &RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _g = group::begin();

        // The error didn't come from a describe() callback, so don't fail whichever scope happens to be active.
        if !matches!(data, RefDataValue::Collection { .. })
            || buntest.collection.active_scope.get() == ScopeId::ROOT
        {
            return HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests;
        }
        buntest.active_scope().failed.set(true);

        HandleUncaughtExceptionResult::ShowUnhandledErrorInDescribe // unhandled because it needs to exit with code 1
    }
}
