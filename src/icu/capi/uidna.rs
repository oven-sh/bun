//! `unicode/uidna.h`

use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, Out, Text, UBool, UChar};
use crate::common::sink::{TextBuf as _, WritableAlias, stack_or_heap};
use crate::common::slice_ext::{SliceExt, to_int32, to_length};
use crate::common::uts46::{IdnaInfo, OutputForm, Uts46};
use crate::common::utypes::*;
use bun_icu_macros::capi;

#[expect(clippy::upper_case_acronyms, reason = "the name in C")]
pub(crate) type UIDNA = Uts46;

#[repr(C)]
pub(crate) struct UIDNAInfo {
    size: i16,
    is_transitional_different: UBool,
    reserved_b3: UBool,
    errors: u32,
    reserved_i2: i32,
    reserved_i3: i32,
}

impl From<IdnaInfo> for UIDNAInfo {
    fn from(info: IdnaInfo) -> Self {
        Self {
            size: size_of::<Self>() as i16,
            is_transitional_different: info.is_transitional_different.into(),
            reserved_b3: 0,
            errors: info.errors,
            reserved_i2: 0,
            reserved_i3: 0,
        }
    }
}

const UIDNA_CHECK_BIDI: u32 = 4;
const UIDNA_CHECK_CONTEXTJ: u32 = 8;
const UIDNA_NONTRANSITIONAL_TO_ASCII: u32 = 0x10;
const UIDNA_NONTRANSITIONAL_TO_UNICODE: u32 = 0x20;
const TO_ASCII: u32 = UIDNA_CHECK_BIDI | UIDNA_CHECK_CONTEXTJ | UIDNA_NONTRANSITIONAL_TO_ASCII;

fn convert(
    idna: Option<&UIDNA>,
    form: OutputForm,
    name: Text<'_, UChar>,
    mut dest: Dest<'_, UChar>,
    info: Out<'_, UIDNAInfo>,
    status: ErrorCode<'_>,
) -> i32 {
    status.run(0, |status| {
        let idna = idna.non_null()?;
        if idna.form != form {
            return Err(U_UNSUPPORTED_ERROR);
        }
        dest.check()?;
        info.set(IdnaInfo::default().into());
        let out = (dest.reborrow()).at_most(to_int32(4 * to_length(name.length()) + 64));
        let name = out.apart(name.get()?)?;
        // The work is done in `dest` if the name fits, until the result outgrows what has been cleared.
        let (mut stack, mut heap);
        let mut scratch = None;
        let buffer = if name.len() <= to_length(out.capacity()) {
            out.cleared()
        } else {
            (stack, heap) = ([0; 64], Vec::new());
            scratch.insert(stack_or_heap(name.len(), &mut stack, &mut heap)?)
        };
        let mut converted = WritableAlias::new(buffer, name.len());
        let result = idna.convert(name, &mut converted)?;
        let (length, spilled) = (converted.len(), converted.into_heap());
        info.set(result.into());
        Ok(
            match spilled
                .as_deref()
                .or_else(|| scratch.map(|scratch| scratch.slice(..length)))
            {
                Some(text) => dest.extract_to(text, status),
                None => dest.terminate(length, status),
            },
        )
    })
}

/// Accepts `TO_ASCII`, with or without `UIDNA_NONTRANSITIONAL_TO_UNICODE`, and that option alone.
#[capi]
fn uidna_openUTS46(options: u32, status: ErrorCode) -> Option<Box<UIDNA>> {
    status.open(|| {
        if options == UIDNA_NONTRANSITIONAL_TO_UNICODE {
            Uts46::new(OutputForm::Unicode)
        } else if options & !UIDNA_NONTRANSITIONAL_TO_UNICODE == TO_ASCII {
            Uts46::new(OutputForm::Ascii)
        } else {
            Err(U_UNSUPPORTED_ERROR)
        }
    })
}

/// `idna` has the options `TO_ASCII`.
#[capi]
fn uidna_nameToASCII(
    idna: Option<&UIDNA>,
    (name, _): Text<UChar>,
    (dest, _): Dest<UChar>,
    info: Out<UIDNAInfo>,
    status: ErrorCode,
) -> i32 {
    convert(idna, OutputForm::Ascii, name, dest, info, status)
}

/// `idna` has only the option `UIDNA_NONTRANSITIONAL_TO_UNICODE`.
#[capi]
fn uidna_nameToUnicode(
    idna: Option<&UIDNA>,
    (name, _): Text<UChar>,
    (dest, _): Dest<UChar>,
    info: Out<UIDNAInfo>,
    status: ErrorCode,
) -> i32 {
    convert(idna, OutputForm::Unicode, name, dest, info, status)
}
