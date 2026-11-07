use rustc_hash::FxHashSet;

use crate::ir::generated::LimitId;
use crate::ir::{LayoutId, Reference, TypeId};
use crate::lower::FileLowering;

enum Pending {
    Type(TypeId),
    Layout(LayoutId),
}

impl FileLowering<'_, '_, '_, '_> {
    /// `None`: more than `limit` layouts.
    pub(crate) fn collect_reached_layouts(
        &mut self,
        ty: TypeId,
        limit: LimitId,
    ) -> Option<Vec<LayoutId>> {
        let limit = self.inputs.limits.get(limit);
        let mut pending = vec![Pending::Type(ty)];
        let mut types: FxHashSet<TypeId> = FxHashSet::from_iter([ty]);
        let mut layouts: FxHashSet<LayoutId> = FxHashSet::default();
        while let Some(next) = pending.pop() {
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
                Pending::Layout(layout) => {
                    let fields = super::own_fields(self, layout);
                    for field in fields.as_slice() {
                        field.declared.for_each_reference(&mut add);
                    }
                }
            }
        }
        let mut layouts: Vec<LayoutId> = layouts.into_iter().collect();
        layouts.sort_unstable();
        Some(layouts)
    }
}
