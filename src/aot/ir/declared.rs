pub use super::generated::{DeclaredType, PositionFlags};
use super::ids::{TypeId, TypeSiteId};
use super::types::TypeTable;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Mapped {
    pub ty: TypeId,
    pub is_checked: bool,
}

impl Mapped {
    pub const UNKNOWN: Mapped = Mapped {
        ty: TypeTable::ANYTHING,
        is_checked: true,
    };

    pub fn checked(ty: TypeId) -> Mapped {
        Mapped {
            ty,
            is_checked: true,
        }
    }

    // A type that says nothing has nothing to check.
    pub fn expected(ty: TypeId) -> Mapped {
        Mapped {
            ty,
            is_checked: ty == TypeTable::ANYTHING,
        }
    }
}

impl DeclaredType {
    pub fn new(mapped: Mapped, site: Option<TypeSiteId>, flags: PositionFlags) -> DeclaredType {
        let says_something = mapped.ty != TypeTable::ANYTHING;
        let is_expected = says_something && !mapped.is_checked;
        debug_assert!(
            !is_expected || !flags.contains(PositionFlags::IS_INT32_PROMISE),
            "only a checked position promises an int32"
        );
        DeclaredType {
            ty: mapped.ty,
            site: site.filter(|_| says_something),
            flags: match is_expected {
                true => flags | PositionFlags::IS_EXPECTED,
                false => flags,
            },
        }
    }

    pub fn untyped() -> DeclaredType {
        DeclaredType::new(Mapped::UNKNOWN, None, PositionFlags::default())
    }

    /// In a definition of a plain layout that says which names a type has and not what they hold.
    pub fn unsaid() -> DeclaredType {
        DeclaredType {
            ty: TypeTable::NEVER,
            site: None,
            flags: PositionFlags::default(),
        }
    }

    pub fn is_said(self) -> bool {
        self.ty != TypeTable::NEVER
    }

    pub fn from_compiler(ty: TypeId) -> DeclaredType {
        DeclaredType::new(Mapped::checked(ty), None, PositionFlags::IS_FROM_COMPILER)
    }

    pub fn is_expected(self) -> bool {
        self.flags.contains(PositionFlags::IS_EXPECTED)
    }
}

#[cfg(test)]
mod tests {
    use super::super::ids::Id;
    use super::*;

    const SITE: TypeSiteId = TypeSiteId::from_word(4);

    #[test]
    fn unknown_type_is_untyped() {
        let declared = DeclaredType::untyped();
        assert_eq!(declared.ty, TypeTable::ANYTHING);
        assert_eq!(declared.site, None);
        assert_eq!(declared.flags, PositionFlags::default());
    }

    #[test]
    fn checked_type_keeps_site_and_flags() {
        let mapped = Mapped::checked(TypeId::new(40));
        let declared = DeclaredType::new(mapped, Some(SITE), PositionFlags::IS_INT32_PROMISE);
        assert_eq!(declared.ty, TypeId::new(40));
        assert_eq!(declared.site, Some(SITE));
        assert_eq!(declared.flags, PositionFlags::IS_INT32_PROMISE);
        assert!(!declared.is_expected());
    }

    #[test]
    fn expected_type_sets_flag() {
        let mapped = Mapped::expected(TypeTable::STRING);
        let declared = DeclaredType::new(mapped, None, PositionFlags::default());
        assert_eq!(declared.ty, TypeTable::STRING);
        assert_eq!(declared.flags, PositionFlags::IS_EXPECTED);
        assert!(declared.is_expected());
    }

    #[test]
    fn expected_flag_is_added_to_other_flags() {
        let mapped = Mapped::expected(TypeTable::OBJECT);
        let declared = DeclaredType::new(mapped, None, PositionFlags::IS_FROM_COMPILER);
        let flags = PositionFlags::IS_FROM_COMPILER | PositionFlags::IS_EXPECTED;
        assert_eq!(declared.flags, flags);
    }

    #[test]
    fn expecting_anything_says_nothing() {
        assert_eq!(Mapped::expected(TypeTable::ANYTHING), Mapped::UNKNOWN);
        let unchecked = Mapped {
            ty: TypeTable::ANYTHING,
            is_checked: false,
        };
        let declared = DeclaredType::new(unchecked, Some(SITE), PositionFlags::default());
        assert_eq!(declared, DeclaredType::untyped());
    }

    #[test]
    fn compiler_position_has_no_site() {
        let declared = DeclaredType::from_compiler(TypeTable::FUNCTION);
        assert_eq!(declared.ty, TypeTable::FUNCTION);
        assert_eq!(declared.site, None);
        assert_eq!(declared.flags, PositionFlags::IS_FROM_COMPILER);
    }

    #[test]
    fn written_position_is_not_from_compiler() {
        let mapped = Mapped::checked(TypeTable::FUNCTION);
        let declared = DeclaredType::new(mapped, Some(SITE), PositionFlags::default());
        assert_eq!(declared.ty, TypeTable::FUNCTION);
        assert_eq!(declared.flags, PositionFlags::default());
    }
}
