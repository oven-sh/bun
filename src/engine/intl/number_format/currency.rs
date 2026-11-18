use bun_engine_text::{CodeUnit, StringRef, Text};

/// A well-formed currency code in upper case.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Currency([u8; 3]);

impl Currency {
    pub(crate) fn parse(text: Text<'_>) -> Option<Currency> {
        if text.len() != 3 || !text.code_units().all(CodeUnit::is_ascii_alphabetic) {
            return None;
        }
        let letter = |index| (text.at(index) as u8).to_ascii_uppercase();
        Some(Currency([letter(0), letter(1), letter(2)]))
    }

    pub(crate) fn code(self) -> [u8; 3] {
        self.0
    }

    /// CurrencyDigits: the minor unit of ISO 4217.
    pub(crate) fn digits(self) -> u8 {
        match &self.0 {
            b"BIF" | b"BYR" | b"CLP" | b"DJF" | b"GNF" | b"ISK" | b"JPY" | b"KMF" | b"KRW"
            | b"PYG" | b"RWF" | b"UGX" | b"UYI" | b"VND" | b"VUV" | b"XAF" | b"XOF" | b"XPF" => 0,
            b"BHD" | b"IQD" | b"JOD" | b"KWD" | b"LYD" | b"OMR" | b"TND" => 3,
            b"CLF" => 4,
            _ => 2,
        }
    }

    pub fn to_string_ref(self) -> StringRef {
        StringRef::from_latin1(&self.0)
    }
}
