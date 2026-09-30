// checker.go:4286-5146 (layer D-CLASS): class and interface declarations, heritage, member overrides, index constraints, property initialization.
use crate::ast::{
    Arg, CheckFlags, DiagnosticId, Factory, FlowNodeId, INTERNAL_SYMBOL_NAME_COMPUTED, Kind,
    ModifierFlags, NodeFactory, NodeFlags, NodeId, SymbolFlags, SymbolId,
    find_constructor_declaration, get_class_extends_heritage_element,
    get_class_like_declaration_of_symbol, get_declaration_of_kind,
    get_extends_heritage_clause_elements, get_implements_heritage_clause_elements,
    get_name_of_declaration, has_abstract_modifier, has_ambient_modifier, has_modifier,
    has_static_modifier, has_syntactic_modifier, is_binary_expression, is_class_declaration,
    is_class_element, is_class_expression, is_class_like, is_computed_property_name,
    is_constructor_declaration, is_decorator, is_entity_name_expression,
    is_expression_with_type_arguments, is_identifier, is_in_js_file,
    is_index_signature_declaration, is_interface_declaration, is_optional_chain,
    is_parameter_declaration, is_parameter_property_declaration, is_private_identifier,
    is_private_identifier_class_element_declaration, is_property_declaration, is_static,
    symbol_name,
};
use crate::checker::{
    Checker, IndexInfoId, MemberOverrideStatus, ObjectFlags, SignatureFlags, SignatureKind,
    Ternary, TypeFlags, TypeId, get_declaration_modifier_flags_from_symbol,
    get_identifier_from_entity_name_expression, has_override_modifier, is_exclamation_token,
    is_prototype_property,
};
use crate::core::{List, Map, Text};
use crate::diagnostics::{self, MessageId};
use crate::scanner::declaration_name_to_string;

// checker.go 5107
#[derive(Clone, Copy, Default)]
pub struct InheritanceInfo {
    pub prop: SymbolId,
    pub containing_type: TypeId,
}

impl<'a> Checker<'a> {
    pub fn check_class_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        let first_decorator = a
            .modifier_nodes(node)
            .as_slice()
            .iter()
            .copied()
            .find(|&modifier| is_decorator(a, modifier))
            .unwrap_or_default();
        if self.legacy_decorators
            && !first_decorator.is_nil()
            && a.members(node).as_slice().iter().any(|&p| {
                has_static_modifier(a, p) && is_private_identifier_class_element_declaration(a, p)
            })
        {
            self.grammar_error_on_node(first_decorator, diagnostics::CLASS_DECORATORS_CAN_T_BE_USED_WITH_STATIC_PRIVATE_IDENTIFIER_CONSIDER_REMOVING_THE_EXPERIMENTAL_DECORATOR, &[]);
        }
        if a.name(node).is_nil() && !has_syntactic_modifier(a, node, ModifierFlags::DEFAULT) {
            self.grammar_error_on_first_token(
                node,
                diagnostics::A_CLASS_DECLARATION_WITHOUT_THE_DEFAULT_MODIFIER_MUST_HAVE_A_NAME,
                &[],
            );
        }
        self.check_class_like_declaration(node);
        self.check_source_elements(a.members(node));
        self.register_for_unused_identifiers_check(node);
    }

    pub fn check_class_like_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_class_like_declaration(node);
        self.check_decorators(node);
        self.check_collisions_for_declaration_name(node, a.name(node));
        self.check_type_parameters(a.type_parameters(node));
        self.check_exports_on_merged_declarations(node);
        let symbol = self.get_symbol_of_declaration(node);
        let class_type = self.get_declared_type_of_symbol(symbol);
        let type_with_this = self.get_type_with_this_argument(class_type, TypeId::NIL, false);
        let static_type = self.get_type_of_symbol(symbol);
        self.check_type_parameter_lists_identical(symbol);
        self.check_function_or_constructor_symbol(symbol);
        self.check_object_type_for_duplicate_declarations(node, true);

        // Only check for reserved static identifiers on non-ambient context.
        let node_in_ambient_context = a.flags(node).intersects(NodeFlags::AMBIENT);
        if !node_in_ambient_context {
            self.check_class_for_static_property_name_conflicts(node);
        }

        let name_or_node = if a.name(node).is_nil() {
            node
        } else {
            a.name(node)
        };
        let base_type_node = get_class_extends_heritage_element(a, node);
        if !base_type_node.is_nil() {
            self.check_source_elements(a.type_arguments(base_type_node));
            let base_types = self.get_base_types(class_type);
            if base_types.len() != 0 {
                let base_type = base_types.as_slice().first().copied().unwrap_or_default();
                self.check_jsdoc_augments_tag_matches_extends(node, base_type_node, base_type);
                let base_constructor_type = self.get_base_constructor_type_of_class(class_type);
                let static_base_type = self.get_apparent_type(base_constructor_type);
                self.check_base_type_accessibility(static_base_type, base_type_node);
                self.check_source_element(a.expression(base_type_node));
                if a.type_arguments(base_type_node).len() != 0 {
                    self.check_source_elements(a.type_arguments(base_type_node));
                    let constructors = self.get_constructors_for_type_arguments(
                        static_base_type,
                        a.type_arguments(base_type_node),
                        base_type_node,
                    );
                    for &constructor in constructors.as_slice() {
                        let type_parameters = self.signatures[constructor].type_parameters;
                        if !self.check_type_argument_constraints(base_type_node, type_parameters) {
                            break;
                        }
                    }
                }
                let this_type = self.as_interface_type(class_type).this_type;
                let base_with_this = self.get_type_with_this_argument(base_type, this_type, false);
                if !self.check_type_assignable_to(
                    type_with_this,
                    base_with_this,
                    NodeId::NIL,
                    MessageId::NIL,
                ) {
                    self.issue_member_specific_error(
                        node,
                        type_with_this,
                        base_with_this,
                        diagnostics::CLASS_0_INCORRECTLY_EXTENDS_BASE_CLASS_1,
                    );
                } else {
                    // Report static side error only when instance type is assignable
                    let static_base_without_signatures =
                        self.get_type_without_signatures(static_base_type);
                    self.check_type_assignable_to(
                        static_type,
                        static_base_without_signatures,
                        name_or_node,
                        diagnostics::CLASS_STATIC_SIDE_0_INCORRECTLY_EXTENDS_BASE_CLASS_STATIC_SIDE_1,
                    );
                }
                if self.types[base_constructor_type]
                    .flags
                    .intersects(TypeFlags::TYPE_VARIABLE)
                {
                    if !self.is_mixin_constructor_type(static_type) {
                        self.error(name_or_node, diagnostics::A_MIXIN_CLASS_MUST_HAVE_A_CONSTRUCTOR_WITH_A_SINGLE_REST_PARAMETER_OF_TYPE_ANY, &[]);
                    } else {
                        let construct_signatures = self.get_signatures_of_type(
                            base_constructor_type,
                            SignatureKind::CONSTRUCT,
                        );
                        if construct_signatures.as_slice().iter().any(|&signature| {
                            self.signatures[signature]
                                .flags
                                .intersects(SignatureFlags::ABSTRACT)
                        }) && !has_syntactic_modifier(a, node, ModifierFlags::ABSTRACT)
                        {
                            self.error(name_or_node, diagnostics::A_MIXIN_CLASS_THAT_EXTENDS_FROM_A_TYPE_VARIABLE_CONTAINING_AN_ABSTRACT_CONSTRUCT_SIGNATURE_MUST_ALSO_BE_DECLARED_ABSTRACT, &[]);
                        }
                    }
                }
                let static_base_symbol = self.types[static_base_type].symbol;
                if !(!static_base_symbol.is_nil()
                    && a.sym(static_base_symbol)
                        .flags
                        .intersects(SymbolFlags::CLASS))
                    && !self.types[base_constructor_type]
                        .flags
                        .intersects(TypeFlags::TYPE_VARIABLE)
                {
                    // When the static base type is a "class-like" constructor function (but not actually a class), we verify that all instantiated base constructor signatures return the same type.
                    let constructors = self.get_instantiated_constructors_for_type_arguments(
                        static_base_type,
                        a.type_arguments(base_type_node),
                        base_type_node,
                    );
                    let mut all_return_base_type = true;
                    for &sig in constructors.as_slice() {
                        let return_type = self.get_return_type_of_signature(sig);
                        if !self.is_type_identical_to(return_type, base_type) {
                            all_return_base_type = false;
                            break;
                        }
                    }
                    if !all_return_base_type {
                        self.error(
                            a.expression(base_type_node),
                            diagnostics::BASE_CONSTRUCTORS_MUST_ALL_HAVE_THE_SAME_RETURN_TYPE,
                            &[],
                        );
                    }
                }
                self.check_kinds_of_property_member_overrides(class_type, base_type);
            }
        }
        self.check_members_for_override_modifier(node, class_type, type_with_this, static_type);
        let implemented_type_nodes = get_implements_heritage_clause_elements(a, node);
        for &type_ref_node in implemented_type_nodes {
            if is_expression_with_type_arguments(a, type_ref_node) {
                let expr = a.expression(type_ref_node);
                if !is_entity_name_expression(a, expr) || is_optional_chain(a, expr) {
                    self.error(expr, diagnostics::A_CLASS_CAN_ONLY_IMPLEMENT_AN_IDENTIFIER_SLASHQUALIFIED_NAME_WITH_OPTIONAL_TYPE_ARGUMENTS, &[]);
                }
            }
            self.check_type_reference_node(type_ref_node);
            let implemented_type = self.get_type_from_type_node(type_ref_node);
            let t = self.get_reduced_type(implemented_type);
            if !self.is_error_type(t) {
                if self.is_valid_base_type(t) {
                    let t_symbol = self.types[t].symbol;
                    let generic_diag = if !t_symbol.is_nil()
                        && a.sym(t_symbol).flags.intersects(SymbolFlags::CLASS)
                    {
                        diagnostics::CLASS_0_INCORRECTLY_IMPLEMENTS_CLASS_1_DID_YOU_MEAN_TO_EXTEND_1_AND_INHERIT_ITS_MEMBERS_AS_A_SUBCLASS
                    } else {
                        diagnostics::CLASS_0_INCORRECTLY_IMPLEMENTS_INTERFACE_1
                    };
                    let this_type = self.as_interface_type(class_type).this_type;
                    let base_with_this = self.get_type_with_this_argument(t, this_type, false);
                    if !self.check_type_assignable_to(
                        type_with_this,
                        base_with_this,
                        NodeId::NIL,
                        MessageId::NIL,
                    ) {
                        self.issue_member_specific_error(
                            node,
                            type_with_this,
                            base_with_this,
                            generic_diag,
                        );
                    }
                } else {
                    self.error(type_ref_node, diagnostics::A_CLASS_CAN_ONLY_IMPLEMENT_AN_OBJECT_TYPE_OR_INTERSECTION_OF_OBJECT_TYPES_WITH_STATICALLY_KNOWN_MEMBERS, &[]);
                }
            }
        }
        self.check_index_constraints(class_type, symbol, false);
        self.check_index_constraints(static_type, symbol, true);
        self.check_class_or_interface_for_duplicate_index_signatures(node);
        self.check_property_initialization(node);
    }

    pub fn check_jsdoc_augments_tag_matches_extends(
        &mut self,
        node: NodeId,
        base_type_node: NodeId,
        base_type: TypeId,
    ) {
        let a = self.ast;
        if !is_in_js_file(a, node) {
            return;
        }
        for &j in a.eager_jsdoc(node).as_slice() {
            let tags = a.as_jsdoc(j).tags;
            if tags.is_nil() {
                continue;
            }
            for &tag in a.nodes(tags).as_slice() {
                if a.kind(tag) != Kind::JSDocAugmentsTag {
                    continue;
                }
                let source_type_node = a.class_name(tag);
                let source_type = self.get_type_from_type_node(source_type_node);
                if self.is_type_identical_to(source_type, base_type) {
                    continue;
                }
                let target_name =
                    get_identifier_from_entity_name_expression(a, a.expression(base_type_node));
                let source_name =
                    get_identifier_from_entity_name_expression(a, a.expression(source_type_node));
                if !target_name.is_nil() && !source_name.is_nil() {
                    self.error(
                        source_name,
                        diagnostics::JSDOC_0_1_DOES_NOT_MATCH_THE_EXTENDS_2_CLAUSE,
                        &[
                            Arg::Str(a.text(a.tag_name(tag))),
                            Arg::Str(a.text(source_name)),
                            Arg::Str(a.text(target_name)),
                        ],
                    );
                }
            }
        }
    }

    pub fn check_class_for_static_property_name_conflicts(&mut self, node: NodeId) {
        let a = self.ast;
        if self.compiler_options.get_use_define_for_class_fields() {
            return;
        }
        for &member in a.members(node).as_slice() {
            let member_name_node = a.name(member);
            let is_static_member = is_static(a, member);
            if is_static_member && !member_name_node.is_nil() {
                let (member_name, _) =
                    self.get_effective_property_name_for_property_name_node(member_name_node);
                if matches!(
                    &member_name[..],
                    b"name" | b"length" | b"caller" | b"arguments"
                ) {
                    let class_symbol = self.get_symbol_of_declaration(node);
                    let class_name = self.symbol_to_string(class_symbol);
                    self.error(member_name_node, diagnostics::STATIC_PROPERTY_0_CONFLICTS_WITH_BUILT_IN_PROPERTY_FUNCTION_0_OF_CONSTRUCTOR_FUNCTION_1, &[Arg::Str(&member_name), Arg::Str(&class_name)]);
                }
            }
        }
    }

    // Check that type parameter lists are identical across multiple declarations
    pub fn check_type_parameter_lists_identical(&mut self, symbol: SymbolId) {
        let a = self.ast;
        if a.sym(symbol).declarations.len() == 1 {
            return;
        }
        let links = self.declared_type_links.get(symbol);
        if !self.declared_type_links[links].type_parameters_checked {
            self.declared_type_links[links].type_parameters_checked = true;
            let declarations = self.get_class_or_interface_declarations_of_symbol(symbol);
            if declarations.len() <= 1 {
                return;
            }
            let t = self.get_declared_type_of_symbol(symbol);
            let local_type_parameters = self.as_interface_type(t).local_type_parameters();
            if !self.are_type_parameters_identical(
                &declarations,
                local_type_parameters,
                &|declaration| a.type_parameters(declaration).as_slice().to_vec(),
            ) {
                // Report an error on every conflicting declaration.
                let name = self.symbol_to_string(symbol);
                for &declaration in &declarations {
                    self.error(
                        a.name(declaration),
                        diagnostics::ALL_DECLARATIONS_OF_0_MUST_HAVE_IDENTICAL_TYPE_PARAMETERS,
                        &[Arg::Str(&name)],
                    );
                }
            }
        }
    }

    pub fn get_class_or_interface_declarations_of_symbol(&self, symbol: SymbolId) -> Vec<NodeId> {
        let a = self.ast;
        a.sym(symbol)
            .declarations
            .as_slice()
            .iter()
            .copied()
            .filter(|&d| is_class_declaration(a, d) || is_interface_declaration(a, d))
            .collect()
    }

    pub fn are_type_parameters_identical(
        &mut self,
        declarations: &[NodeId],
        target_parameters: List<'a, TypeId>,
        get_type_parameter_declarations: &dyn Fn(NodeId) -> Vec<NodeId>,
    ) -> bool {
        let a = self.ast;
        let max_type_argument_count = target_parameters.len();
        let min_type_argument_count = self.get_min_type_argument_count(target_parameters);
        for &declaration in declarations {
            // If this declaration has too few or too many type parameters, we report an error
            let source_parameters = get_type_parameter_declarations(declaration);
            let source_parameter_count = source_parameters.len() as isize;
            if source_parameter_count < min_type_argument_count
                || source_parameter_count > max_type_argument_count
            {
                return false;
            }
            for (i, &source) in source_parameters.iter().enumerate() {
                let target = target_parameters.at(i);
                // If the type parameter node does not have the same name as the resolved type parameter at this position, we report an error.
                if a.text(a.name(source)) != a.sym(self.types[target].symbol).name {
                    return false;
                }
                // If the type parameter node does not have an identical constraintNode as the resolved type parameter at this position, we report an error.
                let constraint_node = a.as_type_parameter_declaration(source).constraint;
                let target_constraint = self.get_constraint_of_type_parameter(target);
                // relax check if later interface augmentation has no constraint, it's more broad and is OK to merge with a more constrained interface (this could be generalized to a full hierarchy check, but that's maybe overkill)
                if !constraint_node.is_nil() && !target_constraint.is_nil() {
                    let constraint_type = self.get_type_from_type_node(constraint_node);
                    if !self.is_type_identical_to(constraint_type, target_constraint) {
                        return false;
                    }
                }
                // If the type parameter node has a default and it is not identical to the default for the type parameter at this position, we report an error.
                let default_node = a.as_type_parameter_declaration(source).default_type;
                let target_default = self.get_default_from_type_parameter(target);
                if !default_node.is_nil() && !target_default.is_nil() {
                    let default_type = self.get_type_from_type_node(default_node);
                    if !self.is_type_identical_to(default_type, target_default) {
                        return false;
                    }
                }
            }
        }
        true
    }

    pub fn check_base_type_accessibility(&mut self, t: TypeId, node: NodeId) {
        let a = self.ast;
        let signatures = self.get_signatures_of_type(t, SignatureKind::CONSTRUCT);
        if signatures.len() != 0 {
            let first_signature = signatures.as_slice().first().copied().unwrap_or_default();
            let declaration = self.signatures[first_signature].declaration;
            if !declaration.is_nil() && has_modifier(a, declaration, ModifierFlags::PRIVATE) {
                let type_symbol = self.types[t].symbol;
                let type_class_declaration = get_class_like_declaration_of_symbol(a, type_symbol);
                if !self.is_node_within_class(node, type_class_declaration) {
                    let class_name = self.get_fully_qualified_name(type_symbol, NodeId::NIL);
                    self.error(
                        node,
                        diagnostics::CANNOT_EXTEND_A_CLASS_0_CLASS_CONSTRUCTOR_IS_MARKED_AS_PRIVATE,
                        &[Arg::Str(&class_name)],
                    );
                }
            }
        }
    }

    pub fn issue_member_specific_error(
        &mut self,
        node: NodeId,
        type_with_this: TypeId,
        base_with_this: TypeId,
        broad_diag: MessageId,
    ) {
        let a = self.ast;
        // iterate over all implemented properties and issue errors on each one which isn't compatible, rather than the class as a whole, if possible
        let mut issued_member_error = false;
        for &member in a.members(node).as_slice() {
            if is_static(a, member) {
                continue;
            }
            let declared_prop = self.get_symbol_of_declaration(member);
            if !declared_prop.is_nil() && a.sym(declared_prop).name != INTERNAL_SYMBOL_NAME_COMPUTED
            {
                let prop = self.get_property_of_type(type_with_this, a.sym(declared_prop).name);
                let base_prop =
                    self.get_property_of_type(base_with_this, a.sym(declared_prop).name);
                if !prop.is_nil() && !base_prop.is_nil() {
                    let mut diags: Vec<DiagnosticId> = Vec::new();
                    let prop_type = self.get_type_of_symbol(prop);
                    let base_prop_type = self.get_type_of_symbol(base_prop);
                    let error_node = if a.name(member).is_nil() {
                        member
                    } else {
                        a.name(member)
                    };
                    if !self.check_type_assignable_to_ex(
                        prop_type,
                        base_prop_type,
                        error_node,
                        MessageId::NIL,
                        Some(&mut diags),
                    ) {
                        // Upstream reads diags[0] without a length test: a failed check that left no diagnostic is an internal fault here.
                        match diags.first().copied() {
                            Some(first) => {
                                let prop_name = self.symbol_to_string(declared_prop);
                                let type_name = self.type_to_string_exported(type_with_this);
                                let base_name = self.type_to_string_exported(base_with_this);
                                let chain = self.diagnostic_store.new_diagnostic_chain(first, diagnostics::PROPERTY_0_IN_TYPE_1_IS_NOT_ASSIGNABLE_TO_THE_SAME_PROPERTY_IN_BASE_TYPE_2, &[Arg::Str(&prop_name), Arg::Str(&type_name), Arg::Str(&base_name)]);
                                self.add_diagnostic(chain);
                            }
                            None => self.fail("index out of range [0] with length 0"),
                        }
                        issued_member_error = true;
                    }
                }
            }
        }
        if !issued_member_error {
            // check again with diagnostics to generate a less-specific error
            let error_node = if a.name(node).is_nil() {
                node
            } else {
                a.name(node)
            };
            self.check_type_assignable_to(type_with_this, base_with_this, error_node, broad_diag);
        }
    }

    pub fn get_type_without_signatures(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return t;
        }
        if self.types[t].flags.intersects(TypeFlags::OBJECT) {
            self.resolve_structured_type_members(t);
            let resolved = self.as_structured_type(t);
            let (signature_count, members, properties) = (
                resolved.signatures.len(),
                resolved.members,
                resolved.properties,
            );
            if signature_count != 0 {
                let symbol = self.types[t].symbol;
                let result = self.new_object_type(ObjectFlags::ANONYMOUS, symbol);
                self.types[result].object_flags |= ObjectFlags::MEMBERS_RESOLVED;
                self.as_structured_type_mut(result).members = members;
                self.as_structured_type_mut(result).properties = properties;
                return result;
            }
        } else if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.as_intersection_type(t).base.types;
            let types_without_signatures =
                self.map_list(types, |c, member| c.get_type_without_signatures(member));
            return self.get_intersection_type(types_without_signatures);
        }
        t
    }

    pub fn check_kinds_of_property_member_overrides(&mut self, t: TypeId, base_type: TypeId) {
        // TypeScript 1.0 spec (April 2014): 8.2.3 A derived class inherits all members from its base class it doesn't override. Inheritance means that a derived class implicitly contains all non - overridden members of the base class. Both public and private property members are inherited, but only public property members can be overridden. A property member in a derived class is said to override a property member in a base class when the derived class property member has the same name and kind(instance or static) as the base class property member. The type of an overriding property member must be assignable(section 3.8.4) to the type of the overridden property member, or otherwise a compile - time error occurs. Base class instance member functions can be overridden by derived class instance member functions, but not by other kinds of members. Base class instance member variables and accessors can be overridden by derived class instance member variables and accessors, but not by other kinds of members. NOTE: assignability is checked in checkClassDeclaration
        struct MemberInfo {
            missed_properties: Vec<Vec<u8>>,
            base_type_name: Vec<u8>,
            type_name: Vec<u8>,
        }
        // strings.Join(core.Map(names, quote), ", ")
        fn join_quoted(names: &[Vec<u8>]) -> Vec<u8> {
            let mut joined = Vec::new();
            for (i, name) in names.iter().enumerate() {
                if i != 0 {
                    joined.extend_from_slice(b", ");
                }
                joined.push(b'\'');
                joined.extend_from_slice(name);
                joined.push(b'\'');
            }
            joined
        }
        let a = self.ast;
        // Upstream keys a map by the class declaration and ranges over it: the entries are kept in the order of their first missed property.
        let mut not_implemented_info: Vec<(NodeId, MemberInfo)> = Vec::new();
        let base_properties = self.get_properties_of_type(base_type);
        'base_property_check: for &base_property in base_properties.as_slice() {
            let base = self.get_target_symbol(base_property);
            let base_data = a.sym(base);
            if base_data.flags.intersects(SymbolFlags::PROTOTYPE) {
                continue;
            }
            let base_symbol = self.get_property_of_object_type(t, base_data.name);
            if base_symbol.is_nil() {
                continue;
            }
            let derived = self.get_target_symbol(base_symbol);
            let derived_data = a.sym(derived);
            let base_declaration_flags = get_declaration_modifier_flags_from_symbol(a, base);
            // In order to resolve whether the inherited method was overridden in the base class or not, we compare the Symbols obtained. Since getTargetSymbol returns the symbol on the *uninstantiated* type declaration, derived and base resolve to the same symbol even in the case of generic classes.
            if derived == base {
                // derived class inherits base without override/redeclaration.
                if base_declaration_flags.intersects(ModifierFlags::ABSTRACT) {
                    // It is an error to inherit an abstract member without implementing it or being declared abstract. If there is no declaration for the derived class (as in the case of class expressions), then the class cannot be declared abstract.
                    let derived_class_decl =
                        get_class_like_declaration_of_symbol(a, self.types[t].symbol);
                    if derived_class_decl.is_nil()
                        || !has_syntactic_modifier(a, derived_class_decl, ModifierFlags::ABSTRACT)
                    {
                        // Searches other base types for a declaration that would satisfy the inherited abstract member. (The class may have more than one base type via declaration merging with an interface with the same name.)
                        let other_base_types = self.get_base_types(t);
                        for &other_base_type in other_base_types.as_slice() {
                            if other_base_type == base_type {
                                continue;
                            }
                            let base_symbol =
                                self.get_property_of_object_type(other_base_type, base_data.name);
                            if !base_symbol.is_nil() && base != self.get_target_symbol(base_symbol)
                            {
                                // Derived property exists elsewhere.
                                continue 'base_property_check;
                            }
                        }
                        let base_type_name = self.type_to_string_exported(base_type);
                        let type_name = self.type_to_string_exported(t);
                        let missed_property = self.symbol_to_string(base_property);
                        match not_implemented_info
                            .iter_mut()
                            .find(|entry| entry.0 == derived_class_decl)
                        {
                            Some(entry) => {
                                entry.1.missed_properties.push(missed_property);
                                entry.1.base_type_name = base_type_name;
                                entry.1.type_name = type_name;
                            }
                            None => not_implemented_info.push((
                                derived_class_decl,
                                MemberInfo {
                                    missed_properties: vec![missed_property],
                                    base_type_name,
                                    type_name,
                                },
                            )),
                        }
                    }
                }
            } else {
                // derived overrides base.
                let derived_declaration_flags =
                    get_declaration_modifier_flags_from_symbol(a, derived);
                if base_declaration_flags.intersects(ModifierFlags::PRIVATE)
                    || derived_declaration_flags.intersects(ModifierFlags::PRIVATE)
                {
                    // either base or derived property is private - not override, skip it
                    continue;
                }
                let mut derived_error_node =
                    get_name_of_declaration(a, derived_data.value_declaration);
                if derived_error_node.is_nil() {
                    derived_error_node = derived_data.value_declaration;
                }
                let error_message: MessageId;
                let base_property_flags = base_data.flags & SymbolFlags::PROPERTY_OR_ACCESSOR;
                let derived_property_flags = derived_data.flags & SymbolFlags::PROPERTY_OR_ACCESSOR;
                if base_property_flags != SymbolFlags::NONE
                    && derived_property_flags != SymbolFlags::NONE
                {
                    // property/accessor is overridden with property/accessor
                    if base_data.check_flags.intersects(CheckFlags::MAPPED)
                        || !derived_data.value_declaration.is_nil()
                            && is_binary_expression(a, derived_data.value_declaration)
                        || self.are_properties_abstract_or_interface(base, base_declaration_flags)
                    {
                        // when the base property is abstract or from an interface, base/derived flags don't need to match; for intersection properties, this must be true of *any* of the declarations, for others it must be true of *all*; same when the derived property is from an assignment
                        continue;
                    }
                    let overridden_instance_property = base_property_flags != SymbolFlags::PROPERTY
                        && derived_property_flags == SymbolFlags::PROPERTY;
                    let overridden_instance_accessor = base_property_flags == SymbolFlags::PROPERTY
                        && derived_property_flags != SymbolFlags::PROPERTY;
                    if overridden_instance_property || overridden_instance_accessor {
                        let error_message = if overridden_instance_property {
                            diagnostics::X_0_IS_DEFINED_AS_AN_ACCESSOR_IN_CLASS_1_BUT_IS_OVERRIDDEN_HERE_IN_2_AS_AN_INSTANCE_PROPERTY
                        } else {
                            diagnostics::X_0_IS_DEFINED_AS_A_PROPERTY_IN_CLASS_1_BUT_IS_OVERRIDDEN_HERE_IN_2_AS_AN_ACCESSOR
                        };
                        let base_name = self.symbol_to_string(base);
                        let base_type_name = self.type_to_string_exported(base_type);
                        let type_name = self.type_to_string_exported(t);
                        self.error(
                            derived_error_node,
                            error_message,
                            &[
                                Arg::Str(&base_name),
                                Arg::Str(&base_type_name),
                                Arg::Str(&type_name),
                            ],
                        );
                    } else if self.compiler_options.get_use_define_for_class_fields() {
                        let uninitialized = derived_data
                            .declarations
                            .as_slice()
                            .iter()
                            .copied()
                            .find(|&d| is_property_declaration(a, d) && a.initializer(d).is_nil())
                            .unwrap_or_default();
                        if !uninitialized.is_nil()
                            && !derived_data.flags.intersects(SymbolFlags::TRANSIENT)
                            && !base_declaration_flags.intersects(ModifierFlags::ABSTRACT)
                            && !derived_declaration_flags.intersects(ModifierFlags::ABSTRACT)
                            && !derived_data
                                .declarations
                                .as_slice()
                                .iter()
                                .any(|&d| a.flags(d).intersects(NodeFlags::AMBIENT))
                        {
                            let constructor = find_constructor_declaration(
                                a,
                                get_class_like_declaration_of_symbol(a, self.types[t].symbol),
                            );
                            let prop_name = a.name(uninitialized);
                            if is_exclamation_token(a, a.postfix_token(uninitialized))
                                || constructor.is_nil()
                                || !is_identifier(a, prop_name)
                                || !self.strict_null_checks
                                || !self.is_property_initialized_in_constructor(
                                    prop_name,
                                    t,
                                    constructor,
                                )
                            {
                                let error_message = diagnostics::PROPERTY_0_WILL_OVERWRITE_THE_BASE_PROPERTY_IN_1_IF_THIS_IS_INTENTIONAL_ADD_AN_INITIALIZER_OTHERWISE_ADD_A_DECLARE_MODIFIER_OR_REMOVE_THE_REDUNDANT_DECLARATION;
                                let base_name = self.symbol_to_string(base);
                                let base_type_name = self.type_to_string_exported(base_type);
                                self.error(
                                    derived_error_node,
                                    error_message,
                                    &[Arg::Str(&base_name), Arg::Str(&base_type_name)],
                                );
                            }
                        }
                    }
                    // correct case
                    continue;
                } else if is_prototype_property(a, base) {
                    if is_prototype_property(a, derived)
                        || derived_data.flags.intersects(SymbolFlags::PROPERTY)
                    {
                        // method is overridden with method or property -- correct case
                        continue;
                    } else {
                        error_message = diagnostics::CLASS_0_DEFINES_INSTANCE_MEMBER_FUNCTION_1_BUT_EXTENDED_CLASS_2_DEFINES_IT_AS_INSTANCE_MEMBER_ACCESSOR;
                    }
                } else if base_data.flags.intersects(SymbolFlags::ACCESSOR) {
                    error_message = diagnostics::CLASS_0_DEFINES_INSTANCE_MEMBER_ACCESSOR_1_BUT_EXTENDED_CLASS_2_DEFINES_IT_AS_INSTANCE_MEMBER_FUNCTION;
                } else {
                    error_message = diagnostics::CLASS_0_DEFINES_INSTANCE_MEMBER_PROPERTY_1_BUT_EXTENDED_CLASS_2_DEFINES_IT_AS_INSTANCE_MEMBER_FUNCTION;
                }
                let base_type_name = self.type_to_string_exported(base_type);
                let base_name = self.symbol_to_string(base);
                let type_name = self.type_to_string_exported(t);
                self.error(
                    derived_error_node,
                    error_message,
                    &[
                        Arg::Str(&base_type_name),
                        Arg::Str(&base_name),
                        Arg::Str(&type_name),
                    ],
                );
            }
        }
        for (error_node, member_info) in &not_implemented_info {
            let error_node = *error_node;
            if error_node.is_nil() {
                // Upstream tests ast.IsClassExpression on the nil map key of a class without a declaration and dies there.
                let _: () =
                    self.fail("nil class declaration in checkKindsOfPropertyMemberOverrides");
                continue;
            }
            let missed_count = member_info.missed_properties.len();
            if missed_count == 1 {
                let missed_property = member_info
                    .missed_properties
                    .first()
                    .map_or(&[][..], |name| name.as_slice());
                if is_class_expression(a, error_node) {
                    self.error(error_node, diagnostics::NON_ABSTRACT_CLASS_EXPRESSION_DOES_NOT_IMPLEMENT_INHERITED_ABSTRACT_MEMBER_0_FROM_CLASS_1, &[Arg::Str(missed_property), Arg::Str(&member_info.base_type_name)]);
                } else {
                    self.error(error_node, diagnostics::NON_ABSTRACT_CLASS_0_DOES_NOT_IMPLEMENT_INHERITED_ABSTRACT_MEMBER_1_FROM_CLASS_2, &[Arg::Str(&member_info.type_name), Arg::Str(missed_property), Arg::Str(&member_info.base_type_name)]);
                }
            } else if missed_count > 5 {
                let missed_properties =
                    join_quoted(member_info.missed_properties.get(..4).unwrap_or(&[]));
                let remaining_missed_properties = missed_count - 4;
                if is_class_expression(a, error_node) {
                    self.error(error_node, diagnostics::NON_ABSTRACT_CLASS_EXPRESSION_IS_MISSING_IMPLEMENTATIONS_FOR_THE_FOLLOWING_MEMBERS_OF_0_COLON_1_AND_2_MORE, &[Arg::Str(&member_info.base_type_name), Arg::Str(&missed_properties), Arg::Int(remaining_missed_properties as i64)]);
                } else {
                    self.error(error_node, diagnostics::NON_ABSTRACT_CLASS_0_IS_MISSING_IMPLEMENTATIONS_FOR_THE_FOLLOWING_MEMBERS_OF_1_COLON_2_AND_3_MORE, &[Arg::Str(&member_info.type_name), Arg::Str(&member_info.base_type_name), Arg::Str(&missed_properties), Arg::Int(remaining_missed_properties as i64)]);
                }
            } else {
                let missed_properties = join_quoted(&member_info.missed_properties);
                if is_class_expression(a, error_node) {
                    self.error(error_node, diagnostics::NON_ABSTRACT_CLASS_EXPRESSION_IS_MISSING_IMPLEMENTATIONS_FOR_THE_FOLLOWING_MEMBERS_OF_0_COLON_1, &[Arg::Str(&member_info.base_type_name), Arg::Str(&missed_properties)]);
                } else {
                    self.error(error_node, diagnostics::NON_ABSTRACT_CLASS_0_IS_MISSING_IMPLEMENTATIONS_FOR_THE_FOLLOWING_MEMBERS_OF_1_COLON_2, &[Arg::Str(&member_info.type_name), Arg::Str(&member_info.base_type_name), Arg::Str(&missed_properties)]);
                }
            }
        }
    }

    pub fn are_properties_abstract_or_interface(
        &self,
        base: SymbolId,
        base_declaration_flags: ModifierFlags,
    ) -> bool {
        let base_data = self.ast.sym(base);
        if base_data.check_flags.intersects(CheckFlags::SYNTHETIC) {
            return base_data
                .declarations
                .as_slice()
                .iter()
                .any(|&d| self.is_property_abstract_or_interface(d, base_declaration_flags));
        }
        base_data
            .declarations
            .as_slice()
            .iter()
            .all(|&d| self.is_property_abstract_or_interface(d, base_declaration_flags))
    }

    pub fn is_property_abstract_or_interface(
        &self,
        declaration: NodeId,
        base_declaration_flags: ModifierFlags,
    ) -> bool {
        let a = self.ast;
        is_interface_declaration(a, a.parent(declaration))
            || base_declaration_flags.intersects(ModifierFlags::ABSTRACT)
                && (!is_property_declaration(a, declaration) || a.initializer(declaration).is_nil())
    }

    pub fn check_members_for_override_modifier(
        &mut self,
        node: NodeId,
        t: TypeId,
        type_with_this: TypeId,
        static_type: TypeId,
    ) {
        let a = self.ast;
        let mut base_with_this = TypeId::NIL;
        let base_type_node = get_class_extends_heritage_element(a, node);
        if !base_type_node.is_nil() {
            let base_types = self.get_base_types(t);
            if base_types.len() > 0 {
                let first_base_type = base_types.as_slice().first().copied().unwrap_or_default();
                let this_type = self.as_interface_type(t).this_type;
                base_with_this =
                    self.get_type_with_this_argument(first_base_type, this_type, false);
            }
        }
        let base_static_type = self.get_base_constructor_type_of_class(t);
        for &member in a.members(node).as_slice() {
            if !has_ambient_modifier(a, member) {
                if is_constructor_declaration(a, member) {
                    for &param in a.parameters(member).as_slice() {
                        if is_parameter_property_declaration(a, param, member) {
                            self.check_member_for_override_modifier(
                                node,
                                static_type,
                                base_static_type,
                                base_with_this,
                                t,
                                type_with_this,
                                param,
                            );
                        }
                    }
                } else {
                    self.check_member_for_override_modifier(
                        node,
                        static_type,
                        base_static_type,
                        base_with_this,
                        t,
                        type_with_this,
                        member,
                    );
                }
            }
        }
    }

    pub fn check_member_for_override_modifier(
        &mut self,
        node: NodeId,
        static_type: TypeId,
        base_static_type: TypeId,
        base_with_this: TypeId,
        t: TypeId,
        type_with_this: TypeId,
        member: NodeId,
    ) {
        let a = self.ast;
        let symbol = self.get_symbol_of_declaration(member);
        if symbol.is_nil() {
            return;
        }

        self.check_member_for_override_modifier_worker(
            node,
            static_type,
            base_static_type,
            base_with_this,
            t,
            type_with_this,
            has_override_modifier(a, member),
            has_abstract_modifier(a, member),
            is_static(a, member),
            is_parameter_declaration(a, member),
            symbol,
            member,
        );
    }

    pub fn get_member_override_modifier_status(
        &mut self,
        node: NodeId,
        member: NodeId,
        member_symbol: SymbolId,
    ) -> MemberOverrideStatus {
        let a = self.ast;
        if a.name(member).is_nil() || member_symbol.is_nil() {
            return MemberOverrideStatus::NONE;
        }

        let class_symbol = self.get_symbol_of_declaration(node);
        if class_symbol.is_nil() {
            return MemberOverrideStatus::NONE;
        }

        let t = self.get_declared_type_of_symbol(class_symbol);
        let type_with_this = self.get_type_with_this_argument(t, TypeId::NIL, false);
        let static_type = self.get_type_of_symbol(class_symbol);

        let mut base_with_this = TypeId::NIL;
        if !get_class_extends_heritage_element(a, node).is_nil() {
            let base_types = self.get_base_types(t);
            if base_types.len() > 0 {
                let first_base_type = base_types.as_slice().first().copied().unwrap_or_default();
                let this_type = self.as_interface_type(t).this_type;
                base_with_this =
                    self.get_type_with_this_argument(first_base_type, this_type, false);
            }
        }

        let base_static_type = self.get_base_constructor_type_of_class(t);
        self.check_member_for_override_modifier_worker(
            node,
            static_type,
            base_static_type,
            base_with_this,
            t,
            type_with_this,
            has_syntactic_modifier(a, member, ModifierFlags::OVERRIDE),
            has_abstract_modifier(a, member),
            is_static(a, member),
            false,
            member_symbol,
            NodeId::NIL,
        )
    }

    pub fn check_member_for_override_modifier_worker(
        &mut self,
        node: NodeId,
        static_type: TypeId,
        base_static_type: TypeId,
        base_with_this: TypeId,
        t: TypeId,
        type_with_this: TypeId,
        member_has_override_modifier: bool,
        member_has_abstract_modifier: bool,
        member_is_static: bool,
        member_is_parameter_property: bool,
        member: SymbolId,
        error_node: NodeId,
    ) -> MemberOverrideStatus {
        let a = self.ast;
        let is_js = is_in_js_file(a, node);
        let member_data = a.sym(member);
        if member_has_override_modifier
            && !member_data.value_declaration.is_nil()
            && is_class_element(a, member_data.value_declaration)
            && !a.name(member_data.value_declaration).is_nil()
            && self.is_non_bindable_dynamic_name(a.name(member_data.value_declaration))
        {
            if !error_node.is_nil() {
                self.error(
                    error_node,
                    if is_js {
                        diagnostics::THIS_MEMBER_CANNOT_HAVE_A_JSDOC_COMMENT_WITH_AN_OVERRIDE_TAG_BECAUSE_ITS_NAME_IS_DYNAMIC
                    } else {
                        diagnostics::THIS_MEMBER_CANNOT_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_ITS_NAME_IS_DYNAMIC
                    },
                    &[],
                );
            }
            return MemberOverrideStatus::HAS_INVALID_OVERRIDE;
        }

        if !base_with_this.is_nil()
            && (member_has_override_modifier
                || self.compiler_options.no_implicit_override.is_true())
        {
            let this_type = if member_is_static {
                static_type
            } else {
                type_with_this
            };
            let base_type = if member_is_static {
                base_static_type
            } else {
                base_with_this
            };
            let prop = self.get_property_of_type(this_type, member_data.name);
            let base_prop = self.get_property_of_type(base_type, member_data.name);

            if !prop.is_nil() && base_prop.is_nil() && member_has_override_modifier {
                if !error_node.is_nil() {
                    let suggestion = self.get_suggested_symbol_for_nonexistent_class_member(
                        symbol_name(a, member),
                        base_type,
                    );
                    if !suggestion.is_nil() {
                        let base_name = self.type_to_string_exported(base_with_this);
                        let suggestion_name = self.symbol_to_string(suggestion);
                        self.error(
                            error_node,
                            if is_js {
                                diagnostics::THIS_MEMBER_CANNOT_HAVE_A_JSDOC_COMMENT_WITH_AN_OVERRIDE_TAG_BECAUSE_IT_IS_NOT_DECLARED_IN_THE_BASE_CLASS_0_DID_YOU_MEAN_1
                            } else {
                                diagnostics::THIS_MEMBER_CANNOT_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_IT_IS_NOT_DECLARED_IN_THE_BASE_CLASS_0_DID_YOU_MEAN_1
                            },
                            &[Arg::Str(&base_name), Arg::Str(&suggestion_name)],
                        );
                    } else {
                        let base_name = self.type_to_string_exported(base_with_this);
                        self.error(
                            error_node,
                            if is_js {
                                diagnostics::THIS_MEMBER_CANNOT_HAVE_A_JSDOC_COMMENT_WITH_AN_OVERRIDE_TAG_BECAUSE_IT_IS_NOT_DECLARED_IN_THE_BASE_CLASS_0
                            } else {
                                diagnostics::THIS_MEMBER_CANNOT_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_IT_IS_NOT_DECLARED_IN_THE_BASE_CLASS_0
                            },
                            &[Arg::Str(&base_name)],
                        );
                    }
                }
                return MemberOverrideStatus::HAS_INVALID_OVERRIDE;
            }

            if !prop.is_nil()
                && !base_prop.is_nil()
                && a.sym(base_prop).declarations.len() > 0
                && self.compiler_options.no_implicit_override.is_true()
                && !a.flags(node).intersects(NodeFlags::AMBIENT)
            {
                let base_has_abstract = a
                    .sym(base_prop)
                    .declarations
                    .as_slice()
                    .iter()
                    .any(|&declaration| has_abstract_modifier(a, declaration));
                if member_has_override_modifier {
                    return MemberOverrideStatus::NONE;
                }
                if !base_has_abstract {
                    if !error_node.is_nil() {
                        let message = if member_is_parameter_property {
                            if is_js {
                                diagnostics::THIS_PARAMETER_PROPERTY_MUST_HAVE_A_JSDOC_COMMENT_WITH_AN_OVERRIDE_TAG_BECAUSE_IT_OVERRIDES_A_MEMBER_IN_THE_BASE_CLASS_0
                            } else {
                                diagnostics::THIS_PARAMETER_PROPERTY_MUST_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_IT_OVERRIDES_A_MEMBER_IN_BASE_CLASS_0
                            }
                        } else if is_js {
                            diagnostics::THIS_MEMBER_MUST_HAVE_A_JSDOC_COMMENT_WITH_AN_OVERRIDE_TAG_BECAUSE_IT_OVERRIDES_A_MEMBER_IN_THE_BASE_CLASS_0
                        } else {
                            diagnostics::THIS_MEMBER_MUST_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_IT_OVERRIDES_A_MEMBER_IN_THE_BASE_CLASS_0
                        };
                        let base_name = self.type_to_string_exported(base_with_this);
                        self.error(error_node, message, &[Arg::Str(&base_name)]);
                    }
                    return MemberOverrideStatus::NEEDS_OVERRIDE;
                }
                if member_has_abstract_modifier {
                    if !error_node.is_nil() {
                        let base_name = self.type_to_string_exported(base_with_this);
                        self.error(error_node, diagnostics::THIS_MEMBER_MUST_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_IT_OVERRIDES_AN_ABSTRACT_METHOD_THAT_IS_DECLARED_IN_THE_BASE_CLASS_0, &[Arg::Str(&base_name)]);
                    }
                    return MemberOverrideStatus::NEEDS_OVERRIDE;
                }
            }
        } else if member_has_override_modifier {
            if !error_node.is_nil() {
                let class_name = self.type_to_string_exported(t);
                self.error(
                    error_node,
                    if is_js {
                        diagnostics::THIS_MEMBER_CANNOT_HAVE_A_JSDOC_COMMENT_WITH_AN_OVERRIDE_TAG_BECAUSE_ITS_CONTAINING_CLASS_0_DOES_NOT_EXTEND_ANOTHER_CLASS
                    } else {
                        diagnostics::THIS_MEMBER_CANNOT_HAVE_AN_OVERRIDE_MODIFIER_BECAUSE_ITS_CONTAINING_CLASS_0_DOES_NOT_EXTEND_ANOTHER_CLASS
                    },
                    &[Arg::Str(&class_name)],
                );
            }
            return MemberOverrideStatus::HAS_INVALID_OVERRIDE;
        }

        MemberOverrideStatus::NONE
    }

    pub fn get_suggested_symbol_for_nonexistent_class_member(
        &mut self,
        name: &[u8],
        base_type: TypeId,
    ) -> SymbolId {
        let properties = self.get_properties_of_type(base_type);
        self.get_spelling_suggestion_for_name(
            name,
            properties.as_slice(),
            SymbolFlags::CLASS_MEMBER,
        )
    }

    pub fn check_index_constraints(&mut self, t: TypeId, symbol: SymbolId, is_static_index: bool) {
        let a = self.ast;
        let index_infos = self.get_index_infos_of_type(t);
        if index_infos.len() == 0 {
            return;
        }
        let properties = self.get_properties_of_object_type(t);
        for &prop in properties.as_slice() {
            if !(is_static_index && a.sym(prop).flags.intersects(SymbolFlags::PROTOTYPE)) {
                let prop_name_type = self.get_literal_type_from_property(
                    prop,
                    TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                    true,
                );
                let prop_type = self.get_non_missing_type_of_symbol(prop);
                self.check_index_constraint_for_property(t, prop, prop_name_type, prop_type);
            }
        }
        let type_declaration = a.sym(symbol).value_declaration;
        if !type_declaration.is_nil() && is_class_like(a, type_declaration) {
            for &member in a.members(type_declaration).as_slice() {
                // Only process instance properties against instance index signatures and static properties against static index signatures
                if is_static(a, member) == is_static_index && !self.has_bindable_name(member) {
                    let symbol = self.get_symbol_of_declaration(member);
                    let prop_name_type = self.get_type_of_expression(a.expression(a.name(member)));
                    let prop_type = self.get_non_missing_type_of_symbol(symbol);
                    self.check_index_constraint_for_property(t, symbol, prop_name_type, prop_type);
                }
            }
        }
        if index_infos.len() > 1 {
            for &info in index_infos.as_slice() {
                self.check_index_constraint_for_index_signature(t, info);
            }
        }
    }

    pub fn check_index_constraint_for_property(
        &mut self,
        t: TypeId,
        prop: SymbolId,
        prop_name_type: TypeId,
        prop_type: TypeId,
    ) {
        let a = self.ast;
        let declaration = a.sym(prop).value_declaration;
        let name = get_name_of_declaration(a, declaration);
        if !name.is_nil() && is_private_identifier(a, name) {
            return;
        }
        let index_infos = self.get_applicable_index_infos(t, prop_name_type);
        if index_infos.len() == 0 {
            return;
        }
        let type_symbol = self.types[t].symbol;
        let mut interface_declaration = NodeId::NIL;
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::INTERFACE)
        {
            interface_declaration =
                get_declaration_of_kind(a, type_symbol, Kind::InterfaceDeclaration);
        }
        let mut prop_declaration = NodeId::NIL;
        if !declaration.is_nil() && is_binary_expression(a, declaration)
            || !name.is_nil() && is_computed_property_name(a, name)
        {
            prop_declaration = declaration;
        }
        let mut local_prop_declaration = NodeId::NIL;
        if self.get_parent_of_symbol(prop) == type_symbol {
            local_prop_declaration = declaration;
        }
        for &info in index_infos.as_slice() {
            let info_declaration = self.index_infos[info].declaration;
            let info_key_type = self.index_infos[info].key_type;
            let info_value_type = self.index_infos[info].value_type;
            let mut local_index_declaration = NodeId::NIL;
            if !info_declaration.is_nil() {
                let info_symbol = self.get_symbol_of_declaration(info_declaration);
                if self.get_parent_of_symbol(info_symbol) == type_symbol {
                    local_index_declaration = info_declaration;
                }
            }
            // We check only when (a) the property is declared in the containing type, or (b) the applicable index signature is declared in the containing type, or (c) the containing type is an interface and no base interface contains both the property and the index signature (i.e. property and index signature are declared in separate inherited interfaces).
            let mut error_node = if local_prop_declaration.is_nil() {
                local_index_declaration
            } else {
                local_prop_declaration
            };
            if error_node.is_nil() && !interface_declaration.is_nil() {
                let base_types = self.get_base_types(t);
                let mut some_base_has_both = false;
                for &base in base_types.as_slice() {
                    if !self
                        .get_property_of_object_type(base, a.sym(prop).name)
                        .is_nil()
                        && !self.get_index_type_of_type(base, info_key_type).is_nil()
                    {
                        some_base_has_both = true;
                        break;
                    }
                }
                if !some_base_has_both {
                    error_node = interface_declaration;
                }
            }
            if !error_node.is_nil() && !self.is_type_assignable_to(prop_type, info_value_type) {
                let prop_name = self.symbol_to_string(prop);
                let prop_type_name = self.type_to_string_exported(prop_type);
                let key_type_name = self.type_to_string_exported(info_key_type);
                let value_type_name = self.type_to_string_exported(info_value_type);
                let diagnostic = self.new_diagnostic_for_node(
                    error_node,
                    diagnostics::PROPERTY_0_OF_TYPE_1_IS_NOT_ASSIGNABLE_TO_2_INDEX_TYPE_3,
                    &[
                        Arg::Str(&prop_name),
                        Arg::Str(&prop_type_name),
                        Arg::Str(&key_type_name),
                        Arg::Str(&value_type_name),
                    ],
                );
                if !prop_declaration.is_nil() && error_node != prop_declaration {
                    let declared_name = self.symbol_to_string(prop);
                    let related = self.new_diagnostic_for_node(
                        prop_declaration,
                        diagnostics::X_0_IS_DECLARED_HERE,
                        &[Arg::Str(&declared_name)],
                    );
                    self.diagnostic_store.add_related_info(diagnostic, related);
                }
                self.add_diagnostic(diagnostic);
            }
        }
    }

    pub fn check_index_constraint_for_index_signature(
        &mut self,
        t: TypeId,
        check_info: IndexInfoId,
    ) {
        let a = self.ast;
        let declaration = self.index_infos[check_info].declaration;
        let check_key_type = self.index_infos[check_info].key_type;
        let check_value_type = self.index_infos[check_info].value_type;
        let index_infos = self.get_applicable_index_infos(t, check_key_type);
        if index_infos.len() == 0 {
            return;
        }
        let type_symbol = self.types[t].symbol;
        let mut interface_declaration = NodeId::NIL;
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::INTERFACE)
        {
            interface_declaration =
                get_declaration_of_kind(a, type_symbol, Kind::InterfaceDeclaration);
        }
        let mut local_check_declaration = NodeId::NIL;
        if !declaration.is_nil() {
            let declaration_symbol = self.get_symbol_of_declaration(declaration);
            if self.get_parent_of_symbol(declaration_symbol) == type_symbol {
                local_check_declaration = declaration;
            }
        }
        for &info in index_infos.as_slice() {
            if info == check_info {
                continue;
            }
            let info_declaration = self.index_infos[info].declaration;
            let info_key_type = self.index_infos[info].key_type;
            let info_value_type = self.index_infos[info].value_type;
            let mut local_index_declaration = NodeId::NIL;
            if !info_declaration.is_nil() {
                let info_symbol = self.get_symbol_of_declaration(info_declaration);
                if self.get_parent_of_symbol(info_symbol) == type_symbol {
                    local_index_declaration = info_declaration;
                }
            }
            // We check only when (a) the check index signature is declared in the containing type, or (b) the applicable index signature is declared in the containing type, or (c) the containing type is an interface and no base interface contains both index signatures (i.e. the index signatures are declared in separate inherited interfaces).
            let mut error_node = if local_check_declaration.is_nil() {
                local_index_declaration
            } else {
                local_check_declaration
            };
            if error_node.is_nil() && !interface_declaration.is_nil() {
                let base_types = self.get_base_types(t);
                let mut some_base_has_both = false;
                for &base in base_types.as_slice() {
                    if !self.get_index_info_of_type(base, check_key_type).is_nil()
                        && !self.get_index_type_of_type(base, info_key_type).is_nil()
                    {
                        some_base_has_both = true;
                        break;
                    }
                }
                if !some_base_has_both {
                    error_node = interface_declaration;
                }
            }
            if !error_node.is_nil()
                && !self.is_type_assignable_to(check_value_type, info_value_type)
            {
                let check_key_name = self.type_to_string_exported(check_key_type);
                let check_value_name = self.type_to_string_exported(check_value_type);
                let key_type_name = self.type_to_string_exported(info_key_type);
                let value_type_name = self.type_to_string_exported(info_value_type);
                self.error(
                    error_node,
                    diagnostics::X_0_INDEX_TYPE_1_IS_NOT_ASSIGNABLE_TO_2_INDEX_TYPE_3,
                    &[
                        Arg::Str(&check_key_name),
                        Arg::Str(&check_value_name),
                        Arg::Str(&key_type_name),
                        Arg::Str(&value_type_name),
                    ],
                );
            }
        }
    }

    pub fn check_class_or_interface_for_duplicate_index_signatures(&mut self, node: NodeId) {
        // Only check the type once
        let symbol = self.get_symbol_of_declaration(node);
        let links = self.declared_type_links.get(symbol);
        if !self.declared_type_links[links].index_signatures_checked {
            self.declared_type_links[links].index_signatures_checked = true;
            self.check_type_for_duplicate_index_signatures(node);
        }
    }

    pub fn check_type_for_duplicate_index_signatures(&mut self, node: NodeId) {
        let a = self.ast;
        // TypeScript 1.0 spec (April 2014) 3.7.4: An object type can contain at most one string index signature and one numeric index signature. 8.5: A class declaration can have at most one string index member declaration and one numeric index member declaration
        let symbol = self.get_symbol_of_declaration(node);
        let index_symbol = self.get_index_symbol(symbol);
        if index_symbol.is_nil() || a.sym(index_symbol).declarations.len() <= 1 {
            return;
        }
        // Upstream keys a map by the type and ranges over it: the entries are kept in the order of their first declaration.
        let mut index_signature_map: Vec<(TypeId, Vec<NodeId>)> = Vec::new();
        for &declaration in a.sym(index_symbol).declarations.as_slice() {
            if is_index_signature_declaration(a, declaration) {
                let parameters = a.parameters(declaration);
                if parameters.len() == 1 && !a.type_node(parameters.at(0usize)).is_nil() {
                    let parameter_type =
                        self.get_type_from_type_node(a.type_node(parameters.at(0usize)));
                    for &t in self.type_distributed(parameter_type).as_slice() {
                        match index_signature_map.iter_mut().find(|entry| entry.0 == t) {
                            Some(entry) => entry.1.push(declaration),
                            None => index_signature_map.push((t, vec![declaration])),
                        }
                    }
                }
            }
            // Do nothing for late-bound index signatures: allow these to duplicate one another and explicit indexes
        }
        for (t, declarations) in &index_signature_map {
            if declarations.len() > 1 {
                for &declaration in declarations {
                    let type_name = self.type_to_string_exported(*t);
                    self.error(
                        declaration,
                        diagnostics::DUPLICATE_INDEX_SIGNATURE_FOR_TYPE_0,
                        &[Arg::Str(&type_name)],
                    );
                }
            }
        }
    }

    pub fn check_property_initialization(&mut self, node: NodeId) {
        let a = self.ast;
        if !self.strict_null_checks
            || !self.strict_property_initialization
            || a.flags(node).intersects(NodeFlags::AMBIENT)
        {
            return;
        }
        let constructor = find_constructor_declaration(a, node);
        for &member in a.members(node).as_slice() {
            if a.modifier_flags(member).intersects(ModifierFlags::AMBIENT) {
                continue;
            }
            if !is_static(a, member) && self.is_property_without_initializer(member) {
                let prop_name = a.name(member);
                if is_identifier(a, prop_name)
                    || is_private_identifier(a, prop_name)
                    || is_computed_property_name(a, prop_name)
                {
                    let member_symbol = self.get_symbol_of_declaration(member);
                    let t = self.get_type_of_symbol(member_symbol);
                    if !(self.types[t].flags.intersects(TypeFlags::ANY_OR_UNKNOWN)
                        || self.contains_undefined_type(t))
                    {
                        if constructor.is_nil()
                            || !self.is_property_initialized_in_constructor(
                                prop_name,
                                t,
                                constructor,
                            )
                        {
                            let name = declaration_name_to_string(a, prop_name);
                            self.error(a.name(member), diagnostics::PROPERTY_0_HAS_NO_INITIALIZER_AND_IS_NOT_DEFINITELY_ASSIGNED_IN_THE_CONSTRUCTOR, &[Arg::Str(&name)]);
                        }
                    }
                }
            }
        }
    }

    pub fn is_property_without_initializer(&self, node: NodeId) -> bool {
        let a = self.ast;
        is_property_declaration(a, node)
            && !has_abstract_modifier(a, node)
            && !is_exclamation_token(a, a.postfix_token(node))
            && a.initializer(node).is_nil()
    }

    pub fn is_property_initialized_in_static_blocks(
        &mut self,
        prop_name: NodeId,
        prop_type: TypeId,
        static_blocks: &[NodeId],
        start_pos: i32,
        end_pos: i32,
    ) -> bool {
        let a = self.ast;
        for &static_block in static_blocks {
            // static block must be within the provided range as they are evaluated in document order (unlike constructors)
            if a.pos(static_block) >= start_pos && a.pos(static_block) <= end_pos {
                let mut factory = Factory::new(a);
                let this_keyword = factory.new_keyword_expression(Kind::ThisKeyword);
                let reference = factory.new_property_access_expression(
                    this_keyword,
                    NodeId::NIL,
                    prop_name,
                    NodeFlags::NONE,
                );
                a.set_parent(a.expression(reference), reference);
                a.set_parent(reference, static_block);
                a.set_flow_node(
                    reference,
                    a.as_class_static_block_declaration(static_block)
                        .return_flow_node,
                );
                let initial_type = self.get_optional_type(prop_type, false);
                let flow_type = self.get_flow_type_of_reference_ex(
                    reference,
                    prop_type,
                    initial_type,
                    NodeId::NIL,
                    FlowNodeId::NIL,
                );
                if !self.contains_undefined_type(flow_type) {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_property_initialized_in_constructor(
        &mut self,
        prop_name: NodeId,
        prop_type: TypeId,
        constructor: NodeId,
    ) -> bool {
        let a = self.ast;
        let mut factory = Factory::new(a);
        let this_keyword = factory.new_keyword_expression(Kind::ThisKeyword);
        let reference = if is_computed_property_name(a, prop_name) {
            factory.new_element_access_expression(
                this_keyword,
                NodeId::NIL,
                a.expression(prop_name),
                NodeFlags::NONE,
            )
        } else {
            factory.new_property_access_expression(
                this_keyword,
                NodeId::NIL,
                prop_name,
                NodeFlags::NONE,
            )
        };
        a.set_parent(a.expression(reference), reference);
        a.set_parent(reference, constructor);
        a.set_flow_node(
            reference,
            a.as_constructor_declaration(constructor).return_flow_node,
        );
        let initial_type = self.get_optional_type(prop_type, false);
        let flow_type = self.get_flow_type_of_reference_ex(
            reference,
            prop_type,
            initial_type,
            NodeId::NIL,
            FlowNodeId::NIL,
        );
        !self.contains_undefined_type(flow_type)
    }

    pub fn check_interface_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        if !self.check_grammar_modifiers(node) {
            self.check_grammar_interface_declaration(node);
        }
        if !self.container_allows_block_scoped_variable(a.parent(node)) {
            self.grammar_error_on_node(
                node,
                diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_DECLARED_INSIDE_A_BLOCK,
                &[Arg::Str(b"interface")],
            );
        }
        self.check_type_parameters(a.type_parameters(node));
        self.check_type_name_is_reserved(a.name(node), diagnostics::INTERFACE_NAME_CANNOT_BE_0);
        self.check_exports_on_merged_declarations(node);
        let symbol = self.get_symbol_of_declaration(node);
        self.check_type_parameter_lists_identical(symbol);
        // Only check this symbol once
        let links = self.declared_type_links.get(symbol);
        if !self.declared_type_links[links].interface_checked {
            self.declared_type_links[links].interface_checked = true;
            let t = self.get_declared_type_of_symbol(symbol);
            let type_with_this = self.get_type_with_this_argument(t, TypeId::NIL, false);
            // run subsequent checks only if first set succeeded
            if self.check_inherited_properties_are_identical(t, a.name(node)) {
                let base_types = self.get_base_types(t);
                for &base_type in base_types.as_slice() {
                    let this_type = self.as_interface_type(t).this_type;
                    let base_with_this =
                        self.get_type_with_this_argument(base_type, this_type, false);
                    self.check_type_assignable_to(
                        type_with_this,
                        base_with_this,
                        a.name(node),
                        diagnostics::INTERFACE_0_INCORRECTLY_EXTENDS_INTERFACE_1,
                    );
                }
                self.check_index_constraints(t, symbol, false);
            }
        }
        self.check_object_type_for_duplicate_declarations(node, false);
        for &heritage_element in get_extends_heritage_clause_elements(a, node) {
            if is_expression_with_type_arguments(a, heritage_element) {
                let expr = a.expression(heritage_element);
                if !is_entity_name_expression(a, expr) || is_optional_chain(a, expr) {
                    self.error(expr, diagnostics::AN_INTERFACE_CAN_ONLY_EXTEND_AN_IDENTIFIER_SLASHQUALIFIED_NAME_WITH_OPTIONAL_TYPE_ARGUMENTS, &[]);
                }
            }
            self.check_type_reference_node(heritage_element);
        }
        self.check_source_elements(a.members(node));
        self.check_class_or_interface_for_duplicate_index_signatures(node);
        self.register_for_unused_identifiers_check(node);
    }

    pub fn check_inherited_properties_are_identical(
        &mut self,
        t: TypeId,
        type_node: NodeId,
    ) -> bool {
        let a = self.ast;
        let base_types = self.get_base_types(t);
        if base_types.len() < 2 {
            return true;
        }
        let mut seen: Map<Text<'a>, InheritanceInfo> = Map::make();
        self.resolve_declared_members(t);
        let declared_members = self.as_interface_type(t).declared_members;
        let mut position = 0;
        while let Some((id, p)) = a.table_entry_at(declared_members, position) {
            position += 1;
            if self.is_named_member(p, id) {
                let _ = seen.set(
                    a.sym(p).name,
                    InheritanceInfo {
                        prop: p,
                        containing_type: t,
                    },
                );
            }
        }
        let mut identical = true;
        for &base in base_types.as_slice() {
            let this_type = self.as_interface_type(t).this_type;
            let base_with_this = self.get_type_with_this_argument(base, this_type, false);
            let properties = self.get_properties_of_type(base_with_this);
            for &prop in properties.as_slice() {
                let prop_name = a.sym(prop).name;
                match seen.get_ok(&prop_name) {
                    None => {
                        let _ = seen.set(
                            prop_name,
                            InheritanceInfo {
                                prop,
                                containing_type: base,
                            },
                        );
                    }
                    Some(existing) => {
                        let is_inherited_property = existing.containing_type != t;
                        if is_inherited_property
                            && !self.is_property_identical_to(existing.prop, prop)
                        {
                            identical = false;
                            let type_name1 = self.type_to_string_exported(existing.containing_type);
                            let type_name2 = self.type_to_string_exported(base);
                            let prop_display_name = self.symbol_to_string(prop);
                            let error_info = self.new_diagnostic_for_node(
                                type_node,
                                diagnostics::NAMED_PROPERTY_0_OF_TYPES_1_AND_2_ARE_NOT_IDENTICAL,
                                &[
                                    Arg::Str(&prop_display_name),
                                    Arg::Str(&type_name1),
                                    Arg::Str(&type_name2),
                                ],
                            );
                            let interface_name = self.type_to_string_exported(t);
                            let chain = self.diagnostic_store.new_diagnostic_chain(
                                error_info,
                                diagnostics::INTERFACE_0_CANNOT_SIMULTANEOUSLY_EXTEND_TYPES_1_AND_2,
                                &[
                                    Arg::Str(&interface_name),
                                    Arg::Str(&type_name1),
                                    Arg::Str(&type_name2),
                                ],
                            );
                            self.add_diagnostic(chain);
                        }
                    }
                }
            }
        }
        identical
    }

    pub fn is_property_identical_to(
        &mut self,
        source_prop: SymbolId,
        target_prop: SymbolId,
    ) -> bool {
        self.compare_properties(
            source_prop,
            target_prop,
            &mut Checker::compare_types_identical,
        ) != Ternary::FALSE
    }
}
