// checker.go 23960-23995 (c39_declared_types_enums): getDeclaredTypeOfTypeAlias, links through a handle and the resolution stack.
use crate::ast::ast_generated::{is_js_type_alias_declaration, is_type_alias_declaration};
use crate::ast::diagnostic::Arg;
use crate::checker::checker::{Checker, TypeSystemEntity, TypeSystemPropertyName};
use crate::checker::keys::get_type_list_key;
use crate::diagnostics;
use crate::tscore::golang::{List, Map, Text};
use crate::tscore::ids::{NodeId, SymbolId, TypeId};

impl<'a> Checker<'a> {
    pub fn get_declared_type_of_type_alias(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let links = self.type_alias_links.get(symbol);
        if self.type_alias_links[links].declared_type.is_nil() {
            // The links object is the target: the symbol is the identity for the 'type' property in SymbolLinks.
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::DeclaredType,
            ) {
                return self.error_type;
            }
            // core.Find(symbol.Declarations, ast.IsTypeOrJSTypeAliasDeclaration)
            let mut declaration = NodeId::NIL;
            for d in a.sym(symbol).declarations.iter() {
                if is_type_alias_declaration(a, d) || is_js_type_alias_declaration(a, d) {
                    declaration = d;
                    break;
                }
            }
            let type_node = a.type_node(declaration);
            let mut t = self.get_type_from_type_node(type_node);
            if self.pop_type_resolution() {
                let type_parameters =
                    self.get_local_type_parameters_of_class_or_interface_or_type_alias(symbol);
                if type_parameters.len() != 0 {
                    // Initialize the instantiation cache for generic type aliases.
                    self.type_alias_links[links].type_parameters = type_parameters;
                    self.type_alias_links[links].instantiations = Map::make();
                    let ok = self.type_alias_links[links]
                        .instantiations
                        .set(get_type_list_key(type_parameters), t);
                    self.map_set(ok);
                }
                if t == self.intrinsic_marker_type && a.sym(symbol).name == b"BuiltinIteratorReturn"
                {
                    t = self.get_builtin_iterator_return_type();
                }
            } else {
                let mut error_node = a.name(declaration);
                if error_node.is_nil() {
                    error_node = declaration;
                }
                let name = self.symbol_to_string(symbol);
                self.error(
                    error_node,
                    diagnostics::Type_alias_0_circularly_references_itself,
                    &[Arg::Str(name)],
                );
                t = self.error_type;
            }
            if self.type_alias_links[links].declared_type.is_nil() {
                self.type_alias_links[links].declared_type = t;
            }
        }
        self.type_alias_links[links].declared_type
    }

    // The scripted types are a hook of this scratch: a test gives a type node its type, or its symbol for a reference to the alias.
    pub fn get_type_from_type_node(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        self.stand_ins.record("getTypeFromTypeNode");
        let referenced = self.scripted_type_node_aliases.get(&node);
        if !referenced.is_nil() {
            return self.get_declared_type_of_type_alias(referenced);
        }
        let links = self.type_node_links.get(node);
        self.type_node_links[links].resolved_type
    }

    pub fn get_local_type_parameters_of_class_or_interface_or_type_alias(
        &mut self,
        symbol: SymbolId,
    ) -> List<'a, TypeId> {
        let _ = symbol;
        self.stand_in("getLocalTypeParametersOfClassOrInterfaceOrTypeAlias")
    }

    pub fn get_builtin_iterator_return_type(&mut self) -> TypeId {
        self.stand_in("getBuiltinIteratorReturnType")
    }

    pub fn symbol_to_string(&mut self, symbol: SymbolId) -> Text<'a> {
        self.stand_ins.record("symbolToString");
        self.ast.sym(symbol).name
    }
}
