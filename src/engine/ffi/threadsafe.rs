//! Calls that come from any thread and are made later, on that of the `Vm`.

use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use bun_engine_exec_memory::{CodeHandle, OutOfExecutableMemory};
use bun_engine_vm::heap::{WeakImpl, WeakOwner};
use bun_engine_vm::{AsciiLiteral, Cx, Gc, JsResult, ValueVec, Visitor, Vm, ascii_literal};
use smallvec::SmallVec;

use crate::callback::link_entry;
use crate::convert::{c_string_at, decode};
use crate::stubs::Receiver;
use crate::{FfiCallback, NativeType, Signature, slot_to_value};

/// Takes a call to the thread of the `Vm`. Any thread can call `function` with `context`, and gives it a box to own.
pub struct Dispatch {
    pub function: unsafe extern "C" fn(*mut Invocation, *mut c_void),
    pub context: *mut c_void,
}

/// Nothing tells when the last thread has left it, so it stays until the process ends.
#[repr(C)]
pub(crate) struct Mailbox {
    receiver: Receiver,
    signature: &'static Signature,
    dispatch: Dispatch,
    /// `CLOSED`, and `PENDING` for each `Invocation`.
    state: AtomicUsize,
    /// The address, or zero once it is dead.
    callback: AtomicUsize,
    entry: OnceLock<CodeHandle>,
}

// SAFETY: what `Dispatch` stands for.
unsafe impl Sync for Mailbox {}

const CLOSED: usize = 1;
const PENDING: usize = 2;

/// # Safety
/// The address of a mailbox.
unsafe fn mailbox_at(address: usize) -> &'static Mailbox {
    // SAFETY: the caller's.
    unsafe { &*core::ptr::with_exposed_provenance(address) }
}

unsafe extern "C" fn has_pending_calls(
    _: &WeakOwner,
    _: &WeakImpl,
    mailbox: *mut c_void,
    _: &mut Visitor,
    reason: Option<&mut AsciiLiteral>,
) -> bool {
    if let Some(reason) = reason {
        *reason = ascii_literal!("Callback with pending activity");
    }
    // SAFETY: the context of the handle.
    unsafe { mailbox_at(mailbox.addr()) }
        .state
        .load(Ordering::SeqCst)
        >= PENDING
}

unsafe extern "C" fn forget_callback(_: &WeakOwner, _: &WeakImpl, mailbox: *mut c_void) -> bool {
    // SAFETY: as above.
    let mailbox = unsafe { mailbox_at(mailbox.addr()) };
    mailbox.close();
    mailbox.callback.store(0, Ordering::SeqCst);
    true
}

static OWNER: WeakOwner = WeakOwner {
    is_reachable_from_opaque_roots: has_pending_calls,
    finalize: forget_callback,
};

impl Mailbox {
    pub(crate) fn open(
        vm: &Vm,
        callback: Gc<FfiCallback>,
        dispatch: Dispatch,
    ) -> Result<&'static Mailbox, OutOfExecutableMemory> {
        let mailbox: &Mailbox = Box::leak(Box::new(Mailbox {
            receiver: receive,
            signature: callback.signature(),
            dispatch,
            state: AtomicUsize::new(0),
            callback: AtomicUsize::new(callback.address()),
            entry: OnceLock::new(),
        }));
        let address = core::ptr::from_ref(mailbox).expose_provenance();
        let _ = mailbox.entry.set(link_entry(mailbox.signature, address)?);
        let context = core::ptr::without_provenance_mut(address);
        // SAFETY: a static, whose functions expect that context.
        unsafe { (vm.heap).allocate_weak_handle(callback.cell(), &raw const OWNER, context) };
        Ok(mailbox)
    }

    pub(crate) fn entry(&self) -> usize {
        self.entry.get().expect("set when it is opened").start()
    }

    pub(crate) fn close(&self) {
        self.state.fetch_or(CLOSED, Ordering::SeqCst);
    }
}

enum Argument {
    Slot(u64),
    /// The caller's copy is gone by the time that the call is made.
    String(Box<[u8]>),
}

/// A call that has yet to reach the script.
pub struct Invocation {
    mailbox: &'static Mailbox,
    arguments: SmallVec<[Argument; 4]>,
}

impl Invocation {
    /// # Safety
    /// On the thread that the `Vm` of the callback has or had, where scripts may run and no exception is pending.
    pub unsafe fn run(&self) -> JsResult<()> {
        let address = self.mailbox.callback.load(Ordering::SeqCst);
        if address == 0 {
            return Ok(());
        }
        // SAFETY: not dead as of the last collection, and the caller's.
        let (callback, cx) = unsafe {
            let callback = Gc::<FfiCallback>::from_address(address);
            (callback, Cx::from_global(callback.global()))
        };
        if callback.global().discards_microtasks() {
            return Ok(());
        }
        let mut values = ValueVec::new();
        let types = self.mailbox.signature.arguments();
        for (argument, &argument_type) in self.arguments.iter().zip(types) {
            values.push(match argument {
                // SAFETY: the promise of the maker of the callback.
                &Argument::Slot(slot) => unsafe { slot_to_value(cx, argument_type, slot) }?,
                Argument::String(bytes) => decode(cx, bytes)?,
            });
        }
        callback.call(cx, &values).map(drop)
    }
}

impl Drop for Invocation {
    fn drop(&mut self) {
        self.mailbox.state.fetch_sub(PENDING, Ordering::SeqCst);
    }
}

unsafe extern "C" fn receive(context: usize, slots: *const u64) -> u64 {
    // SAFETY: what the entry was made with, and the promise of the maker of the callback.
    unsafe {
        let mailbox = mailbox_at(context);
        let mut invocation = Invocation {
            mailbox,
            arguments: SmallVec::new(),
        };
        if mailbox.state.fetch_add(PENDING, Ordering::SeqCst) & CLOSED != 0 {
            return 0;
        }
        let types = mailbox.signature.arguments();
        let slots = core::slice::from_raw_parts(slots, types.len());
        let arguments = types.iter().zip(slots).map(|pair| match pair {
            (NativeType::CString, &address @ 1..) => Argument::String(c_string_at(address).into()),
            (_, &slot) => Argument::Slot(slot),
        });
        invocation.arguments.extend(arguments);
        let invocation = Box::into_raw(Box::new(invocation));
        (mailbox.dispatch.function)(invocation, mailbox.dispatch.context);
    }
    0
}
