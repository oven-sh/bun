
use bun_core::strings;
use core::cmp::Ordering;

pub fn compare_code_units(a: &[u8], b: &[u8]) -> Ordering {
    strings::order_utf16(a, b)
}
