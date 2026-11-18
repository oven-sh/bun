use bun_engine_text::Text;

use crate::class::{self, UPPERCASE};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Scheme {
    /// Not a special scheme.
    Other = 0,
    Http = 1,
    Https = 2,
    Ws = 3,
    Wss = 4,
    Ftp = 5,
    File = 6,
}

impl Scheme {
    /// `name` has no colon. Case matters.
    pub fn named(name: Text<'_>) -> Scheme {
        match name {
            Text::Latin1(name) => Scheme::of(name),
            Text::Utf16(units) if units.len() <= 5 && name.is_ascii() => {
                let mut name = [0; 5];
                for (byte, &unit) in name.iter_mut().zip(units) {
                    *byte = unit as u8;
                }
                Scheme::of(&name[..units.len()])
            }
            Text::Utf16(_) => Scheme::Other,
        }
    }

    #[inline]
    pub(crate) fn of(name: &[u8]) -> Scheme {
        match name {
            b"http" => Scheme::Http,
            b"https" => Scheme::Https,
            b"ws" => Scheme::Ws,
            b"wss" => Scheme::Wss,
            b"ftp" => Scheme::Ftp,
            b"file" => Scheme::File,
            _ => Scheme::Other,
        }
    }

    pub(crate) fn of_any_case(name: &[u8]) -> Scheme {
        let mut lowercase = [0; 5];
        let Some(lowercase) = lowercase.get_mut(..name.len()) else {
            return Scheme::Other;
        };
        lowercase.copy_from_slice(name);
        lowercase.make_ascii_lowercase();
        Scheme::of(lowercase)
    }

    #[inline]
    pub fn is_special(self) -> bool {
        self != Scheme::Other
    }

    #[inline]
    pub fn default_port(self) -> Option<u16> {
        match self {
            Scheme::Http | Scheme::Ws => Some(80),
            Scheme::Https | Scheme::Wss => Some(443),
            Scheme::Ftp => Some(21),
            Scheme::File | Scheme::Other => None,
        }
    }

    /// What a URL of a special scheme starts with.
    pub(crate) fn prefix(self) -> &'static [u8] {
        match self {
            Scheme::Http => b"http://",
            Scheme::Https => b"https://",
            Scheme::Ws => b"ws://",
            Scheme::Wss => b"wss://",
            Scheme::Ftp => b"ftp://",
            Scheme::File => b"file://",
            Scheme::Other => b"",
        }
    }
}

/// How many bytes `input` starts with that make a scheme if a colon follows, and whether one is uppercase.
#[inline]
pub(crate) fn scan_scheme(input: &[u8]) -> (usize, bool) {
    if !input.first().is_some_and(u8::is_ascii_alphabetic) {
        return (0, false);
    }
    let (mut length, mut traits) = (0, 0);
    for &byte in input.iter().take_while(|&&byte| class::is_in_scheme(byte)) {
        traits |= class::host_traits(byte);
        length += 1;
    }
    (length, traits & UPPERCASE != 0)
}
