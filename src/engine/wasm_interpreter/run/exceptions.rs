//! Throwing and catching.

use bun_engine_wasm_format::TagIndex;
use bun_engine_wasm_runtime::interpreted::Site;
use bun_engine_wasm_runtime::{Failure, Reference, Tag};

use super::control::jump;
use crate::code::index_before;
use crate::machine::{Frame, Machine, Running, fail, given, go, handlers};

fn handler_at(frame: &Frame<'_, '_>, site: Site, tag: &Tag) -> Option<u32> {
    let code = frame.cx.existing_code(frame.func().usize())?;
    let handlers = code.handlers.as_ref()?;
    handlers.find(index_before(&code.ops, site), |it| frame.cx.is_tag(it, tag))
}

/// `frame` is for no function.
#[cold]
pub(crate) fn throw_from(frame: &Frame<'_, '_>, failure: Failure) -> Failure {
    frame.cx.throw(failure, |tag| {
        let mut callers = core::iter::successors(frame.caller(), |(frame, _)| frame.caller());
        callers.any(|(frame, site)| handler_at(frame, site, tag).is_some())
    })
}

impl Machine<'_, '_> {
    /// After the records of the instruction have been taken.
    fn throw(&self, failure: Failure) -> Failure {
        let (cx, site) = (self.cx, self.pc.site());
        let running = Running::nothing(cx);
        cx.call_out(self.frame, site, self.slots, running, |frame| {
            throw_from(frame, failure)
        })
    }
}

macro_rules! throw {
    ($m:ident, $failure:expr) => {{
        let failure = $m.throw($failure);
        let Some(exception) = failure.as_exception() else {
            fail!(failure);
        };
        $m.forget_last_results();
        $m.int = exception.address() as u64;
        go!($m, catch);
    }};
}

handlers! {
    /// The last result, which the instruction before throws, and this function or a caller catches.
    #[cold]
    fn catch(m) {
        let exception = given!(Reference(m.int).cell());
        let Some(target) = handler_at(m.frame, m.pc.site(), m.cx.tag_of(exception)) else {
            fail!(Failure::exception(exception));
        };
        m.memory = m.cx.first_memory();
        jump!(m, target, false);
    }

    fn throw(m, op) {
        let tag = TagIndex(op.imm);
        m.keep_frame();
        let payload = given!(m.range(op.low(), m.cx.payload_slots(tag)));
        throw!(m, m.cx.new_exception(tag, payload));
    }

    fn throw_ref(m, op) {
        m.keep_frame();
        throw!(m, m.cx.existing_exception(m.get(op.a)));
    }

    /// First in a handler, unless it has no use for the exception.
    fn keep_exception(m, op) {
        given!(given!(m.range(op.imm, 1)).first()).set(m.int);
    }

    /// The same.
    fn unpack(m, op) {
        let payload = m.cx.payload(m.int);
        let slots = given!(m.range(op.imm, payload.len()));
        slots.iter().zip(payload).for_each(|(slot, &word)| slot.set(word));
    }
}
