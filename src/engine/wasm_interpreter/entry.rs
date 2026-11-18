//! Calls from the host.

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::FuncIndex;
use bun_engine_wasm_runtime::interpreted::{Context, Entry, Parked, Site};
use bun_engine_wasm_runtime::{Failure, Incoming, Instance, Outcome, Outgoing, Tag, Thrown};

use crate::code::{Pc, existing_functions, index_before};
use crate::machine::{Cx, Frame, Running};
use crate::run::calls::{run, settle};
use crate::run::exceptions::{catch, throw_from};

/// In the frame of an entry.
fn start<'a>(root: &Frame<'a, '_>, entry: &Entry<'a>) -> Result<(), Failure> {
    const NOWHERE: Site = 1;
    let (cx, callee, slots) = (root.cx, entry.callee(), root.slots());
    let func = callee.func();
    let (result, _) = match cx.existing_code(func.usize()) {
        Some(code) => {
            let running = Running::new(&code.ops, cx);
            cx.call(root, NOWHERE, func, slots, running, |frame| {
                settle(frame, run(&code.ops, frame, cx))
            })
        }
        None => cx.call(root, NOWHERE, func, slots, Running::nothing(cx), |frame| {
            settle(frame, Outcome::failure(frame.hand_over(callee)))
        }),
    };
    cx.return_to(root);
    result.map(drop)
}

fn context_for<'a>(entry: &Entry<'a>) -> Result<Cx<'a>, Thrown> {
    Cx::new(entry.context().of(entry.callee())).map_err(|_| entry.throw(Trap::OutOfMemory))
}

/// `put` sets every argument to a value of its type. `None` if the call is suspended.
#[inline]
pub fn call<R>(
    entry: &Entry<'_>,
    put: impl FnOnce(Outgoing<'_>) -> Result<(), Thrown>,
    take: impl FnOnce(Incoming<'_>) -> Result<R, Thrown>,
) -> Result<Option<R>, Thrown> {
    let cx = context_for(entry)?;
    entry.call(Running::nothing(&cx), put, |root| start(root, entry), take)
}

type PutResults<'a> = &'a mut dyn FnMut(&Instance, Outgoing<'_>) -> Result<(), Thrown>;

/// Makes the frame with that index and those inside it again, and lets them run.
fn restore<'a>(
    parked: &Parked<'a>,
    index: usize,
    root: &Frame<'a, '_>,
    caller: &Frame<'a, '_>,
    put: PutResults<'_>,
) -> Result<u64, Failure> {
    let (callee, first_slot, site) = parked.frame(index);
    let slots = (root.cx.window(root.slots(), first_slot)).ok_or(Trap::StackOverflow)?;
    if index == parked.frame_count() {
        let cx = caller.cx;
        return cx.call_out(caller, site, slots, Running::nothing(cx), |frame| {
            let ended = cx.end_host_call(frame, callee, put);
            ended.map_err(|failure| throw_from(frame, failure))?;
            Ok(slots[0].get())
        });
    }
    let cx = Cx::new(root.cx.of(callee)).map_err(|_| Trap::OutOfMemory)?;
    let ops = &cx.code(callee.func()).map_err(|_| Trap::OutOfMemory)?.ops;
    let running = Running::new(ops, &cx);
    let (result, caller) = cx.call(caller, site, callee.func(), slots, running, |frame| {
        let (_, _, site) = parked.frame(index + 1);
        let returned = match Context::has_room(&cx, frame) {
            true => restore(parked, index + 1, root, frame, put),
            false => Err(Trap::StackOverflow.into()),
        };
        settle(frame, go_on(frame, site, returned))
    });
    cx.return_to(caller);
    result
}

/// After the call before the site.
fn go_on<'a, 'f>(frame: &'f Frame<'a, 'f>, site: Site, returned: Result<u64, Failure>) -> Outcome {
    let (ops, cx) = (frame.ops.get(), frame.cx);
    let (link, pc) = Pc::after(ops, index_before(ops, site)).expect("the site of a call");
    let (handler, value) = match returned.map_err(|it| (it, it.as_exception())) {
        Ok(value) => (link.next, value),
        Err((_, Some(exception))) => (catch as _, exception.address() as u64),
        Err((failure, None)) => return Outcome::failure(failure),
    };
    handler(
        pc,
        frame.slots(),
        cx.first_memory(),
        frame,
        cx,
        value,
        0.0,
        0.0,
    )
}

/// `put` ends the call of the import, and sets every result to a value of its type. `None` if the call is suspended
/// again.
pub fn resume<'a, R>(
    parked: &Parked<'a>,
    mut put: impl FnMut(&Instance, Outgoing<'_>) -> Result<(), Thrown>,
    take: impl FnOnce(Incoming<'_>) -> Result<R, Thrown>,
) -> Result<Option<R>, Thrown> {
    let cx = context_for(parked.entry())?;
    let run = |root: &Frame<'a, '_>| {
        let result = restore(parked, 0, root, root, &mut put);
        result
            .map(drop)
            .map_err(|failure| root.cx.raise(root, failure))
    };
    parked.resume(Running::nothing(&cx), run, take)
}

/// Whether a frame of the function would catch what has the tag. The site may be anything.
pub fn catches(instance: &Instance, func: FuncIndex, site: Site, tag: &Tag) -> bool {
    let find = || {
        let code = existing_functions(instance.module())?
            .get(func.usize())?
            .get()?;
        let is_tag = |it| instance.tag(it).identity() == tag.identity();
        (code.handlers.as_ref()?).find(index_before(&code.ops, site), is_tag)
    };
    find().is_some()
}
