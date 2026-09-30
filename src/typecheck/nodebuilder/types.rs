// nodebuilder/types.go: the interfaces and flag types of the node builder that the printer family shares.
use crate::ast::{NodeId, SymbolFlags, SymbolId};

pub trait SymbolTracker {
    fn track_symbol(
        &mut self,
        symbol: SymbolId,
        enclosing_declaration: NodeId,
        meaning: SymbolFlags,
    ) -> bool;
    fn report_inaccessible_this_error(&mut self);
    fn report_private_in_base_of_class_expression(&mut self, property_name: &[u8]);
    fn report_inaccessible_unique_symbol_error(&mut self);
    fn report_cyclic_structure_error(&mut self);
    fn report_likely_unsafe_import_required_error(&mut self, specifier: &[u8], symbol_name: &[u8]);
    fn report_truncation_error(&mut self);
    fn report_nonlocal_augmentation(
        &mut self,
        containing_file: NodeId,
        parent_symbol: SymbolId,
        augmenting_symbol: SymbolId,
    );
    fn report_non_serializable_property(&mut self, property_name: &[u8]);
    fn report_inference_fallback(&mut self, node: NodeId);
    fn push_error_fallback_node(&mut self, node: NodeId);
    fn pop_error_fallback_node(&mut self);
}

// Flag sets keep upstream's bit values: `a&b != 0` is `a.intersects(b)`, `a&b == b` is `a.contains(b)`, `a &^ b` is `a.without(b)`.
macro_rules! define_flags {
    ($name:ident : $repr:ty { $($flag:ident = $value:expr),* $(,)? }) => {
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
        pub struct $name(pub $repr);
        impl $name {
            $(pub const $flag: Self = Self($value);)*
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
        impl std::ops::BitOr for $name {
            type Output = Self;
            #[inline]
            fn bitor(self, rhs: Self) -> Self {
                Self(self.0 | rhs.0)
            }
        }
        impl std::ops::BitAnd for $name {
            type Output = Self;
            #[inline]
            fn bitand(self, rhs: Self) -> Self {
                Self(self.0 & rhs.0)
            }
        }
        impl std::ops::BitOrAssign for $name {
            #[inline]
            fn bitor_assign(&mut self, rhs: Self) {
                self.0 |= rhs.0;
            }
        }
        impl std::ops::BitAndAssign for $name {
            #[inline]
            fn bitand_assign(&mut self, rhs: Self) {
                self.0 &= rhs.0;
            }
        }
    };
}

pub(crate) use define_flags;

// NOTE: If modifying this enum, must modify `TypeFormatFlags` too!
define_flags!(Flags: u32 {
    NONE = 0,
    NO_TRUNCATION = 1 << 0,
    WRITE_ARRAY_AS_GENERIC_TYPE = 1 << 1,
    GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS = 1 << 2,
    USE_STRUCTURAL_FALLBACK = 1 << 3,
    FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES = 1 << 4,
    WRITE_TYPE_ARGUMENTS_OF_SIGNATURE = 1 << 5,
    USE_FULLY_QUALIFIED_TYPE = 1 << 6,
    USE_ONLY_EXTERNAL_ALIASING = 1 << 7,
    SUPPRESS_ANY_RETURN_TYPE = 1 << 8,
    WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME = 1 << 9,
    MULTILINE_OBJECT_LITERALS = 1 << 10,
    WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL = 1 << 11,
    USE_TYPE_OF_FUNCTION = 1 << 12,
    OMIT_PARAMETER_MODIFIERS = 1 << 13,
    USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE = 1 << 14,
    USE_SINGLE_QUOTES_FOR_STRING_LITERAL_TYPE = 1 << 28,
    NO_TYPE_REDUCTION = 1 << 29,
    USE_INSTANTIATION_EXPRESSIONS = 1 << 30,
    OMIT_THIS_PARAMETER = 1 << 25,
    WRITE_CALL_STYLE_SIGNATURE = 1 << 27,
    ALLOW_THIS_IN_OBJECT_LITERAL = 1 << 15,
    ALLOW_QUALIFIED_NAME_IN_PLACE_OF_IDENTIFIER = 1 << 16,
    ALLOW_ANONYMOUS_IDENTIFIER = 1 << 17,
    ALLOW_EMPTY_UNION_OR_INTERSECTION = 1 << 18,
    ALLOW_EMPTY_TUPLE = 1 << 19,
    ALLOW_UNIQUE_ES_SYMBOL_TYPE = 1 << 20,
    ALLOW_EMPTY_INDEX_INFO_TYPE = 1 << 21,
    ALLOW_NODE_MODULES_RELATIVE_PATHS = 1 << 26,
    IGNORE_ERRORS = (1 << 15) | (1 << 16) | (1 << 17) | (1 << 18) | (1 << 19) | (1 << 21) | (1 << 26),
    IN_OBJECT_TYPE_LITERAL = 1 << 22,
    IN_TYPE_ALIAS = 1 << 23,
    IN_INITIAL_ENTITY_NAME = 1 << 24,
});

define_flags!(InternalFlags: i32 {
    NONE = 0,
    WRITE_COMPUTED_PROPS = 1 << 0,
    NO_SYNTACTIC_PRINTER = 1 << 1,
    DO_NOT_INCLUDE_SYMBOL_CHAIN = 1 << 2,
    ALLOW_UNRESOLVED_NAMES = 1 << 3,
});
