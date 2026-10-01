// core.Filter, core.Some, core.Same and checker.go:25684-25722, 26681-26712, 14075-14084.
use crate::checker::Checker;
use crate::flags::TypeFlags;
use crate::golang::{List, SliceBuf};
use crate::ids::*;

// core.Some: a helper that does not know the checker. Its callback captures what it needs.
pub fn some<T: Copy + Default>(slice: List<'_, T>, mut f: impl FnMut(T) -> bool) -> bool {
    for value in slice.iter() {
        if f(value) {
            return true;
        }
    }
    false
}

impl<'a> Checker<'a> {
    // core.Filter: returns the argument itself when nothing is removed.
    pub fn filter<T: Copy + Default>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> List<'a, T> {
        for (i, value) in slice.iter().enumerate() {
            if !f(self, value) {
                let mut result = SliceBuf::make(0, slice.len());
                result.extend(slice.sub(0usize, i));
                for j in i + 1..slice.len() as usize {
                    let value = slice.at(j);
                    if f(self, value) {
                        result.push(value);
                    }
                }
                return self.list(&result);
            }
        }
        slice
    }

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
        if self.types[t].flags.intersects(TypeFlags::NEVER) {
            return t;
        }
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            return f(self, t);
        }
        let u = t;
        let mut types = self.as_union_type(u).base.types;
        let origin = self.as_union_type(u).origin;
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
            return self.get_union_type_ex(
                self.list(&mapped_types),
                if no_reductions { 0 } else { 1 },
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        t
    }

    pub fn filter_type(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
    ) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(t);
            let filtered = self.filter(types, &mut *f);
            if types.same(filtered) {
                return t;
            }
            let origin = self.as_union_type(t).origin;
            let mut new_origin = TypeId::NIL;
            if !origin.is_nil() && self.types[origin].flags.intersects(TypeFlags::UNION) {
                let origin_types = self.type_types(origin);
                let origin_filtered = self.filter(origin_types, |c, u| {
                    c.types[u].flags.intersects(TypeFlags::UNION) || f(c, u)
                });
                if origin_types.len() - origin_filtered.len() == types.len() - filtered.len() {
                    if origin_filtered.len() == 1 {
                        return origin_filtered.at(0);
                    }
                    new_origin = self.new_union_type(origin_filtered);
                }
            }
            return self.get_union_type_from_sorted_list(filtered, new_origin);
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) || f(self, t) {
            return t;
        }
        self.never_type
    }

    // A call site: the callback is a closure over locals, the checker comes in as the parameter.
    pub fn remove_type(&mut self, t: TypeId, target_type: TypeId) -> TypeId {
        self.filter_type(t, &mut |_, u| u != target_type)
    }

    // A call site: the callback is a method value.
    pub fn map_to_widened(&mut self, t: TypeId) -> TypeId {
        self.map_type(t, &mut Checker::get_widened_type)
    }

    pub fn get_widened_type(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("getWidenedType")
    }

    pub fn get_union_type_ex(
        &mut self,
        types: List<'a, TypeId>,
        union_reduction: i32,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        let _ = (types, union_reduction, alias, origin);
        self.stand_in("getUnionTypeEx")
    }

    pub fn new_union_type(&mut self, types: List<'a, TypeId>) -> TypeId {
        let _ = types;
        self.stand_in("newUnionType")
    }

    pub fn get_union_type_from_sorted_list(
        &mut self,
        types: List<'a, TypeId>,
        origin: TypeId,
    ) -> TypeId {
        let _ = (types, origin);
        self.stand_in("getUnionTypeFromSortedList")
    }

    pub fn add_deferred_diagnostic(&mut self, callback: Box<dyn FnOnce(&mut Checker<'a>) + 'a>) {
        self.deferred_diagnostic_callbacks.push(callback);
    }

    pub fn produce_deferred_diagnostics(&mut self) {
        // `range` reads the slice once: a callback added by a callback is not run, and the assignment drops it.
        let callbacks = core::mem::take(&mut self.deferred_diagnostic_callbacks);
        for cb in callbacks {
            cb(self);
        }
        self.deferred_diagnostic_callbacks = Vec::new();
    }

    // A call site that defers a closure over locals.
    pub fn defer_unused_check(&mut self, node: NodeId, t: TypeId) {
        self.add_deferred_diagnostic(Box::new(move |c| {
            if c.types[t].flags.intersects(TypeFlags::NEVER) {
                c.error(node, MessageId(6133));
            }
        }));
    }

    // Sorting a list of types with the checker as comparator context.
    pub fn sort_types(&mut self, types: &mut [TypeId]) {
        crate::slices::sort_stable_func(types, |a, b| self.compare_types(a, b));
    }

    pub fn contains_type(&mut self, types: List<'a, TypeId>, t: TypeId) -> bool {
        let (_, ok) =
            crate::slices::binary_search_func(types.as_slice(), t, |a, b| self.compare_types(a, b));
        ok
    }
}
