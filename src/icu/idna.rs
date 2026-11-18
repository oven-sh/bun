//! UTS #46 with CheckBidi and CheckJoiners, without UseSTD3ASCIIRules and Transitional_Processing.

use core::ffi::c_char;
use core::ptr::NonNull;
use std::sync::OnceLock;

use smallvec::SmallVec;

use crate::Result;
use crate::argument::expandable_length;
use crate::error::Status;
use crate::ffi::{call, fill, open};

bun_opaque::opaque_ffi! { struct UIDNA; }
bun_opaque::opaque_ffi! { struct UNormalizer2; }

#[repr(C)]
struct UIDNAInfo {
    size: i16,
    is_transitional_different: i8,
    reserved_byte: i8,
    errors: u32,
    reserved: [i32; 2],
}

type Conversion = unsafe extern "C" fn(
    *const UIDNA,
    *const u16,
    i32,
    *mut u16,
    i32,
    &mut UIDNAInfo,
    &mut Status,
) -> i32;

icu_functions! {
    fn uidna_openUTS46(options: u32, status: &mut Status) -> *mut UIDNA;
    fn uidna_nameToASCII(
        idna: *const UIDNA,
        name: *const u16,
        length: i32,
        out: *mut u16,
        capacity: i32,
        info: &mut UIDNAInfo,
        status: &mut Status,
    ) -> i32;
    fn uidna_nameToUnicode(
        idna: *const UIDNA,
        name: *const u16,
        length: i32,
        out: *mut u16,
        capacity: i32,
        info: &mut UIDNAInfo,
        status: &mut Status,
    ) -> i32;
    fn unorm2_getInstance(package: *const c_char, name: *const c_char, mode: i32, status: &mut Status) -> *mut UNormalizer2;
    fn unorm2_isNormalized(normalizer: *const UNormalizer2, text: *const u16, length: i32, status: &mut Status) -> i8;
    fn u_charDirection(code_point: i32) -> i32;
    fn u_charType(code_point: i32) -> i8;
}

/// Has room for any name that DNS can resolve.
pub type Name = SmallVec<[u16; 256]>;

/// What a conversion recorded about a name.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Verdict {
    /// No error but those of CheckHyphens and VerifyDnsLength.
    Valid,
    Invalid,
}

/// An object that is never changed or closed.
struct Constant<T>(NonNull<T>);

// SAFETY: ICU only reads a `UIDNA` and a `UNormalizer2` once they are open.
unsafe impl<T> Send for Constant<T> {}
// SAFETY: as above.
unsafe impl<T> Sync for Constant<T> {}

fn constant<T>(
    cell: &OnceLock<Result<Constant<T>>>,
    function: impl FnOnce(&mut Status) -> *mut T,
) -> Result<*const T> {
    match cell.get_or_init(|| open(function).map(Constant)) {
        Ok(object) => Ok(object.0.as_ptr()),
        Err(error) => Err(*error),
    }
}

fn convert(conversion: Conversion, name: &[u16], out: &mut Name) -> Result<Verdict> {
    const CHECK_BIDI: u32 = 0x4;
    const CHECK_CONTEXTJ: u32 = 0x8;
    const NONTRANSITIONAL: u32 = 0x10 | 0x20;
    const HYPHEN_AND_LENGTH_ERRORS: u32 = 0x3f;
    static IDNA: OnceLock<Result<Constant<UIDNA>>> = OnceLock::new();

    // SAFETY: it takes nothing but flags and the status.
    let idna = constant(&IDNA, |status| unsafe {
        uidna_openUTS46(CHECK_BIDI | CHECK_CONTEXTJ | NONTRANSITIONAL, status)
    })?;
    let length = expandable_length(name)?;
    let mut info = UIDNAInfo {
        size: size_of::<UIDNAInfo>() as i16,
        is_transitional_different: 0,
        reserved_byte: 0,
        errors: 0,
        reserved: [0; 2],
    };
    // SAFETY: `name` has `length` units, and `out` has room for `capacity`.
    fill(out, |out, capacity, status| unsafe {
        conversion(
            idna,
            name.as_ptr(),
            length,
            out,
            capacity,
            &mut info,
            status,
        )
    })?;
    Ok(match info.errors & !HYPHEN_AND_LENGTH_ERRORS {
        0 => Verdict::Valid,
        _ => Verdict::Invalid,
    })
}

/// ToASCII. What it writes for an invalid name need not be ASCII. The time grows with the square of the length.
pub fn to_ascii(name: &[u16], out: &mut Name) -> Result<Verdict> {
    convert(uidna_nameToASCII, name, out)
}

/// ToUnicode. The time grows with the square of the length.
pub fn to_unicode(name: &[u16], out: &mut Name) -> Result<Verdict> {
    convert(uidna_nameToUnicode, name, out)
}

/// Whether the steps Map and Normalize leave `text` as it is. They turn what is disallowed into U+FFFD.
pub fn is_mapped(text: &[u16]) -> Result<bool> {
    const COMPOSE: i32 = 0;
    static MAPPING: OnceLock<Result<Constant<UNormalizer2>>> = OnceLock::new();

    // SAFETY: a null package is the data of ICU, and the name is terminated.
    let mapping = constant(&MAPPING, |status| unsafe {
        unorm2_getInstance(core::ptr::null(), c"uts46".as_ptr(), COMPOSE, status)
    })?;
    let length = expandable_length(text)?;
    // SAFETY: `text` has `length` units.
    call(|status| unsafe { unorm2_isNormalized(mapping, text.as_ptr(), length, status) } != 0)
}

/// Whether the character puts its name under the Bidi Rule of RFC 5893: Bidi_Class R, AL or AN.
pub fn is_right_to_left(character: char) -> bool {
    // SAFETY: it takes any number.
    matches!(unsafe { u_charDirection(character as i32) }, 1 | 5 | 13)
}

/// General_Category M, which a label does not start with.
pub fn is_mark(character: char) -> bool {
    // SAFETY: it takes any number.
    matches!(unsafe { u_charType(character as i32) }, 6..=8)
}
