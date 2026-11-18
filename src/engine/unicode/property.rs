use core::ops::RangeInclusive;

use bun_engine_text::Text;

use crate::tables::{
    BINARY_PROPERTY_NAMES, FIRST_PROPERTY_OF_STRINGS, GENERAL_CATEGORY_NAMES, PROPERTY_COUNT,
    PROPERTY_OF_STRINGS_NAMES, PROPERTY_SECTIONS, SCRIPT_NAMES, SCRIPT_PROPERTIES,
};

static DATA: &[u8] = include_bytes!("properties.bin");

/// Sorted names, one after the other.
pub(crate) struct Names {
    pub(crate) text: &'static [u8],
    pub(crate) ends_and_values: &'static [(u16, u16)],
}

impl Names {
    fn find(&self, name: Text<'_>) -> Option<u16> {
        let (mut low, mut high) = (0, self.ends_and_values.len());
        while low < high {
            let middle = low.midpoint(high);
            let start = match middle {
                0 => 0,
                _ => self.ends_and_values[middle - 1].0,
            };
            let (end, value) = self.ends_and_values[middle];
            let candidate = Text::Latin1(&self.text[usize::from(start)..usize::from(end)]);
            match candidate.cmp(&name) {
                core::cmp::Ordering::Less => low = middle + 1,
                core::cmp::Ordering::Equal => return Some(value),
                core::cmp::Ordering::Greater => high = middle,
            }
        }
        None
    }
}

/// What a `\p{..}` of a regular expression names.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Property(u16);

impl Property {
    pub const COUNT: usize = PROPERTY_COUNT as usize;

    /// `\p{name=value}`
    pub fn with_value(name: Text<'_>, value: Text<'_>) -> Option<Property> {
        let is = |long, short| name.eq_ascii(long) || name.eq_ascii(short);
        let script = |column: usize| {
            let script = SCRIPT_NAMES.find(value)?;
            Some(SCRIPT_PROPERTIES[usize::from(script)][column])
        };
        let id = if is("General_Category", "gc") {
            GENERAL_CATEGORY_NAMES.find(value)
        } else if is("Script", "sc") {
            script(0)
        } else if is("Script_Extensions", "scx") {
            script(1)
        } else {
            None
        };
        id.map(Property)
    }

    /// `\p{name}`: a binary property or a general category.
    pub fn of_characters(name: Text<'_>) -> Option<Property> {
        BINARY_PROPERTY_NAMES
            .find(name)
            .or_else(|| GENERAL_CATEGORY_NAMES.find(name))
            .map(Property)
    }

    /// `\p{name}` under the flag `v`, besides those of [`Property::of_characters`].
    pub fn of_strings(name: Text<'_>) -> Option<Property> {
        PROPERTY_OF_STRINGS_NAMES.find(name).map(Property)
    }

    /// Below [`Property::COUNT`].
    #[inline]
    pub fn index(self) -> usize {
        usize::from(self.0)
    }

    #[inline]
    pub fn has_strings(self) -> bool {
        self.0 >= FIRST_PROPERTY_OF_STRINGS
    }

    /// The code points, ascending, with a gap between any two ranges.
    pub fn ranges(self) -> PropertyRanges {
        PropertyRanges {
            bytes: sections(self.0, self.0),
            next: 0,
        }
    }

    /// The members of more than one code point, each once.
    pub fn strings(self) -> PropertyStrings {
        let with_own_strings = PROPERTY_COUNT - 1 - FIRST_PROPERTY_OF_STRINGS;
        let bytes = match self.0.checked_sub(FIRST_PROPERTY_OF_STRINGS) {
            None => &[],
            Some(index) if index < with_own_strings => {
                sections(PROPERTY_COUNT + index, PROPERTY_COUNT + index)
            }
            Some(_) => sections(PROPERTY_COUNT, PROPERTY_COUNT + with_own_strings - 1),
        };
        PropertyStrings {
            bytes,
            string: [0; 16],
        }
    }
}

fn sections(first: u16, last: u16) -> &'static [u8] {
    let offset = |section: u16| usize::from(PROPERTY_SECTIONS[usize::from(section)]);
    &DATA[offset(first)..offset(last + 1)]
}

#[inline]
fn read_varint(bytes: &mut &[u8]) -> Option<u32> {
    let (mut value, mut shift) = (0, 0);
    loop {
        let byte = *bytes.split_off_first()?;
        value |= u32::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(value);
        }
        shift += 7;
    }
}

#[derive(Clone)]
pub struct PropertyRanges {
    bytes: &'static [u8],
    next: u32,
}

impl Iterator for PropertyRanges {
    type Item = RangeInclusive<u32>;

    #[inline]
    fn next(&mut self) -> Option<RangeInclusive<u32>> {
        let head = read_varint(&mut self.bytes)?;
        let first = self.next + (head >> 3);
        let mut last = first + (head & 7);
        if head & 7 == 7 {
            last += read_varint(&mut self.bytes)?;
        }
        self.next = last + 1;
        Some(first..=last)
    }
}

pub struct PropertyStrings {
    bytes: &'static [u8],
    string: [u32; 16],
}

impl PropertyStrings {
    pub fn next(&mut self) -> Option<&[u32]> {
        let head = *self.bytes.split_off_first()?;
        let kept = usize::from(head >> 4);
        let length = kept + usize::from(head & 15);
        for c in &mut self.string[kept..length] {
            *c = read_varint(&mut self.bytes)?;
        }
        Some(&self.string[..length])
    }
}
