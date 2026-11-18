use core::ffi::c_void;
use core::mem::{MaybeUninit, offset_of};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering, fence};

use bun_alloc::{AllocError, default_alloc};

use crate::{CodeUnit, MAX_LENGTH, Text, atom_table, hash_latin1, symbol};

/// Immutable characters with a reference count. C++ and generated code read this layout in place.
#[repr(C)]
pub struct StringImpl {
    ref_count: AtomicU32,
    length: u32,
    data: *const c_void,
    hash_and_flags: AtomicU32,
}

/// Who frees the characters.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub(crate) enum Buffer {
    /// They follow the header, or outlive the string.
    Internal = 0,
    /// An allocation of the default allocator.
    Owned = 1,
    /// Part of another string, which this one holds.
    Substring = 2,
    External = 3,
}

pub type FreeExternalBuffer =
    unsafe extern "C" fn(context: *mut c_void, buffer: *mut c_void, byte_length: usize);

#[repr(C)]
pub(crate) struct SubstringImpl {
    pub(crate) string: StringImpl,
    pub(crate) owner: NonNull<StringImpl>,
}

#[repr(C)]
struct ExternalImpl {
    string: StringImpl,
    free: Option<FreeExternalBuffer>,
    context: *mut c_void,
}

impl StringImpl {
    pub const FLAG_COUNT: u32 = 8;
    pub const BUFFER_MASK: u32 = 0b11;
    pub const SUBSTRING_BUFFER: u32 = Buffer::Substring as u32;
    pub const EXTERNAL_BUFFER: u32 = Buffer::External as u32;
    pub const IS_LATIN1: u32 = 1 << 2;
    pub const DID_REPORT_COST: u32 = 1 << 3;
    pub const IS_ATOM: u32 = 1 << 4;
    pub const IS_SYMBOL: u32 = 1 << 5;
    pub const NEVER_ATOMIZE: u32 = 1 << 6;
    /// Only an atom has it.
    pub const IS_ARRAY_INDEX: u32 = 1 << 7;

    pub const IS_STATIC: u32 = 1;
    pub const REF_COUNT_INCREMENT: u32 = 2;
    /// Leaves room for each thread to add a reference between the check and the increment.
    pub const REF_COUNT_LIMIT: u32 = u32::MAX - (1 << 20);

    pub const OFFSET_OF_LENGTH: usize = offset_of!(StringImpl, length);
    pub const OFFSET_OF_DATA: usize = offset_of!(StringImpl, data);
    pub const OFFSET_OF_FLAGS: usize = offset_of!(StringImpl, hash_and_flags);
    /// Inline characters start in what would be the padding of the header.
    pub const TAIL: usize = Self::OFFSET_OF_FLAGS + size_of::<u32>();

    pub(crate) fn header<T: CodeUnit>(units: *const T, length: usize, flags: u32) -> StringImpl {
        debug_assert!(length <= MAX_LENGTH);
        StringImpl {
            ref_count: AtomicU32::new(Self::REF_COUNT_INCREMENT),
            length: length as u32,
            data: units.cast(),
            hash_and_flags: AtomicU32::new(if T::IS_LATIN1 { Self::IS_LATIN1 } else { 0 } | flags),
        }
    }

    #[inline(always)]
    fn flags(&self) -> u32 {
        self.hash_and_flags.load(Ordering::Relaxed)
    }

    /// Only the thread that the string belongs to writes the word. Other threads may read it.
    #[inline(always)]
    fn set_flags(&self, flags: u32) {
        debug_assert!(!self.is_static());
        self.hash_and_flags.store(flags, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn len(&self) -> usize {
        self.length as usize
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }

    #[inline(always)]
    pub fn is_latin1(&self) -> bool {
        self.flags() & Self::IS_LATIN1 != 0
    }

    #[inline(always)]
    pub fn is_atom(&self) -> bool {
        self.flags() & Self::IS_ATOM != 0
    }

    #[inline(always)]
    pub fn is_symbol(&self) -> bool {
        self.flags() & Self::IS_SYMBOL != 0
    }

    #[inline(always)]
    pub(crate) fn is_array_index_atom(&self) -> bool {
        self.flags() & Self::IS_ARRAY_INDEX != 0
    }

    #[inline(always)]
    pub fn is_static(&self) -> bool {
        self.ref_count.load(Ordering::Relaxed) & Self::IS_STATIC != 0
    }

    #[inline(always)]
    pub fn has_one_ref(&self) -> bool {
        self.ref_count.load(Ordering::Acquire) == Self::REF_COUNT_INCREMENT
    }

    pub fn ref_count(&self) -> u32 {
        self.ref_count.load(Ordering::Relaxed) / Self::REF_COUNT_INCREMENT
    }

    #[inline(always)]
    pub(crate) fn buffer(&self) -> Buffer {
        match self.flags() & Self::BUFFER_MASK {
            0 => Buffer::Internal,
            1 => Buffer::Owned,
            2 => Buffer::Substring,
            _ => Buffer::External,
        }
    }

    #[inline(always)]
    pub fn is_substring(&self) -> bool {
        self.buffer() == Buffer::Substring
    }

    pub fn is_external(&self) -> bool {
        self.buffer() == Buffer::External
    }

    pub fn can_become_atom(&self) -> bool {
        self.flags() & Self::NEVER_ATOMIZE == 0
    }

    /// From now on nothing but the reference count changes. Panics for an atom of this thread.
    pub fn set_never_atomize(&self) {
        if !self.is_static() && self.can_become_atom() {
            assert!(!self.is_atom());
            self.hash();
            self.set_flags(self.flags() | Self::NEVER_ATOMIZE);
        }
    }

    /// Whether the string does nothing to keep its characters alive.
    pub(crate) fn borrows_characters(&self) -> bool {
        self.buffer() == Buffer::Internal && self.data.addr() != self.address() + Self::TAIL
    }

    pub(crate) fn mark_as_atom(&self, is_array_index: bool) {
        let index = if is_array_index {
            Self::IS_ARRAY_INDEX
        } else {
            0
        };
        self.set_flags(self.flags() | Self::IS_ATOM | index);
    }

    pub(crate) fn unmark_as_atom(&self) {
        self.set_flags(self.flags() & !(Self::IS_ATOM | Self::IS_ARRAY_INDEX));
    }

    #[inline(always)]
    pub fn text(&self) -> Text<'_> {
        // SAFETY: `data` has `length` initialized units of the width that the flag names for as long as the string lives.
        unsafe {
            if self.is_latin1() {
                Text::Latin1(core::slice::from_raw_parts(self.data.cast(), self.len()))
            } else {
                Text::Utf16(core::slice::from_raw_parts(self.data.cast(), self.len()))
            }
        }
    }

    /// The first unit.
    #[inline(always)]
    pub fn characters(&self) -> *const c_void {
        self.data
    }

    #[inline(always)]
    pub fn byte_length(&self) -> usize {
        self.len() << usize::from(!self.is_latin1())
    }

    /// Zero if nothing has asked for the hash yet. An atom has one.
    #[inline(always)]
    pub fn existing_hash(&self) -> u32 {
        self.flags() >> Self::FLAG_COUNT
    }

    #[inline]
    pub fn hash(&self) -> u32 {
        match self.existing_hash() {
            0 => self.compute_hash(),
            hash => hash,
        }
    }

    #[inline(never)]
    fn compute_hash(&self) -> u32 {
        let hash = self.text().hash();
        self.set_hash(hash);
        hash
    }

    pub(crate) fn set_hash(&self, hash: u32) {
        debug_assert!(self.existing_hash() == 0 && hash == self.text().hash());
        self.set_flags(self.flags() | hash << Self::FLAG_COUNT);
    }

    /// The string that holds the characters of a substring or of a symbol's description.
    #[inline]
    pub(crate) fn owner(&self) -> &StringImpl {
        if self.is_substring() {
            // SAFETY: the flag says that this is the first field of a `SubstringImpl`, which holds a reference to its owner.
            unsafe {
                (*core::ptr::with_exposed_provenance::<SubstringImpl>(self.address()))
                    .owner
                    .as_ref()
            }
        } else {
            self
        }
    }

    #[inline(always)]
    pub fn address(&self) -> usize {
        core::ptr::from_ref(self).addr()
    }

    /// The bytes to charge to the collector: those of the buffer the first time, then none. Of a buffer that threads
    /// share, each holder is charged its share.
    #[inline]
    pub fn take_cost(&self) -> usize {
        let owner = self.owner();
        let flags = owner.flags();
        if flags & (Self::DID_REPORT_COST | Self::NEVER_ATOMIZE) == 0 {
            owner.set_flags(flags | Self::DID_REPORT_COST);
            owner.byte_length()
        } else if flags & Self::NEVER_ATOMIZE == 0 {
            0
        } else {
            self.shared_cost()
        }
    }

    /// This holder's share of the buffer.
    #[inline(always)]
    pub fn shared_cost(&self) -> usize {
        if self.ref_count.load(Ordering::Relaxed) == Self::REF_COUNT_INCREMENT
            && self.flags() & Self::BUFFER_MASK < Buffer::Substring as u32
        {
            return self.byte_length();
        }
        self.shared_cost_slow()
    }

    #[inline(never)]
    fn shared_cost_slow(&self) -> usize {
        if self.is_static() || self.has_lasting_buffer() {
            return 0;
        }
        let bytes = if self.is_substring() {
            self.owner().shared_cost()
        } else {
            self.byte_length()
        };
        bytes.div_ceil(self.ref_count().max(1) as usize)
    }

    fn has_lasting_buffer(&self) -> bool {
        self.flags() & Self::BUFFER_MASK == Buffer::External as u32
            // SAFETY: the flag says that this is the first field of an `ExternalImpl`.
            && unsafe { &*core::ptr::with_exposed_provenance::<ExternalImpl>(self.address()) }
                .free
                .is_none()
    }

    #[inline(always)]
    pub(crate) fn retain(&self) {
        // The rotation takes the flag to the top: one comparison finds both static strings and counts at the limit.
        let count = self.ref_count.load(Ordering::Relaxed);
        if count.rotate_right(1) <= Self::REF_COUNT_LIMIT / Self::REF_COUNT_INCREMENT {
            self.ref_count
                .fetch_add(Self::REF_COUNT_INCREMENT, Ordering::Relaxed);
        } else if count & Self::IS_STATIC == 0 {
            std::process::abort();
        }
    }

    /// # Safety
    /// The caller gives up a reference that it holds.
    #[inline(always)]
    pub(crate) unsafe fn release(this: NonNull<StringImpl>) {
        // SAFETY: the caller's reference keeps the string alive up to the decrement.
        let ref_count = unsafe { &this.as_ref().ref_count };
        let count = ref_count.load(Ordering::Relaxed);
        if count & Self::IS_STATIC != 0 {
            return;
        }
        if count != Self::REF_COUNT_INCREMENT
            && ref_count.fetch_sub(Self::REF_COUNT_INCREMENT, Ordering::Release)
                != Self::REF_COUNT_INCREMENT
        {
            return;
        }
        // SAFETY: that was the last reference.
        unsafe { Self::destroy(this) }
    }

    /// # Safety
    /// The caller has given up the last reference.
    #[inline(never)]
    #[unsafe(export_name = "engine_text_destroy")]
    pub unsafe extern "C" fn destroy(this: NonNull<StringImpl>) {
        fence(Ordering::Acquire);
        // SAFETY: nothing else refers to the string.
        unsafe {
            debug_assert!(!this.as_ref().is_static());
            if this.as_ref().flags() & (Self::IS_ATOM | Self::IS_SYMBOL | Self::BUFFER_MASK) != 0 {
                return Self::destroy_with_ties(this);
            }
            default_alloc::free(this.as_ptr().cast());
        }
    }

    /// # Safety
    /// As for `destroy`.
    #[inline(never)]
    unsafe fn destroy_with_ties(this: NonNull<StringImpl>) {
        // SAFETY: nothing else refers to the string, and each flag says which allocation it heads.
        unsafe {
            let string = this.as_ref();
            if string.is_atom() {
                atom_table::remove(string);
            } else if string.is_symbol() {
                symbol::unregister(string);
            }
            match string.buffer() {
                Buffer::Internal => {}
                Buffer::Owned => default_alloc::free(string.data.cast_mut()),
                Buffer::Substring => Self::release(this.cast::<SubstringImpl>().as_ref().owner),
                Buffer::External => {
                    let external = this.cast::<ExternalImpl>().as_ref();
                    if let Some(free) = external.free {
                        free(
                            external.context,
                            string.data.cast_mut(),
                            string.byte_length(),
                        );
                    }
                }
            }
            default_alloc::free(this.as_ptr().cast());
        }
    }

    /// Whether a string of so many units can be allocated if there is memory.
    #[inline(always)]
    pub fn is_valid_length<T: CodeUnit>(length: usize) -> bool {
        length <= MAX_LENGTH.min((u32::MAX as usize - size_of::<StringImpl>()) / size_of::<T>())
    }

    #[inline(always)]
    fn inline_size<T: CodeUnit>(length: usize) -> Result<usize, AllocError> {
        if !Self::is_valid_length::<T>(length) {
            return Err(AllocError);
        }
        let size = (Self::TAIL + length * size_of::<T>()).max(size_of::<StringImpl>());
        if cfg!(debug_assertions) && size > MAX_ALLOCATION_SIZE.load(Ordering::Relaxed) {
            return Err(AllocError);
        }
        Ok(size)
    }

    /// A string with one reference whose `length` units are not written yet.
    #[inline(always)]
    pub(crate) fn allocate<T: CodeUnit>(length: usize) -> Result<NonNull<StringImpl>, AllocError> {
        Self::allocate_with_slack::<T, 0>(length)
    }

    /// With a few units more behind them, which do not count.
    #[inline(always)]
    pub(crate) fn allocate_with_slack<T: CodeUnit, const SLACK: usize>(
        length: usize,
    ) -> Result<NonNull<StringImpl>, AllocError> {
        const { assert!(SLACK <= 64) };
        let size = Self::inline_size::<T>(length)? + SLACK * size_of::<T>();
        let memory = default_alloc::malloc(size);
        let this = NonNull::new(memory.cast::<StringImpl>()).ok_or(AllocError)?;
        memory.expose_provenance();
        // SAFETY: the allocation has room for the header and is aligned for it.
        unsafe {
            let tail = memory.byte_add(Self::TAIL).cast::<T>();
            this.write(Self::header(tail, length, Buffer::Internal as u32));
        }
        Ok(this)
    }

    /// Changes the number of units. On failure `this` is as it was.
    ///
    /// # Safety
    /// `this` came from `allocate::<T>` and the caller holds the only reference, which moves to the result.
    pub(crate) unsafe fn reallocate<T: CodeUnit>(
        this: NonNull<StringImpl>,
        length: usize,
    ) -> Result<NonNull<StringImpl>, AllocError> {
        let size = Self::inline_size::<T>(length)?;
        // SAFETY: a live allocation of the default allocator, whose header is written again where it has moved to.
        unsafe {
            let memory = default_alloc::realloc(this.as_ptr().cast(), size);
            let this = NonNull::new(memory.cast::<StringImpl>()).ok_or(AllocError)?;
            memory.expose_provenance();
            (*this.as_ptr()).length = length as u32;
            (*this.as_ptr()).data = memory.byte_add(Self::TAIL);
            Ok(this)
        }
    }

    /// # Safety
    /// `this` came from `allocate::<T>` or `reallocate::<T>`, and nothing else reads its units while the slice lives.
    #[inline(always)]
    pub(crate) unsafe fn tail<'a, T: CodeUnit>(
        this: NonNull<StringImpl>,
    ) -> &'a mut [MaybeUninit<T>] {
        // SAFETY: the allocation has `length` units behind the header.
        unsafe {
            let length = (*this.as_ptr()).length as usize;
            core::slice::from_raw_parts_mut(this.byte_add(Self::TAIL).cast().as_ptr(), length)
        }
    }

    pub(crate) fn boxed<T>(value: T) -> NonNull<T> {
        let memory = default_alloc::malloc(size_of::<T>()).cast::<T>();
        let Some(this) = NonNull::new(memory) else {
            bun_alloc::out_of_memory()
        };
        memory.expose_provenance();
        // SAFETY: a new allocation of the size of `T`, which is aligned to a pointer at most.
        unsafe { this.write(value) };
        this
    }

    /// # Safety
    /// `units` stay valid and unchanged until `free` is called, from whichever thread drops the last reference.
    pub(crate) unsafe fn external<T: CodeUnit>(
        units: &[T],
        context: *mut c_void,
        free: Option<FreeExternalBuffer>,
    ) -> NonNull<StringImpl> {
        assert!(units.len() <= MAX_LENGTH);
        let reported = if free.is_none() {
            Self::DID_REPORT_COST
        } else {
            0
        };
        let flags = Buffer::External as u32 | reported;
        Self::boxed(ExternalImpl {
            string: Self::header(units.as_ptr(), units.len(), flags),
            free,
            context,
        })
        .cast()
    }
}

impl core::fmt::Display for StringImpl {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.text().fmt(formatter)
    }
}

impl core::fmt::Debug for StringImpl {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.text().fmt(formatter)
    }
}

/// A `StringImpl` in read-only memory: nothing counts references to it and every lazy field is filled in.
#[repr(C)]
pub struct StaticString {
    ref_count: u32,
    length: u32,
    data: *const u8,
    hash_and_flags: u32,
}

// SAFETY: never written, and `data` is a `&'static [u8]`.
unsafe impl Sync for StaticString {}

impl StaticString {
    pub const fn new(latin1: &'static [u8]) -> StaticString {
        Self::with_kind(latin1, hash_latin1(latin1), 0)
    }

    pub(crate) const fn atom(latin1: &'static [u8], hash: u32) -> StaticString {
        let index = match latin1 {
            [b'0'..=b'9'] => StringImpl::IS_ARRAY_INDEX,
            _ => 0,
        };
        Self::with_kind(latin1, hash, StringImpl::IS_ATOM | index)
    }

    pub(crate) const fn with_kind(latin1: &'static [u8], hash: u32, kind: u32) -> StaticString {
        StaticString {
            ref_count: StringImpl::IS_STATIC,
            length: latin1.len() as u32,
            data: latin1.as_ptr(),
            hash_and_flags: hash << StringImpl::FLAG_COUNT
                | StringImpl::IS_LATIN1
                | StringImpl::DID_REPORT_COST
                | kind,
        }
    }

    #[inline(always)]
    pub(crate) const fn as_ptr(&'static self) -> NonNull<StringImpl> {
        NonNull::from_ref(self).cast()
    }

    #[inline(always)]
    pub fn get(&'static self) -> &'static StringImpl {
        // SAFETY: the layouts agree, and a static string is only ever loaded from.
        unsafe { self.as_ptr().as_ref() }
    }
}

/// With assertions, for tests of what happens when memory runs out. C++ sets it, and goes by it too.
#[unsafe(export_name = "engine_max_allocation_size")]
static MAX_ALLOCATION_SIZE: AtomicUsize = AtomicUsize::new(usize::MAX);

#[unsafe(export_name = "engine_empty_string")]
pub(crate) static EMPTY: StaticString = StaticString::atom(b"", hash_latin1(b""));

const _: () = {
    assert!(size_of::<StaticString>() == size_of::<StringImpl>());
    assert!(offset_of!(StaticString, data) == StringImpl::OFFSET_OF_DATA);
    assert!(offset_of!(StaticString, hash_and_flags) == StringImpl::OFFSET_OF_FLAGS);
};
