use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable, Decl};
use bun_sema::hir::{self, ExprId, Flags, ImportEqualsId, ImportEqualsTarget, NameId};

use crate::ir::ValueId;
use crate::lower::commonjs::BodyForm;
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, scope};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_import_equals(&mut self, declaration: ImportEqualsId) {
        let data = self.file.hir[declaration];
        if data.flags.contains(Flags::TYPE_ONLY) {
            return;
        }
        let declared = Decl::ImportEquals(declaration);
        let symbol = self.file.bound.declared_symbol(declared);
        debug_assert!(
            symbol.is_some(),
            "an import alias with a value declares a symbol"
        );
        let unused_symbols = self.file.compiled.analysis.unused_import_symbols;
        let value = match data.target {
            ImportEqualsTarget::Require(_) => self.lower_import_equals_require(declaration),
            ImportEqualsTarget::Entity(_) if unused_symbols.binary_search(&symbol).is_ok() => None,
            ImportEqualsTarget::Entity(names) => self.lower_entity_name(declaration, names),
        };
        let Some(value) = value else {
            return;
        };
        // A holder holds nothing of the type that the name has.
        match self.file.inputs.modules.holder(self.file.file, symbol) {
            Some(_) => self.initialize_converted_symbol(symbol, data.name, value),
            None => scope::initialize_binding(self, Binding::Symbol(symbol), data.name, value),
        }
    }

    pub(crate) fn lower_export_assignment(&mut self, expression: ExprId) {
        let position = self.position();
        if self.file.body_form() == BodyForm::Plain {
            if self.try_lower_export_assignment(expression) {
                return;
            }
            let value = self.lower_expression(expression);
            self.set_position(position);
            self.set_own_exports(value);
            return;
        }
        let module_object = self.get_commonjs_variable(CommonJsVariable::Module);
        let value = self.lower_expression(expression);
        self.set_position(position);
        let exports = PropertyName::Constant(self.file.name_key(known::exports));
        self.emit_set(module_object, exports, value);
    }

    fn lower_entity_name(
        &mut self,
        declaration: ImportEqualsId,
        names: hir::Span<NameId>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let mut names = names.iter().map(|name| hir[name]);
        let root = names.next()?;
        self.set_position(root.pos());
        let binding = self.file.bound.entity_root_binding(declaration);
        let mut value = self.get_binding(binding, root.text);
        for name in names {
            self.set_position(name.pos());
            let key = self.file.name_key(name.text);
            value = self.emit_get(value, PropertyName::Constant(key));
        }
        Some(value)
    }
}
