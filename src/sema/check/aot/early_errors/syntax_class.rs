use crate::check::Checker;
use crate::check::aot::DiagnosticClass;
use crate::hir::{Flags, has_body_node, rare};
use crate::node::{Kind, Node, NodeData};
use crate::program::FileId;

impl Checker<'_, '_> {
    pub(in crate::check) fn is_strict_mode_code(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        if hir.is_strict || hir.get_containing_class(node).is_some() {
            return true;
        }
        let function = hir.function_of(hir.get_containing_function(node));
        hir.fns
            .get(function.idx())
            .is_some_and(|function| function.is_strict)
    }

    pub(in crate::check) fn is_erased_syntax(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let is_erased = |ancestor: Node| {
            matches!(
                hir.data(ancestor),
                NodeData::Type(_) | NodeData::TypeParam(_)
            ) || matches!(
                hir.kind(ancestor),
                Kind::InterfaceDeclaration | Kind::TypeAliasDeclaration
            ) || (hir.fns.get(hir.function_of(ancestor).idx()))
                .is_some_and(|function| !has_body_node(function))
        };
        hir.is_ambient(node) || hir.find_ancestor(node, is_erased).is_some()
    }

    pub(in crate::check) fn early_error_class(&self, file: FileId, node: Node) -> DiagnosticClass {
        if self.is_erased_syntax(file, node) {
            DiagnosticClass::TypeScriptGrammar
        } else {
            DiagnosticClass::EarlyError
        }
    }

    /// For `await` (`ASYNC`) or `yield` (`GENERATOR`) as a name where the code around it has the operator. A function
    /// expression reads its own name as its own modifiers say.
    pub(in crate::check) fn operator_as_name_error_class(
        &self,
        file: FileId,
        name: Node,
        modifier: Flags,
    ) -> DiagnosticClass {
        let hir = self.hir(file);
        let function = hir.parent(name);
        let is_own_name = hir.kind(function) == Kind::FunctionExpression
            && hir.name(function) == name
            && !hir.flags(function).contains(modifier);
        if is_own_name {
            DiagnosticClass::TypeScriptGrammar
        } else {
            self.early_error_class(file, name)
        }
    }

    pub(in crate::check) fn function_directive_error_class(&self, file: FileId) -> DiagnosticClass {
        match self.hir(file).rare_syntax & rare::DIRECTIVE_IN_FUNCTION != 0 {
            true => DiagnosticClass::EarlyError,
            false => DiagnosticClass::TypeScriptGrammar,
        }
    }

    pub(in crate::check) fn is_read_as_strict_mode_code(&self, file: FileId, node: Node) -> bool {
        self.is_strict_mode_code(file, node) || self.hir(file).follows_dropped_directive(node)
    }

    pub(in crate::check) fn strict_mode_name_error_class(
        &self,
        file: FileId,
        node: Node,
    ) -> DiagnosticClass {
        if self.is_read_as_strict_mode_code(file, node) {
            self.early_error_class(file, node)
        } else {
            DiagnosticClass::TypeScriptGrammar
        }
    }

    pub(in crate::check) fn strict_mode_error_class(
        &self,
        file: FileId,
        node: Node,
    ) -> DiagnosticClass {
        if self.is_strict_mode_code(file, node) {
            self.early_error_class(file, node)
        } else {
            DiagnosticClass::TypeScriptGrammar
        }
    }
}
