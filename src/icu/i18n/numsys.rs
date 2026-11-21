//! A numbering system is a string of ten digits or the name of a rule set. ICU4C: numsys.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::locid::Locale;
use crate::common::memory::{try_box, try_to_vec};
use crate::common::resource::ResourceTable;
use crate::common::sink::CheckedArraySink;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::uenum::{Item, StringEnumeration, UEnumeration};
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::{Subtag, ulocimp_get_keyword_value_to};
use crate::common::unicode::uloc::ULOC_KEYWORDS_CAPACITY;
use crate::common::unistr::UStr;
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use std::ffi::CStr;

const NUMBERING_SYSTEMS: &[u8] = b"numberingSystems";
const LATIN_DIGITS: [u16; 10] = from_latin1(b"0123456789");

const MAX_NAME_LENGTH: usize = 8;

/// The last byte of the array is always NUL.
pub(crate) type Name = ArrayVec<u8, { MAX_NAME_LENGTH + 1 }>;

pub(crate) const LATN: Name = Name::from_array(*b"latn\0\0\0\0\0", 4);

pub(crate) struct NumberingSystem {
    description: Vec<u16>,
    is_algorithmic: bool,
    pub(crate) name: Name,
}

impl NumberingSystem {
    pub(crate) fn create_instance_for_locale(locale: &Locale) -> Result<Self, UErrorCode> {
        const CAPACITY: usize = ULOC_KEYWORDS_CAPACITY as usize;
        let mut keyword = [0; CAPACITY];
        let mut sink = CheckedArraySink::new(&mut keyword);
        let found = ulocimp_get_keyword_value_to(locale.get_name(), b"numbers", &mut sink);
        // A value that does not fit is ignored.
        let length = found.ok().map(|()| sink.length());
        let length = length.filter(|&length| length < CAPACITY);
        let mut kind: &[u8] = match length.map_or(&[][..], |length| keyword.slice(..length)) {
            b"" => b"default",
            kind @ (b"default" | b"native" | b"traditional" | b"finance") => kind,
            name => return Self::create_instance_by_name(name),
        };

        let bundle = ures_open(None, locale.get_name()).ok();
        let elements = bundle.and_then(|it| it.get_by_key(b"NumberElements").ok());
        loop {
            let name = elements
                .as_ref()
                .and_then(|it| it.get_string_by_key_with_fallback(kind).ok());
            if let Some(name) = name {
                let name = Subtag::<CAPACITY>::new(invariant_prefix(name.units().iter()));
                return Self::create_instance_by_name(&name);
            }
            kind = match kind {
                b"native" | b"finance" => b"default",
                b"traditional" => b"native",
                _ => break,
            };
        }
        Ok(Self {
            description: try_to_vec(&LATIN_DIGITS)?,
            is_algorithmic: false,
            name: LATN,
        })
    }

    pub(crate) fn create_instance_by_name(name: &[u8]) -> Result<Self, UErrorCode> {
        let system = Self::load(name).or(Err(U_UNSUPPORTED_ERROR))?;
        if !system.is_algorithmic && system.description.count_char32() != 10 {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        Ok(system)
    }

    fn load(name: &[u8]) -> Result<Self, UErrorCode> {
        let mut system = ures_open_direct(None, NUMBERING_SYSTEMS)?;
        system.descend(NUMBERING_SYSTEMS)?;
        system.descend(name)?;
        let description = system.get_data_string_by_key(b"desc")?;
        Ok(Self {
            description: description.units().try_to_vec()?,
            is_algorithmic: system.get_by_key(b"algorithmic")?.get_int()? == 1,
            name: Name::from_slice(name.slice(..name.len().min(MAX_NAME_LENGTH))),
        })
    }

    /// Returns the digits, or the name of a rule set.
    pub(crate) fn get_description(&self) -> &[u16] {
        &self.description
    }

    pub(crate) fn get_name_c_str(&self) -> &CStr {
        CStr::from_bytes_until_nul(&self.name.units)
            .ok()
            .soft_unwrap()
    }

    pub(crate) fn is_algorithmic(&self) -> bool {
        self.is_algorithmic
    }

    pub(crate) fn get_available_names() -> Result<UEnumeration, UErrorCode> {
        let bundle = ures_open_direct(None, NUMBERING_SYSTEMS)?;
        let systems = bundle.get_by_key(NUMBERING_SYSTEMS)?;
        Ok(try_box(NumsysNameEnumeration {
            systems: systems.get_value().get_table()?,
            position: 0,
        })?)
    }
}

struct NumsysNameEnumeration {
    systems: ResourceTable,
    position: usize,
}

impl StringEnumeration for NumsysNameEnumeration {
    fn count(&self) -> Result<usize, UErrorCode> {
        Ok(self.systems.get_size())
    }

    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        let name = self.systems.key_at(self.position);
        self.position += usize::from(name.is_some());
        Ok(name.map(|name| Item::Chars(name.as_c_str())))
    }
}
