use rustc_hash::{FxHashMap, FxHashSet};

use crate::ir::generated::LimitId;
use crate::ir::{LayoutId, Reference, TypeId};
use crate::lower::FileLowering;

enum Pending {
    Type(TypeId),
    Layout(LayoutId),
}

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn collect_reached_layouts(
        &mut self,
        ty: TypeId,
        limit: LimitId,
    ) -> Option<Vec<LayoutId>> {
        let limit = self.inputs.limits.get(limit);
        let mut pending = vec![Pending::Type(ty)];
        let mut types: FxHashSet<TypeId> = FxHashSet::from_iter([ty]);
        let mut layouts: FxHashSet<LayoutId> = FxHashSet::default();
        let mut followed: FxHashMap<LayoutId, usize> = FxHashMap::default();
        loop {
            let Some(next) = pending.pop() else {
                let late = followed.iter().filter(|&(&layout, &number)| {
                    let listed = self.layouts.stored_listed_fields(layout);
                    listed.is_some_and(|listed| listed.count_types() > number)
                });
                pending.extend(late.map(|(&layout, _)| Pending::Layout(layout)));
                if pending.is_empty() {
                    break;
                }
                continue;
            };
            if layouts.len() as u64 > limit {
                return None;
            }
            let mut add = |reference: Reference| match reference {
                Reference::Type(ty) => {
                    if types.insert(ty) {
                        pending.push(Pending::Type(ty));
                    }
                }
                Reference::Layout(layout) => {
                    if layouts.insert(layout) {
                        pending.push(Pending::Layout(layout));
                    }
                }
                Reference::String(_)
                | Reference::PropertyKey(_)
                | Reference::TypeSite(_)
                | Reference::ExpectedResult(_)
                | Reference::Variable(_)
                | Reference::Module(..)
                | Reference::ModuleFailure(_)
                | Reference::EvalScope(_)
                | Reference::Function(..)
                | Reference::Data(_)
                | Reference::Builtin(_) => {}
            };
            match next {
                Pending::Type(ty) => self.fragment.types.get(ty).for_each_reference(&mut add),
                Pending::Layout(layout) => match self.list_fields_without_unions(layout) {
                    Some(_) if self.layouts.is_growing(layout) => {
                        followed.remove(&layout);
                    }
                    Some(listed) => {
                        let first = followed.insert(layout, listed.count_types()).unwrap_or(0);
                        listed.for_each_type_said(first, |ty| add(Reference::Type(ty)));
                    }
                    None => {
                        followed.remove(&layout);
                        let fields = super::own_fields(self, layout);
                        for field in fields.as_slice() {
                            add(Reference::Type(field.declared.ty));
                        }
                    }
                },
            }
        }
        let mut layouts: Vec<LayoutId> = layouts.into_iter().collect();
        layouts.sort_unstable();
        Some(layouts)
    }
}
