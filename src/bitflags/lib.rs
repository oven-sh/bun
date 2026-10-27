//! `bitflags!` from crates.io, where two flags of one set that are written as the same bit do not compile.

#![no_std]

#[doc(hidden)]
pub use bitflags as __upstream;

/// The crates.io macro, then a check of each set. A second name for a bit is written as `Self::FIRST.bits()`.
#[macro_export]
macro_rules! bitflags {
    () => {};
    (
        $(#[$outer:meta])*
        $vis:vis struct $Name:ident : $T:ty { $($body:tt)* }
        $($rest:tt)*
    ) => {
        $crate::__upstream::bitflags! {
            $(#[$outer])*
            $vis struct $Name : $T { $($body)* }
        }
        const _: () = $crate::__each_bit_is_numbered_once(&$crate::__bit_numbered_twice!($Name { $($body)* }));
        $crate::bitflags! { $($rest)* }
    };
    (
        $(#[$outer:meta])*
        impl $Name:ident : $T:ty { $($body:tt)* }
        $($rest:tt)*
    ) => {
        $crate::__upstream::bitflags! {
            $(#[$outer])*
            impl $Name : $T { $($body)* }
        }
        const _: () = $crate::__each_bit_is_numbered_once(&$crate::__bit_numbered_twice!($Name { $($body)* }));
        $crate::bitflags! { $($rest)* }
    };
}

/// The error for the set `$Name`, or `None`. An expression, so that a test can read the error of a set that has one.
#[doc(hidden)]
#[macro_export]
macro_rules! __bit_numbered_twice {
    ($Name:ident {
        $(
            $(#[$inner:meta])*
            const $Flag:tt = $value:expr;
        )*
    }) => {{
        const FLAGS: &[$crate::__upstream::Flag<$Name>] = <$Name as $crate::__upstream::Flags>::FLAGS;
        let mut flags = [$crate::__Flag::UNNAMED; FLAGS.len()];
        let mut i = 0;
        while i < FLAGS.len() {
            let bits = FLAGS[i].value().bits();
            flags[i] = $crate::__Flag::new(FLAGS[i].name(), bits.count_ones(), bits.trailing_zeros());
            i += 1;
        }
        // `FLAGS` has no flag that `#[cfg]` removed. This list of the flags as they are written has all of them.
        $crate::__bit_numbered_twice(stringify!($Name), &flags, &[$((stringify!($Flag), stringify!($value)),)*])
    }};
}

/// One flag of a set, as the check reads it.
#[doc(hidden)]
#[derive(Clone, Copy)]
pub struct __Flag {
    /// Empty for `const _ = ..;`.
    name: &'static str,
    ones: u32,
    lowest_one: u32,
}

impl __Flag {
    pub const UNNAMED: Self = Self::new("", 0, 0);

    pub const fn new(name: &'static str, ones: u32, lowest_one: u32) -> Self {
        Self {
            name,
            ones,
            lowest_one,
        }
    }
}

#[doc(hidden)]
#[track_caller]
pub const fn __each_bit_is_numbered_once(numbered_twice: &Option<__Message>) {
    if let Some(message) = numbered_twice {
        panic!("{}", message.as_str());
    }
}

/// `written` is `(name, value)` of each flag of the declaration, as source text.
#[doc(hidden)]
pub const fn __bit_numbered_twice(
    set: &str,
    flags: &[__Flag],
    written: &[(&str, &str)],
) -> Option<__Message> {
    match numbered_twice(flags, written) {
        Some(twice) => Some(twice.message(set)),
        None => None,
    }
}

/// Two flags that are written as numbers and have the same single bit.
#[cfg_attr(test, derive(Debug, PartialEq, Eq))]
struct NumberedTwice {
    first: &'static str,
    second: &'static str,
    bit: u32,
}

const fn numbered_twice(flags: &[__Flag], written: &[(&str, &str)]) -> Option<NumberedTwice> {
    const NONE: usize = usize::MAX;
    // By bit: the first flag that is written as a number.
    let mut numbered = [NONE; u128::BITS as usize];
    // `flags` has no flag that `#[cfg]` removed, and `written` has all of them.
    let none_removed = flags.len() == written.len();
    let mut next = 0;
    let mut i = 0;
    while i < flags.len() {
        let flag = flags[i];
        let at = if none_removed {
            i
        } else {
            position(written, next, flag.name)
        };
        if at < written.len() {
            next = at + 1;
            // `1 << 3` is a number. `Self::A.bits()` and `libc::O_NONBLOCK` are not.
            if flag.ones == 1 && !flag.name.is_empty() && !has_path(written[at].1) {
                let first = numbered[flag.lowest_one as usize];
                if first == NONE {
                    numbered[flag.lowest_one as usize] = i;
                } else if !str_eq(flags[first].name, flag.name) {
                    return Some(NumberedTwice {
                        first: flags[first].name,
                        second: flag.name,
                        bit: flag.lowest_one,
                    });
                }
            }
        }
        i += 1;
    }
    None
}

/// Where the flag `name` is in `written`, at or after `from`. If `#[cfg]` gives one name two values, the first.
const fn position(written: &[(&str, &str)], from: usize, name: &str) -> usize {
    let mut at = from;
    while at < written.len() && !str_eq(written[at].0, name) {
        at += 1;
    }
    at
}

const fn str_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut i = 0;
    while i < a.len() {
        if a[i] != b[i] {
            return false;
        }
        i += 1;
    }
    true
}

const fn has_path(value: &str) -> bool {
    let value = value.as_bytes();
    let mut i = 1;
    while i < value.len() {
        if value[i - 1] == b':' && value[i] == b':' {
            return true;
        }
        i += 1;
    }
    false
}

impl NumberedTwice {
    const fn message(&self, set: &str) -> __Message {
        let mut message = __Message {
            bytes: [0; 512],
            len: 0,
        };
        message.push(set);
        message.push("::");
        message.push(self.first);
        message.push(" and ");
        message.push(set);
        message.push("::");
        message.push(self.second);
        message.push(" are both written as bit ");
        message.push_number(self.bit);
        message.push(
            ". Move the one that your change adds to a bit that no flag of this set has. If ",
        );
        message.push(self.second);
        message.push(" is another name for ");
        message.push(self.first);
        message.push(", write `const ");
        message.push(self.second);
        message.push(" = Self::");
        message.push(self.first);
        message.push(".bits();`.");
        message
    }
}

/// Text that is built during const evaluation, where nothing can allocate.
#[doc(hidden)]
pub struct __Message {
    bytes: [u8; 512],
    len: usize,
}

impl __Message {
    const fn push(&mut self, text: &str) {
        let text = text.as_bytes();
        let mut i = 0;
        while i < text.len() && self.len < self.bytes.len() {
            self.bytes[self.len] = text[i];
            self.len += 1;
            i += 1;
        }
    }

    const fn push_number(&mut self, number: u32) {
        if number >= 10 {
            self.push_number(number / 10);
        }
        let digit = [b'0' + (number % 10) as u8];
        if let Ok(digit) = core::str::from_utf8(&digit) {
            self.push(digit);
        }
    }

    pub const fn as_str(&self) -> &str {
        let (text, _) = self.bytes.split_at(self.len);
        match core::str::from_utf8(text) {
            Ok(text) => text,
            // A flag name that does not fit was cut inside a character.
            Err(_) => "two flags of one set are written as the same bit",
        }
    }
}

#[cfg(doctest)]
#[doc = r#"
```compile_fail,E0080
bun_bitflags::bitflags! {
    pub struct Flags: u32 {
        const IS_BARREL_DEFERRED = 1 << 18;
        const IS_DEV_SERVER_STYLESHEET = 1 << 19;
        const RESOLVED_WITHOUT_URL_SUFFIX = 1 << 19;
    }
}
```

```compile_fail,E0080
pub struct Flags(i8);

bun_bitflags::bitflags! {
    impl Flags: i8 {
        const A = -128;
        const B = 1 << 7;
    }
}
```

```compile_fail,E0080
bun_bitflags::bitflags! {
    pub struct First: u8 {
        const A = 1;
    }

    pub struct Second: u8 {
        const A = 2;
        const B = 2;
    }
}
```

```compile_fail,E0080
pub struct First(u8);

bun_bitflags::bitflags! {
    impl First: u8 {
        const A = 1;
    }

    pub struct Second: u8 {
        const A = 2;
        const B = 2;
    }
}
```
"#]
mod two_flags_written_as_one_bit_do_not_compile {}

#[cfg(test)]
mod tests {
    use super::{__Flag, NumberedTwice, has_path, numbered_twice, position};

    crate::bitflags! {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        struct Numbered: u16 {
            /// The first flag.
            const A = 1 << 0;
            const B = 1 << 1;
            const HIGHEST = 1 << 15;
        }

        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        struct SecondNames: u32 {
            const A = 1 << 10;
            const A_EXCLUDES = Self::A.bits();
            const B = 0x800;
            const BOTH = Self::A.bits() | Self::B.bits();
            const ALSO_BOTH = 0xc00;
            #[cfg(any())]
            const REMOVED = 1 << 10;
            const AFTER_REMOVED = 1 << 12;
        }
    }

    struct Manual(i32);

    crate::bitflags! {
        impl Manual: i32 {
            const A = 1;
            const SIGN = i32::MIN;
            const _ = !0;
        }

        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        struct AfterManual: u8 {
            const A = 1;
        }
    }

    /// A number and a second name for each bit: the check must not take longer for a set with many second names.
    macro_rules! every_bit_twice {
        ($($bit:literal $A:ident $B:ident),* $(,)?) => {
            crate::bitflags! {
                #[derive(Clone, Copy, PartialEq, Eq, Debug)]
                struct EveryBitTwice: u128 {
                    $(
                        const $A = 1 << $bit;
                        const $B = Self::$A.bits();
                    )*
                }
            }
        };
    }

    #[rustfmt::skip]
    every_bit_twice!(
        0 A0 B0, 1 A1 B1, 2 A2 B2, 3 A3 B3, 4 A4 B4, 5 A5 B5, 6 A6 B6, 7 A7 B7,
        8 A8 B8, 9 A9 B9, 10 A10 B10, 11 A11 B11, 12 A12 B12, 13 A13 B13, 14 A14 B14, 15 A15 B15,
        16 A16 B16, 17 A17 B17, 18 A18 B18, 19 A19 B19, 20 A20 B20, 21 A21 B21, 22 A22 B22, 23 A23 B23,
        24 A24 B24, 25 A25 B25, 26 A26 B26, 27 A27 B27, 28 A28 B28, 29 A29 B29, 30 A30 B30, 31 A31 B31,
        32 A32 B32, 33 A33 B33, 34 A34 B34, 35 A35 B35, 36 A36 B36, 37 A37 B37, 38 A38 B38, 39 A39 B39,
        40 A40 B40, 41 A41 B41, 42 A42 B42, 43 A43 B43, 44 A44 B44, 45 A45 B45, 46 A46 B46, 47 A47 B47,
        48 A48 B48, 49 A49 B49, 50 A50 B50, 51 A51 B51, 52 A52 B52, 53 A53 B53, 54 A54 B54, 55 A55 B55,
        56 A56 B56, 57 A57 B57, 58 A58 B58, 59 A59 B59, 60 A60 B60, 61 A61 B61, 62 A62 B62, 63 A63 B63,
        64 A64 B64, 65 A65 B65, 66 A66 B66, 67 A67 B67, 68 A68 B68, 69 A69 B69, 70 A70 B70, 71 A71 B71,
        72 A72 B72, 73 A73 B73, 74 A74 B74, 75 A75 B75, 76 A76 B76, 77 A77 B77, 78 A78 B78, 79 A79 B79,
        80 A80 B80, 81 A81 B81, 82 A82 B82, 83 A83 B83, 84 A84 B84, 85 A85 B85, 86 A86 B86, 87 A87 B87,
        88 A88 B88, 89 A89 B89, 90 A90 B90, 91 A91 B91, 92 A92 B92, 93 A93 B93, 94 A94 B94, 95 A95 B95,
        96 A96 B96, 97 A97 B97, 98 A98 B98, 99 A99 B99, 100 A100 B100, 101 A101 B101, 102 A102 B102, 103 A103 B103,
        104 A104 B104, 105 A105 B105, 106 A106 B106, 107 A107 B107, 108 A108 B108, 109 A109 B109, 110 A110 B110, 111 A111 B111,
        112 A112 B112, 113 A113 B113, 114 A114 B114, 115 A115 B115, 116 A116 B116, 117 A117 B117, 118 A118 B118, 119 A119 B119,
        120 A120 B120, 121 A121 B121, 122 A122 B122, 123 A123 B123, 124 A124 B124, 125 A125 B125, 126 A126 B126, 127 A127 B127,
    );

    #[test]
    fn sets_that_write_each_bit_once_compile() {
        assert_eq!(Numbered::all().bits(), 0b1000_0000_0000_0011);
        assert_eq!(Numbered::A | Numbered::B, Numbered::from_bits_retain(3));
        assert_eq!(SecondNames::A, SecondNames::A_EXCLUDES);
        assert_eq!(SecondNames::BOTH, SecondNames::ALSO_BOTH);
        assert_eq!(SecondNames::all().bits(), 0x1c00);
        assert_eq!(Manual::SIGN.bits(), i32::MIN);
        assert_eq!(Manual::A.0, 1);
        assert_eq!(AfterManual::all(), AfterManual::A);
        assert_eq!(EveryBitTwice::all().bits(), u128::MAX);
        assert_eq!(EveryBitTwice::A127, EveryBitTwice::B127);
    }

    /// The error of a set, from what `bitflags!` gives the check. The set is declared without the check.
    macro_rules! error_of {
        ($Name:ident : $T:ty { $($body:tt)* }) => {{
            crate::__upstream::bitflags! {
                struct $Name: $T { $($body)* }
            }
            crate::__bit_numbered_twice!($Name { $($body)* })
        }};
    }

    fn text(error: &Option<super::__Message>) -> Option<&str> {
        error.as_ref().map(super::__Message::as_str)
    }

    /// Whether the error starts with `start` and then says what to do.
    fn starts_with(error: &Option<super::__Message>, start: &str) -> bool {
        let advice =
            " Move the one that your change adds to a bit that no flag of this set has. If ";
        text(error)
            .is_some_and(|text| text.starts_with(start) && text[start.len()..].starts_with(advice))
    }

    #[test]
    fn the_error_names_the_set_both_flags_the_bit_and_what_to_do() {
        let error = error_of!(Flags: u32 {
            /// The highest flag on main.
            const IS_BARREL_DEFERRED = 1 << 18;
            const IS_DEV_SERVER_STYLESHEET = 1 << 19;
            const RESOLVED_WITHOUT_URL_SUFFIX = 1 << 19;
        });
        assert_eq!(
            text(&error),
            Some(
                "Flags::IS_DEV_SERVER_STYLESHEET and Flags::RESOLVED_WITHOUT_URL_SUFFIX are both written as \
                 bit 19. Move the one that your change adds to a bit that no flag of this set has. If \
                 RESOLVED_WITHOUT_URL_SUFFIX is another name for IS_DEV_SERVER_STYLESHEET, write `const \
                 RESOLVED_WITHOUT_URL_SUFFIX = Self::IS_DEV_SERVER_STYLESHEET.bits();`."
            )
        );
    }

    #[test]
    fn the_bit_is_the_set_s_own_at_every_width() {
        let sign_bit = error_of!(Signed: i8 { const A = -128; const B = 1 << 7; });
        assert!(starts_with(
            &sign_bit,
            "Signed::A and Signed::B are both written as bit 7."
        ));

        let top_of_a_full_set =
            error_of!(Full: u8 { const LOW = 0x7f; const A = 0x80; const B = 1 << 7; });
        assert!(starts_with(
            &top_of_a_full_set,
            "Full::A and Full::B are both written as bit 7."
        ));

        let above_64 =
            error_of!(Wide: u128 { const LOW = 1; const A = 1 << 100; const B = 1 << 100; });
        assert!(starts_with(
            &above_64,
            "Wide::A and Wide::B are both written as bit 100."
        ));

        let first_and_last = error_of!(Ends: u16 { const A = 1; const B = 2; const C = 0b1; });
        assert!(starts_with(
            &first_and_last,
            "Ends::A and Ends::C are both written as bit 0."
        ));
    }

    #[test]
    fn a_second_name_that_names_the_first_is_no_error() {
        assert_eq!(
            text(&error_of!(After: u8 { const A = 1 << 3; const ALSO_A = Self::A.bits(); })),
            None
        );
        assert_eq!(
            text(&error_of!(Before: u8 { const ALSO_A = Self::A.bits(); const A = 1 << 3; })),
            None
        );
        let between = error_of!(Between: u8 { const A = 8; const ALSO_A = Self::A.bits(); const B = 0b1000; });
        assert!(starts_with(
            &between,
            "Between::A and Between::B are both written as bit 3."
        ));
    }

    #[test]
    fn only_flags_of_one_bit_are_compared() {
        let error = error_of!(Several: u8 {
            const A = 1;
            const ALSO_A = Self::A.bits();
            const B = 2;
            const AB = 3;
            const ALSO_AB = 0b11;
            const NONE = 0;
            const ZERO = 0;
        });
        assert_eq!(text(&error), None);
    }

    #[test]
    fn a_flag_that_cfg_removed_is_not_in_the_set() {
        let removed_twin = error_of!(Twin: u8 {
            const A = 1;
            #[cfg(any())]
            const GONE = 1;
            const B = 2;
        });
        assert_eq!(text(&removed_twin), None);
        let after_removed = error_of!(After: u8 {
            #[cfg(any())]
            const GONE = Self::A.bits();
            const A = 1;
            #[cfg(any())]
            const ALSO_GONE = 4;
            const B = Self::A.bits();
            const C = 2;
            const D = 2;
        });
        assert!(starts_with(
            &after_removed,
            "After::C and After::D are both written as bit 1."
        ));
        let value_that_is_kept = error_of!(Kept: u8 {
            #[cfg(any())]
            const A = 2;
            const B = 2;
            #[cfg(all())]
            const A = Self::B.bits();
        });
        assert_eq!(text(&value_that_is_kept), None);
    }

    #[test]
    fn an_unnamed_flag_is_not_compared() {
        let error = error_of!(Unnamed: u8 { const A = 1; const _ = 1; const _ = 1; const B = 2; const _ = !0; });
        assert_eq!(text(&error), None);
        let after = error_of!(After: u8 {
            #[cfg(any())]
            const GONE = 1;
            const _ = 2;
            const A = 2;
            const _ = 2;
            const B = 2;
        });
        assert!(starts_with(
            &after,
            "After::A and After::B are both written as bit 1."
        ));
    }

    /// The check for a set given as `(name, value, value as source text)`.
    fn check(set: &[(&'static str, u8, &str)], written: &[(&str, &str)]) -> Option<NumberedTwice> {
        let flags: [__Flag; 4] = core::array::from_fn(|i| match set.get(i) {
            Some(&(name, bits, _)) => __Flag::new(name, bits.count_ones(), bits.trailing_zeros()),
            None => __Flag::UNNAMED,
        });
        numbered_twice(&flags[..set.len()], written)
    }

    #[test]
    fn a_name_that_is_defined_twice_is_left_to_rustc() {
        let written = [("A", "1 << 3"), ("A", "1 << 3"), ("B", "1"), ("C", "1")];
        let set = [("A", 8, ""), ("A", 8, ""), ("B", 1, ""), ("C", 1, "")];
        assert_eq!(
            check(&set, &written),
            Some(NumberedTwice {
                first: "B",
                second: "C",
                bit: 0
            })
        );
        assert_eq!(check(&set[..2], &written[..2]), None);
    }

    #[test]
    fn a_flag_is_found_by_its_whole_name_after_the_last_one() {
        let written = [("AB", "1"), ("A", "2"), ("B", "4"), ("A", "8")];
        assert_eq!(position(&written, 0, "A"), 1);
        assert_eq!(position(&written, 2, "A"), 3);
        assert_eq!(position(&written, 0, "B"), 2);
        assert_eq!(position(&written, 0, "C"), 4);
        assert_eq!(position(&written, 4, "A"), 4);
        // A flag that is not in the list is not a number, and the flags after it are still found.
        let set = [("X", 1, ""), ("B", 4, ""), ("A", 4, "")];
        assert_eq!(
            check(&set, &written),
            Some(NumberedTwice {
                first: "B",
                second: "A",
                bit: 2
            })
        );
    }

    #[test]
    fn a_value_with_a_path_is_not_a_number() {
        for number in ["1 << 19", "0b1000", "1 << SHIFT", "", ":", "a: b"] {
            assert!(!has_path(number), "{number}");
        }
        for path in [
            "::",
            "Self::A.bits()",
            "1 << 3 | Self::A.bits()",
            "libc::O_NONBLOCK",
            "i32::MIN",
        ] {
            assert!(has_path(path), "{path}");
        }
    }

    #[test]
    fn a_message_that_does_not_fit_is_cut() {
        let long = "LONGER_THAN_THE_MESSAGE_CAN_HOLD_LONGER_THAN_THE_MESSAGE_CAN_HOLD_LONGER_THAN_THE_MESSAGE_\
                    CAN_HOLD_LONGER_THAN_THE_MESSAGE_CAN_HOLD_LONGER_THAN_THE_MESSAGE_CAN_HOLD_LONGER_THAN_THE_";
        let twice = NumberedTwice {
            first: long,
            second: long,
            bit: 0,
        };
        let message = twice.message("Set");
        assert_eq!(message.as_str().len(), 512);
        assert!(
            message
                .as_str()
                .starts_with("Set::LONGER_THAN_THE_MESSAGE_CAN_HOLD_")
        );
        let mut cut_inside_a_character = NumberedTwice {
            first: "é",
            second: "B",
            bit: 0,
        }
        .message("Set");
        cut_inside_a_character.len = "Set::é".len() - 1;
        assert_eq!(
            cut_inside_a_character.as_str(),
            "two flags of one set are written as the same bit"
        );
    }
}
