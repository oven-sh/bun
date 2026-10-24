use core::fmt;
use core::hash::Hash;
use core::num::NonZeroU32;

pub const ABSENT_WORD: u32 = u32::MAX;

pub trait Id: Copy + Eq + Ord + Hash + Default {
    const PREFIX: &'static str;

    fn new(index: usize) -> Self;
    fn index(self) -> usize;
    fn from_word(word: u32) -> Self;
    fn to_word(self) -> u32;
}

#[inline]
pub fn optional_id_from_word<I: Id>(word: u32) -> Option<I> {
    (word != ABSENT_WORD).then(|| I::from_word(word))
}

#[inline]
pub fn optional_id_to_word<I: Id>(id: Option<I>) -> u32 {
    id.map_or(ABSENT_WORD, I::to_word)
}

#[inline]
pub fn optional_word(word: Option<u32>) -> u32 {
    debug_assert!(word != Some(ABSENT_WORD));
    word.unwrap_or(ABSENT_WORD)
}

macro_rules! id {
    ($name:ident, $prefix:literal) => {
        #[repr(transparent)]
        #[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(NonZeroU32);

        impl $name {
            #[inline]
            pub const fn from_word(word: u32) -> $name {
                match NonZeroU32::new(word.wrapping_add(1)) {
                    Some(word_plus_one) => $name(word_plus_one),
                    None => panic!("the absent word is not an id"),
                }
            }

            #[inline]
            pub const fn to_word(self) -> u32 {
                self.0.get() - 1
            }
        }

        impl Id for $name {
            const PREFIX: &'static str = $prefix;

            #[inline]
            fn new(index: usize) -> $name {
                assert!(index < ABSENT_WORD as usize);
                $name::from_word(index as u32)
            }

            #[inline]
            fn index(self) -> usize {
                self.to_word() as usize
            }

            #[inline]
            fn from_word(word: u32) -> $name {
                $name::from_word(word)
            }

            #[inline]
            fn to_word(self) -> u32 {
                $name::to_word(self)
            }
        }

        impl Default for $name {
            #[inline]
            fn default() -> $name {
                $name::from_word(0)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, concat!($prefix, "{}"), self.to_word())
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Debug::fmt(self, f)
            }
        }

        const _: () = assert!(size_of::<Option<$name>>() == 4);
    };
}

id!(ValueId, "v");
id!(BlockId, "b");
id!(StringId, "s");
id!(PropertyKeyId, "k");
id!(TypeId, "t");
id!(TypeSiteId, "w");
id!(ExpectedResultId, "x");
id!(LayoutId, "L");
id!(VariableId, "g");
id!(ModuleId, "m");
id!(ModuleFailureId, "q");
id!(EvalScopeId, "e");
id!(FunctionId, "f");
id!(DataId, "d");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_word_is_no_id() {
        assert_eq!(optional_id_from_word::<TypeId>(ABSENT_WORD), None);
        assert_eq!(optional_id_to_word::<TypeId>(None), ABSENT_WORD);
        assert_eq!(optional_word(None), ABSENT_WORD);
        assert_eq!(optional_word(Some(7)), 7);
    }

    #[test]
    fn words_round_trip() {
        assert_eq!(optional_id_from_word(7), Some(BlockId::new(7)));
        assert_eq!(optional_id_to_word(Some(BlockId::new(7))), 7);
        assert_eq!(FunctionId::from_word(7), FunctionId::new(7));
        assert_eq!(FunctionId::new(7).to_word(), 7);
        assert_eq!(FunctionId::new(7).index(), 7);
        assert_eq!(
            ValueId::new(ABSENT_WORD as usize - 1).to_word(),
            ABSENT_WORD - 1
        );
    }

    #[test]
    fn default_is_id_zero() {
        assert_eq!(ModuleId::default(), ModuleId::new(0));
        assert_eq!(ModuleId::default().to_word(), 0);
    }

    #[test]
    fn ids_order_by_index() {
        assert!(StringId::new(2) < StringId::new(10));
        assert!(None < Some(StringId::new(0)));
    }

    #[test]
    fn ids_print_text_prefixes() {
        let printed = format!(
            "{} {} {} {} {} {} {} {} {} {} {} {} {} {}",
            ValueId::new(3),
            BlockId::new(3),
            StringId::new(3),
            PropertyKeyId::new(3),
            TypeId::new(3),
            TypeSiteId::new(3),
            ExpectedResultId::new(3),
            LayoutId::new(3),
            VariableId::new(3),
            ModuleId::new(3),
            ModuleFailureId::new(3),
            EvalScopeId::new(3),
            FunctionId::new(3),
            DataId::new(3),
        );
        assert_eq!(printed, "v3 b3 s3 k3 t3 w3 x3 L3 g3 m3 q3 e3 f3 d3");
        assert_eq!(format!("{:?}", LayoutId::new(3)), "L3");
        assert_eq!(LayoutId::PREFIX, "L");
    }

    #[test]
    #[should_panic]
    fn new_rejects_absent_index() {
        ValueId::new(ABSENT_WORD as usize);
    }

    #[test]
    #[should_panic]
    fn from_word_rejects_absent_word() {
        ValueId::from_word(ABSENT_WORD);
    }
}
