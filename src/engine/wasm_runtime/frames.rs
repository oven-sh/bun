//! What the host needs to walk and unwind the stack. Only the frames of stubs are ever at the top.

use core::cell::Cell;
use core::mem::offset_of;
use core::num::NonZeroUsize;
use core::ptr;

use bun_engine_exec_memory::lock_owners;
use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::{CALLEE_TAG, ENTRY_CALLEE, STUB_CALLEE, frame, func_of};
use bun_engine_wasm_format::FuncIndex;

use crate::code::{CodeKind, InstalledCode};
use crate::engine::Engine;
use crate::host::Thrown;
use crate::instance::Instance;
use crate::outcome::{Decoded, Failure};
use crate::tag::Tag;
use crate::value::HostCell;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Frame {
    pub fp: usize,
    /// From the frame below it. Zero if there is none.
    pub return_address: usize,
}

/// Where an exception goes. The code gets the frame pointer and the registers that are pinned in JavaScript.
#[derive(Clone, Copy, Debug)]
#[repr(C)]
pub struct Catch {
    pub fp: usize,
    pub address: usize,
}

/// The code in a frame that goes on with an exception.
pub struct Handler<'a> {
    instance: &'a Instance,
    address: usize,
    stack_pointer: usize,
}

impl<'a> Handler<'a> {
    pub fn instance(&self) -> &'a Instance {
        self.instance
    }

    /// Where to jump with the frame pointer of the frame, before anything else happens.
    ///
    /// # Safety
    /// `exception` is an `exnref` with the tag that the handler was found for.
    pub unsafe fn enter_with(self, exception: HostCell) -> usize {
        let resumption = self.instance.resumption();
        resumption.address.set(self.address);
        resumption.stack_pointer.set(self.stack_pointer);
        self.instance.set_caught(exception);
        self.instance.engine().stubs().resume
    }
}

/// For the stub that resumes.
#[derive(Default)]
pub(crate) struct Resumption {
    address: Cell<usize>,
    stack_pointer: Cell<usize>,
}

impl Resumption {
    pub(crate) const ADDRESS: i32 = offset_of!(Self, address) as i32;
    pub(crate) const STACK_POINTER: i32 = offset_of!(Self, stack_pointer) as i32;
}

impl Frame {
    /// # Safety
    /// The frame at `fp` is on a stack.
    pub(crate) unsafe fn caller_of(fp: usize) -> Self {
        // SAFETY: the caller's.
        let [fp, return_address] = unsafe { ptr::with_exposed_provenance::<[usize; 2]>(fp).read() };
        Self { fp, return_address }
    }

    /// # Safety
    /// The frame is on a stack, and has called compiled code.
    unsafe fn callee(self) -> u64 {
        let callee = ptr::with_exposed_provenance::<u64>(self.fp + frame::CALLEE as usize);
        // SAFETY: the caller's.
        unsafe { callee.read() }
    }

    /// Whether it is that of a stub that the host has called.
    ///
    /// # Safety
    /// As above.
    pub(crate) unsafe fn is_of_entry_stub(self) -> bool {
        // SAFETY: the caller's.
        unsafe { self.callee() == ENTRY_CALLEE.into() }
    }

    /// Whether it is where WebAssembly was called from outside, be it by code that the host has generated.
    ///
    /// # Safety
    /// As above.
    unsafe fn is_entry(self) -> bool {
        const TAG: u64 = CALLEE_TAG as u64;
        // SAFETY: the caller's.
        unsafe { self.callee() & TAG != TAG || self.is_of_entry_stub() }
    }

    /// # Safety
    /// The frame is on a stack for `'a`.
    unsafe fn code<'a>(self) -> Option<&'a InstalledCode> {
        // SAFETY: the caller's.
        unsafe { InstalledCode::running_at(self.return_address.checked_sub(1)?) }
    }
}

/// The frame pointer of who has called WebAssembly from outside.
///
/// # Safety
/// `fp` is that of a stub that compiled code has called.
pub(crate) unsafe fn entry_above(fp: usize) -> usize {
    // SAFETY: the caller's. Up to the entry there are only frames of functions.
    unsafe {
        let mut frame = Frame::caller_of(fp);
        while !frame.is_entry() {
            frame = Frame::caller_of(frame.fp);
        }
        frame.fp
    }
}

impl Engine {
    /// # Safety
    /// The frame at `fp` is that of a function or of a stub that fills in the header, and is on a stack for `'a`.
    pub unsafe fn instance_of_frame<'a>(&self, fp: usize) -> &'a Instance {
        let place = ptr::with_exposed_provenance::<usize>(fp + frame::INSTANCE as usize);
        // SAFETY: the prologue wrote it, and the collector finds it there.
        let instance = unsafe {
            let cell = NonZeroUsize::new(place.read());
            cell.and_then(|cell| Instance::of_cell(self, HostCell(cell)))
        };
        instance.expect("an instance")
    }

    /// `None` unless the frame catches the exception. `tag` is asked for its tag only if that matters, and can say
    /// that it is not to be caught.
    ///
    /// # Safety
    /// The frame is on the stack of this thread for `'a`.
    pub unsafe fn find_handler<'a>(
        &self,
        frame: Frame,
        tag: impl FnOnce() -> Option<&'a Tag>,
    ) -> Option<Handler<'a>> {
        // SAFETY: the caller's.
        let code = unsafe { frame.code() }?;
        let (address, mut taken) = code.handler(frame.return_address)?;
        let tag = tag()?;
        // SAFETY: the code tells.
        let instance = unsafe { self.instance_of_frame(frame.fp) };
        let is_taken =
            taken.any(|it| it.is_none_or(|it| instance.tag(it).identity() == tag.identity()));
        is_taken.then(|| Handler {
            instance,
            address,
            stack_pointer: frame.fp - code.frame_size(),
        })
    }

    /// # Safety
    /// `exception` is an `exnref` that lives for `'a`.
    pub(crate) unsafe fn tag_of<'a>(&self, exception: HostCell) -> &'a Tag {
        let identity = exception.field::<usize>(self.layout().exception_tag);
        // SAFETY: it keeps its tag.
        unsafe { &*ptr::with_exposed_provenance(identity.read()) }
    }

    /// `None` for a stub, and where nothing is compiled.
    ///
    /// # Safety
    /// The frame is on the stack of this thread.
    pub unsafe fn kind_of_code(&self, frame: Frame) -> Option<CodeKind> {
        // SAFETY: the caller's.
        unsafe { frame.code() }.map(InstalledCode::kind)
    }

    /// The functions that are active in the frame, the innermost first. None for a stub.
    ///
    /// # Safety
    /// The frame is on a stack for `'a`.
    pub unsafe fn functions_in<'a>(&self, frame: Frame) -> impl Iterator<Item = FuncIndex> + 'a {
        // SAFETY: the caller's.
        let (code, interpreted) = unsafe {
            match self.compiles() {
                true => (frame.code(), None),
                false => (None, interpreted_function(frame.callee())),
            }
        };
        code.into_iter()
            .flat_map(move |code| code.functions_at(frame.return_address))
            .chain(interpreted)
    }
}

/// From the word for the callee in a frame of an interpreter. It may be any.
pub fn interpreted_function(callee: u64) -> Option<FuncIndex> {
    let callee = u32::try_from(callee).ok();
    (callee.filter(|it| ![STUB_CALLEE, ENTRY_CALLEE].contains(it))).map(func_of)
}

/// The innermost function that the code at the address is for. It may be any address, or what a call returns to.
pub fn function_at(address: usize) -> Option<(FuncIndex, CodeKind)> {
    let owners = lock_owners();
    let code = InstalledCode::at(&owners, address)
        .or_else(|| InstalledCode::at(&owners, address.wrapping_sub(1)))?;
    Some((code.functions_at(address).next()?, code.kind()))
}

/// # Safety
/// `fp` is that of the innermost frame, in which a stub runs.
#[native_abi]
pub(crate) unsafe fn raise(instance: &Instance, failure: Failure, fp: usize) -> Catch {
    instance.store().set_top_frame(fp);
    let (host, vm) = instance.store().host();
    let fp = match failure.decode() {
        Decoded::Pending => fp,
        Decoded::Suspended => {
            return Catch {
                // SAFETY: the caller's.
                fp: unsafe { entry_above(fp) },
                address: instance.engine().stubs().leave_entry,
            };
        }
        Decoded::Terminated => {
            host.terminate(instance);
            fp
        }
        Decoded::Trap(trap) => {
            host.throw_trap(instance, trap);
            fp
        }
        // SAFETY: the caller's.
        Decoded::Exception(exception) => match unsafe { throw(instance, exception, fp) } {
            Ok(caught) => return caught,
            Err(entry) => entry,
        },
    };
    // SAFETY: the caller's, or one that is further out.
    unsafe { host.unwind(vm, fp) }
}

/// Fails with the frame from which the host goes on with what is pending.
///
/// # Safety
/// As for `raise`, and `exception` is an `exnref`.
unsafe fn throw(instance: &Instance, exception: HostCell, fp: usize) -> Result<Catch, usize> {
    let engine = instance.engine();
    // SAFETY: the caller's. Up to the entry there are only frames of functions.
    unsafe {
        let tag = engine.tag_of(exception);
        let mut frame = Frame::caller_of(fp);
        while !frame.is_entry() {
            if let Some(handler) = engine.find_handler(frame, || Some(tag)) {
                (engine.host().will_catch(instance, exception)).map_err(|Thrown| fp)?;
                let address = handler.enter_with(exception);
                return Ok(Catch {
                    fp: frame.fp,
                    address,
                });
            }
            frame = Frame::caller_of(frame.fp);
        }
        engine.host().throw(instance, exception);
        Err(frame.fp)
    }
}
