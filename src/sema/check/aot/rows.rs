use crate::bind::SymFlags;
use crate::check::Checker;
use crate::hir::FileKind;
use crate::types::{Origin, TypeData, TypeId};
use std::sync::atomic::Ordering;

pub(super) const IS_READ: u64 = 1;
pub(super) const MAY_HOLD_OBJECTS: u64 = 1 << 1;
pub(super) const SAYS_PROPERTIES: u64 = 1 << 2;
pub(super) const IS_NAMESPACE_OBJECT: u64 = 1 << 3;
pub(super) const IS_ARRAY: u64 = 1 << 4;
pub(super) const IS_TUPLE: u64 = 1 << 5;
pub(super) const IS_TYPE_OF_INSTANCES: u64 = 1 << 6;
pub(super) const IS_DECLARED_OUTSIDE: u64 = 1 << 7;
pub(super) const KNOWS_NESTING: u64 = 1 << 8;
pub(super) const IS_NESTED_TOO_DEEPLY: u64 = 1 << 9;
pub(super) const KNOWS_WHETHER_BEYOND_THE_LAYOUTS: u64 = 1 << 10;
pub(super) const IS_BEYOND_THE_LAYOUTS: u64 = 1 << 11;
pub(super) const KNOWS_WHETHER_IT_ACCEPTS_PRIMITIVES: u64 = 1 << 12;
pub(super) const ACCEPTS_PRIMITIVES: u64 = 1 << 13;
pub(super) const KNOWS_WHETHER_ARRAY_SUBTYPE: u64 = 1 << 14;
pub(super) const IS_ARRAY_SUBTYPE: u64 = 1 << 15;
pub(super) const KNOWS_WHETHER_REDEFINED: u64 = 1 << 16;
pub(super) const IS_REDEFINED_SOMEWHERE: u64 = 1 << 17;
pub(super) const KNOWS_PRIMITIVES: u64 = 1 << 18;
pub(super) const FIRST_PRIMITIVE: u32 = 19;

impl Checker<'_, '_> {
    #[inline]
    pub(super) fn row(&self, ty: TypeId) -> u64 {
        let row = self.types().row(ty).load(Ordering::Relaxed);
        if row & IS_READ != 0 { row } else { self.read_row(ty) }
    }

    #[inline(never)]
    fn read_row(&self, ty: TypeId) -> u64 {
        let if_holding = |holds: bool| if holds { MAY_HOLD_OBJECTS } else { 0 };
        let read = match *self.data(ty) {
            TypeData::Union(ref parts) => if_holding(!self.has_primitive_flag(ty) && parts.iter().any(|&part| self.row(part) & MAY_HOLD_OBJECTS != 0)),
            TypeData::Intersection(ref parts) => SAYS_PROPERTIES | if_holding(parts.iter().all(|&part| self.row(part) & MAY_HOLD_OBJECTS != 0)),
            TypeData::Ref { target, .. } => {
                let is_array = self.is_array(ty);
                let is_of_instances = self.files().flags(target).contains(SymFlags::CLASS);
                let is_declared_outside = !is_array && self.files().decls_of(target).iter().all(|&(declared_in, _)| self.hir(declared_in).kind == FileKind::Declaration);
                MAY_HOLD_OBJECTS
                    | if is_array { IS_ARRAY } else { SAYS_PROPERTIES }
                    | if is_of_instances { IS_TYPE_OF_INSTANCES } else { 0 }
                    | if is_declared_outside { IS_DECLARED_OUTSIDE } else { 0 }
            }
            TypeData::Tuple { .. } => MAY_HOLD_OBJECTS | IS_TUPLE,
            TypeData::Anon { origin: Origin::Module(_), .. } => MAY_HOLD_OBJECTS | IS_NAMESPACE_OBJECT,
            TypeData::Anon { origin: Origin::TypeLiteral(..) | Origin::Mapped(..) | Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. } => MAY_HOLD_OBJECTS | SAYS_PROPERTIES,
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } => MAY_HOLD_OBJECTS | SAYS_PROPERTIES,
            TypeData::Anon { .. } | TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::IndexedAccess { .. } | TypeData::Cond { .. } | TypeData::Substitution { .. } => MAY_HOLD_OBJECTS,
            _ => 0,
        };
        self.types().row(ty).fetch_or(IS_READ | read, Ordering::Relaxed) | IS_READ | read
    }

    #[inline]
    pub(super) fn known_from_row(&self, ty: TypeId, knows: u64, holds: u64) -> Option<bool> {
        let row = self.types().row(ty).load(Ordering::Relaxed);
        (row & knows != 0).then_some(row & holds != 0)
    }

    pub(super) fn keep_in_row(&self, ty: TypeId, knows: u64, holds: u64, found: bool) -> bool {
        self.types().row(ty).fetch_or(if found { knows | holds } else { knows }, Ordering::Relaxed);
        found
    }

    #[inline]
    pub(super) fn shares_rows(&self) -> bool {
        self.p.aot.storage.given.is_made_for_good() && !self.is_warming_up()
    }

    #[inline]
    pub(super) fn shared_row(&self, ty: TypeId) -> u64 {
        if self.shares_rows() { self.types().row(ty).load(Ordering::Relaxed) } else { 0 }
    }

    #[inline]
    pub(super) fn shared_answer(&self, ty: TypeId, knows: u64, holds: u64) -> Option<bool> {
        let row = self.shared_row(ty);
        (row & knows != 0).then_some(row & holds != 0)
    }

    pub(super) fn share_bits(&self, ty: TypeId, bits: u64) -> bool {
        let is_shared = self.shares_rows() && !self.has_answers_that_depend_on_order();
        if is_shared {
            self.types().row(ty).fetch_or(bits, Ordering::Relaxed);
        }
        is_shared
    }

    pub(super) fn share_answer(&self, ty: TypeId, knows: u64, holds: u64, found: bool) -> bool {
        self.share_bits(ty, if found { knows | holds } else { knows })
    }
}
