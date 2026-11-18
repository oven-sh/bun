//! Who is waiting for whom.

use crate::{
    FastHashSet, Gc, InternalMicrotask, InternalReaction, JsAsyncFromSyncIterator,
    JsAsyncFunctionGenerator, JsFunction, JsPromise, PromiseCombinator, StackFrame, Value,
};

impl InternalReaction {
    /// The promise whose fate depends on the one that this reacts to, as far as it is not up to the module loader.
    pub fn dependent_promise(&self) -> Option<Gc<JsPromise>> {
        let of_function = |it: Value| Some(it.downcast::<JsAsyncFunctionGenerator>()?.promise());
        if let Some(combinator) = self.cell.downcast::<PromiseCombinator>() {
            return combinator.promise();
        }
        let waits = match self.context.is::<JsAsyncFromSyncIterator>() {
            true => self.cell,
            false => self.context,
        };
        self.cell.downcast().or_else(|| of_function(waits))
    }
}

impl JsPromise {
    fn awaiter(&self) -> Option<Gc<JsAsyncFunctionGenerator>> {
        self.reactions().next()?.context.downcast()
    }

    /// The last that has come to await it, or a promise that follows it.
    pub fn indirect_awaiter(&self) -> Option<Gc<JsAsyncFunctionGenerator>> {
        const MAX_LINKS: usize = 32;
        let chain = core::iter::successors(Some(Gc::from(self)), |promise| {
            promise.reactions().next()?.cell.downcast::<JsPromise>()
        });
        chain.take(MAX_LINKS).find_map(|promise| promise.awaiter())
    }
}

impl JsAsyncFunctionGenerator {
    /// Those that wait for this one, one for the other, directly or through a combinator. It ends.
    pub fn awaiters(&self) -> impl Iterator<Item = Gc<JsAsyncFunctionGenerator>> + use<> {
        // Each awaits one promise, so only that of a combinator can close a cycle.
        let mut combined = FastHashSet::default();
        let first = self.awaiter(&mut combined);
        core::iter::successors(first, move |generator| generator.awaiter(&mut combined))
    }

    fn awaiter(&self, combined: &mut FastHashSet<usize>) -> Option<Gc<JsAsyncFunctionGenerator>> {
        let reaction = self.promise().reactions().next()?;
        match reaction.task {
            InternalMicrotask::PromiseRaceElement
            | InternalMicrotask::PromiseAllElement
            | InternalMicrotask::PromiseAllSettledElement
            | InternalMicrotask::PromiseAnyElement => (reaction.dependent_promise())
                .filter(|promise| combined.insert(promise.address()))?
                .awaiter(),
            _ => reaction.context.downcast(),
        }
    }

    /// Where it is suspended. `None` if stack traces do not show it.
    pub fn stack_frame(&self) -> Option<StackFrame> {
        let function = self.callee().downcast::<JsFunction>()?;
        let executable = self.executable();
        if executable.is_private_builtin() {
            return None;
        }
        let code_block = executable.code_block(bun_engine_bytecode::Specialization::Call);
        let code_block = code_block.map(|it| it.baseline());
        let point = |it: Gc<crate::CodeBlock>| {
            let points = it.body().suspend_points();
            (points.get(self.point().index())).map_or(0, |point| point.resume)
        };
        Some(StackFrame {
            callee: Some(function.cell()),
            code_block,
            bytecode_offset: code_block.filter(|_| self.is_suspended()).map_or(0, point),
            is_async: true,
            is_wasm: false,
        })
    }
}
