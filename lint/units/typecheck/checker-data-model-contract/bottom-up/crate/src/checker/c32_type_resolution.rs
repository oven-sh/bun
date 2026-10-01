// checker.go 18861-18934 (c32_type_resolution, layer T-RSTACK).
use crate::checker::c01_data::{TypeResolution, TypeSystemEntity, TypeSystemPropertyName};
use crate::checker::checker::Checker;
use crate::checker::flags_generated::NodeCheckFlags;
use crate::tscore::ids::{NodeId, SignatureId, SymbolId, TypeId};

impl<'a> Checker<'a> {
    // `r.target.(*ast.Symbol)` and the three other type assertions: a wrong kind is recorded and reads nil.
    fn entity_symbol(&self, entity: TypeSystemEntity) -> SymbolId {
        match entity {
            TypeSystemEntity::Symbol(s) => s,
            _ => {
                self.bad_cast("target.(*ast.Symbol)");
                SymbolId::NIL
            }
        }
    }
    fn entity_type(&self, entity: TypeSystemEntity) -> TypeId {
        match entity {
            TypeSystemEntity::Type(t) => t,
            _ => {
                self.bad_cast("target.(*Type)");
                TypeId::NIL
            }
        }
    }
    fn entity_signature(&self, entity: TypeSystemEntity) -> SignatureId {
        match entity {
            TypeSystemEntity::Signature(s) => s,
            _ => {
                self.bad_cast("target.(*Signature)");
                SignatureId::NIL
            }
        }
    }
    fn entity_node(&self, entity: TypeSystemEntity) -> NodeId {
        match entity {
            TypeSystemEntity::Node(n) => n,
            _ => {
                self.bad_cast("target.(*ast.Node)");
                NodeId::NIL
            }
        }
    }

    // Push an entry on the type resolution stack. False when the same query is already on the stack with no typed entry in between.
    pub fn push_type_resolution(
        &mut self,
        target: TypeSystemEntity,
        property_name: TypeSystemPropertyName,
    ) -> bool {
        let resolution_cycle_start_index =
            self.find_resolution_cycle_start_index(target, property_name);
        if resolution_cycle_start_index >= 0 {
            // A cycle was found
            let mut i = resolution_cycle_start_index;
            while i < self.type_resolutions.len() as isize {
                if let Some(resolution) = self.type_resolutions.get_mut(i as usize) {
                    resolution.result = false;
                }
                i += 1;
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

    // Pop an entry from the type resolution stack and return its associated result value.
    pub fn pop_type_resolution(&mut self) -> bool {
        match self.type_resolutions.pop() {
            Some(resolution) => resolution.result,
            None => self.fail("index out of range [-1]"),
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
                break;
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

    // The match is exhaustive: upstream's closing panic has no port.
    pub fn type_resolution_has_property(&mut self, r: TypeResolution) -> bool {
        match r.property_name {
            TypeSystemPropertyName::Type => {
                let links = self.value_symbol_links_get(self.entity_symbol(r.target));
                !self.value_symbol_links[links].resolved_type.is_nil()
            }
            TypeSystemPropertyName::DeclaredType => {
                let links = self.type_alias_links.get(self.entity_symbol(r.target));
                !self.type_alias_links[links].declared_type.is_nil()
            }
            TypeSystemPropertyName::ResolvedTypeArguments => !self
                .as_type_reference(self.entity_type(r.target))
                .resolved_type_arguments
                .is_nil(),
            TypeSystemPropertyName::ResolvedBaseTypes => {
                self.as_interface_type(self.entity_type(r.target))
                    .base_types_resolved
            }
            TypeSystemPropertyName::ResolvedBaseConstructorType => !self
                .as_interface_type(self.entity_type(r.target))
                .resolved_base_constructor_type
                .is_nil(),
            TypeSystemPropertyName::ResolvedReturnType => !self.signatures
                [self.entity_signature(r.target)]
            .resolved_return_type
            .is_nil(),
            TypeSystemPropertyName::ResolvedBaseConstraint => !self
                .as_constrained_type(self.entity_type(r.target))
                .resolved_base_constraint
                .is_nil(),
            TypeSystemPropertyName::InitializerIsUndefined => {
                let links = self.node_links.get(self.entity_node(r.target));
                self.node_links[links]
                    .flags
                    .intersects(NodeCheckFlags::INITIALIZER_IS_UNDEFINED_COMPUTED)
            }
            TypeSystemPropertyName::WriteType => {
                let links = self.value_symbol_links_get(self.entity_symbol(r.target));
                !self.value_symbol_links[links].write_type.is_nil()
            }
            TypeSystemPropertyName::AliasTarget => {
                let links = self.alias_symbol_links.get(self.entity_symbol(r.target));
                !self.alias_symbol_links[links].alias_target.is_nil()
            }
        }
    }
}
