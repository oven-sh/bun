use core::cell::Cell;
use core::mem::offset_of;

use crate::{CodeBlock, Gc, GcFree, JsObject, Value};

/// The header of a frame on the native stack. The arguments follow it.
#[repr(C)]
pub struct CallFrame {
    caller: Cell<usize>,
    return_address: Cell<usize>,
    /// Of WebAssembly code, the instance.
    code_block: Cell<usize>,
    callee: Cell<u64>,
    argument_count_including_this: Cell<u32>,
    call_site: Cell<u32>,
    this_value: Cell<u64>,
}

impl !GcFree for CallFrame {}

impl CallFrame {
    pub const OFFSET_OF_CALLER: usize = offset_of!(CallFrame, caller);
    pub const OFFSET_OF_RETURN_ADDRESS: usize = offset_of!(CallFrame, return_address);
    pub const OFFSET_OF_CODE_BLOCK: usize = offset_of!(CallFrame, code_block);
    pub const OFFSET_OF_CALLEE: usize = offset_of!(CallFrame, callee);
    pub const OFFSET_OF_ARGUMENT_COUNT: usize =
        offset_of!(CallFrame, argument_count_including_this);
    pub const OFFSET_OF_CALL_SITE: usize = offset_of!(CallFrame, call_site);
    /// For a call site at the entry: the caller has seen to it that there is an argument for each parameter.
    pub const IS_PADDED: u32 = u32::MAX;
    pub const OFFSET_OF_THIS: usize = offset_of!(CallFrame, this_value);
    pub const OFFSET_OF_ARGUMENTS: usize = size_of::<CallFrame>();
    /// The words below `this`.
    pub const HEADER_WORDS: usize = Self::OFFSET_OF_THIS / size_of::<u64>();
    /// What the call and the prologue push.
    pub const LINKAGE_SIZE: usize = Self::OFFSET_OF_CODE_BLOCK;

    /// # Safety
    /// The address of a frame that is there for `'a`.
    #[inline(always)]
    pub unsafe fn from_address<'a>(address: usize) -> &'a CallFrame {
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(address) }
    }

    #[inline(always)]
    pub fn address(&self) -> usize {
        core::ptr::from_ref(self).expose_provenance()
    }

    /// That of another `CallFrame` or of an `EntryFrame`.
    #[inline(always)]
    pub fn caller_address(&self) -> usize {
        self.caller.get()
    }

    #[inline(always)]
    pub fn return_address(&self) -> usize {
        self.return_address.get()
    }

    #[inline(always)]
    pub fn callee_bits(&self) -> u64 {
        self.callee.get()
    }

    #[inline(always)]
    pub fn has_native_callee(&self) -> bool {
        self.callee.get() & Value::NATIVE_CALLEE_TAG == Value::NATIVE_CALLEE_TAG
    }

    #[inline(always)]
    pub fn code_block_bits(&self) -> usize {
        self.code_block.get()
    }

    /// `None` in a native function.
    #[inline(always)]
    pub fn code_block(&self) -> Option<Gc<CodeBlock>> {
        let address = self.code_block.get();
        // SAFETY: what the slot has, and the stack keeps it alive.
        (address != 0 && !self.has_native_callee()).then(|| unsafe { Gc::from_address(address) })
    }

    /// Panics in a frame of WebAssembly code.
    #[inline(always)]
    pub fn callee(&self) -> Gc<JsObject> {
        assert!(!self.has_native_callee());
        // SAFETY: only objects are called.
        unsafe { Gc::from_address(self.callee.get() as usize) }
    }

    /// Zero in a generator that has been resumed.
    #[inline(always)]
    pub fn argument_count_including_this(&self) -> u32 {
        self.argument_count_including_this.get()
    }

    #[inline(always)]
    pub fn argument_count(&self) -> usize {
        (self.argument_count_including_this.get() as usize).saturating_sub(1)
    }

    #[inline(always)]
    pub fn call_site(&self) -> u32 {
        self.call_site.get()
    }

    #[inline(always)]
    pub fn set_call_site(&self, call_site: u32) {
        self.call_site.set(call_site);
    }

    #[inline(always)]
    pub fn this_value(&self) -> Value {
        // SAFETY: a value, or empty in a derived constructor.
        unsafe { Value::from_bits_or_empty(self.this_value.get()) }.unwrap_or_default()
    }

    pub(crate) fn this_value_or_empty(&self) -> Option<Value> {
        // SAFETY: as above.
        unsafe { Value::from_bits_or_empty(self.this_value.get()) }
    }

    /// In a native function that is called by `new`.
    #[inline(always)]
    pub fn new_target(&self) -> Value {
        self.this_value()
    }

    #[inline(always)]
    pub fn arguments(&self) -> &[Value] {
        let first = core::ptr::with_exposed_provenance(self.address() + Self::OFFSET_OF_ARGUMENTS);
        // SAFETY: the caller of the function has put that many there.
        unsafe { core::slice::from_raw_parts(first, self.argument_count()) }
    }

    /// Undefined if there are fewer.
    #[inline(always)]
    pub fn argument(&self, index: usize) -> Value {
        self.arguments().get(index).copied().unwrap_or_default()
    }

    /// Those from `first` on.
    #[inline(always)]
    pub fn rest(&self, first: usize) -> &[Value] {
        self.arguments().get(first..).unwrap_or_default()
    }

    /// # Safety
    /// The frame has a slot at that distance in words, and nothing borrows it.
    #[inline(always)]
    pub unsafe fn slot(&self, offset: isize) -> &Cell<u64> {
        let address = self.address().wrapping_add_signed(offset * 8);
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(address) }
    }

    /// # Safety
    /// The code block of the code that the frame runs from now on.
    #[inline(always)]
    pub unsafe fn set_code_block(&self, code_block: Option<Gc<CodeBlock>>) {
        self.code_block.set(code_block.map_or(0, Gc::address));
    }
}

/// What native code leaves below its frame pointer when it calls into generated code.
#[repr(C)]
pub struct EntryRecord {
    /// The coroutine that the call resumes.
    context: Option<Value>,
    pub(crate) previous_top_entry_frame: usize,
    pub(crate) previous_top_call_frame: usize,
}

impl EntryRecord {
    pub const DISTANCE: usize = size_of::<EntryRecord>();
    pub const OFFSET_OF_TOP_ENTRY_FRAME: usize = offset_of!(EntryRecord, previous_top_entry_frame);
    pub const OFFSET_OF_TOP_CALL_FRAME: usize = offset_of!(EntryRecord, previous_top_call_frame);

    /// # Safety
    /// The address of an entry frame that is there for `'a`.
    #[inline(always)]
    pub unsafe fn of<'a>(entry_frame: usize) -> &'a EntryRecord {
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(entry_frame - Self::DISTANCE) }
    }

    pub fn context(&self) -> Option<Value> {
        self.context
    }

    pub fn previous_top_call_frame(&self) -> usize {
        self.previous_top_call_frame
    }

    pub fn previous_top_entry_frame(&self) -> usize {
        self.previous_top_entry_frame
    }
}
