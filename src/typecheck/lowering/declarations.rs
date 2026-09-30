// Functions, classes, their members, parameters and binding patterns.
use super::{
    Lowerer, Lowering, PC_BLOCK_STATEMENTS, PC_SOURCE_ELEMENTS, PC_SWITCH_CLAUSE_STATEMENTS,
};
use crate::ast::{Kind, ModifierListId, NodeFactory, NodeFlags, NodeId, NodeListId};
use bun_ast::{ArrayBinding, B, Binding, Expr, ExprData, G, Stmt};

// The function of a property that is a method or an accessor.
pub(super) fn method_function(property: &G::Property) -> Option<&G::Fn> {
    match property.value.as_ref().map(|value| &value.data) {
        Some(ExprData::EFunction(function))
            if property.flags.contains(bun_ast::flags::Property::IsMethod) =>
        {
            Some(&function.func)
        }
        _ => None,
    }
}

impl<'t> Lowerer<'t, '_> {
    // parseDecorator
    pub(super) fn lower_decorator(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::AtToken)?;
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::DECORATOR_CONTEXT, true);
        let expression = self.lower_assignment_expression(expr);
        self.context_flags = save_context_flags;
        let node = self.b.new_decorator(expression?);
        Ok(self.finish(node, pos))
    }

    // parseModifiersEx where only decorators can stand: before a parameter and before a class expression.
    pub(super) fn lower_decorators(
        &mut self,
        pos: i32,
        decorators: &'t [Expr],
    ) -> Lowering<ModifierListId> {
        if decorators.is_empty() {
            return Ok(ModifierListId::NIL);
        }
        let mut list: Vec<NodeId> = Vec::with_capacity(decorators.len());
        for decorator in decorators {
            list.push(self.lower_decorator(decorator)?);
        }
        let end = self.node_pos();
        Ok(self.new_modifier_list(pos, end, &list))
    }

    // parseFunctionExpression
    pub(super) fn lower_function_expression(&mut self, func: &'t G::Fn) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::DECORATOR_CONTEXT, false);
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let is_async = func.flags.contains(bun_ast::flags::Function::IsAsync);
        // parseModifiers
        let modifiers = if is_async {
            if self.token != Kind::AsyncKeyword {
                return Err(self.out_of_step("the `async` of a function expression"));
            }
            let modifier = self.parse_token_node();
            let end = self.node_pos();
            self.new_modifier_list(pos, end, &[modifier])
        } else {
            ModifierListId::NIL
        };
        self.expect(Kind::FunctionKeyword)?;
        let asterisk_token = self.optional_token_node(Kind::AsteriskToken);
        let is_generator = !asterisk_token.is_nil();
        let mut name = NodeId::NIL;
        if func.name.is_some() {
            // parseOptionalBindingIdentifier, in the [Yield] and [Await] contexts of the function
            let save_name_context_flags = self.context_flags;
            if is_generator {
                self.context_flags |= NodeFlags::YIELD_CONTEXT;
            }
            if is_async {
                self.context_flags |= NodeFlags::AWAIT_CONTEXT;
            }
            let identifier = self.parse_binding_identifier();
            self.context_flags = save_name_context_flags;
            name = identifier?;
        }
        let parameters = self.lower_parameters(is_generator, is_async, func.args.slice())?;
        let body = self.lower_function_block(is_generator, is_async, func.body.stmts.slice())?;
        self.context_flags = save_context_flags;
        let result = self.b.new_function_expression(
            modifiers,
            asterisk_token,
            name,
            NodeListId::NIL,
            parameters,
            NodeId::NIL,
            NodeId::NIL,
            body,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseParameters
    pub(super) fn lower_parameters(
        &mut self,
        is_generator: bool,
        is_async: bool,
        args: &'t [G::Arg],
    ) -> Lowering<NodeListId> {
        self.expect(Kind::OpenParenToken)?;
        let parameters = self.lower_parameters_worker(is_generator, is_async, args)?;
        self.expect(Kind::CloseParenToken)?;
        Ok(parameters)
    }

    // parseParametersWorker
    pub(super) fn lower_parameters_worker(
        &mut self,
        is_generator: bool,
        is_async: bool,
        args: &'t [G::Arg],
    ) -> Lowering<NodeListId> {
        let in_await_context = self.in_await_context();
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::YIELD_CONTEXT, is_generator);
        self.set_context_flags(NodeFlags::AWAIT_CONTEXT, is_async);
        let parameters = self.lower_delimited(args, Some(Kind::CloseParenToken), |this, arg| {
            this.lower_parameter(in_await_context, arg)
        });
        self.context_flags = save_context_flags;
        parameters
    }

    // parseParameterEx
    fn lower_parameter(
        &mut self,
        in_outer_await_context: bool,
        arg: &'t G::Arg,
    ) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        // Decorators are parsed in the outer [Await] context, the rest of the parameter is parsed in the function's [Await] context.
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::AWAIT_CONTEXT, in_outer_await_context);
        let modifiers = self.lower_decorators(pos, arg.ts_decorators.as_slice());
        self.context_flags = save_context_flags;
        let modifiers = modifiers?;
        let dot_dot_dot_token = self.optional_token_node(Kind::DotDotDotToken);
        let name = self.lower_identifier_or_pattern(&arg.binding)?;
        let initializer = self.lower_initializer(arg.default.as_ref())?;
        let result = self.b.new_parameter_declaration(
            modifiers,
            dot_dot_dot_token,
            name,
            NodeId::NIL,
            NodeId::NIL,
            initializer,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseInitializer
    pub(super) fn lower_initializer(&mut self, value: Option<&'t Expr>) -> Lowering<NodeId> {
        if self.token == Kind::EqualsToken {
            let Some(value) = value else {
                return Err(self.out_of_step("an initializer that is not in the tree"));
            };
            self.next_token();
            return self.lower_assignment_expression(value);
        }
        if value.is_some() {
            return Err(self.out_of_step("an initializer of the tree has no `=`"));
        }
        Ok(NodeId::NIL)
    }

    // parseIdentifierOrPattern
    pub(super) fn lower_identifier_or_pattern(&mut self, binding: &'t Binding) -> Lowering<NodeId> {
        self.check_stack()?;
        match &binding.data {
            B::B::BArray(array) => {
                // parseArrayBindingPattern
                let pos = self.node_pos();
                self.expect(Kind::OpenBracketToken)?;
                let save_context_flags = self.context_flags;
                self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, false);
                let elements = self.lower_delimited(
                    array.items.slice(),
                    Some(Kind::CloseBracketToken),
                    |this, item| this.lower_array_binding_element(item),
                );
                self.context_flags = save_context_flags;
                let elements = elements?;
                self.expect(Kind::CloseBracketToken)?;
                let node = self
                    .b
                    .new_binding_pattern(Kind::ArrayBindingPattern, elements);
                Ok(self.finish(node, pos))
            }
            B::B::BObject(object) => {
                // parseObjectBindingPattern
                let pos = self.node_pos();
                self.expect(Kind::OpenBraceToken)?;
                let save_context_flags = self.context_flags;
                self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, false);
                let elements = self.lower_delimited(
                    object.properties.slice(),
                    Some(Kind::CloseBraceToken),
                    |this, property| this.lower_object_binding_element(property),
                );
                self.context_flags = save_context_flags;
                let elements = elements?;
                self.expect(Kind::CloseBraceToken)?;
                let node = self
                    .b
                    .new_binding_pattern(Kind::ObjectBindingPattern, elements);
                Ok(self.finish(node, pos))
            }
            B::B::BIdentifier(_) => self.parse_binding_identifier(),
            B::B::BMissing(_) => Err(self.out_of_step("a binding of the tree is missing")),
        }
    }

    // parseArrayBindingElement
    fn lower_array_binding_element(&mut self, item: &'t ArrayBinding) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let mut dot_dot_dot_token = NodeId::NIL;
        let mut name = NodeId::NIL;
        let mut initializer = NodeId::NIL;
        if self.token != Kind::CommaToken {
            // These are all nil for a missing element
            dot_dot_dot_token = self.optional_token_node(Kind::DotDotDotToken);
            name = self.lower_identifier_or_pattern(&item.binding)?;
            initializer = self.lower_initializer(item.default_value.as_ref())?;
        } else if !matches!(item.binding.data, B::B::BMissing(_)) {
            return Err(self.out_of_step("an element of an array pattern"));
        }
        let node = self
            .b
            .new_binding_element(dot_dot_dot_token, NodeId::NIL, name, initializer);
        Ok(self.finish(node, pos))
    }

    // parseObjectBindingElement
    fn lower_object_binding_element(&mut self, property: &'t B::Property) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let dot_dot_dot_token = self.optional_token_node(Kind::DotDotDotToken);
        let token_is_identifier = self.is_binding_identifier();
        let mut property_name = self.lower_property_name_with(Some(&property.key))?;
        let name;
        if token_is_identifier && self.token != Kind::ColonToken {
            name = property_name;
            property_name = NodeId::NIL;
        } else {
            self.expect(Kind::ColonToken)?;
            name = self.lower_identifier_or_pattern(&property.value)?;
        }
        let initializer = self.lower_initializer(property.default_value.as_ref())?;
        let node = self
            .b
            .new_binding_element(dot_dot_dot_token, property_name, name, initializer);
        Ok(self.finish(node, pos))
    }

    // parsePropertyName
    pub(super) fn lower_property_name(&mut self, property: &'t G::Property) -> Lowering<NodeId> {
        self.lower_property_name_with(property.key.as_ref())
    }

    // parsePropertyNameWorker: only a computed name needs the tree.
    fn lower_property_name_with(&mut self, key: Option<&'t Expr>) -> Lowering<NodeId> {
        let save_has_await_identifier = self.statement_has_await_identifier;
        let node = match self.token {
            Kind::StringLiteral | Kind::NumericLiteral | Kind::BigIntLiteral => {
                self.parse_literal_expression()?
            }
            Kind::OpenBracketToken => {
                // parseComputedPropertyName: any expression (including a comma expression), the grammar checker reports the comma.
                let pos = self.node_pos();
                self.next_token();
                let Some(key) = key else {
                    return Err(self.out_of_step("a computed name that is not in the tree"));
                };
                let expression = self.lower_expression_allow_in(key)?;
                self.expect(Kind::CloseBracketToken)?;
                let node = self.b.new_computed_property_name(expression);
                self.finish(node, pos)
            }
            Kind::PrivateIdentifier => self.parse_private_identifier()?,
            _ => self.create_identifier()?,
        };
        self.statement_has_await_identifier = save_has_await_identifier;
        Ok(node)
    }

    // parseMethodDeclaration
    pub(super) fn lower_method_declaration(
        &mut self,
        pos: i32,
        jsdoc: u8,
        modifiers: ModifierListId,
        asterisk_token: NodeId,
        name: NodeId,
        func: &'t G::Fn,
    ) -> Lowering<NodeId> {
        let is_generator = !asterisk_token.is_nil();
        let is_async = func.flags.contains(bun_ast::flags::Function::IsAsync);
        let parameters = self.lower_parameters(is_generator, is_async, func.args.slice())?;
        let body = self.lower_function_block(is_generator, is_async, func.body.stmts.slice())?;
        let result = self.b.new_method_declaration(
            modifiers,
            asterisk_token,
            name,
            NodeId::NIL,
            NodeListId::NIL,
            parameters,
            NodeId::NIL,
            NodeId::NIL,
            body,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseAccessorDeclaration, from the `get` or the `set` that parseContextualModifier reads
    pub(super) fn lower_accessor_declaration(
        &mut self,
        pos: i32,
        jsdoc: u8,
        modifiers: ModifierListId,
        property: &'t G::Property,
        func: &'t G::Fn,
    ) -> Lowering<NodeId> {
        let is_get = property.kind == G::PropertyKind::Get;
        self.expect(if is_get {
            Kind::GetKeyword
        } else {
            Kind::SetKeyword
        })?;
        let name = self.lower_property_name(property)?;
        let parameters = self.lower_parameters(false, false, func.args.slice())?;
        let body = self.lower_function_block(false, false, func.body.stmts.slice())?;
        let result = if is_get {
            self.b.new_get_accessor_declaration(
                modifiers,
                name,
                NodeListId::NIL,
                parameters,
                NodeId::NIL,
                NodeId::NIL,
                body,
            )
        } else {
            self.b.new_set_accessor_declaration(
                modifiers,
                name,
                NodeListId::NIL,
                parameters,
                NodeId::NIL,
                NodeId::NIL,
                body,
            )
        };
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseFunctionBlock
    pub(super) fn lower_function_block(
        &mut self,
        is_generator: bool,
        is_async: bool,
        stmts: &'t [Stmt],
    ) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        let save_has_await_identifier = self.statement_has_await_identifier;
        self.set_context_flags(NodeFlags::YIELD_CONTEXT, is_generator);
        self.set_context_flags(NodeFlags::AWAIT_CONTEXT, is_async);
        // We may be in a [Decorator] context when parsing a function expression or arrow function. The body of the function is not in [Decorator] context.
        self.set_context_flags(NodeFlags::DECORATOR_CONTEXT, false);
        let block = self.lower_block(stmts);
        self.context_flags = save_context_flags;
        self.statement_has_await_identifier = save_has_await_identifier;
        block
    }

    // parsePrimaryExpression at `class` and parseDecoratedExpression
    pub(super) fn lower_class_expression(&mut self, class: &'t G::Class) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let modifiers = self.lower_decorators(pos, class.ts_decorators.as_slice())?;
        self.lower_class(pos, jsdoc, modifiers, class, false, false)
    }

    // parseClassDeclarationOrExpression
    pub(super) fn lower_class(
        &mut self,
        pos: i32,
        jsdoc: u8,
        modifiers: ModifierListId,
        class: &'t G::Class,
        is_declaration: bool,
        has_export_modifier: bool,
    ) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        self.expect(Kind::ClassKeyword)?;
        // We don't parse the name here in await context, instead we will report a grammar error in the checker.
        let name = if class.class_name.is_some() {
            self.parse_binding_identifier()?
        } else {
            NodeId::NIL
        };
        if has_export_modifier
            && self.parsing_contexts & PC_SOURCE_ELEMENTS != 0
            && self.parsing_contexts & (PC_BLOCK_STATEMENTS | PC_SWITCH_CLAUSE_STATEMENTS) == 0
        {
            self.set_context_flags(NodeFlags::AWAIT_CONTEXT, true);
        }
        let heritage_clauses = self.lower_heritage_clauses(class)?;
        // ClassTail[Yield,Await] : ClassHeritage[?Yield,?Await]opt { ClassBody[?Yield,?Await]opt }
        self.expect(Kind::OpenBraceToken)?;
        let members = self.lower_class_members(class.properties.slice())?;
        self.expect(Kind::CloseBraceToken)?;
        self.context_flags = save_context_flags;
        let result = if is_declaration {
            self.b.new_class_declaration(
                modifiers,
                name,
                NodeListId::NIL,
                heritage_clauses,
                members,
            )
        } else {
            self.b
                .new_class_expression(modifiers, name, NodeListId::NIL, heritage_clauses, members)
        };
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseHeritageClauses: a class of Bun's JavaScript parse has `extends` with one expression, or nothing.
    fn lower_heritage_clauses(&mut self, class: &'t G::Class) -> Lowering<NodeListId> {
        let Some(extends) = class.extends.as_ref() else {
            return Ok(NodeListId::NIL);
        };
        if self.token != Kind::ExtendsKeyword {
            return Err(self.out_of_step("the `extends` of a class"));
        }
        let list_pos = self.node_pos();
        // parseHeritageClause
        let clause_pos = self.node_pos();
        self.next_token();
        let types_pos = self.node_pos();
        // parseExpressionWithTypeArguments
        let element_pos = self.node_pos();
        let expression = self.lower_assignment_expression(extends)?;
        let element = self
            .b
            .new_expression_with_type_arguments(expression, NodeListId::NIL);
        self.finish(element, element_pos);
        let types_end = self.node_pos();
        let types = self.new_list(types_pos, types_end, &[element]);
        let clause = self.b.new_heritage_clause(Kind::ExtendsKeyword, types);
        self.finish(clause, clause_pos);
        let list_end = self.node_pos();
        Ok(self.new_list(list_pos, list_end, &[clause]))
    }

    // parseList(PCClassMembers, parseClassElement): Bun keeps no member for a `;`.
    fn lower_class_members(&mut self, properties: &'t [G::Property]) -> Lowering<NodeListId> {
        let pos = self.node_pos();
        let mut nodes: Vec<NodeId> = Vec::with_capacity(properties.len());
        let mut next = properties.iter();
        while self.token != Kind::CloseBraceToken && self.token != Kind::EndOfFile {
            if self.token == Kind::SemicolonToken {
                let member_pos = self.node_pos();
                let jsdoc = self.jsdoc_scanner_info();
                self.next_token();
                let result = self.b.new_semicolon_class_element();
                self.finish(result, member_pos);
                self.with_jsdoc(result, jsdoc);
                nodes.push(result);
                continue;
            }
            let Some(property) = next.next() else {
                return Err(self.out_of_step("a class member that is not in the tree"));
            };
            nodes.push(self.lower_class_element(property)?);
        }
        if next.next().is_some() {
            return Err(self.out_of_step("a class member of the tree after the end of the class"));
        }
        let end = self.node_pos();
        Ok(self.new_list(pos, end, &nodes))
    }

    // parseClassElement
    fn lower_class_element(&mut self, property: &'t G::Property) -> Lowering<NodeId> {
        self.check_stack()?;
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let function = method_function(property);
        let static_block = property.class_static_block_ref();
        let is_static = property.flags.contains(bun_ast::flags::Property::IsStatic);
        let is_async =
            function.is_some_and(|func| func.flags.contains(bun_ast::flags::Function::IsAsync));
        let is_accessor = property.kind == G::PropertyKind::AutoAccessor;

        // parseModifiersEx: a keyword is a modifier where Bun's property says that the member is what the keyword makes it.
        let mut list: Vec<NodeId> = Vec::new();
        let mut decorators = property.ts_decorators.as_slice().iter();
        let mut seen_static = false;
        let mut seen_async = false;
        let mut seen_accessor = false;
        loop {
            let modifier = match self.token {
                Kind::AtToken => {
                    let Some(decorator) = decorators.next() else {
                        return Err(self.out_of_step("a decorator that is not in the tree"));
                    };
                    self.lower_decorator(decorator)?
                }
                Kind::StaticKeyword if is_static && !seen_static => {
                    seen_static = true;
                    self.parse_token_node()
                }
                Kind::AsyncKeyword if is_async && !seen_async => {
                    seen_async = true;
                    self.parse_token_node()
                }
                Kind::AccessorKeyword if is_accessor && !seen_accessor => {
                    seen_accessor = true;
                    self.parse_token_node()
                }
                _ => break,
            };
            list.push(modifier);
        }
        if decorators.next().is_some() {
            return Err(self.out_of_step("a decorator of the tree is not at its place"));
        }
        let modifiers = if list.is_empty() {
            ModifierListId::NIL
        } else {
            let end = self.node_pos();
            self.new_modifier_list(pos, end, &list)
        };

        if let Some(block) = static_block {
            // parseClassStaticBlockDeclaration and parseClassStaticBlockBody
            self.expect(Kind::StaticKeyword)?;
            let save_context_flags = self.context_flags;
            self.set_context_flags(NodeFlags::YIELD_CONTEXT, false);
            self.set_context_flags(NodeFlags::AWAIT_CONTEXT, true);
            let body = self.lower_block(block.stmts.as_slice());
            self.context_flags = save_context_flags;
            let result = self.b.new_class_static_block_declaration(modifiers, body?);
            self.finish(result, pos);
            self.with_jsdoc(result, jsdoc);
            return Ok(result);
        }
        if property.kind == G::PropertyKind::Get || property.kind == G::PropertyKind::Set {
            let Some(func) = function else {
                return Err(self.out_of_step("an accessor of the tree has no function"));
            };
            return self.lower_accessor_declaration(pos, jsdoc, modifiers, property, func);
        }
        // tryParseConstructorDeclaration
        if self.token == Kind::ConstructorKeyword
            || self.token == Kind::StringLiteral
                && self.scanner.token_value() == b"constructor"
                && self.look_ahead(|this| this.next_token() == Kind::OpenParenToken)
        {
            let Some(func) = function else {
                return Err(self.out_of_step("a constructor of the tree has no function"));
            };
            self.next_token();
            let parameters = self.lower_parameters(false, false, func.args.slice())?;
            let body = self.lower_function_block(false, false, func.body.stmts.slice())?;
            let result = self.b.new_constructor_declaration(
                modifiers,
                NodeListId::NIL,
                parameters,
                NodeId::NIL,
                NodeId::NIL,
                body,
            );
            self.finish(result, pos);
            self.with_jsdoc(result, jsdoc);
            return Ok(result);
        }
        // parsePropertyOrMethodDeclaration
        let asterisk_token = self.optional_token_node(Kind::AsteriskToken);
        let name = self.lower_property_name(property)?;
        if !asterisk_token.is_nil() || self.token == Kind::OpenParenToken {
            let Some(func) = function else {
                return Err(self.out_of_step("a method of the tree has no function"));
            };
            return self.lower_method_declaration(
                pos,
                jsdoc,
                modifiers,
                asterisk_token,
                name,
                func,
            );
        }
        // parsePropertyDeclaration
        let save_context_flags = self.context_flags;
        self.set_context_flags(
            NodeFlags::YIELD_CONTEXT | NodeFlags::AWAIT_CONTEXT | NodeFlags::DISALLOW_IN_CONTEXT,
            false,
        );
        let initializer = self.lower_initializer(property.initializer.as_ref());
        self.context_flags = save_context_flags;
        let initializer = initializer?;
        // parseSemicolonAfterPropertyName
        self.parse_semicolon()?;
        let result =
            self.b
                .new_property_declaration(modifiers, name, NodeId::NIL, NodeId::NIL, initializer);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }
}
