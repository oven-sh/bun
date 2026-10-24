use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, FnOwner, Parent, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, FnBody, FnId, PatKind, PropKey, StmtId, StmtKind};
use smallvec::SmallVec;

use super::member::PropertyName;
use super::{FileLowering, FunctionLowering};
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, Edge, ValueId};
use crate::known_helpers::Shape;
use crate::statistics::StatisticId;

#[derive(Copy, Clone)]
struct Parameter {
    symbol: SymbolId,
    name: Atom,
}

#[derive(Copy, Clone)]
struct NamedBuiltin {
    path: ExprId,
    builtin: BuiltinId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn emit_fast_path(&mut self, source: FnId) {
        let helpers = self.file.inputs.known_helpers;
        let Some(known) = helpers.function(self.file.file, source) else {
            return;
        };
        self.file.count(StatisticId::KnownHelperFunctions, 1);
        match known.shape {
            Shape::CreateBindingReusesDescriptor => {
                if let [_, getter] = known.functions[..] {
                    self.emit_live_binding(source, getter);
                }
            }
            Shape::ExportStarBindsNamesTheTargetLacks => {
                self.emit_export_star_fast_path(source);
            }
            _ => {}
        }
    }

    // A fast path stands in for calls of built-ins, and the program may have put other functions in their places.
    fn require_unchanged_builtin(&mut self, named: NamedBuiltin, written_body: BlockId) {
        let value = self.lower_expression(named.path);
        let builtin = self.emit_locked_builtin(named.builtin);
        let is_unchanged = self.builder.strict_eq(value, builtin);
        require(self, is_unchanged, written_body);
    }

    fn emit_live_binding(&mut self, source: FnId, getter: FnId) {
        let [_, description, _, definition] = find_statements(self.file, source)[..] else {
            return;
        };
        let StmtKind::Expr(definition) = self.file.hir[definition].kind else {
            return;
        };
        let Some(description) = find_first_initializer(self.file, description) else {
            return;
        };
        let describe = find_callee(self.file, description);
        let define = find_callee(self.file, definition);
        let (Some(describe), Some(define)) = (describe, define) else {
            return;
        };
        let builtins = [
            NamedBuiltin {
                path: describe,
                builtin: BuiltinId::ObjectGetOwnPropertyDescriptor,
            },
            NamedBuiltin {
                path: define,
                builtin: BuiltinId::ObjectDefineProperty,
            },
        ];
        if !builtins
            .iter()
            .all(|&named| names_builtin(self.file, named))
        {
            return;
        }
        let Some(name) = self.file.find_property_name(getter) else {
            return;
        };
        let Some(parameters) = self.file.find_parameters(source) else {
            return;
        };
        let [target, module, source_key, target_key] = parameters[..] else {
            return;
        };

        let written_body = self.create_unlikely_block();
        for named in builtins {
            self.require_unchanged_builtin(named, written_body);
        }
        self.set_position(self.file.hir[definition].pos);
        let target = get_parameter(self, target);
        let module = get_parameter(self, module);
        let source_key = get_parameter(self, source_key);
        let target_key = get_parameter(self, target_key);
        let getter = self.lower_function_expression(getter, Some(name));
        let is_defined = self
            .builder
            .try_define_live_binding(target, module, source_key, target_key, getter);
        require(self, is_defined, written_body);
        self.emit_empty_return();
        self.continue_in(written_body);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_parameters(&self, source: FnId) -> Option<SmallVec<[Parameter; 4]>> {
        let (hir, bound) = (self.hir, self.bound);
        let mut parameters = SmallVec::new();
        for parameter in hir[source].params.iter() {
            let pattern = hir[parameter].pat;
            let PatKind::Ident(name) = hir[pattern].kind else {
                return None;
            };
            let symbol = bound.declared_symbol(Decl::Param(pattern)).some()?;
            parameters.push(Parameter { symbol, name });
        }
        Some(parameters)
    }

    fn find_property_name(&mut self, function: FnId) -> Option<PropertyName> {
        let FnOwner::Expr(expression) = self.bound.fns[function.idx()].owner else {
            return None;
        };
        let Parent::Prop(property) = self.bound.parent_of_expr(expression) else {
            return None;
        };
        let PropKey::Name(name) = self.hir.runtime_property_key(property) else {
            return None;
        };
        Some(PropertyName::Constant(self.name_key(name)))
    }
}

fn get_parameter(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: Parameter,
) -> ValueId {
    lowering.get_binding(Binding::Symbol(parameter.symbol), parameter.name)
}

fn find_statements(file: &FileLowering<'_, '_, '_, '_>, source: FnId) -> SmallVec<[StmtId; 8]> {
    match file.hir[source].body {
        FnBody::Block(statements) => file.hir.ids(statements).collect(),
        FnBody::Expr(_) | FnBody::None => SmallVec::new(),
    }
}

fn find_first_initializer(
    file: &FileLowering<'_, '_, '_, '_>,
    statement: StmtId,
) -> Option<ExprId> {
    let StmtKind::Var(declarations) = file.hir[statement].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    file.hir[declaration].init.some()
}

fn find_callee(file: &FileLowering<'_, '_, '_, '_>, call: ExprId) -> Option<ExprId> {
    let ExprKind::Call(site) = file.hir[file.skip_type_syntax(call)].kind else {
        return None;
    };
    Some(file.skip_type_syntax(file.hir[site].callee))
}

fn names_builtin(file: &FileLowering<'_, '_, '_, '_>, named: NamedBuiltin) -> bool {
    match file.builtins.of_expr(named.path) {
        Some(Resolved::Builtin(path)) => path.id == named.builtin,
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => false,
    }
}

fn require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    condition: ValueId,
    written_body: BlockId,
) {
    let passed = lowering.create_block();
    lowering
        .builder
        .branch(condition, Edge::to(passed), Edge::to(written_body));
    lowering.continue_in(passed);
}
