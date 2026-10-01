// checker.go 26681-26726 (c43_unions_intersections): filterType and removeType, where a filter that keeps everything returns its argument.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{ObjectFlags, TypeFlags};
use crate::checker::types::{TypeData, UnionOrIntersectionType, UnionType};
use crate::tscore::golang::List;
use crate::tscore::ids::TypeId;

impl<'a> Checker<'a> {
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
                // The origin keeps its non-union constituents when the same number of types goes away: see checker.go 26690.
                let origin_types = self.type_types(origin);
                let origin_filtered = self.filter(origin_types, |c, u| {
                    c.types[u].flags.intersects(TypeFlags::UNION) || f(c, u)
                });
                if origin_types.len() - origin_filtered.len() == types.len() - filtered.len() {
                    if origin_filtered.len() == 1 {
                        return origin_filtered.at(0usize);
                    }
                    new_origin = self.new_union_type(origin_filtered);
                }
            }
            // filtering could remove intersections so `ContainsIntersections` might be forwarded "incorrectly"
            let object_flags = self.types[t].object_flags
                & (ObjectFlags::PRIMITIVE_UNION | ObjectFlags::CONTAINS_INTERSECTIONS);
            return self.get_union_type_from_sorted_list(filtered, object_flags, new_origin);
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) || f(self, t) {
            return t;
        }
        self.never_type
    }

    // A call site whose callback is a closure over a local.
    pub fn remove_type(&mut self, t: TypeId, target_type: TypeId) -> TypeId {
        self.filter_type(t, &mut |_, u| u != target_type)
    }

    // checker.go 25357: newUnionType, with the object flags left out.
    pub fn new_union_type(&mut self, types: List<'a, TypeId>) -> TypeId {
        let data = UnionType {
            base: UnionOrIntersectionType {
                types,
                ..Default::default()
            },
            ..Default::default()
        };
        self.new_type(
            TypeFlags::UNION,
            ObjectFlags::NONE,
            TypeData::Union(Box::new(data)),
        )
    }

    pub fn get_union_type_from_sorted_list(
        &mut self,
        types: List<'a, TypeId>,
        object_flags: ObjectFlags,
        origin: TypeId,
    ) -> TypeId {
        let _ = object_flags;
        self.stand_ins.record("getUnionTypeFromSortedList");
        if types.len() == 0 {
            return self.never_type;
        }
        let t = self.new_union_type(types);
        if let TypeData::Union(union) = &mut self.types[t].data {
            union.origin = origin;
        }
        t
    }
}
