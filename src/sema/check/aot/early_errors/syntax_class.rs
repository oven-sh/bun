use crate::bind::{Binding, BindingStability};
use crate::check::Checker;
use crate::check::aot::DiagnosticClass;
use crate::hir::{ExprId, Flags, StmtKind, has_body_node, rare};
use crate::node::{Kind, Node, NodeData};
use crate::program::FileId;

impl Checker<'_, '_> {
    pub(in crate::check) fn is_strict_mode_code(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let class = hir.get_containing_class_excluding_class_decorators(node);
        if hir.is_strict || class.is_some() {
            return true;
        }
        let function = hir.function_of(hir.get_containing_function(node));
        let is_in_strict_function = hir
            .fns
            .get(function.idx())
            .is_some_and(|function| function.is_strict);
        let is_strict_namespace = |ancestor: Node| match hir.data(ancestor) {
            NodeData::Stmt(statement) => {
                matches!(hir[statement].kind, StmtKind::Module(it) if hir.is_strict_namespace(it))
            }
            _ => false,
        };
        is_in_strict_function || hir.find_ancestor(node, is_strict_namespace).is_some()
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

    pub(in crate::check) fn names_member_of_container(&self, file: FileId, name: ExprId) -> bool {
        let bound = self.bound(file);
        bound.runtime.is_computed()
            && matches!(bound.binding(name), Binding::Symbol(symbol)
                if bound.binding_stability(symbol) == BindingStability::ContainerMember)
    }
}
