use crate::bind::SymFlags;
use crate::check::Checker;
use crate::hir::FileKind;
use crate::types::{Origin, TypeData, TypeId};
use std::sync::atomic::Ordering;

pub(super) const IS_READ: u64 = 1;
pub(super) const MAY_HOLD_OBJECTS: u64 = 1 << 1;
pub(super) const DECLARES_PROPERTIES: u64 = 1 << 2;
pub(super) const IS_NAMESPACE_OBJECT: u64 = 1 << 3;
pub(super) const IS_ARRAY: u64 = 1 << 4;
pub(super) const IS_TUPLE: u64 = 1 << 5;
pub(super) const IS_INSTANCE_TYPE: u64 = 1 << 6;
pub(super) const IS_DECLARED_EXTERNALLY: u64 = 1 << 7;
pub(super) const NESTING_KNOWN: u64 = 1 << 8;
pub(super) const IS_NESTED_TOO_DEEPLY: u64 = 1 << 9;
pub(super) const BEYOND_LAYOUTS_KNOWN: u64 = 1 << 10;
pub(super) const IS_BEYOND_LAYOUTS: u64 = 1 << 11;
pub(super) const ACCEPTS_PRIMITIVES_KNOWN: u64 = 1 << 12;
pub(super) const ACCEPTS_PRIMITIVES: u64 = 1 << 13;
pub(super) const ARRAY_SUBTYPE_KNOWN: u64 = 1 << 14;
pub(super) const IS_ARRAY_SUBTYPE: u64 = 1 << 15;
pub(super) const REDEFINED_KNOWN: u64 = 1 << 16;
pub(super) const IS_REDEFINED: u64 = 1 << 17;
pub(super) const ASSIGNABLE_PRIMITIVES_KNOWN: u64 = 1 << 18;
pub(super) const GENERIC_CALLBACK_KNOWN: u64 = 1 << 29;
pub(super) const IS_GENERIC_CALLBACK: u64 = 1 << 30;
pub(super) const IS_OWN_LAYOUT_TYPE: u64 = 1 << 31;
pub(super) const ASSIGNABLE_PRIMITIVES_SHIFT: u32 = 19;
const NESTING_BOUND_KNOWN: u64 = 1 << 32;
pub(super) const TAINT_KNOWN: u64 = 1 << 38;
pub(super) const IS_TAINTED: u64 = 1 << 39;
pub(super) const NAMESPACE_TEST_KNOWN: u64 = 1 << 40;
pub(super) const MAY_BE_NAMESPACE: u64 = 1 << 41;
pub(super) const HAS_NO_TYPE_PREDICATE: u64 = 1 << 44;
pub(super) const UNTYPED_FOR_OBJECTS_KNOWN: u64 = 1 << 45;
pub(super) const IS_UNTYPED_FOR_OBJECTS: u64 = 1 << 46;
pub(super) const OBJECT_TYPES_KNOWN: u64 = 1 << 47;
pub(super) const HAS_OBJECT_TYPES: u64 = 1 << 48;
pub(super) const HAS_OBJECT_TYPE_PARAMETERS: u64 = 1 << 49;
pub(super) const HAS_UNTYPED_OBJECT_PART: u64 = 1 << 50;
const NESTING_BOUND_SHIFT: u32 = 33;
const MAX_NESTING_BOUND: u32 = 31;
const DESCRIPTION_KIND_SHIFT: u32 = 24;
const DESCRIPTION_BITS_SHIFT: u32 = 52;
pub(super) const HAS_NO_MUTATING_BUILTIN_SIGNATURE: u64 = 1 << 63;

impl Checker<'_, '_> {
    #[inline]
    pub(super) fn row(&self, ty: TypeId) -> u64 {
        let row = self.types().row(ty).load(Ordering::Relaxed);
        if row & IS_READ != 0 {
            row
        } else {
            self.read_type_flags(ty)
        }
    }

    #[inline(never)]
    fn read_type_flags(&self, ty: TypeId) -> u64 {
        let if_holding = |holds: bool| if holds { MAY_HOLD_OBJECTS } else { 0 };
        let read = match *self.data(ty) {
            TypeData::Union(ref parts) => if_holding(
                !self.has_primitive_flag(ty)
                    && parts
                        .iter()
                        .any(|&part| self.row(part) & MAY_HOLD_OBJECTS != 0),
            ),
            TypeData::Intersection(ref parts) => {
                DECLARES_PROPERTIES
                    | if_holding(
                        parts
                            .iter()
                            .all(|&part| self.row(part) & MAY_HOLD_OBJECTS != 0),
                    )
            }
            TypeData::Ref { target, .. } => {
                let is_array = self.is_array(ty);
                let is_instance_type = self.files().flags(target).contains(SymFlags::CLASS);
                let is_declared_externally = !is_array
                    && self
                        .files()
                        .decls_of(target)
                        .iter()
                        .all(|&(declared_in, _)| {
                            self.hir(declared_in).kind == FileKind::Declaration
                        });
                MAY_HOLD_OBJECTS
                    | if is_array {
                        IS_ARRAY
                    } else {
                        DECLARES_PROPERTIES
                    }
                    | if is_instance_type {
                        IS_INSTANCE_TYPE
                    } else {
                        0
                    }
                    | if is_declared_externally {
                        IS_DECLARED_EXTERNALLY
                    } else {
                        0
                    }
            }
            TypeData::Tuple { .. } => MAY_HOLD_OBJECTS | IS_TUPLE,
            TypeData::Anon {
                origin: Origin::Module(_),
                ..
            } => MAY_HOLD_OBJECTS | IS_NAMESPACE_OBJECT,
            TypeData::Anon {
                origin:
                    Origin::TypeLiteral(..)
                    | Origin::Mapped(..)
                    | Origin::ObjectLiteral(..)
                    | Origin::WidenedLiteral(..),
                ..
            } => MAY_HOLD_OBJECTS | DECLARES_PROPERTIES,
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } => {
                MAY_HOLD_OBJECTS | DECLARES_PROPERTIES
            }
            TypeData::Anon { .. }
            | TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::Substitution { .. } => MAY_HOLD_OBJECTS,
            _ => 0,
        };
        self.types()
            .row(ty)
            .fetch_or(IS_READ | read, Ordering::Relaxed)
            | IS_READ
            | read
    }

    #[inline]
    pub(super) fn cached_nesting_bound(&self, ty: TypeId) -> Option<u32> {
        let row = self.types().row(ty).load(Ordering::Relaxed);
        (row & NESTING_BOUND_KNOWN != 0)
            .then_some((row >> NESTING_BOUND_SHIFT) as u32 & MAX_NESTING_BOUND)
    }

    pub(super) fn cache_nesting_bound(&self, ty: TypeId, bound: u32) {
        self.types().row(ty).fetch_or(
            NESTING_BOUND_KNOWN | u64::from(bound.min(MAX_NESTING_BOUND)) << NESTING_BOUND_SHIFT,
            Ordering::Relaxed,
        );
    }

    #[inline]
    pub(super) fn cached_type_flag(&self, ty: TypeId, knows: u64, holds: u64) -> Option<bool> {
        let row = self.types().row(ty).load(Ordering::Relaxed);
        (row & knows != 0).then_some(row & holds != 0)
    }

    pub(super) fn cache_type_flag(&self, ty: TypeId, knows: u64, holds: u64, found: bool) -> bool {
        self.types()
            .row(ty)
            .fetch_or(if found { knows | holds } else { knows }, Ordering::Relaxed);
        found
    }

    #[inline]
    pub(super) fn translation_type_flags(&self, ty: TypeId, knows: u64) -> Option<u64> {
        let row = self.types().row(ty).load(Ordering::Relaxed);
        (row & knows != 0 && self.type_caches().is_some()).then_some(row)
    }

    #[inline]
    pub(super) fn can_share_type_flags(&self) -> bool {
        self.p.aot.storage.external_types.is_finalized() && !self.is_warming_up()
    }

    #[inline]
    pub(super) fn shared_type_flags(&self, ty: TypeId) -> u64 {
        if self.can_share_type_flags() {
            self.types().row(ty).load(Ordering::Relaxed)
        } else {
            0
        }
    }

    #[inline]
    pub(super) fn shared_type_flag(&self, ty: TypeId, knows: u64, holds: u64) -> Option<bool> {
        let row = self.shared_type_flags(ty);
        (row & knows != 0).then_some(row & holds != 0)
    }

    pub(super) fn publish_type_flags(&self, ty: TypeId, bits: u64) -> bool {
        let is_shared = self.can_share_type_flags() && !self.has_order_dependent_results();
        if is_shared {
            self.types().row(ty).fetch_or(bits, Ordering::Relaxed);
        }
        is_shared
    }

    #[inline]
    pub fn cached_description(&self, ty: TypeId) -> u16 {
        let row = self.shared_type_flags(ty);
        (row >> DESCRIPTION_KIND_SHIFT & 0x1F) as u16
            | ((row >> DESCRIPTION_BITS_SHIFT & 0x7FF) as u16) << 5
    }

    pub fn publish_description(&self, ty: TypeId, description: u16) {
        self.publish_type_flags(
            ty,
            u64::from(description & 0x1F) << DESCRIPTION_KIND_SHIFT
                | u64::from(description >> 5) << DESCRIPTION_BITS_SHIFT,
        );
    }

    pub(super) fn publish_type_flag(
        &self,
        ty: TypeId,
        knows: u64,
        holds: u64,
        found: bool,
    ) -> bool {
        self.publish_type_flags(ty, if found { knows | holds } else { knows })
    }
}
