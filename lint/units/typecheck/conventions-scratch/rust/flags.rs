// Flag sets keep upstream's bit values. `a&b != 0` is `a.intersects(b)`, `a&b == b` is `a.contains(b)`, `a &^ b` is `a.without(b)`.
macro_rules! define_flags {
    ($name:ident : $repr:ty { $($flag:ident = $value:expr),* $(,)? }) => {
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
        pub struct $name(pub $repr);
        impl $name {
            pub const NONE: Self = Self(0);
            $(pub const $flag: Self = Self($value);)*
            #[inline]
            pub const fn bits(self) -> $repr {
                self.0
            }
            #[inline]
            pub const fn intersects(self, other: Self) -> bool {
                self.0 & other.0 != 0
            }
            #[inline]
            pub const fn contains(self, other: Self) -> bool {
                self.0 & other.0 == other.0
            }
            #[inline]
            pub const fn without(self, other: Self) -> Self {
                Self(self.0 & !other.0)
            }
        }
        impl core::ops::BitOr for $name {
            type Output = Self;
            #[inline]
            fn bitor(self, rhs: Self) -> Self {
                Self(self.0 | rhs.0)
            }
        }
        impl core::ops::BitAnd for $name {
            type Output = Self;
            #[inline]
            fn bitand(self, rhs: Self) -> Self {
                Self(self.0 & rhs.0)
            }
        }
        impl core::ops::BitOrAssign for $name {
            #[inline]
            fn bitor_assign(&mut self, rhs: Self) {
                self.0 |= rhs.0;
            }
        }
    };
}

define_flags!(TypeFlags: u32 {
    ANY = 1 << 0,
    UNKNOWN = 1 << 1,
    UNDEFINED = 1 << 2,
    NULL = 1 << 3,
    VOID = 1 << 4,
    STRING = 1 << 5,
    NUMBER = 1 << 6,
    BIG_INT = 1 << 7,
    BOOLEAN = 1 << 8,
    ES_SYMBOL = 1 << 9,
    STRING_LITERAL = 1 << 10,
    NUMBER_LITERAL = 1 << 11,
    BIG_INT_LITERAL = 1 << 12,
    BOOLEAN_LITERAL = 1 << 13,
    UNIQUE_ES_SYMBOL = 1 << 14,
    ENUM_LITERAL = 1 << 15,
    ENUM = 1 << 16,
    NON_PRIMITIVE = 1 << 17,
    NEVER = 1 << 18,
    TYPE_PARAMETER = 1 << 19,
    OBJECT = 1 << 20,
    INDEX = 1 << 21,
    TEMPLATE_LITERAL = 1 << 22,
    STRING_MAPPING = 1 << 23,
    SUBSTITUTION = 1 << 24,
    INDEXED_ACCESS = 1 << 25,
    CONDITIONAL = 1 << 26,
    UNION = 1 << 27,
    INTERSECTION = 1 << 28,
    UNION_OR_INTERSECTION = (1 << 27) | (1 << 28),
});

define_flags!(ObjectFlags: u32 {
    CLASS = 1 << 0,
    INTERFACE = 1 << 1,
    REFERENCE = 1 << 2,
    TUPLE = 1 << 3,
    ANONYMOUS = 1 << 4,
    MAPPED = 1 << 5,
    CLASS_OR_INTERFACE = (1 << 0) | (1 << 1),
    COULD_CONTAIN_TYPE_VARIABLES_COMPUTED = 1 << 19,
    COULD_CONTAIN_TYPE_VARIABLES = 1 << 20,
    MEMBERS_RESOLVED = 1 << 21,
    OBJECT_TYPE_KIND_MASK = 0x0000_04FF,
});

define_flags!(SymbolFlags: u32 {
    CLASS = 1 << 5,
    INTERFACE = 1 << 6,
    TYPE_ALIAS = 1 << 19,
    TRANSIENT = 1 << 25,
});

define_flags!(ElementFlags: u32 {
    REQUIRED = 1 << 0,
    OPTIONAL = 1 << 1,
    REST = 1 << 2,
    VARIADIC = 1 << 3,
});
