// checker.go:23960-23995, checker.go:1153-1158 (core.Memoize), flow.go:2155-2195 (defer).
use crate::checker::{Checker, TypeSystemEntity, TypeSystemPropertyName};
use crate::golang::{List, Map};
use crate::ids::*;
use crate::keys::get_type_list_key;

impl<'a> Checker<'a> {
    pub fn get_declared_type_of_type_alias(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.type_alias_links.get(symbol);
        if self.type_alias_links[links].declared_type.is_nil() {
            // Note that we use the links object as the target here because the symbol object is used as the unique
            // identity for resolution of the 'type' property in SymbolLinks.
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::DeclaredType,
            ) {
                return self.error_type;
            }
            let declaration = self.find_node(
                self.symbols[symbol].declarations,
                Checker::is_type_or_js_type_alias_declaration,
            );
            let type_node = self.nodes[declaration].type_node;
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
                if t == self.intrinsic_marker_type
                    && self.symbols[symbol].name == b"BuiltinIteratorReturn"
                {
                    t = self.get_builtin_iterator_return_type();
                }
            } else {
                let mut error_node = self.nodes[declaration].name;
                if error_node.is_nil() {
                    error_node = declaration;
                }
                self.error(error_node, MessageId(2456));
                t = self.error_type;
            }
            if self.type_alias_links[links].declared_type.is_nil() {
                self.type_alias_links[links].declared_type = t;
            }
        }
        self.type_alias_links[links].declared_type
    }

    // core.Find over nodes with a predicate that reads the node table.
    pub fn find_node(
        &mut self,
        nodes: List<'a, NodeId>,
        f: fn(&mut Checker<'a>, NodeId) -> bool,
    ) -> NodeId {
        for node in nodes.iter() {
            if f(self, node) {
                return node;
            }
        }
        NodeId::NIL
    }

    pub fn is_type_or_js_type_alias_declaration(&mut self, node: NodeId) -> bool {
        self.nodes[node].kind == 266 || self.nodes[node].kind == 353
    }

    pub fn get_type_from_type_node(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let _ = node;
        self.stand_in("getTypeFromTypeNode")
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

    // c.getGlobalPromiseType = c.getGlobalTypeResolver("Promise", 1, false)
    pub fn get_global_promise_type(&mut self) -> TypeId {
        if !self.get_global_promise_type.done {
            let value = self.get_global_type(b"Promise", 1, false);
            self.get_global_promise_type.value = value;
            self.get_global_promise_type.done = true;
        }
        self.get_global_promise_type.value
    }

    pub fn get_global_type(
        &mut self,
        name: &'static [u8],
        arity: isize,
        report_errors: bool,
    ) -> TypeId {
        let _ = (name, arity, report_errors);
        self.stand_in("getGlobalType")
    }

    // `defer f()` becomes a labeled block: every `return x` after the defer statement is `break 'deferred x`.
    pub fn get_explicit_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        let symbol = self.resolve_symbol(symbol);
        if self.resolving_explicit_type_of_symbol.contains(&symbol) {
            return TypeId::NIL;
        }
        self.resolving_explicit_type_of_symbol.push(symbol);
        let result = 'deferred: {
            if self.symbols[symbol]
                .flags
                .intersects(crate::flags::SymbolFlags::CLASS)
            {
                break 'deferred self.get_type_of_symbol(symbol);
            }
            TypeId::NIL
        };
        self.resolving_explicit_type_of_symbol
            .retain(|&s| s != symbol);
        result
    }

    pub fn resolve_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let _ = symbol;
        self.stand_in("resolveSymbol")
    }

    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        let _ = symbol;
        self.stand_in("getTypeOfSymbol")
    }

    // What a recursion hub returns when the thread has no stack left.
    pub fn stack_limit<T: crate::checker::Fallback<'a>>(&self) -> T {
        self.internal.record(crate::internal::InternalFault {
            kind: crate::internal::FaultKind::StackLimit,
            message: "stack limit reached",
            detail: 0,
            node: self.current_node,
        });
        T::fallback(self)
    }
}
