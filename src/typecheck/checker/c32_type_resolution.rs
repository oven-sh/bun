// checker.go:18861-18958 (layer T-RSTACK): the type resolution stack: its push with the circularity test, its pop, the search for the start of a resolution cycle, the test whether a resolution has its property by now, and the report of a circularity at a symbol.
use crate::ast::{Arg, NodeId, SymbolFlags, SymbolId, is_parameter_declaration};
use crate::checker::{
    Checker, NodeCheckFlags, SignatureId, TypeId, TypeResolution, TypeSystemEntity,
    TypeSystemPropertyName,
};
use crate::diagnostics;

// The four functions below are the type assertions of typeResolutionHasProperty on `r.target`: a target of another kind is a fault and reads as nil.
fn target_symbol(c: &Checker<'_>, target: TypeSystemEntity) -> SymbolId {
    match target {
        TypeSystemEntity::Symbol(symbol) => symbol,
        _ => {
            c.bad_cast("target.(*ast.Symbol)");
            SymbolId::NIL
        }
    }
}

fn target_type(c: &Checker<'_>, target: TypeSystemEntity) -> TypeId {
    match target {
        TypeSystemEntity::Type(t) => t,
        _ => {
            c.bad_cast("target.(*Type)");
            TypeId::NIL
        }
    }
}

fn target_signature(c: &Checker<'_>, target: TypeSystemEntity) -> SignatureId {
    match target {
        TypeSystemEntity::Signature(signature) => signature,
        _ => {
            c.bad_cast("target.(*Signature)");
            SignatureId::NIL
        }
    }
}

fn target_node(c: &Checker<'_>, target: TypeSystemEntity) -> NodeId {
    match target {
        TypeSystemEntity::Node(node) => node,
        _ => {
            c.bad_cast("target.(*ast.Node)");
            NodeId::NIL
        }
    }
}

impl<'a> Checker<'a> {
    // Push an entry on the type resolution stack. If an entry with the given target and the given property name is already on the stack, and no entries in between already have a type, then a circularity has occurred. In this case, the result values of the existing entry and all entries pushed after it are changed to false, and the value false is returned. Otherwise, the new entry is just pushed onto the stack, and true is returned. In order to see if the same query has already been done before, the target object and the propertyName both must match the one passed in.
    pub fn push_type_resolution(
        &mut self,
        target: TypeSystemEntity,
        property_name: TypeSystemPropertyName,
    ) -> bool {
        let resolution_cycle_start_index =
            self.find_resolution_cycle_start_index(target, property_name);
        if resolution_cycle_start_index >= 0 {
            // A cycle was found
            for resolution in self
                .type_resolutions
                .iter_mut()
                .skip(resolution_cycle_start_index as usize)
            {
                resolution.result = false;
            }
            return false;
        }
        self.type_resolutions.push(TypeResolution {
            target,
            property_name,
            result: true,
        });
        true
    }

    // Pop an entry from the type resolution stack and return its associated result value. The result value will be true if no circularities were detected, or false if a circularity was found. Upstream indexes the stack at -1 when it is empty: here that is a fault and false.
    pub fn pop_type_resolution(&mut self) -> bool {
        match self.type_resolutions.pop() {
            Some(resolution) => resolution.result,
            None => self.fail("popTypeResolution: index out of range [-1]"),
        }
    }

    pub fn find_resolution_cycle_start_index(
        &mut self,
        target: TypeSystemEntity,
        property_name: TypeSystemPropertyName,
    ) -> isize {
        let mut i = self.type_resolutions.len() as isize - 1;
        while i >= self.resolution_start {
            let Some(&resolution) = self.type_resolutions.get(i as usize) else {
                let _: () = self.fail("findResolutionCycleStartIndex: index out of range");
                return -1;
            };
            if self.type_resolution_has_property(resolution) {
                return -1;
            }
            if resolution.target == target && resolution.property_name == property_name {
                return i;
            }
            i -= 1;
        }
        -1
    }

    // The match names every property name, so the panic that closes the switch of upstream has no counterpart.
    pub fn type_resolution_has_property(&mut self, r: TypeResolution) -> bool {
        match r.property_name {
            TypeSystemPropertyName::Type => {
                let symbol = target_symbol(self, r.target);
                let links = self.value_symbol_links_get(symbol);
                !self.value_symbol_links[links].resolved_type.is_nil()
            }
            TypeSystemPropertyName::DeclaredType => {
                let symbol = target_symbol(self, r.target);
                let links = self.type_alias_links.get(symbol);
                !self.type_alias_links[links].declared_type.is_nil()
            }
            TypeSystemPropertyName::ResolvedTypeArguments => {
                let t = target_type(self, r.target);
                !self.as_type_reference(t).resolved_type_arguments.is_nil()
            }
            TypeSystemPropertyName::ResolvedBaseTypes => {
                let t = target_type(self, r.target);
                self.as_interface_type(t).base_types_resolved
            }
            TypeSystemPropertyName::ResolvedBaseConstructorType => {
                let t = target_type(self, r.target);
                !self
                    .as_interface_type(t)
                    .resolved_base_constructor_type
                    .is_nil()
            }
            TypeSystemPropertyName::ResolvedReturnType => {
                let signature = target_signature(self, r.target);
                !self.signatures[signature].resolved_return_type.is_nil()
            }
            TypeSystemPropertyName::ResolvedBaseConstraint => {
                let t = target_type(self, r.target);
                !self
                    .as_constrained_type(t)
                    .resolved_base_constraint
                    .is_nil()
            }
            TypeSystemPropertyName::InitializerIsUndefined => {
                let node = target_node(self, r.target);
                let links = self.node_links.get(node);
                self.node_links[links]
                    .flags
                    .intersects(NodeCheckFlags::INITIALIZER_IS_UNDEFINED_COMPUTED)
            }
            TypeSystemPropertyName::WriteType => {
                let symbol = target_symbol(self, r.target);
                let links = self.value_symbol_links_get(symbol);
                !self.value_symbol_links[links].write_type.is_nil()
            }
            TypeSystemPropertyName::AliasTarget => {
                let symbol = target_symbol(self, r.target);
                let links = self.alias_symbol_links.get(symbol);
                !self.alias_symbol_links[links].alias_target.is_nil()
            }
        }
    }

    pub fn report_circularity_error(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let declaration = a.sym(symbol).value_declaration;
        // Check if variable has type annotation that circularly references the variable itself
        if !declaration.is_nil() {
            if !a.type_node(declaration).is_nil() {
                let symbol_name = self.symbol_to_string(symbol);
                self.error(
                    a.sym(symbol).value_declaration,
                    diagnostics::X_0_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ITS_OWN_TYPE_ANNOTATION,
                    &[Arg::Str(&symbol_name)],
                );
                return self.error_type;
            }
            // Check if variable has initializer that circularly references the variable itself
            if self.no_implicit_any
                && (!is_parameter_declaration(a, declaration)
                    || !a.initializer(declaration).is_nil())
            {
                let symbol_name = self.symbol_to_string(symbol);
                self.error(
                    a.sym(symbol).value_declaration,
                    diagnostics::X_0_IMPLICITLY_HAS_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_TYPE_ANNOTATION_AND_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ITS_OWN_INITIALIZER,
                    &[Arg::Str(&symbol_name)],
                );
            }
        } else if a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
            let node = self.get_declaration_of_alias_symbol(symbol);
            if !node.is_nil() {
                let symbol_name = self.symbol_to_string(symbol);
                self.error(
                    node,
                    diagnostics::CIRCULAR_DEFINITION_OF_IMPORT_ALIAS_0,
                    &[Arg::Str(&symbol_name)],
                );
            }
        }
        // Circularities could also result from parameters in function expressions that end up having themselves as contextual types following type argument inference. In those cases we have already reported an implicit any error so we don't report anything here.
        self.any_type
    }
}
