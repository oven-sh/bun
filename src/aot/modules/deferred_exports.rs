use crate::builtins::id::BuiltinId;
use crate::builtins::{ResolvedBuiltins, RuntimeModule};
use crate::load::Sources;
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, BindingInitializer, Bound, SymbolId};
use bun_sema::hir::{self, ExprId, ExprKind, PropId, PropKey, PropKind, Span, StmtKind};
use bun_sema::program::Files;
use bun_sema::util::SharedSort;

/// A getter of the object that one of Bun's own modules exports: `get WriteStream() { .. }` in the literal, or `Object.defineProperty(assert, "AssertionError", { get() { .. } })`.
#[derive(Default)]
pub struct DeferredExports {
    /// In the order of the registry, and of the bytes.
    names: Vec<(u32, Box<[u8]>)>,
}

/// The native modules that mirror an object of the host, which makes most of its members at their first read: `process.stdout` loads `node:stream`.
const MODULES_THAT_MIRROR_AN_OBJECT: [RuntimeModule; 3] = [
    RuntimeModule::NodeModule,
    RuntimeModule::NodeProcess,
    RuntimeModule::Bun,
];

struct LibraryModule<'a, 's> {
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    atoms: &'a Interner<'s>,
    builtins: Option<&'a ResolvedBuiltins>,
}

impl DeferredExports {
    pub fn collect(runtime_files: &Files<'_>, runtime_sources: &Sources) -> DeferredExports {
        let mut names = Vec::new();
        for &(module, file) in runtime_sources.runtime_module_files() {
            let library_module = LibraryModule {
                hir: runtime_files.hir(file),
                bound: runtime_files.bound(file),
                atoms: &runtime_files.atoms,
                builtins: parsed_source(runtime_files, file).map(|source| &source.builtins),
            };
            for name in library_module.find_getters() {
                names.push((module.registry_id(), runtime_files.atoms.bytes(name).into()));
            }
        }
        names.shared_sort_unstable();
        names.dedup();
        DeferredExports { names }
    }

    pub fn contains(&self, module: RuntimeModule, name: &[u8]) -> bool {
        if MODULES_THAT_MIRROR_AN_OBJECT.contains(&module) {
            return true;
        }
        let key = (module.registry_id(), name);
        self.names
            .binary_search_by(|(module, name)| (*module, &**name).cmp(&key))
            .is_ok()
    }
}

impl LibraryModule<'_, '_> {
    fn find_getters(&self) -> Vec<Atom> {
        let hir = self.hir;
        let mut statements = hir.ids(hir.body);
        let exported = statements.find_map(|statement| match hir[statement].kind {
            StmtKind::ExportDefault(value) => Some(hir.skip_type_assertions(value)),
            _ => None,
        });
        let Some(exported) = exported else {
            return Vec::new();
        };
        // `export default { .. }`
        let ExprKind::Ident(_) = hir[exported].kind else {
            return self.find_getters_of_literal(self.as_literal(exported));
        };
        // `export default a`
        let Binding::Symbol(symbol) = self.bound.binding(exported) else {
            return Vec::new();
        };
        if !self.bound.is_stable_binding(symbol) {
            return Vec::new();
        }
        let literal = match self.bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(value) => self.as_literal(value),
            _ => None,
        };
        let mut getters = self.find_getters_of_literal(literal);
        getters.extend(
            hir.ids(hir.body)
                .filter_map(|statement| match hir[statement].kind {
                    StmtKind::Expr(expression) => self.find_defined_getter(symbol, expression),
                    _ => None,
                }),
        );
        getters
    }

    fn as_literal(&self, value: ExprId) -> Option<Span<PropId>> {
        match self.hir[self.hir.skip_type_assertions(value)].kind {
            ExprKind::Object(properties) => Some(properties),
            _ => None,
        }
    }

    fn find_getters_of_literal(&self, literal: Option<Span<PropId>>) -> Vec<Atom> {
        let properties = literal.into_iter().flat_map(|properties| properties.iter());
        properties
            .filter_map(|id| match (self.hir[id].kind, self.hir[id].key) {
                (PropKind::Getter, PropKey::Name(name)) => Some(name),
                _ => None,
            })
            .collect()
    }

    // `Object.defineProperty(a, "name", { get() { .. }, .. })` as a statement of the module.
    fn find_defined_getter(&self, exported: SymbolId, statement: ExprId) -> Option<Atom> {
        let hir = self.hir;
        let ExprKind::Call(call) = hir[hir.skip_type_assertions(statement)].kind else {
            return None;
        };
        let call = hir[call];
        let callee = hir.skip_type_assertions(call.callee);
        let callee = self.builtins?.builtin_of_expression(callee);
        if callee != Some(BuiltinId::ObjectDefineProperty) || call.args.len() != 3 {
            return None;
        }
        let argument =
            |index: usize| hir.skip_type_assertions(hir.id_at::<ExprId>(call.args, index));
        let object = argument(0);
        let is_exported = matches!(hir[object].kind, ExprKind::Ident(_))
            && matches!(self.bound.binding(object), Binding::Symbol(symbol) if symbol == exported);
        let ExprKind::String(name) = hir[argument(1)].kind else {
            return None;
        };
        let has_getter = self.as_literal(argument(2))?.iter().any(|id| {
            let property = hir[id];
            matches!(property.kind, PropKind::Init | PropKind::Method)
                && matches!(property.key, PropKey::Name(key) if self.atoms.bytes(key) == b"get")
        });
        (is_exported && has_getter).then_some(name)
    }
}
