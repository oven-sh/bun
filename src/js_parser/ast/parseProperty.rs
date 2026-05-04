use bun_core::{self, err};
use bun_logger as logger;
use bun_str::strings;

use crate::{
    self as js_parser, AwaitOrYield, DeferredErrors, FnOrArrowDataParse, JSXTransformType,
    NewParser_, ParseStatementOptions, PropertyOpts, TypeScript,
};
use bun_js_parser::ast as js_ast;
use js_ast::{
    E, Expr, ExprNodeList, Flags, Stmt, Symbol,
    G::{self, Property},
};
use bun_js_parser::lexer as js_lexer;
use js_lexer::{PropertyModifierKeyword, T};

// TODO(port): exact paths for these enums (Phase B import fix)
use js_ast::Scope::Kind as ScopeKind;
use js_ast::Op::Level;

// PORT NOTE: Zig defines `fn ParseProperty(comptime ts, comptime jsx, comptime scan_only) type`
// returning a struct of methods that take `p: *P`. In Rust this becomes an inherent
// `impl` block on the parser type with the same const-generic parameters; the
// `usingnamespace` mixin at the call site is replaced by these methods being directly
// callable on `P`.
type P<const PARSER_FEATURE__TYPESCRIPT: bool, const PARSER_FEATURE__JSX: JSXTransformType, const PARSER_FEATURE__SCAN_ONLY: bool> =
    NewParser_<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>;

impl<
        const PARSER_FEATURE__TYPESCRIPT: bool,
        const PARSER_FEATURE__JSX: JSXTransformType,
        const PARSER_FEATURE__SCAN_ONLY: bool,
    > P<PARSER_FEATURE__TYPESCRIPT, PARSER_FEATURE__JSX, PARSER_FEATURE__SCAN_ONLY>
{
    // const is_typescript_enabled = P.is_typescript_enabled;
    // (referenced below as Self::IS_TYPESCRIPT_ENABLED)

    fn parse_method_expression(
        p: &mut Self,
        kind: Property::Kind,
        opts: &mut PropertyOpts,
        is_computed: bool,
        key: &mut Expr,
        key_range: logger::Range,
    ) -> Result<Option<G::Property>, bun_core::Error> {
        if p.lexer.token == T::TOpenParen && kind != Property::Kind::Get && kind != Property::Kind::Set {
            // markSyntaxFeature object extensions
        }

        let loc = p.lexer.loc();
        let scope_index = p
            .push_scope_for_parse_pass(ScopeKind::FunctionArgs, loc)
            .expect("unreachable");
        let mut is_constructor = false;

        // Forbid the names "constructor" and "prototype" in some cases
        if opts.is_class && !is_computed {
            match &key.data {
                Expr::Data::EString(str_) => {
                    if !opts.is_static && str_.eql_comptime(b"constructor") {
                        if kind == Property::Kind::Get {
                            p.log.add_range_error(p.source, key_range, "Class constructor cannot be a getter").expect("unreachable");
                        } else if kind == Property::Kind::Set {
                            p.log.add_range_error(p.source, key_range, "Class constructor cannot be a setter").expect("unreachable");
                        } else if opts.is_async {
                            p.log.add_range_error(p.source, key_range, "Class constructor cannot be an async function").expect("unreachable");
                        } else if opts.is_generator {
                            p.log.add_range_error(p.source, key_range, "Class constructor cannot be a generator function").expect("unreachable");
                        } else {
                            is_constructor = true;
                        }
                    } else if opts.is_static && str_.eql_comptime(b"prototype") {
                        p.log.add_range_error(p.source, key_range, "Invalid static method name \"prototype\"").expect("unreachable");
                    }
                }
                _ => {}
            }
        }

        let mut func = p.parse_fn(
            None,
            FnOrArrowDataParse {
                async_range: opts.async_range,
                needs_async_loc: key.loc,
                has_async_range: !opts.async_range.is_empty(),
                allow_await: if opts.is_async { AwaitOrYield::AllowExpr } else { AwaitOrYield::AllowIdent },
                allow_yield: if opts.is_generator { AwaitOrYield::AllowExpr } else { AwaitOrYield::AllowIdent },
                allow_super_call: opts.class_has_extends && is_constructor,
                allow_super_property: true,
                allow_ts_decorators: opts.allow_ts_decorators,
                is_constructor,
                has_decorators: opts.ts_decorators.len() > 0 || (opts.has_class_decorators && is_constructor),

                // Only allow omitting the body if we're parsing TypeScript class
                allow_missing_body_for_type_script: Self::IS_TYPESCRIPT_ENABLED && opts.is_class,
                ..Default::default()
            },
        )?;

        opts.has_argument_decorators = opts.has_argument_decorators || p.fn_or_arrow_data_parse.has_argument_decorators;
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        // "class Foo { foo(): void; foo(): void {} }"
        if func.flags.contains(Flags::Function::IS_FORWARD_DECLARATION) {
            // Skip this property entirely
            p.pop_and_discard_scope(scope_index);
            return Ok(None);
        }

        p.pop_scope();
        func.flags.insert(Flags::Function::IS_UNIQUE_FORMAL_PARAMETERS);
        let value = p.new_expr(E::Function { func }, loc);

        // Enforce argument rules for accessors
        match kind {
            Property::Kind::Get => {
                if func.args.len() > 0 {
                    let r = js_lexer::range_of_identifier(p.source, func.args[0].binding.loc);
                    p.log
                        .add_range_error_fmt(
                            p.source,
                            r,
                            p.allocator,
                            format_args!("Getter {} must have zero arguments", p.key_name_for_error(key)),
                        )
                        .expect("unreachable");
                }
            }
            Property::Kind::Set => {
                if func.args.len() != 1 {
                    let mut r = js_lexer::range_of_identifier(
                        p.source,
                        if func.args.len() > 0 { func.args[0].binding.loc } else { loc },
                    );
                    if func.args.len() > 1 {
                        r = js_lexer::range_of_identifier(p.source, func.args[1].binding.loc);
                    }
                    p.log
                        .add_range_error_fmt(
                            p.source,
                            r,
                            p.allocator,
                            format_args!(
                                "Setter {} must have exactly 1 argument (there are {})",
                                p.key_name_for_error(key),
                                func.args.len()
                            ),
                        )
                        .expect("unreachable");
                }
            }
            _ => {}
        }

        // Special-case private identifiers
        match &mut key.data {
            Expr::Data::EPrivateIdentifier(private) => {
                let declare: Symbol::Kind = match kind {
                    Property::Kind::Get => {
                        if opts.is_static {
                            Symbol::Kind::PrivateStaticGet
                        } else {
                            Symbol::Kind::PrivateGet
                        }
                    }
                    Property::Kind::Set => {
                        if opts.is_static {
                            Symbol::Kind::PrivateStaticSet
                        } else {
                            Symbol::Kind::PrivateSet
                        }
                    }
                    _ => {
                        if opts.is_static {
                            Symbol::Kind::PrivateStaticMethod
                        } else {
                            Symbol::Kind::PrivateMethod
                        }
                    }
                };

                let name = p.load_name_from_ref(private.ref_);
                if name == b"#constructor" {
                    p.log.add_range_error(p.source, key_range, "Invalid method name \"#constructor\"").expect("unreachable");
                }
                private.ref_ = p.declare_symbol(declare, key.loc, name).expect("unreachable");
            }
            _ => {}
        }

        Ok(Some(G::Property {
            ts_decorators: ExprNodeList::from_slice(p.allocator, opts.ts_decorators)?,
            kind,
            flags: {
                let mut f = Flags::Property::empty();
                if is_computed {
                    f.insert(Flags::Property::IS_COMPUTED);
                }
                f.insert(Flags::Property::IS_METHOD);
                if opts.is_static {
                    f.insert(Flags::Property::IS_STATIC);
                }
                f
            },
            key: Some(*key),
            value: Some(value),
            ts_metadata: TypeScript::Metadata::MFunction,
            ..Default::default()
        }))
    }

    pub fn parse_property(
        p: &mut Self,
        kind_: Property::Kind,
        opts: &mut PropertyOpts,
        errors_: Option<&mut DeferredErrors>,
    ) -> Result<Option<G::Property>, bun_core::Error> {
        let mut kind = kind_;
        let mut errors = errors_;
        // This while loop exists to conserve stack space by reducing (but not completely eliminating) recursion.
        'restart: loop {
            let mut key: Expr = Expr {
                loc: logger::Loc::EMPTY,
                data: Expr::Data::EMissing(E::Missing {}),
            };
            let key_range = p.lexer.range();
            let mut is_computed = false;

            match p.lexer.token {
                T::TNumericLiteral => {
                    key = p.new_expr(E::Number { value: p.lexer.number }, p.lexer.loc());
                    // p.checkForLegacyOctalLiteral()
                    p.lexer.next()?;
                }
                T::TStringLiteral => {
                    key = p.parse_string_literal()?;
                }
                T::TBigIntegerLiteral => {
                    key = p.new_expr(E::BigInt { value: p.lexer.identifier }, p.lexer.loc());
                    // markSyntaxFeature
                    p.lexer.next()?;
                }
                T::TPrivateIdentifier => {
                    if !opts.is_class || (opts.ts_decorators.len() > 0 && !p.options.features.standard_decorators) {
                        p.lexer.expected(T::TIdentifier)?;
                    }

                    key = p.new_expr(
                        E::PrivateIdentifier {
                            ref_: p.store_name_in_ref(p.lexer.identifier).expect("unreachable"),
                        },
                        p.lexer.loc(),
                    );
                    p.lexer.next()?;
                }
                T::TOpenBracket => {
                    is_computed = true;
                    // p.markSyntaxFeature(compat.objectExtensions, p.lexer.range())
                    p.lexer.next()?;
                    let was_identifier = p.lexer.token == T::TIdentifier;
                    let expr = p.parse_expr(Level::Comma)?;

                    if Self::IS_TYPESCRIPT_ENABLED {
                        // Handle index signatures
                        if p.lexer.token == T::TColon && was_identifier && opts.is_class {
                            match expr.data {
                                Expr::Data::EIdentifier(_) => {
                                    p.lexer.next()?;
                                    p.skip_typescript_type(Level::Lowest)?;
                                    p.lexer.expect(T::TCloseBracket)?;
                                    p.lexer.expect(T::TColon)?;
                                    p.skip_typescript_type(Level::Lowest)?;
                                    p.lexer.expect_or_insert_semicolon()?;

                                    // Skip this property entirely
                                    return Ok(None);
                                }
                                _ => {}
                            }
                        }
                    }

                    p.lexer.expect(T::TCloseBracket)?;
                    key = expr;
                }
                T::TAsterisk => {
                    if kind != Property::Kind::Normal || opts.is_generator {
                        p.lexer.unexpected()?;
                        return Err(err!("SyntaxError"));
                    }

                    p.lexer.next()?;
                    opts.is_generator = true;
                    kind = Property::Kind::Normal;
                    continue 'restart;
                }

                _ => {
                    let name = p.lexer.identifier;
                    let raw = p.lexer.raw();
                    let name_range = p.lexer.range();

                    if !p.lexer.is_identifier_or_keyword() {
                        p.lexer.expect(T::TIdentifier)?;
                    }

                    p.lexer.next()?;

                    // Support contextual keywords
                    if kind == Property::Kind::Normal && !opts.is_generator {
                        // Does the following token look like a key?
                        let could_be_modifier_keyword = p.lexer.is_identifier_or_keyword()
                            || matches!(
                                p.lexer.token,
                                T::TOpenBracket
                                    | T::TNumericLiteral
                                    | T::TStringLiteral
                                    | T::TAsterisk
                                    | T::TPrivateIdentifier
                            );

                        // If so, check for a modifier keyword
                        if could_be_modifier_keyword {
                            // TODO: micro-optimization, use a smaller list for non-typescript files.
                            if let Some(keyword) = PropertyModifierKeyword::LIST.get(name).copied() {
                                match keyword {
                                    PropertyModifierKeyword::PGet => {
                                        if !opts.is_async
                                            && PropertyModifierKeyword::LIST
                                                .get(raw)
                                                .copied()
                                                .unwrap_or(PropertyModifierKeyword::PStatic)
                                                == PropertyModifierKeyword::PGet
                                        {
                                            kind = Property::Kind::Get;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }

                                    PropertyModifierKeyword::PSet => {
                                        if !opts.is_async
                                            && PropertyModifierKeyword::LIST
                                                .get(raw)
                                                .copied()
                                                .unwrap_or(PropertyModifierKeyword::PStatic)
                                                == PropertyModifierKeyword::PSet
                                        {
                                            // p.markSyntaxFeature(ObjectAccessors, name_range)
                                            kind = Property::Kind::Set;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PAsync => {
                                        if !opts.is_async
                                            && PropertyModifierKeyword::LIST
                                                .get(raw)
                                                .copied()
                                                .unwrap_or(PropertyModifierKeyword::PStatic)
                                                == PropertyModifierKeyword::PAsync
                                            && !p.lexer.has_newline_before
                                        {
                                            opts.is_async = true;
                                            opts.async_range = name_range;

                                            // p.markSyntaxFeature(ObjectAccessors, name_range)

                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PStatic => {
                                        if !opts.is_static
                                            && !opts.is_async
                                            && opts.is_class
                                            && PropertyModifierKeyword::LIST
                                                .get(raw)
                                                .copied()
                                                .unwrap_or(PropertyModifierKeyword::PGet)
                                                == PropertyModifierKeyword::PStatic
                                        {
                                            opts.is_static = true;
                                            kind = Property::Kind::Normal;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PDeclare => {
                                        // skip declare keyword entirely
                                        // https://github.com/oven-sh/bun/issues/1907
                                        if opts.is_class && Self::IS_TYPESCRIPT_ENABLED && raw == b"declare" {
                                            let scope_index = p.scopes_in_order.len();
                                            if let Some(_prop) = p.parse_property(kind, opts, None)? {
                                                let mut prop = _prop;
                                                if prop.kind == Property::Kind::Normal
                                                    && prop.value.is_none()
                                                    && opts.ts_decorators.len() > 0
                                                {
                                                    prop.kind = Property::Kind::Declare;
                                                    return Ok(Some(prop));
                                                }
                                            }

                                            p.discard_scopes_up_to(scope_index);
                                            return Ok(None);
                                        }
                                    }
                                    PropertyModifierKeyword::PAbstract => {
                                        if opts.is_class
                                            && Self::IS_TYPESCRIPT_ENABLED
                                            && !opts.is_ts_abstract
                                            && raw == b"abstract"
                                        {
                                            opts.is_ts_abstract = true;
                                            let scope_index = p.scopes_in_order.len();
                                            if let Some(prop) = p.parse_property(kind, opts, None)? {
                                                if prop.kind == Property::Kind::Normal
                                                    && prop.value.is_none()
                                                    && opts.ts_decorators.len() > 0
                                                {
                                                    let mut prop_ = prop;
                                                    prop_.kind = Property::Kind::Abstract;
                                                    return Ok(Some(prop_));
                                                }
                                            }
                                            p.discard_scopes_up_to(scope_index);
                                            return Ok(None);
                                        }
                                    }
                                    PropertyModifierKeyword::PAccessor => {
                                        // "accessor" keyword for auto-accessor fields (TC39 standard decorators)
                                        if opts.is_class
                                            && p.options.features.standard_decorators
                                            && PropertyModifierKeyword::LIST
                                                .get(raw)
                                                .copied()
                                                .unwrap_or(PropertyModifierKeyword::PStatic)
                                                == PropertyModifierKeyword::PAccessor
                                        {
                                            kind = Property::Kind::AutoAccessor;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PPrivate
                                    | PropertyModifierKeyword::PProtected
                                    | PropertyModifierKeyword::PPublic
                                    | PropertyModifierKeyword::PReadonly
                                    | PropertyModifierKeyword::POverride => {
                                        // Skip over TypeScript keywords
                                        if opts.is_class
                                            && Self::IS_TYPESCRIPT_ENABLED
                                            && PropertyModifierKeyword::LIST
                                                .get(raw)
                                                .copied()
                                                .unwrap_or(PropertyModifierKeyword::PStatic)
                                                == keyword
                                        {
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                }
                            }
                        } else if p.lexer.token == T::TOpenBrace && name == b"static" {
                            let loc = p.lexer.loc();
                            p.lexer.next()?;

                            let old_fn_or_arrow_data_parse = p.fn_or_arrow_data_parse;
                            p.fn_or_arrow_data_parse = FnOrArrowDataParse {
                                is_return_disallowed: true,
                                allow_super_property: true,
                                allow_await: AwaitOrYield::ForbidAll,
                                ..Default::default()
                            };

                            let _ = p.push_scope_for_parse_pass(ScopeKind::ClassStaticInit, loc)?;
                            let mut _parse_opts = ParseStatementOptions::default();
                            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut _parse_opts)?;

                            p.pop_scope();

                            p.fn_or_arrow_data_parse = old_fn_or_arrow_data_parse;
                            p.lexer.expect(T::TCloseBrace)?;

                            // PERF(port): was arena allocator.create — bump.alloc returns &'bump mut T
                            let block = p.allocator.alloc(G::ClassStaticBlock {
                                stmts: js_ast::BabyList::<Stmt>::from_owned_slice(stmts),
                                loc,
                            });

                            return Ok(Some(G::Property {
                                kind: Property::Kind::ClassStaticBlock,
                                class_static_block: Some(block),
                                ..Default::default()
                            }));
                        }
                    }

                    // Handle invalid identifiers in property names
                    // https://github.com/oven-sh/bun/issues/12039
                    if p.lexer.token == T::TSyntaxError {
                        p.log
                            .add_range_error_fmt(
                                p.source,
                                name_range,
                                p.allocator,
                                format_args!("Unexpected {}", bun_core::fmt::quote(name)),
                            )
                            .expect("unreachable");
                        return Err(err!("SyntaxError"));
                    }

                    key = p.new_expr(E::String { data: name }, name_range.loc);

                    // Parse a shorthand property
                    let is_shorthand_property = !opts.is_class
                        && kind == Property::Kind::Normal
                        && p.lexer.token != T::TColon
                        && p.lexer.token != T::TOpenParen
                        && p.lexer.token != T::TLessThan
                        && !opts.is_generator
                        && !opts.is_async
                        && !js_lexer::Keywords::has(name);

                    if is_shorthand_property {
                        if (p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                            && name == b"await")
                            || (p.fn_or_arrow_data_parse.allow_yield != AwaitOrYield::AllowIdent
                                && name == b"yield")
                        {
                            if name == b"await" {
                                p.log.add_range_error(p.source, name_range, "Cannot use \"await\" here").expect("unreachable");
                            } else {
                                p.log.add_range_error(p.source, name_range, "Cannot use \"yield\" here").expect("unreachable");
                            }
                        }

                        let ref_ = p.store_name_in_ref(name).expect("unreachable");
                        let value = p.new_expr(E::Identifier { ref_ }, key.loc);

                        // Destructuring patterns have an optional default value
                        let mut initializer: Option<Expr> = None;
                        if errors.is_some() && p.lexer.token == T::TEquals {
                            errors.as_mut().unwrap().invalid_expr_default_value = Some(p.lexer.range());
                            p.lexer.next()?;
                            initializer = Some(p.parse_expr(Level::Comma)?);
                        }

                        return Ok(Some(G::Property {
                            kind,
                            key: Some(key),
                            value: Some(value),
                            initializer,
                            flags: {
                                let mut f = Flags::Property::empty();
                                f.insert(Flags::Property::WAS_SHORTHAND);
                                f
                            },
                            ..Default::default()
                        }));
                    }
                }
            }

            let mut has_type_parameters = false;
            let mut has_definite_assignment_assertion_operator = false;

            if Self::IS_TYPESCRIPT_ENABLED {
                if opts.is_class {
                    if p.lexer.token == T::TQuestion {
                        // "class X { foo?: number }"
                        // "class X { foo!: number }"
                        p.lexer.next()?;
                    } else if p.lexer.token == T::TExclamation
                        && !p.lexer.has_newline_before
                        && (kind == Property::Kind::Normal || kind == Property::Kind::AutoAccessor)
                        && !opts.is_async
                        && !opts.is_generator
                    {
                        // "class X { foo!: number }"
                        p.lexer.next()?;
                        has_definite_assignment_assertion_operator = true;
                    }
                }

                // "class X { foo?<T>(): T }"
                // "const x = { foo<T>(): T {} }"
                if !has_definite_assignment_assertion_operator {
                    // TODO(port): SkipTypeParameterOptions struct name/shape
                    has_type_parameters = p.skip_typescript_type_parameters(
                        js_parser::SkipTypeParameterOptions {
                            allow_const_modifier: true,
                            ..Default::default()
                        },
                    )? != js_parser::SkipTypeParameterResult::DidNotSkipAnything;
                }
            }

            // Parse a class field with an optional initial value
            if opts.is_class
                && (kind == Property::Kind::Normal || kind == Property::Kind::AutoAccessor)
                && !opts.is_async
                && !opts.is_generator
                && p.lexer.token != T::TOpenParen
                && !has_type_parameters
                && (p.lexer.token != T::TOpenParen || has_definite_assignment_assertion_operator)
            {
                let mut initializer: Option<Expr> = None;
                let mut ts_metadata = TypeScript::Metadata::default();

                // Forbid the names "constructor" and "prototype" in some cases
                if !is_computed {
                    match &key.data {
                        Expr::Data::EString(str_) => {
                            if str_.eql_comptime(b"constructor")
                                || (opts.is_static && str_.eql_comptime(b"prototype"))
                            {
                                // TODO: fmt error message to include string value.
                                p.log.add_range_error(p.source, key_range, "Invalid field name").expect("unreachable");
                            }
                        }
                        _ => {}
                    }
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    // Skip over types
                    if p.lexer.token == T::TColon {
                        p.lexer.next()?;
                        if p.options.features.emit_decorator_metadata
                            && opts.is_class
                            && opts.ts_decorators.len() > 0
                        {
                            ts_metadata = p.skip_typescript_type_with_metadata(Level::Lowest)?;
                        } else {
                            p.skip_typescript_type(Level::Lowest)?;
                        }
                    }
                }

                if p.lexer.token == T::TEquals {
                    if Self::IS_TYPESCRIPT_ENABLED {
                        if !opts.declare_range.is_empty() {
                            p.log.add_range_error(
                                p.source,
                                p.lexer.range(),
                                "Class fields that use \"declare\" cannot be initialized",
                            )?;
                        }
                    }

                    p.lexer.next()?;

                    // "this" and "super" property access is allowed in field initializers
                    let old_is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;
                    let old_allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
                    p.fn_or_arrow_data_parse.is_this_disallowed = false;
                    p.fn_or_arrow_data_parse.allow_super_property = true;

                    initializer = Some(p.parse_expr(Level::Comma)?);

                    p.fn_or_arrow_data_parse.is_this_disallowed = old_is_this_disallowed;
                    p.fn_or_arrow_data_parse.allow_super_property = old_allow_super_property;
                }

                // Special-case private identifiers
                match &mut key.data {
                    Expr::Data::EPrivateIdentifier(private) => {
                        let name = p.load_name_from_ref(private.ref_);
                        if name == b"#constructor" {
                            p.log.add_range_error(p.source, key_range, "Invalid field name \"#constructor\"").expect("unreachable");
                        }

                        let declare: js_ast::Symbol::Kind = if opts.is_static {
                            Symbol::Kind::PrivateStaticField
                        } else {
                            Symbol::Kind::PrivateField
                        };

                        private.ref_ = p.declare_symbol(declare, key.loc, name).expect("unreachable");
                    }
                    _ => {}
                }

                p.lexer.expect_or_insert_semicolon()?;

                return Ok(Some(G::Property {
                    ts_decorators: ExprNodeList::from_slice(p.allocator, opts.ts_decorators)?,
                    kind,
                    flags: {
                        let mut f = Flags::Property::empty();
                        if is_computed {
                            f.insert(Flags::Property::IS_COMPUTED);
                        }
                        if opts.is_static {
                            f.insert(Flags::Property::IS_STATIC);
                        }
                        f
                    },
                    key: Some(key),
                    initializer,
                    ts_metadata,
                    ..Default::default()
                }));
            }

            // Auto-accessor fields cannot be methods
            if kind == Property::Kind::AutoAccessor && p.lexer.token == T::TOpenParen {
                p.log
                    .add_range_error(p.source, key_range, "auto-accessor properties cannot have a method body")
                    .expect("unreachable");
                return Err(err!("SyntaxError"));
            }

            // Parse a method expression
            if p.lexer.token == T::TOpenParen
                || kind != Property::Kind::Normal
                || opts.is_class
                || opts.is_async
                || opts.is_generator
            {
                return Self::parse_method_expression(p, kind, opts, is_computed, &mut key, key_range);
            }

            // Parse an object key/value pair
            p.lexer.expect(T::TColon)?;
            let mut property = G::Property {
                kind,
                flags: {
                    let mut f = Flags::Property::empty();
                    if is_computed {
                        f.insert(Flags::Property::IS_COMPUTED);
                    }
                    f
                },
                key: Some(key),
                value: Some(Expr {
                    data: Expr::Data::EMissing(E::Missing {}),
                    loc: logger::Loc::default(),
                }),
                ..Default::default()
            };

            // PORT NOTE: reshaped for borrowck — `errors` is Option<&mut _>, reborrow via as_deref_mut
            p.parse_expr_or_bindings(
                Level::Comma,
                errors.as_deref_mut(),
                property.value.as_mut().unwrap(),
            )?;
            return Ok(Some(property));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseProperty.zig (591 lines)
//   confidence: medium
//   todos:      2
//   notes:      Zig type-returning fn → inherent impl on NewParser_<const TS, JSX, SCAN_ONLY>; Flags::Property assumed bitflags; ScopeKind/Level/SkipTypeParameter* import paths need Phase B fixup
// ──────────────────────────────────────────────────────────────────────────
