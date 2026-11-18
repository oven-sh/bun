//! Properties whose values native code provides.

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_text::PropertyName;
use bun_engine_vm::ic::{AccessCase, AccessKind, PrototypeLookup};
use bun_engine_vm::{Gc, GlobalObject, Shape};

use crate::builder::Builder;
use crate::graph::Kind;

#[derive(Clone, Copy, PartialEq)]
pub(in crate::builder) struct Custom {
    function: usize,
    realm: Gc<GlobalObject>,
    /// If it is inherited.
    lookup: Option<Gc<PrototypeLookup>>,
    gets_holder: bool,
}

impl Builder<'_> {
    pub(super) fn custom_for(&self, shape: &Shape, case: &AccessCase) -> Option<Custom> {
        let lookup = case.lookup();
        let realm = match lookup {
            Some(lookup) => lookup.holder()?.realm(),
            None => shape.global(),
        };
        Some(Custom {
            function: case.pointer(),
            realm: realm.unwrap_or_else(|| self.global()),
            lookup,
            gets_holder: matches!(
                case.kind(),
                AccessKind::CallCustomValueGetter | AccessKind::CallCustomValueSetter
            ),
        })
    }

    /// The function, the realm and `this`.
    fn custom_call(&mut self, custom: Custom, object: Ssa) -> [Ssa; 3] {
        custom.lookup.inspect(|&lookup| self.rely_on(lookup));
        let holder = (custom.lookup.filter(|_| custom.gets_holder)).and_then(|it| it.holder());
        [
            self.word(custom.function),
            self.cell(custom.realm.cell()),
            match holder {
                Some(holder) => self.cell(holder.cell()),
                None => self.graph.root(object),
            },
        ]
    }

    pub(super) fn get_custom(
        &mut self,
        custom: Custom,
        object: Ssa,
        name: PropertyName<'_>,
        metadata: u32,
    ) -> Option<Ssa> {
        let prediction = self.prediction_or_exit(metadata)?;
        let [function, realm, this] = self.custom_call(custom, object);
        let operands = [function, realm, this, self.name(name)];
        let value = self.profiled_node(Kind::CallCustomGetter, &operands, 0, prediction);
        self.note_profile(value, metadata);
        Some(value)
    }

    pub(super) fn set_custom(
        &mut self,
        custom: Custom,
        [object, value]: [Ssa; 2],
        name: PropertyName<'_>,
    ) {
        let [function, realm, this] = self.custom_call(custom, object);
        let (value, name) = (self.graph.root(value), self.name(name));
        let operands = [function, realm, this, value, name];
        self.node(Kind::CallCustomSetter, &operands, 0);
    }
}
