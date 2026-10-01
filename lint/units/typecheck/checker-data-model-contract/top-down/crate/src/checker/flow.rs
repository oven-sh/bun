// flow.go 2155-2192: getExplicitTypeOfSymbol, a function with `defer`.
use crate::ast::ast_generated::{is_for_of_statement, is_variable_declaration};
use crate::ast::diagnostic::Arg;
use crate::ast::flags_generated::{CheckFlags, SymbolFlags};
use crate::checker::checker::Checker;
use crate::diagnostics;
use crate::tscore::ids::{DiagnosticId, NodeId, SymbolId, TypeId};

impl Checker<'_> {
    pub fn get_explicit_type_of_symbol(
        &mut self,
        symbol: SymbolId,
        diagnostic: DiagnosticId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return TypeId::NIL;
        }
        let a = self.ast;
        let symbol = self.resolve_symbol(symbol);
        if !self.resolving_explicit_type_of_symbol.add_if_absent(symbol) {
            return TypeId::NIL;
        }
        // `defer f()`: every `return x` after the defer statement is `break 'deferred x`.
        let result = 'deferred: {
            let s = a.sym(symbol);
            if s.flags.intersects(
                SymbolFlags::FUNCTION
                    | SymbolFlags::METHOD
                    | SymbolFlags::CLASS
                    | SymbolFlags::VALUE_MODULE,
            ) {
                break 'deferred self.get_type_of_symbol(symbol);
            }
            if s.flags
                .intersects(SymbolFlags::VARIABLE | SymbolFlags::PROPERTY)
            {
                if s.check_flags.intersects(CheckFlags::MAPPED) {
                    let origin = self.get_synthetic_origin_of_mapped_symbol(symbol);
                    if !origin.is_nil()
                        && !self
                            .get_explicit_type_of_symbol(origin, diagnostic)
                            .is_nil()
                    {
                        break 'deferred self.get_type_of_symbol(symbol);
                    }
                }
                let declaration = s.value_declaration;
                if !declaration.is_nil() {
                    if self.is_declaration_with_explicit_type_annotation(declaration) {
                        break 'deferred self.get_type_of_symbol(symbol);
                    }
                    if is_variable_declaration(a, declaration)
                        && is_for_of_statement(a, a.parent(a.parent(declaration)))
                    {
                        let statement = a.parent(a.parent(declaration));
                        let expression_type = self
                            .get_type_of_dotted_name(a.expression(statement), DiagnosticId::NIL);
                        if !expression_type.is_nil() {
                            let for_await = !a
                                .as_for_in_or_of_statement(statement)
                                .await_modifier
                                .is_nil();
                            break 'deferred self.check_iterated_type_or_element_type(
                                for_await,
                                expression_type,
                                declaration,
                            );
                        }
                    }
                    if !diagnostic.is_nil() {
                        let name = self.symbol_to_string(symbol);
                        let info = self.new_diagnostic_for_node(
                            declaration,
                            diagnostics::X_0_needs_an_explicit_type_annotation,
                            &[Arg::Str(name)],
                        );
                        self.diagnostic_store.add_related_info(diagnostic, info);
                    }
                }
            }
            TypeId::NIL
        };
        self.resolving_explicit_type_of_symbol.delete(symbol);
        result
    }

    // Stand-ins for the callees of other layers.
    pub fn resolve_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        self.stand_ins.record("resolveSymbol");
        symbol
    }
    pub fn get_synthetic_origin_of_mapped_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let _ = symbol;
        self.stand_in("mappedSymbolLinks.Get(symbol).syntheticOrigin")
    }
    pub fn is_declaration_with_explicit_type_annotation(&mut self, node: NodeId) -> bool {
        let _ = node;
        self.stand_in("isDeclarationWithExplicitTypeAnnotation")
    }
    pub fn get_type_of_dotted_name(&mut self, node: NodeId, diagnostic: DiagnosticId) -> TypeId {
        let _ = (node, diagnostic);
        self.stand_ins.record("getTypeOfDottedName");
        TypeId::NIL
    }
    pub fn check_iterated_type_or_element_type(
        &mut self,
        for_await: bool,
        input_type: TypeId,
        error_node: NodeId,
    ) -> TypeId {
        let _ = (for_await, input_type, error_node);
        self.stand_in("checkIteratedTypeOrElementType")
    }
}
