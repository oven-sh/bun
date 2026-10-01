// checker.go 25684-25723 (c42_literal_types): mapType, a callback that gets the checker back as its first parameter.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{TypeFlags, UnionReduction};
use crate::checker::ids::TypeAliasId;
use crate::tscore::golang::{List, SliceBuf};
use crate::tscore::ids::TypeId;

impl<'a> Checker<'a> {
    pub fn map_type(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
    ) -> TypeId {
        self.map_type_ex(t, f, false)
    }

    pub fn map_type_ex(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
        no_reductions: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) {
            return t;
        }
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            return f(self, t);
        }
        let mut types = self.as_union_type(t).base.types;
        let origin = self.as_union_type(t).origin;
        if !origin.is_nil() && self.types[origin].flags.intersects(TypeFlags::UNION) {
            types = self.type_types(origin);
        }
        let mut mapped_types = SliceBuf::make(0, 16);
        let mut changed = false;
        for s in types.iter() {
            let mapped = if self.types[s].flags.intersects(TypeFlags::UNION) {
                self.map_type_ex(s, f, no_reductions)
            } else {
                f(self, s)
            };
            if mapped != s {
                changed = true;
            }
            if !mapped.is_nil() {
                mapped_types.push(mapped);
            }
        }
        if changed {
            if mapped_types.len() == 0 {
                return TypeId::NIL;
            }
            let reduction = if no_reductions {
                UnionReduction::NONE
            } else {
                UnionReduction::LITERAL
            };
            let mapped_types = self.list(&mapped_types);
            return self.get_union_type_ex(mapped_types, reduction, TypeAliasId::NIL, TypeId::NIL);
        }
        t
    }

    // A call site whose callback is a method value.
    pub fn map_to_widened(&mut self, t: TypeId) -> TypeId {
        self.map_type(t, &mut Checker::get_widened_type)
    }

    pub fn get_widened_type(&mut self, t: TypeId) -> TypeId {
        self.stand_ins.record("getWidenedType");
        t
    }

    // The stand-in makes a union of its own, so that a test sees the list that was passed.
    pub fn get_union_type_ex(
        &mut self,
        types: List<'a, TypeId>,
        union_reduction: UnionReduction,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        let _ = (union_reduction, alias, origin);
        self.stand_ins.record("getUnionTypeEx");
        self.new_union_type(types)
    }
}
