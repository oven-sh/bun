use rustc_hash::FxHashSet;

use crate::ir::generated::LimitId;
use crate::ir::{LayoutId, Reference, TypeId};
use crate::lower::FileLowering;

enum Pending {
    Type(TypeId),
    Layout(LayoutId),
}

#[derive(Default)]
struct Reached {
    pending: Vec<Pending>,
    types: FxHashSet<TypeId>,
    layouts: FxHashSet<LayoutId>,
}

impl Reached {
    fn add(&mut self, reference: Reference) {
        match reference {
            Reference::Type(ty) => {
                if self.types.insert(ty) {
                    self.pending.push(Pending::Type(ty));
                }
            }
            Reference::Layout(layout) => {
                if self.layouts.insert(layout) {
                    self.pending.push(Pending::Layout(layout));
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
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    /// `None`: more than `limit` layouts.
    pub(crate) fn collect_reached_layouts(
        &mut self,
        ty: TypeId,
        limit: LimitId,
    ) -> Option<Vec<LayoutId>> {
        let limit = self.inputs.limits.get(limit);
        let mut reached = Reached::default();
        reached.add(Reference::Type(ty));
        while let Some(pending) = reached.pending.pop() {
            if reached.layouts.len() as u64 > limit {
                return None;
            }
            let mut add = |reference: Reference| reached.add(reference);
            match pending {
                Pending::Type(ty) => self.fragment.types.get(ty).for_each_reference(&mut add),
                Pending::Layout(layout) => {
                    let fields = super::own_fields(self, layout);
                    for field in fields.as_slice() {
                        field.declared.for_each_reference(&mut add);
                    }
                }
            }
        }
        let mut layouts: Vec<LayoutId> = reached.layouts.into_iter().collect();
        layouts.sort_unstable();
        Some(layouts)
    }
}
