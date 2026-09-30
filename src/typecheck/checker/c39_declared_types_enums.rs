// checker.go:23878-24223 (layers T-DECLARED, T-ENUMVAL): outer and local type parameters, declared types of type parameters, type aliases, enums and aliases, and the values of enum members.
use crate::ast::{
    Arg, Kind, NodeFlags, NodeId, SymbolFlags, SymbolId, get_source_file_of_node,
    get_text_of_property_name, has_dynamic_name, is_big_int_literal, is_computed_non_literal_name,
    is_entity_name_expression, is_enum_const, is_infinity_or_nan_string, is_object_literal_method,
    is_string_literal_like, is_type_or_js_type_alias_declaration, is_variable_declaration,
};
use crate::checker::{
    Checker, LiteralValue, NodeCheckFlags, SignatureKind, TypeAlias, TypeFlags, TypeId,
    TypeSystemEntity, TypeSystemPropertyName, UnionReduction, get_type_list_key,
    is_numeric_literal_name, is_type_alias,
};
use crate::core::{List, Map};
use crate::diagnostics::{self, MessageId};
use crate::evaluator;
use crate::jsnum::{Number, from_string};

// `append(list, items...)`: the list itself when nothing is appended, so that nil stays nil.
fn append_types<'a>(c: &Checker<'a>, list: List<'a, TypeId>, items: &[TypeId]) -> List<'a, TypeId> {
    if items.is_empty() {
        return list;
    }
    let mut result: Vec<TypeId> = list.as_slice().to_vec();
    result.extend_from_slice(items);
    c.list_of(&result)
}

impl<'a> Checker<'a> {
    // Return the outer type parameters of a node or undefined if the node has no outer type parameters.
    pub fn get_outer_type_parameters(
        &mut self,
        node: NodeId,
        include_this_types: bool,
    ) -> List<'a, TypeId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let mut node = node;
        loop {
            node = a.parent(node);
            if node.is_nil() {
                return List::NIL;
            }
            let kind = a.kind(node);
            match kind {
                Kind::ClassDeclaration
                | Kind::ClassExpression
                | Kind::InterfaceDeclaration
                | Kind::CallSignature
                | Kind::ConstructSignature
                | Kind::MethodSignature
                | Kind::FunctionType
                | Kind::ConstructorType
                | Kind::FunctionDeclaration
                | Kind::MethodDeclaration
                | Kind::FunctionExpression
                | Kind::ArrowFunction
                | Kind::TypeAliasDeclaration
                | Kind::JSTypeAliasDeclaration
                | Kind::MappedType
                | Kind::ConditionalType => {
                    let outer_type_parameters =
                        self.get_outer_type_parameters(node, include_this_types);
                    if (kind == Kind::FunctionExpression
                        || kind == Kind::ArrowFunction
                        || is_object_literal_method(a, node))
                        && self.is_context_sensitive(node)
                    {
                        let symbol = self.get_symbol_of_declaration(node);
                        let function_type = self.get_type_of_symbol(symbol);
                        let signatures =
                            self.get_signatures_of_type(function_type, SignatureKind::CALL);
                        if let Some(&signature) = signatures.as_slice().first() {
                            let type_parameters = self.signatures[signature].type_parameters;
                            if !signature.is_nil() && !type_parameters.as_slice().is_empty() {
                                return append_types(
                                    self,
                                    outer_type_parameters,
                                    type_parameters.as_slice(),
                                );
                            }
                        }
                    }
                    if kind == Kind::MappedType {
                        let symbol = self
                            .get_symbol_of_declaration(a.as_mapped_type_node(node).type_parameter);
                        let type_parameter = self.get_declared_type_of_type_parameter(symbol);
                        return append_types(self, outer_type_parameters, &[type_parameter]);
                    }
                    if kind == Kind::ConditionalType {
                        let infer_type_parameters = self.get_infer_type_parameters(node);
                        return append_types(
                            self,
                            outer_type_parameters,
                            infer_type_parameters.as_slice(),
                        );
                    }
                    let outer_and_own_type_parameters =
                        self.append_type_parameters(outer_type_parameters, a.type_parameters(node));
                    let mut this_type = TypeId::NIL;
                    if include_this_types
                        && (kind == Kind::ClassDeclaration
                            || kind == Kind::ClassExpression
                            || kind == Kind::InterfaceDeclaration)
                    {
                        let symbol = self.get_symbol_of_declaration(node);
                        let declared_type = self.get_declared_type_of_class_or_interface(symbol);
                        this_type = self.as_interface_type(declared_type).this_type;
                    }
                    if !this_type.is_nil() {
                        return append_types(self, outer_and_own_type_parameters, &[this_type]);
                    }
                    return outer_and_own_type_parameters;
                }
                _ => {}
            }
        }
    }

    pub fn get_infer_type_parameters(&mut self, node: NodeId) -> List<'a, TypeId> {
        let a = self.ast;
        let locals = a.locals(node);
        let mut result: Vec<TypeId> = Vec::new();
        // Upstream ranges over a map: the table is read in insertion order, which is declaration order.
        let mut position = 0;
        while let Some((_, symbol)) = a.table_entry_at(locals, position) {
            if a.sym(symbol).flags.intersects(SymbolFlags::TYPE_PARAMETER) {
                let type_parameter = self.get_declared_type_of_symbol(symbol);
                result.push(type_parameter);
            }
            position += 1;
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    // The local type parameters are the combined set of type parameters from all declarations of the class, interface, or type alias.
    pub fn get_local_type_parameters_of_class_or_interface_or_type_alias(
        &mut self,
        symbol: SymbolId,
    ) -> List<'a, TypeId> {
        self.append_local_type_parameters_of_class_or_interface_or_type_alias(List::NIL, symbol)
    }

    pub fn append_local_type_parameters_of_class_or_interface_or_type_alias(
        &mut self,
        types: List<'a, TypeId>,
        symbol: SymbolId,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let mut types = types;
        for &node in a.sym(symbol).declarations.as_slice() {
            if matches!(
                a.kind(node),
                Kind::InterfaceDeclaration | Kind::ClassDeclaration | Kind::ClassExpression
            ) || is_type_alias(a, node)
            {
                types = self.append_type_parameters(types, a.type_parameters(node));
            }
        }
        types
    }

    // Appends the type parameters given by a list of declarations to a set of type parameters and returns the resulting set. Upstream allocates a new array if the input set is undefined and otherwise modifies the set in place: here the input list is returned when nothing is appended and a new list otherwise.
    pub fn append_type_parameters(
        &mut self,
        type_parameters: List<'a, TypeId>,
        declarations: List<'_, NodeId>,
    ) -> List<'a, TypeId> {
        let mut result: Vec<TypeId> = type_parameters.as_slice().to_vec();
        let mut appended = false;
        for &declaration in declarations.as_slice() {
            let symbol = self.get_symbol_of_declaration(declaration);
            let type_parameter = self.get_declared_type_of_type_parameter(symbol);
            if !result.contains(&type_parameter) {
                result.push(type_parameter);
                appended = true;
            }
        }
        if !appended {
            return type_parameters;
        }
        self.list_of(&result)
    }

    pub fn get_declared_type_of_type_parameter(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.declared_type_links.get(symbol);
        if self.declared_type_links[links].declared_type.is_nil() {
            let t = self.new_type_parameter(symbol);
            self.declared_type_links[links].declared_type = t;
        }
        self.declared_type_links[links].declared_type
    }

    pub fn get_declared_type_of_type_alias(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let links = self.type_alias_links.get(symbol);
        if self.type_alias_links[links].declared_type.is_nil() {
            // Note that we use the links object as the target here because the symbol object is used as the unique identity for resolution of the 'type' property in SymbolLinks.
            if !self.push_type_resolution(
                TypeSystemEntity::Symbol(symbol),
                TypeSystemPropertyName::DeclaredType,
            ) {
                return self.error_type;
            }
            let declarations = a.sym(symbol).declarations;
            let declaration = declarations
                .as_slice()
                .iter()
                .find(|&&d| is_type_or_js_type_alias_declaration(a, d))
                .copied()
                .unwrap_or(NodeId::NIL);
            let type_node = a.type_node(declaration);
            let mut t = self.get_type_from_type_node(type_node);
            if self.pop_type_resolution() {
                let type_parameters =
                    self.get_local_type_parameters_of_class_or_interface_or_type_alias(symbol);
                if !type_parameters.as_slice().is_empty() {
                    // Initialize the instantiation cache for generic type aliases. The declared type corresponds to an instantiation of the type alias with the type parameters supplied as type arguments.
                    self.type_alias_links[links].type_parameters = type_parameters;
                    self.type_alias_links[links].instantiations = Map::make();
                    let key = get_type_list_key(type_parameters);
                    let ok = self.type_alias_links[links].instantiations.set(key, t);
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
                    diagnostics::TYPE_ALIAS_0_CIRCULARLY_REFERENCES_ITSELF,
                    &[Arg::Str(&name)],
                );
                t = self.error_type;
            }
            if self.type_alias_links[links].declared_type.is_nil() {
                self.type_alias_links[links].declared_type = t;
            }
        }
        self.type_alias_links[links].declared_type
    }

    pub fn get_declared_type_of_enum(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let links = self.declared_type_links.get(symbol);
        if self.declared_type_links[links].declared_type.is_nil() {
            let mut member_type_list: Vec<TypeId> = Vec::new();
            for &declaration in a.sym(symbol).declarations.as_slice() {
                if a.kind(declaration) == Kind::EnumDeclaration {
                    for &member in a.members(declaration).as_slice() {
                        if !has_dynamic_name(a, member) {
                            let member_symbol = self.get_symbol_of_declaration(member);
                            let value = self.get_enum_member_value(member).value;
                            let member_type = if !matches!(value, LiteralValue::Nil) {
                                self.get_enum_literal_type(value, symbol, member_symbol)
                            } else {
                                self.create_computed_enum_type(member_symbol)
                            };
                            let member_links = self.declared_type_links.get(member_symbol);
                            let fresh_type = self.get_fresh_type_of_literal_type(member_type);
                            self.declared_type_links[member_links].declared_type = fresh_type;
                            member_type_list.push(member_type);
                        }
                    }
                }
            }
            let enum_type = if !member_type_list.is_empty() {
                let alias = self.type_aliases.alloc(TypeAlias {
                    symbol,
                    type_arguments: List::NIL,
                });
                self.get_union_type_ex(
                    List::from_slice(&member_type_list),
                    UnionReduction::LITERAL,
                    alias,
                    TypeId::NIL,
                )
            } else {
                self.create_computed_enum_type(symbol)
            };
            if self.types[enum_type].flags.intersects(TypeFlags::UNION) {
                self.types[enum_type].flags |= TypeFlags::ENUM_LITERAL;
                self.types[enum_type].symbol = symbol;
            }
            self.declared_type_links[links].declared_type = enum_type;
        }
        self.declared_type_links[links].declared_type
    }

    pub fn get_enum_member_value(&mut self, node: NodeId) -> evaluator::Result<'a> {
        let parent = self.ast.parent(node);
        self.compute_enum_member_values(parent);
        let links = self.enum_member_links.get(node);
        self.enum_member_links[links].value.clone()
    }

    pub fn create_computed_enum_type(&mut self, symbol: SymbolId) -> TypeId {
        let regular_type = self.new_literal_type(TypeFlags::ENUM, LiteralValue::Nil, TypeId::NIL);
        self.types[regular_type].symbol = symbol;
        let fresh_type = self.new_literal_type(TypeFlags::ENUM, LiteralValue::Nil, regular_type);
        self.types[fresh_type].symbol = symbol;
        self.as_literal_type_mut(regular_type).fresh_type = fresh_type;
        self.as_literal_type_mut(fresh_type).fresh_type = fresh_type;
        regular_type
    }

    pub fn get_declared_type_of_enum_member(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.declared_type_links.get(symbol);
        if self.declared_type_links[links].declared_type.is_nil() {
            let parent = self.get_parent_of_symbol(symbol);
            let enum_type = self.get_declared_type_of_enum(parent);
            if self.declared_type_links[links].declared_type.is_nil() {
                self.declared_type_links[links].declared_type = enum_type;
            }
        }
        self.declared_type_links[links].declared_type
    }

    pub fn compute_enum_member_values(&mut self, node: NodeId) {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let node_links = self.node_links.get(node);
        if !self.node_links[node_links]
            .flags
            .intersects(NodeCheckFlags::ENUM_VALUES_COMPUTED)
        {
            self.node_links[node_links].flags |= NodeCheckFlags::ENUM_VALUES_COMPUTED;
            // The auto value is an optional number: a number after a numeric member, nothing after any other member.
            let mut auto_value: Option<Number> = Some(Number(0.0));
            let mut previous = NodeId::NIL;
            for &member in a.members(node).as_slice() {
                let result = self.compute_enum_member_value(member, auto_value, previous);
                auto_value = match result.value {
                    LiteralValue::Number(value) => Some(Number(value + 1.0)),
                    _ => None,
                };
                let links = self.enum_member_links.get(member);
                self.enum_member_links[links].value = result;
                previous = member;
            }
        }
    }

    pub fn compute_enum_member_value(
        &mut self,
        member: NodeId,
        auto_value: Option<Number>,
        previous: NodeId,
    ) -> evaluator::Result<'a> {
        let a = self.ast;
        let name = a.name(member);
        if is_computed_non_literal_name(a, name) {
            self.error(
                name,
                diagnostics::COMPUTED_PROPERTY_NAMES_ARE_NOT_ALLOWED_IN_ENUMS,
                &[],
            );
        } else if is_big_int_literal(a, name) {
            self.error(
                name,
                diagnostics::AN_ENUM_MEMBER_CANNOT_HAVE_A_NUMERIC_NAME,
                &[],
            );
        } else {
            let text = get_text_of_property_name(a, name);
            if is_numeric_literal_name(text) && !is_infinity_or_nan_string(text) {
                self.error(
                    name,
                    diagnostics::AN_ENUM_MEMBER_CANNOT_HAVE_A_NUMERIC_NAME,
                    &[],
                );
            }
        }
        if !a.initializer(member).is_nil() {
            return self.compute_constant_enum_member_value(member);
        }
        // In ambient non-const numeric enum declarations, enum members without initializers are considered computed members (as opposed to having auto-incremented values).
        let parent = a.parent(member);
        if a.flags(parent).intersects(NodeFlags::AMBIENT) && !is_enum_const(a, parent) {
            return evaluator::new_result(LiteralValue::Nil, false, false, false);
        }
        // If the member declaration specifies no value, the member is considered a constant enum member. If the member is the first member in the enum declaration, it is assigned the value zero. Otherwise, it is assigned the value of the immediately preceding member plus one, and an error occurs if the immediately preceding member is not a constant enum member.
        let Some(auto_value) = auto_value else {
            self.error(name, diagnostics::ENUM_MEMBER_MUST_HAVE_INITIALIZER, &[]);
            return evaluator::new_result(LiteralValue::Nil, false, false, false);
        };
        if self.compiler_options.get_isolated_modules()
            && !previous.is_nil()
            && !a.initializer(previous).is_nil()
        {
            let prev_value = self.get_enum_member_value(previous);
            let prev_is_num = matches!(prev_value.value, LiteralValue::Number(_));
            if !prev_is_num || prev_value.resolved_other_files {
                self.error(
                    name,
                    diagnostics::ENUM_MEMBER_FOLLOWING_A_NON_LITERAL_NUMERIC_MEMBER_MUST_HAVE_AN_INITIALIZER_WHEN_ISOLATEDMODULES_IS_ENABLED,
                    &[],
                );
            }
        }
        evaluator::new_result(LiteralValue::Number(auto_value.0), false, false, false)
    }

    pub fn compute_constant_enum_member_value(&mut self, member: NodeId) -> evaluator::Result<'a> {
        let a = self.ast;
        let parent = a.parent(member);
        let is_const_enum = is_enum_const(a, parent);
        let initializer = a.initializer(member);
        let result = self.evaluate(initializer, member);
        if !matches!(result.value, LiteralValue::Nil) {
            if is_const_enum {
                if let LiteralValue::Number(num_value) = result.value {
                    if num_value.is_infinite() || num_value.is_nan() {
                        let message = if num_value.is_nan() {
                            diagnostics::X_CONST_ENUM_MEMBER_INITIALIZER_WAS_EVALUATED_TO_DISALLOWED_VALUE_NAN
                        } else {
                            diagnostics::X_CONST_ENUM_MEMBER_INITIALIZER_WAS_EVALUATED_TO_A_NON_FINITE_VALUE
                        };
                        self.error(initializer, message, &[]);
                    }
                }
            }
            if self.compiler_options.get_isolated_modules() {
                if matches!(result.value, LiteralValue::String(_))
                    && !result.is_syntactically_string
                {
                    let mut member_name: Vec<u8> = a.text(a.name(parent)).to_vec();
                    member_name.push(b'.');
                    member_name.extend_from_slice(a.text(a.name(member)));
                    self.error(
                        initializer,
                        diagnostics::X_0_HAS_A_STRING_TYPE_BUT_MUST_HAVE_SYNTACTICALLY_RECOGNIZABLE_STRING_SYNTAX_WHEN_ISOLATEDMODULES_IS_ENABLED,
                        &[Arg::Str(&member_name)],
                    );
                }
            }
        } else if is_const_enum {
            self.error(
                initializer,
                diagnostics::X_CONST_ENUM_MEMBER_INITIALIZERS_MUST_BE_CONSTANT_EXPRESSIONS,
                &[],
            );
        } else if a.flags(parent).intersects(NodeFlags::AMBIENT) {
            self.error(
                initializer,
                diagnostics::IN_AMBIENT_ENUM_DECLARATIONS_MEMBER_INITIALIZER_MUST_BE_CONSTANT_EXPRESSION,
                &[],
            );
        } else {
            let initializer_type = self.check_expression(initializer);
            let number_type = self.number_type;
            self.check_type_assignable_to(
                initializer_type,
                number_type,
                initializer,
                diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_AS_REQUIRED_FOR_COMPUTED_ENUM_MEMBER_VALUES,
            );
        }
        result
    }

    pub fn evaluate_entity(&mut self, expr: NodeId, location: NodeId) -> evaluator::Result<'a> {
        let a = self.ast;
        match a.kind(expr) {
            Kind::Identifier | Kind::PropertyAccessExpression => {
                let symbol =
                    self.resolve_entity_name(expr, SymbolFlags::VALUE, true, false, NodeId::NIL);
                if symbol.is_nil() {
                    return evaluator::new_result(LiteralValue::Nil, false, false, false);
                }
                if a.kind(expr) == Kind::Identifier {
                    let text = a.text(expr);
                    if is_infinity_or_nan_string(text)
                        && symbol
                            == self.get_global_symbol(text, SymbolFlags::VALUE, MessageId::NIL)
                    {
                        // Technically we resolved a global lib file here, but the decision to treat this as numeric is more predicated on the fact that the single-file resolution *didn't* resolve to a different meaning of `Infinity` or `NaN`. Transpilers handle this no problem.
                        return evaluator::new_result(
                            LiteralValue::Number(from_string(text).0),
                            false,
                            false,
                            false,
                        );
                    }
                }
                if a.sym(symbol).flags.intersects(SymbolFlags::ENUM_MEMBER) {
                    if !location.is_nil() {
                        return self.evaluate_enum_member(expr, symbol, location);
                    }
                    return self.get_enum_member_value(a.sym(symbol).value_declaration);
                }
                if self.is_constant_variable(symbol) {
                    let declaration = a.sym(symbol).value_declaration;
                    if !declaration.is_nil()
                        && is_variable_declaration(a, declaration)
                        && a.type_node(declaration).is_nil()
                        && !a.initializer(declaration).is_nil()
                        && (location.is_nil()
                            || declaration != location
                                && self.is_block_scoped_name_declared_before_use(
                                    declaration,
                                    location,
                                ))
                    {
                        let result = self.evaluate(a.initializer(declaration), declaration);
                        if !location.is_nil()
                            && get_source_file_of_node(a, location)
                                != get_source_file_of_node(a, declaration)
                        {
                            return evaluator::new_result(result.value, false, true, true);
                        }
                        return evaluator::new_result(
                            result.value,
                            result.is_syntactically_string,
                            result.resolved_other_files,
                            true,
                        );
                    }
                }
                evaluator::new_result(LiteralValue::Nil, false, false, false)
            }
            Kind::ElementAccessExpression => {
                let root = a.expression(expr);
                let argument = a.as_element_access_expression(expr).argument_expression;
                if is_entity_name_expression(a, root) && is_string_literal_like(a, argument) {
                    let root_symbol = self.resolve_entity_name(
                        root,
                        SymbolFlags::VALUE,
                        true,
                        false,
                        NodeId::NIL,
                    );
                    if !root_symbol.is_nil()
                        && a.sym(root_symbol).flags.intersects(SymbolFlags::ENUM)
                    {
                        let name = a.text(argument);
                        let member = a.table_get(a.sym(root_symbol).exports, name);
                        if !member.is_nil() {
                            if !location.is_nil() {
                                return self.evaluate_enum_member(expr, member, location);
                            }
                            return self.get_enum_member_value(a.sym(member).value_declaration);
                        }
                    }
                }
                evaluator::new_result(LiteralValue::Nil, false, false, false)
            }
            _ => {
                let _: () = self.fail("Unhandled case in evaluateEntity");
                evaluator::new_result(LiteralValue::Nil, false, false, false)
            }
        }
    }

    pub fn evaluate_enum_member(
        &mut self,
        expr: NodeId,
        symbol: SymbolId,
        location: NodeId,
    ) -> evaluator::Result<'a> {
        let a = self.ast;
        let declaration = a.sym(symbol).value_declaration;
        if declaration.is_nil() || declaration == location {
            let name = self.symbol_to_string(symbol);
            self.error(
                expr,
                diagnostics::PROPERTY_0_IS_USED_BEFORE_BEING_ASSIGNED,
                &[Arg::Str(&name)],
            );
            return evaluator::new_result(LiteralValue::Nil, false, false, false);
        }
        if !self.is_block_scoped_name_declared_before_use(declaration, location) {
            self.error(
                expr,
                diagnostics::A_MEMBER_INITIALIZER_IN_A_ENUM_DECLARATION_CANNOT_REFERENCE_MEMBERS_DECLARED_AFTER_IT_INCLUDING_MEMBERS_DEFINED_IN_OTHER_ENUMS,
                &[],
            );
            return evaluator::new_result(LiteralValue::Number(0.0), false, false, false);
        }
        let value = self.get_enum_member_value(declaration);
        if a.parent(location) != a.parent(declaration) {
            return evaluator::new_result(
                value.value,
                value.is_syntactically_string,
                value.resolved_other_files,
                true,
            );
        }
        value
    }

    pub fn get_declared_type_of_alias(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.declared_type_links.get(symbol);
        if self.declared_type_links[links].declared_type.is_nil() {
            let target = self.resolve_alias(symbol);
            let t = self.get_declared_type_of_symbol(target);
            self.declared_type_links[links].declared_type = t;
        }
        self.declared_type_links[links].declared_type
    }
}
