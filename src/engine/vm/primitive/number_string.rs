use bun_engine_number::{Radix, integer_to_radix, parse_int, with_radix_text};
use bun_engine_text::Text;

use crate::{Cx, Gc, JsResult, JsString, Vm};

impl JsString {
    /// Number::toString
    pub fn from_number_in_radix(vm: &Vm, number: f64, radix: Radix) -> Gc<JsString> {
        if radix == Radix::DECIMAL {
            return Self::from_number(vm, number);
        }
        with_radix_text(number, radix, |text| {
            Self::from_text(vm, Text::Latin1(text))
        })
    }

    /// The same, for an integer of at most 53 bits.
    pub fn from_integer_in_radix(vm: &Vm, number: i64, radix: Radix) -> Gc<JsString> {
        if radix != Radix::DECIMAL {
            let mut buffer = [0; _];
            let text = integer_to_radix(number, radix, &mut buffer);
            return Self::from_text(vm, Text::Latin1(text));
        }
        match i32::try_from(number) {
            Ok(number) => Self::from_int32(vm, number),
            Err(_) => Self::from_number(vm, number as f64),
        }
    }

    /// What `parseInt` makes of it. `radix` is the result of ToInt32.
    #[inline]
    pub fn parse_int(&self, cx: &Cx, radix: i32) -> JsResult<f64> {
        self.with_text(cx, |text| parse_int(text, radix))
    }
}
