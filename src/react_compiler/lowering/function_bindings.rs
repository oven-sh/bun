//! Upstream's `is_scope_within_compiled_function`, answered from the function alone: see "Locals" in `../DESIGN.md`.

use bun_ast::Ref;

#[allow(
    clippy::disallowed_types,
    reason = "vendored react_compiler_hir HashMap<BindingId, _> contract"
)]
pub(super) type RefMap<V> = crate::collections::FxHashMap<Ref, V>;

/// A `Ref` that the function being compiled declares. Only [`FunctionBindings::local`] makes one.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct LocalRef(Ref);

impl LocalRef {
    pub(crate) fn get(self) -> Ref {
        self.0
    }
}

pub(crate) struct FunctionBindings {
    /// For each declared `Ref`, how many functions deep its declaration is.
    declared: RefMap<u32>,
}

impl FunctionBindings {
    pub(super) fn new(declared: RefMap<u32>) -> Self {
        FunctionBindings { declared }
    }

    /// `None`: `ref_` is bound outside the function, or not bound at all.
    pub(crate) fn local(&self, ref_: Ref) -> Option<LocalRef> {
        self.declared.contains_key(&ref_).then_some(LocalRef(ref_))
    }
}
