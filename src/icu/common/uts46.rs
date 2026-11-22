//! UTS #46, Unicode IDNA Compatibility Processing, nontransitional and without STD3 rules. ICU4C: uts46.cpp

use crate::common::memory::{Appendable, try_with_capacity};
use crate::common::normalizer2::{Normalizer2, get_uts46_instance};
use crate::common::punycode::{self, ACE_PREFIX};
use crate::common::sink::{TextBuf, TextSink, WritableAlias, replace};
use crate::common::slice_ext::SliceExt;
use crate::common::ubidi_props::{ubidi_get_class, ubidi_get_joining_type};
use crate::common::uchar::u_char_type;
use crate::common::udata::searches_files;
use crate::common::unicode::uchar::{
    U_ARABIC_NUMBER, U_BOUNDARY_NEUTRAL, U_COMMON_NUMBER_SEPARATOR, U_DIR_NON_SPACING_MARK,
    U_EUROPEAN_NUMBER, U_EUROPEAN_NUMBER_SEPARATOR, U_EUROPEAN_NUMBER_TERMINATOR, U_GC_M_MASK,
    U_JT_DUAL_JOINING, U_JT_LEFT_JOINING, U_JT_RIGHT_JOINING, U_JT_TRANSPARENT, U_LEFT_TO_RIGHT,
    U_OTHER_NEUTRAL, U_RIGHT_TO_LEFT, U_RIGHT_TO_LEFT_ARABIC, UJoiningType,
};
use crate::common::utf16::{self, code_points};
use crate::common::utypes::UErrorCode;
use std::ops::Range;

const UIDNA_ERROR_EMPTY_LABEL: u32 = 1;
const UIDNA_ERROR_LABEL_TOO_LONG: u32 = 2;
const UIDNA_ERROR_DOMAIN_NAME_TOO_LONG: u32 = 4;
const UIDNA_ERROR_LEADING_HYPHEN: u32 = 8;
const UIDNA_ERROR_TRAILING_HYPHEN: u32 = 0x10;
const UIDNA_ERROR_HYPHEN_3_4: u32 = 0x20;
const UIDNA_ERROR_LEADING_COMBINING_MARK: u32 = 0x40;
const UIDNA_ERROR_DISALLOWED: u32 = 0x80;
const UIDNA_ERROR_PUNYCODE: u32 = 0x100;
const UIDNA_ERROR_INVALID_ACE_LABEL: u32 = 0x400;
const UIDNA_ERROR_BIDI: u32 = 0x800;
const UIDNA_ERROR_CONTEXTJ: u32 = 0x1000;

const SEVERE_ERRORS: u32 = UIDNA_ERROR_LEADING_COMBINING_MARK
    | UIDNA_ERROR_DISALLOWED
    | UIDNA_ERROR_PUNYCODE
    | UIDNA_ERROR_INVALID_ACE_LABEL;

const L_MASK: u32 = 1 << U_LEFT_TO_RIGHT;
const R_AL_MASK: u32 = (1 << U_RIGHT_TO_LEFT) | (1 << U_RIGHT_TO_LEFT_ARABIC);
const EN_MASK: u32 = 1 << U_EUROPEAN_NUMBER;
const AN_MASK: u32 = 1 << U_ARABIC_NUMBER;
const ES_CS_ET_ON_BN_NSM_MASK: u32 = (1 << U_EUROPEAN_NUMBER_SEPARATOR)
    | (1 << U_COMMON_NUMBER_SEPARATOR)
    | (1 << U_EUROPEAN_NUMBER_TERMINATOR)
    | (1 << U_OTHER_NEUTRAL)
    | (1 << U_BOUNDARY_NEUTRAL)
    | (1 << U_DIR_NON_SPACING_MARK);

const HYPHEN: u16 = b'-' as u16;
const DOT: u16 = b'.' as u16;
/// The mapping of disallowed characters.
const REPLACEMENT: u16 = 0xfffd;
const SHARP_S: u16 = 0xdf;
const FINAL_SIGMA: u16 = 0x3c2;
const ZWNJ: u16 = 0x200c;
const ZWJ: u16 = 0x200d;

const MAX_LABEL_LENGTH: usize = 63;

/// The mapping of each ASCII letter and digit, and 0 for all other ASCII characters.
static ALPHANUMERIC: [u8; 128] = *b"\
    \0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\
    \0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\
    0123456789\0\0\0\0\0\0\
    \0abcdefghijklmnopqrstuvwxyz\0\0\0\0\0\
    \0abcdefghijklmnopqrstuvwxyz\0\0\0\0\0";

/// Indexed by the low and the high byte of a unit, with a bit for each group. The units of a group share their high byte.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static SPECIAL_BYTES: [[u8; 256]; 2] = {
    const GROUPS: [&[(u16, u16)]; 4] = [
        &[
            (0, 0x2c),
            (0x2e, 0x2f),
            (0x3a, 0x40),
            (0x5b, 0x60),
            (0x7b, 0x7f),
            (SHARP_S, SHARP_S),
        ],
        &[(FINAL_SIGMA, FINAL_SIGMA)],
        &[(ZWNJ, ZWJ)],
        &[(REPLACEMENT, REPLACEMENT)],
    ];
    let (mut table, mut group) = ([[0; 256]; 2], 0);
    while group < GROUPS.len() {
        let mut range = 0;
        while range < GROUPS[group].len() {
            let (mut unit, last) = GROUPS[group][range];
            while unit <= last {
                table[0][unit as usize & 0xff] |= 1 << group;
                table[1][unit as usize >> 8] |= 1 << group;
                unit += 1;
            }
            range += 1;
        }
        group += 1;
    }
    table
};

/// Returns true for non-LDH ASCII, sharp s, final sigma, the two joiners and U+FFFD.
#[inline(always)]
fn is_special(unit: u16) -> bool {
    let ([low, high], [by_low, by_high]) = (unit.to_le_bytes(), &SPECIAL_BYTES);
    by_low.at(low.into()) & by_high.at(high.into()) != 0
}

fn has_unpaired_surrogate(text: &[u16]) -> bool {
    text.iter().any(|&unit| utf16::is_surrogate(unit.into()))
        && code_points(text).any(utf16::is_surrogate)
}

/// Checks the Bidi Rule for the lowercased labels of the ASCII fast path.
fn is_ascii_ok_bidi(mut labels: impl Iterator<Item = u16>) -> bool {
    let mut previous = DOT;
    labels.all(
        |unit| match (std::mem::replace(&mut previous, unit), unit) {
            (last, DOT) => matches!(last, DOT | 0x30..=0x39 | 0x61..=0x7a),
            (DOT, first) => matches!(first, 0x61..=0x7a),
            // Bidi classes B, S and WS
            _ => !matches!(unit, 9..=0xd | 0x1c..=0x20),
        },
    )
}

#[derive(Default)]
pub(crate) struct IdnaInfo {
    /// A bit set of `UIDNA_ERROR_` values.
    pub(crate) errors: u32,
    pub(crate) is_transitional_different: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum OutputForm {
    /// Checks the Bidi Rule and the CONTEXTJ rules too.
    Ascii,
    Unicode,
}

pub(crate) struct Uts46 {
    mapping: &'static Normalizer2,
    /// The linked mapping lowercases ASCII like the fast path, and has a boundary before each ASCII character.
    is_linked: bool,
    pub(crate) form: OutputForm,
}

impl Uts46 {
    pub(crate) fn new(form: OutputForm) -> Result<Self, UErrorCode> {
        Ok(Self {
            mapping: get_uts46_instance()?,
            is_linked: !searches_files()?,
            form,
        })
    }

    /// Overwrites `dest`, which has `name.len()` units. ICU4C: uts46.cpp, UTS46::process
    pub(crate) fn convert(
        &self,
        name: &[u16],
        dest: &mut WritableAlias,
    ) -> Result<IdnaInfo, UErrorCode> {
        let mut conversion = Conversion {
            idna: self,
            info: IdnaInfo::default(),
            severe_label_errors: 0,
            is_bidi_name: false,
            is_ok_bidi: true,
        };
        if let Some((label_start, stop)) = conversion.ascii_fast_path(name, dest.as_mut_slice()) {
            // The last ASCII character may combine with what follows.
            let mapping_start = stop.saturating_sub(1);
            let tail = name.slice(mapping_start..);
            if self.is_linked && !has_unpaired_surrogate(tail) {
                dest.truncate(mapping_start);
                self.mapping.normalize_append(tail, 0, dest)?;
            } else {
                conversion.map_and_merge(name, label_start, stop, dest)?;
            }
            conversion.process_labels(label_start, dest)?;
            // The mapping has removed the labels of the fast path too.
            if dest.len() == 0 && label_start != 0 {
                return Ok(conversion.info);
            }
            conversion.check_name_bidi(dest.as_slice().iter().take(label_start).copied());
        }
        conversion.check_name_length(dest.as_slice());
        Ok(conversion.info)
    }
}

/// The bitwise OR of the units of a label in the low 16 bits, and three flags.
type LabelBits = u32;
const HAS_NON_LDH_ASCII: LabelBits = 1 << 16;
const HAS_REPLACEMENT: LabelBits = 1 << 17;
const HAS_DEVIATION_CHARACTER: LabelBits = 1 << 18;

/// Returns the length of the label at the start of `text`, and its bits.
fn scan_label(text: &[u16]) -> (usize, LabelBits) {
    let mut bits = 0;
    for (i, &unit) in text.iter().enumerate() {
        if is_special(unit) {
            bits |= match unit {
                DOT => return (i, bits),
                ..=0x7f => HAS_NON_LDH_ASCII,
                REPLACEMENT => HAS_REPLACEMENT,
                _ => HAS_DEVIATION_CHARACTER,
            };
        }
        bits |= LabelBits::from(unit);
    }
    (text.len(), bits)
}

/// A processing step that may change the length of a label.
#[derive(Clone, Copy)]
enum LabelChange {
    Decode,
    Encode,
    /// Replace the leading combining mark, which has this length, with U+FFFD.
    ReplaceMark(usize),
}

struct Conversion<'a> {
    idna: &'a Uts46,
    info: IdnaInfo,
    /// The `SEVERE_ERRORS` of the current label.
    severe_label_errors: u32,
    /// A label has an R, AL or AN character, so all labels must satisfy the Bidi Rule.
    is_bidi_name: bool,
    is_ok_bidi: bool,
}

impl Conversion<'_> {
    /// Copies lowercased ASCII to `dest`. Returns the start of the label and the index at which it stopped, if it did.
    fn ascii_fast_path(&mut self, text: &[u16], dest: &mut [u16]) -> Option<(usize, usize)> {
        let mut label_start = 0;
        for i in 0..text.len().min(dest.len()) {
            let unit = text.at(i);
            let mapped = ALPHANUMERIC.get(usize::from(unit)).copied();
            if let Some(mapped @ 1..) = mapped {
                dest.set(i, mapped.into());
                continue;
            }
            // "??--" is Punycode or forbidden.
            if mapped.is_none()
                || (unit == HYPHEN && i == label_start + 3 && text.at(i - 1) == HYPHEN)
            {
                return Some((label_start, i));
            }
            dest.set(i, unit);
            if unit == DOT {
                if i == label_start {
                    self.info.errors |= UIDNA_ERROR_EMPTY_LABEL;
                }
                self.check_label_length(i - label_start);
                label_start = i + 1;
            } else if unit == HYPHEN {
                if i == label_start {
                    self.info.errors |= UIDNA_ERROR_LEADING_HYPHEN;
                }
                if text.get(i + 1).is_none_or(|&next| next == DOT) {
                    self.info.errors |= UIDNA_ERROR_TRAILING_HYPHEN;
                }
            }
        }
        self.check_label_length(text.len() - label_start);
        None
    }

    fn check_label_length(&mut self, length: usize) {
        if self.idna.form == OutputForm::Ascii && length > MAX_LABEL_LENGTH {
            self.info.errors |= UIDNA_ERROR_LABEL_TOO_LONG;
        }
    }

    /// The limit is 253 characters plus an optional final dot.
    fn check_name_length(&mut self, name: &[u16]) {
        if name.is_empty() {
            self.info.errors |= UIDNA_ERROR_EMPTY_LABEL;
        } else if name.len() > 253
            && (name.len() > 254 || name.last() != Some(&DOT))
            && self.idna.form == OutputForm::Ascii
            && name.iter().all(|&unit| unit <= 0x7f)
        {
            self.info.errors |= UIDNA_ERROR_DOMAIN_NAME_TOO_LONG;
        }
    }

    /// `ascii_labels` are those that the ASCII fast path has finished.
    fn check_name_bidi(&mut self, ascii_labels: impl Iterator<Item = u16>) {
        if self.is_bidi_name
            && self.info.errors & SEVERE_ERRORS == 0
            && !(self.is_ok_bidi && is_ascii_ok_bidi(ascii_labels))
        {
            self.info.errors |= UIDNA_ERROR_BIDI;
        }
    }

    /// Appends the mapped `name[stop..]`. The merge can change what the fast path has written, also before `label_start`.
    #[cold]
    fn map_and_merge(
        &mut self,
        name: &[u16],
        label_start: usize,
        mut stop: usize,
        dest: &mut WritableAlias,
    ) -> Result<(), UErrorCode> {
        if name.at(stop) == HYPHEN {
            dest.as_mut_slice().set(stop, HYPHEN);
            stop += 1;
        }
        dest.truncate(stop);
        // Replaces unpaired surrogates first, because the mapping may remove what separates two of them.
        let mut well_formed = try_with_capacity(name.len() - stop)?;
        for c in code_points(name.slice(stop..)) {
            if utf16::is_surrogate(c) {
                self.info.errors |= UIDNA_ERROR_DISALLOWED;
                well_formed.add(REPLACEMENT);
            } else {
                well_formed.add_code_point(c);
            }
        }
        (self.idna.mapping).normalize_second_and_append(dest, &well_formed)?;
        // A pair may have replaced the dot.
        if let Some(unit @ 0xdc00..=0xdfff) = dest.as_mut_slice().get_mut(label_start) {
            *unit = REPLACEMENT;
        }
        Ok(())
    }

    /// Converts the labels from `label_start` on. ICU4C: uts46.cpp, UTS46::processUnicode
    fn process_labels(
        &mut self,
        mut label_start: usize,
        dest: &mut WritableAlias,
    ) -> Result<(), UErrorCode> {
        let (mut scratch, new_scratch) =
            (None, || [0; punycode::max_encoded_len(MAX_LABEL_LENGTH)]);
        // An empty label is allowed after the final dot.
        while let Some(rest @ [_, ..]) = dest.as_slice().get(label_start..) {
            let (length, bits) = scan_label(rest);
            self.info.is_transitional_different |= bits & HAS_DEVIATION_CHARACTER != 0;
            let mut end = label_start + length;
            if let Some(change) = self.process_label(rest.slice(..length), bits) {
                let scratch = scratch.get_or_insert_with(new_scratch);
                end = self.change_label(dest, label_start..end, change, bits, scratch)?;
            }
            self.info.errors |= std::mem::take(&mut self.severe_label_errors);
            label_start = end + 1;
        }
        Ok(())
    }

    // ICU4C: uts46.cpp, UTS46::processLabel
    fn process_label(&mut self, label: &[u16], bits: LabelBits) -> Option<LabelChange> {
        if label.is_empty() {
            self.info.errors |= UIDNA_ERROR_EMPTY_LABEL;
            return None;
        }
        if label.starts_with(&ACE_PREFIX) {
            return Some(LabelChange::Decode);
        }
        let mark_length = self.check_label(label, bits);
        if mark_length > 0 {
            return Some(LabelChange::ReplaceMark(mark_length));
        }
        if self.idna.form == OutputForm::Ascii && self.severe_label_errors == 0 {
            if bits as u16 > 0x7f {
                return Some(LabelChange::Encode);
            }
            self.check_label_length(label.len());
        }
        None
    }

    /// Returns the new end of the label `dest[range]`.
    #[inline(never)]
    fn change_label(
        &mut self,
        dest: &mut WritableAlias,
        range: Range<usize>,
        change: LabelChange,
        bits: LabelBits,
        scratch: &mut [u16],
    ) -> Result<usize, UErrorCode> {
        let label = dest.as_slice().slice(range.start..range.end);
        match change {
            LabelChange::ReplaceMark(length) => {
                replace(dest, range.start..range.start + length, &[REPLACEMENT])
                    .map(|()| range.end + 1 - length)
            }
            LabelChange::Encode => {
                let mut heap = Vec::new();
                let encoded = punycode::encode(label, scratch, &mut heap)?;
                self.check_label_length(encoded.len());
                replace(dest, range.clone(), encoded).map(|()| range.start + encoded.len())
            }
            LabelChange::Decode => {
                let mut decoded = WritableAlias::new(scratch, 0);
                let error = self.decode(label.slice(ACE_PREFIX.len()..), &mut decoded)?;
                self.severe_label_errors |= error;
                if error != 0 && bits <= 0x7f {
                    // An LDH label must not look valid.
                    replace(dest, range.end..range.end, &[REPLACEMENT]).map(|()| range.end + 1)
                } else if error == 0 && self.idna.form == OutputForm::Unicode {
                    replace(dest, range.clone(), decoded.as_slice())
                        .map(|()| range.start + decoded.len())
                } else {
                    if bits as u16 <= 0x7f {
                        self.check_label_length(range.len());
                    }
                    Ok(range.end)
                }
            }
        }
    }

    /// Decodes and checks the text after `xn--`. Returns the `UIDNA_ERROR_` value of an invalid label, else 0.
    fn decode(&mut self, encoded: &[u16], decoded: &mut WritableAlias) -> Result<u32, UErrorCode> {
        // "xn--" and "xn--ascii-" do not round-trip.
        if let [] | [_, .., HYPHEN] = encoded {
            return Ok(UIDNA_ERROR_INVALID_ACE_LABEL);
        }
        if punycode::decode(encoded, decoded).is_none() {
            return Ok(UIDNA_ERROR_PUNYCODE);
        }
        let label = decoded.as_slice();
        if !self.idna.mapping.is_normalized(label)? || label.starts_with(&ACE_PREFIX) {
            return Ok(UIDNA_ERROR_INVALID_ACE_LABEL);
        }
        self.check_label(label, scan_label(label).1);
        Ok(if self.severe_label_errors == 0 {
            0
        } else {
            UIDNA_ERROR_INVALID_ACE_LABEL
        })
    }

    /// Checks the validity criteria for the non-empty `label`. Returns the length of a leading combining mark.
    #[inline(always)]
    fn check_label(&mut self, label: &[u16], bits: LabelBits) -> usize {
        if let [_, _, HYPHEN, HYPHEN, ..] = label {
            self.info.errors |= UIDNA_ERROR_HYPHEN_3_4;
        }
        if let [HYPHEN, ..] = label {
            self.info.errors |= UIDNA_ERROR_LEADING_HYPHEN;
        }
        if let [.., HYPHEN] = label {
            self.info.errors |= UIDNA_ERROR_TRAILING_HYPHEN;
        }
        if bits & HAS_REPLACEMENT != 0 {
            self.severe_label_errors |= UIDNA_ERROR_DISALLOWED;
        }
        let mut first_length = 0;
        let first = utf16::next(label, &mut first_length);
        if first >= 0x300 && is_mark(first) {
            self.severe_label_errors |= UIDNA_ERROR_LEADING_COMBINING_MARK;
            return first_length;
        }
        if self.idna.form == OutputForm::Ascii && self.severe_label_errors == 0 {
            if bits <= 0x7f {
                // Letters are L, digits EN, the hyphen is ES.
                self.is_ok_bidi &= first > 0x39 && label.last() != Some(&HYPHEN);
            } else {
                self.check_label_bidi(label, first, first_length);
            }
            if bits as u16 & ZWNJ == ZWNJ && !self.is_label_ok_context_j(label) {
                self.info.errors |= UIDNA_ERROR_CONTEXTJ;
            }
        }
        0
    }

    /// Checks the Bidi Rule (RFC 5893, section 2). The code point `first` ends at index `i`.
    fn check_label_bidi(&mut self, label: &[u16], first: u32, i: usize) {
        let mask_of = |c| 1u32 << ubidi_get_class(c);
        let (first, mut rest) = (mask_of(first), code_points(label.slice(i..)).map(mask_of));
        // The class of the last character that is not NSM.
        let last = rest
            .rfind(|&mask| mask != 1 << U_DIR_NON_SPACING_MARK)
            .unwrap_or(first);
        let all = rest.fold(first | last, |all, mask| all | mask);
        self.is_ok_bidi &= if first & L_MASK != 0 {
            // Conditions 5 and 6
            all & !(L_MASK | EN_MASK | ES_CS_ET_ON_BN_NSM_MASK) == 0
                && last & !(L_MASK | EN_MASK) == 0
        } else {
            // Conditions 1 to 4
            first & R_AL_MASK != 0
                && all & !(R_AL_MASK | AN_MASK | EN_MASK | ES_CS_ET_ON_BN_NSM_MASK) == 0
                && last & !(R_AL_MASK | EN_MASK | AN_MASK) == 0
                && all & (EN_MASK | AN_MASK) != EN_MASK | AN_MASK
        };
        self.is_bidi_name |= all & (R_AL_MASK | AN_MASK) != 0;
    }

    /// Checks the CONTEXTJ rules (RFC 5892, appendix A.1 and A.2).
    fn is_label_ok_context_j(&self, label: &[u16]) -> bool {
        /// Matches `(Joining_Type:T)*(Joining_Type:{side,D})` at the start of `neighbors`.
        fn matches_joining_type(neighbors: impl Iterator<Item = u32>, side: UJoiningType) -> bool {
            let joining_type = neighbors
                .map(ubidi_get_joining_type)
                .find(|&joining_type| joining_type != U_JT_TRANSPARENT);
            joining_type.is_some_and(|joining_type| {
                joining_type == side || joining_type == U_JT_DUAL_JOINING
            })
        }
        label
            .iter()
            .enumerate()
            .filter(|&(_, &unit)| unit | 1 == ZWJ)
            .all(|(i, &unit)| {
                let (mut before, after) = (
                    code_points(label.slice(..i)).rev().peekable(),
                    code_points(label.slice(i + 1..)),
                );
                before
                    .peek()
                    .is_some_and(|&c| self.idna.mapping.get_combining_class(c) == 9)
                    || (unit == ZWNJ
                        && matches_joining_type(before, U_JT_LEFT_JOINING)
                        && matches_joining_type(after, U_JT_RIGHT_JOINING))
            })
    }
}

#[inline(never)]
fn is_mark(c: u32) -> bool {
    (1 << u_char_type(c)) & U_GC_M_MASK != 0
}
