use core::mem;
use core::ptr;

use bun_alloc::AllocError;
use bun_collections::BabyList;

// NOTE: the tag-bit scheme below only works on little-endian systems (matches Zig comment).
const _: () = assert!(cfg!(target_endian = "little"));
// NOTE: the packed layout assumes 64-bit pointers (`__ptr` occupies the upper 64 bits of the u128).
const _: () = assert!(mem::size_of::<usize>() == 8);

/// This is a string type that stores up to 15 bytes inline on the stack, and heap allocates if it is longer.
///
/// Zig layout (`packed struct(u128)`, little-endian bit order):
///   bits   0..32  = `__len: u32`
///   bits  32..64  = `cap: u32`
///   bits  64..128 = `__ptr: [*]u8`  (bit 127 is the inlined tag)
#[repr(transparent)]
pub struct SmolStr(u128);

const TAG: usize = 0x8000_0000_0000_0000; // bit 63 of the ptr word == bit 127 of the u128
const NEGATED_TAG: usize = !TAG;

impl SmolStr {
    // ---- raw field accessors (packed-struct shims) ------------------------

    #[inline]
    fn raw_len(&self) -> u32 {
        (self.0 & 0xFFFF_FFFF) as u32
    }
    #[inline]
    fn set_raw_len(&mut self, v: u32) {
        self.0 = (self.0 & !0xFFFF_FFFFu128) | (v as u128);
    }
    #[inline]
    fn raw_cap(&self) -> u32 {
        ((self.0 >> 32) & 0xFFFF_FFFF) as u32
    }
    #[inline]
    fn set_raw_cap(&mut self, v: u32) {
        self.0 = (self.0 & !(0xFFFF_FFFFu128 << 32)) | ((v as u128) << 32);
    }
    #[inline]
    fn raw_ptr_bits(&self) -> usize {
        (self.0 >> 64) as usize
    }
    #[inline]
    fn set_raw_ptr_bits(&mut self, v: usize) {
        self.0 = (self.0 & 0xFFFF_FFFF_FFFF_FFFFu128) | ((v as u128) << 64);
    }

    // ---- public API -------------------------------------------------------

    // TODO(port): Zig `jsonStringify` participates in std.json's structural protocol;
    // map to whatever bun's JSON-serialize trait becomes in Phase B.
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: JsonWriter,
    {
        writer.write(self.slice())
    }

    pub fn empty() -> SmolStr {
        SmolStr::from_inlined(Inlined::EMPTY)
    }

    pub fn len(&self) -> u32 {
        if self.is_inlined() {
            return ((self.raw_ptr_bits() >> 56) & 0b0111_1111) as u32;
        }
        self.raw_len()
    }

    pub fn ptr(&mut self) -> *mut u8 {
        (self.raw_ptr_bits() & NEGATED_TAG) as *mut u8
    }

    pub fn ptr_const(&self) -> *const u8 {
        (self.raw_ptr_bits() & NEGATED_TAG) as *const u8
    }

    pub fn mark_inlined(&mut self) {
        self.set_raw_ptr_bits(self.raw_ptr_bits() | TAG);
    }

    pub fn mark_heap(&mut self) {
        self.set_raw_ptr_bits(self.raw_ptr_bits() & NEGATED_TAG);
    }

    pub fn is_inlined(&self) -> bool {
        (self.raw_ptr_bits() & TAG) != 0
    }

    /// ## Panics
    /// if `self` is too long to fit in an inlined string
    pub fn to_inlined(&self) -> Inlined {
        debug_assert!(self.len() as usize <= Inlined::MAX_LEN);
        let mut inlined = Inlined(self.0);
        inlined.set_tag(1);
        inlined
    }

    pub fn from_baby_list(baby_list: BabyList<u8>) -> SmolStr {
        // PORT NOTE: BabyList<u8> is #[repr(C)] { ptr, len, cap }. We take ownership of its
        // storage by reading the raw parts and forgetting the list; Drop on SmolStr frees it.
        // TODO(port): verify BabyList<u8> field names / into_raw_parts API.
        let len = baby_list.len;
        let cap = baby_list.cap;
        let p = baby_list.ptr;
        mem::forget(baby_list);
        let mut smol_str = SmolStr(0);
        smol_str.set_raw_len(len);
        smol_str.set_raw_cap(cap);
        smol_str.set_raw_ptr_bits(p.as_ptr() as usize);
        smol_str.mark_heap();
        smol_str
    }

    pub fn from_inlined(inlined: Inlined) -> SmolStr {
        let mut smol_str = SmolStr(inlined.0);
        smol_str.mark_inlined();
        smol_str
    }

    pub fn from_char(char: u8) -> SmolStr {
        let mut inlined = Inlined::EMPTY;
        inlined.all_chars()[0] = char;
        inlined.set_len(1);
        SmolStr::from_inlined(inlined)
    }

    pub fn from_slice(values: &[u8]) -> Result<SmolStr, AllocError> {
        if values.len() > Inlined::MAX_LEN {
            // TODO(port): verify BabyList<u8>::init_capacity / append_slice_assume_capacity API.
            let mut baby_list = BabyList::<u8>::init_capacity(values.len())?;
            baby_list.append_slice_assume_capacity(values);
            // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
            return Ok(SmolStr::from_baby_list(baby_list));
        }

        // SAFETY: we already checked that `values` can fit in an inlined string
        let inlined = Inlined::init(values).expect("unreachable");
        Ok(SmolStr::from_inlined(inlined))
    }

    pub fn slice(&self) -> &[u8] {
        if self.is_inlined() {
            // SAFETY: on little-endian the low `len` bytes of the backing u128 are the inline data.
            let bytes = &self.0 as *const u128 as *const u8;
            return unsafe { core::slice::from_raw_parts(bytes, self.len() as usize) };
        }
        // SAFETY: heap ptr + raw_len describe a live allocation owned by self.
        unsafe { core::slice::from_raw_parts(self.ptr_const(), self.raw_len() as usize) }
    }

    pub fn append_char(&mut self, char: u8) -> Result<(), AllocError> {
        if self.is_inlined() {
            let mut inlined = self.to_inlined();
            if inlined.len() as usize + 1 > Inlined::MAX_LEN {
                let mut baby_list = BabyList::<u8>::init_capacity(inlined.len() as usize + 1)?;
                baby_list.append_slice_assume_capacity(inlined.slice());
                // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                baby_list.append(char)?;
                // PORT NOTE: overwrite raw bits without running Drop — old value was inlined (no heap).
                let len = baby_list.len;
                let cap = baby_list.cap;
                let p = baby_list.ptr;
                mem::forget(baby_list);
                self.set_raw_len(len);
                self.set_raw_ptr_bits(p.as_ptr() as usize);
                self.set_raw_cap(cap);
                self.mark_heap();
                return Ok(());
            }
            let old_len = inlined.len() as usize;
            inlined.all_chars()[old_len] = char;
            inlined.set_len(u8::try_from(old_len + 1).unwrap());
            self.0 = inlined.0;
            self.mark_inlined();
            return Ok(());
        }

        // SAFETY: ptr/len/cap were produced by a prior BabyList<u8> allocation.
        let mut baby_list = unsafe {
            BabyList::<u8>::from_raw_parts(self.ptr(), self.raw_len(), self.raw_cap())
        };
        // TODO(port): verify BabyList<u8>::from_raw_parts exists; else construct fields directly.
        // Ownership of the allocation has moved into `baby_list`; neutralize self so an
        // error return below (which drops `baby_list`) does not double-free via SmolStr::drop.
        self.0 = Inlined::EMPTY.0;
        baby_list.append(char)?;

        let len = baby_list.len;
        let cap = baby_list.cap;
        let p = baby_list.ptr;
        mem::forget(baby_list);
        self.set_raw_len(len);
        self.set_raw_ptr_bits(p.as_ptr() as usize);
        self.set_raw_cap(cap);
        // (already heap-tagged)
        Ok(())
    }

    pub fn append_slice(&mut self, values: &[u8]) -> Result<(), AllocError> {
        if self.is_inlined() {
            let mut inlined = self.to_inlined();
            let old_len = inlined.len() as usize;
            if old_len + values.len() > Inlined::MAX_LEN {
                let mut baby_list = BabyList::<u8>::init_capacity(old_len + values.len())?;
                baby_list.append_slice_assume_capacity(inlined.slice());
                baby_list.append_slice_assume_capacity(values);
                // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                // SAFETY: old *self is inlined (no heap ownership); ptr::write skips its Drop.
                unsafe { ptr::write(self, SmolStr::from_baby_list(baby_list)) };
                return Ok(());
            }
            inlined.all_chars()[old_len..old_len + values.len()].copy_from_slice(values);
            inlined.set_len(u8::try_from(old_len + values.len()).unwrap());
            // SAFETY: old *self is inlined (no heap ownership); ptr::write skips its Drop.
            unsafe { ptr::write(self, SmolStr::from_inlined(inlined)) };
            return Ok(());
        }

        // SAFETY: ptr/len/cap were produced by a prior BabyList<u8> allocation; we logically
        // move ownership into `baby_list` and write the result back without dropping the old self.
        let mut baby_list = unsafe {
            BabyList::<u8>::from_raw_parts(self.ptr(), self.raw_len(), self.raw_cap())
        };
        // Ownership of the allocation has moved into `baby_list`; neutralize self so an
        // error return below (which drops `baby_list`) does not double-free via SmolStr::drop.
        self.0 = Inlined::EMPTY.0;
        baby_list.append_slice(values)?;

        // SAFETY: old *self is now inlined-empty (no heap ownership); ptr::write skips its Drop.
        unsafe { ptr::write(self, SmolStr::from_baby_list(baby_list)) };
        Ok(())
    }
}

impl Drop for SmolStr {
    fn drop(&mut self) {
        if !self.is_inlined() {
            // SAFETY: ptr/len/cap describe a BabyList<u8> allocation we own; reconstruct to free.
            // TODO(port): verify BabyList<u8> Drop frees; else dealloc via global allocator directly.
            let list = unsafe {
                BabyList::<u8>::from_raw_parts(self.ptr(), self.raw_len(), self.raw_cap())
            };
            drop(list);
        }
    }
}

// TODO(port): placeholder for the std.json `writer: anytype` protocol used by json_stringify.
pub trait JsonWriter {
    fn write(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error>;
}

// ---------------------------------------------------------------------------

/// Zig layout (`packed struct(u128)`, little-endian bit order):
///   bits   0..120 = `data: u120`   (15 inline bytes)
///   bits 120..127 = `__len: u7`
///   bit  127      = `_tag: u1`
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Inlined(u128);

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum InlinedError {
    #[error("StringTooLong")]
    StringTooLong,
}

impl From<InlinedError> for bun_core::Error {
    fn from(e: InlinedError) -> Self {
        bun_core::err!(from e)
    }
}

impl Inlined {
    pub const MAX_LEN: usize = 120 / 8; // = 15
    pub const EMPTY: Inlined = Inlined(1u128 << 127); // data=0, __len=0, _tag=1

    /// ## Errors
    /// if `str` is longer than `MAX_LEN`
    pub fn init(str: &[u8]) -> Result<Inlined, InlinedError> {
        if str.len() > Self::MAX_LEN {
            // PERF(port): @branchHint(.unlikely) — no stable Rust equivalent
            return Err(InlinedError::StringTooLong);
        }
        let mut inlined = Inlined::EMPTY;

        if !str.is_empty() {
            inlined.all_chars()[0..str.len()].copy_from_slice(&str[0..str.len()]);
            inlined.set_len(u8::try_from(str.len()).unwrap());
        }
        Ok(inlined)
    }

    #[inline]
    pub fn len(&self) -> u8 {
        ((self.0 >> 120) & 0x7F) as u8
    }

    pub fn set_len(&mut self, new_len: u8) {
        debug_assert!(new_len < 128); // u7
        self.0 = (self.0 & !(0x7Fu128 << 120)) | ((new_len as u128) << 120);
    }

    #[inline]
    fn set_tag(&mut self, tag: u8) {
        debug_assert!(tag <= 1);
        self.0 = (self.0 & !(1u128 << 127)) | ((tag as u128) << 127);
    }

    pub fn slice(&self) -> &[u8] {
        // SAFETY: bytes 0..len of the backing u128 are the inline data on little-endian.
        unsafe { core::slice::from_raw_parts(self.ptr_const(), self.len() as usize) }
    }

    pub fn slice_mut(&mut self) -> &mut [u8] {
        let len = self.len() as usize;
        // SAFETY: same as `slice`.
        unsafe { core::slice::from_raw_parts_mut(self.ptr(), len) }
    }

    pub fn all_chars(&mut self) -> &mut [u8; Self::MAX_LEN] {
        // SAFETY: the first 15 bytes of the u128 backing storage are the `data` field.
        unsafe { &mut *(self.ptr() as *mut [u8; Self::MAX_LEN]) }
    }

    #[inline]
    fn ptr(&mut self) -> *mut u8 {
        &mut self.0 as *mut u128 as *mut u8
    }

    #[inline]
    fn ptr_const(&self) -> *const u8 {
        &self.0 as *const u128 as *const u8
    }
}

const _: () = assert!(mem::size_of::<SmolStr>() == mem::size_of::<Inlined>());

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smol_str() {
        // large strings are heap-allocated
        {
            let str = SmolStr::from_slice(b"oh wow this is a long string").unwrap();
            assert_eq!(b"oh wow this is a long string", str.slice());
            assert!(!str.is_inlined());
        }

        // small strings are inlined
        {
            let mut str = SmolStr::from_slice(b"hello").unwrap();
            assert_eq!(b"hello", str.slice());
            assert!(str.is_inlined());

            // operations that grow a string beyond the inlined capacity force an allocation.
            str.append_slice(b" world, this makes it too long to be inlined")
                .unwrap();
            assert_eq!(
                b"hello world, this makes it too long to be inlined".as_slice(),
                str.slice()
            );
            assert!(!str.is_inlined());
        }
    }

    #[test]
    fn inlined_init() {
        let hello = Inlined::init(b"hello").unwrap();
        assert_eq!(b"hello", hello.slice());
        assert_eq!(5, hello.len());
        // _tag == 1 (inlined)
        assert_eq!(1, (hello.0 >> 127) as u8);

        assert!(matches!(
            Inlined::init(b"this string is too long to be inlined within a u120"),
            Err(InlinedError::StringTooLong)
        ));

        let empty = Inlined::init(b"").unwrap();
        assert_eq!(empty, Inlined::EMPTY);
    }

    #[test]
    fn inlined_does_not_allocate() {
        // TODO(port): Zig used std.testing.allocator to assert no allocation; no direct
        // equivalent here. The is_inlined() check is the observable proxy.
        let hello = SmolStr::from_slice(b"hello").unwrap();
        assert_eq!(5, hello.len());
        assert!(hello.is_inlined());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/SmolStr.zig (275 lines)
//   confidence: medium
//   todos:      6
//   notes:      packed u128 bit-layout reimplemented with manual shift accessors; Drop replaces deinit so heap-backed mutators neutralize self before fallible BabyList ops to avoid error-path double-free; BabyList<u8> raw-parts API needs verification in Phase B.
// ──────────────────────────────────────────────────────────────────────────
