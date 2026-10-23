use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable, Decl, SymbolId};
use bun_sema::hir::{self, ExprId, Flags, ImportEqualsId, ImportEqualsTarget, NameId};

use crate::ir::ValueId;
use crate::lower::commonjs::{self, BodyForm};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, expression, module, scope};

pub(super) fn lower_import_equals(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: ImportEqualsId,
) {
    let data = lowering.file.hir[declaration];
    if data.flags.contains(Flags::TYPE_ONLY) {
        return;
    }
    let symbol = lowering
        .file
        .bound
        .declared_symbol(Decl::ImportEquals(declaration));
    debug_assert!(
        symbol.is_some(),
        "an import alias with a value declares a symbol"
    );
    let value = match data.target {
        ImportEqualsTarget::Require(_) => {
            module::lower_import_equals_require(lowering, declaration)
        }
        ImportEqualsTarget::Entity(_) if is_unused_alias(lowering, symbol) => None,
        ImportEqualsTarget::Entity(names) => lower_entity_name(lowering, declaration, names),
    };
    let Some(value) = value else {
        return;
    };
    // A holder holds nothing of the type that the name has.
    match lowering
        .file
        .inputs
        .modules
        .holder(lowering.file.file, symbol)
    {
        Some(_) => scope::initialize_converted_symbol(lowering, symbol, data.name, value),
        None => scope::initialize_binding(lowering, Binding::Symbol(symbol), data.name, value),
    }
}

pub(super) fn lower_export_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    let position = lowering.position();
    if commonjs::body_form(lowering.file) == BodyForm::Plain {
        if commonjs::try_lower_export_assignment(lowering, expression) {
            return;
        }
        let value = expression::lower_expression(lowering, expression);
        lowering.set_position(position);
        commonjs::set_own_exports(lowering, value);
        return;
    }
    let module_object = commonjs::get_commonjs_variable(lowering, CommonJsVariable::Module);
    let value = expression::lower_expression(lowering, expression);
    lowering.set_position(position);
    let exports = PropertyName::Constant(member::name_key(lowering.file, known::exports));
    member::emit_set(lowering, module_object, exports, value);
}

fn is_unused_alias(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, symbol: SymbolId) -> bool {
    let unused_symbols = lowering.file.compiled.analysis.unused_import_symbols;
    unused_symbols.binary_search(&symbol).is_ok()
}

fn lower_entity_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: ImportEqualsId,
    names: hir::Span<NameId>,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let mut names = names.iter().map(|name| hir[name]);
    let root = names.next()?;
    lowering.set_position(root.pos());
    let binding = lowering.file.bound.entity_root_binding(declaration);
    let mut value = scope::get_binding(lowering, binding, root.text);
    for name in names {
        lowering.set_position(name.pos());
        let key = member::name_key(lowering.file, name.text);
        value = member::emit_get(lowering, value, PropertyName::Constant(key));
    }
    Some(value)
}
