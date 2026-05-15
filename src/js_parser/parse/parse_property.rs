#![allow(unused_imports, unused_variables, dead_code, unused_mut)]
#![warn(unused_must_use)]
use core::ptr::NonNull;

use bun_collections::VecExt;
use bun_core::strings;
use bun_core::{self, err};

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{
    AwaitOrYield, DeferredErrors, FnOrArrowDataParse, ParseStatementOptions, PropertyOpts,
    SkipTypeParameterResult, TypeParameterFlag,
};
use bun_ast as js_ast;
use bun_ast::flags;
use bun_ast::lexer_tables::PropertyModifierKeyword;
use bun_ast::op::Level;
use bun_ast::scope::Kind as ScopeKind;
use bun_ast::ts::Metadata as TsMetadata;
use js_ast::{
    E, Expr, ExprNodeList,
    G::{self, Property, PropertyKind},
    Stmt, symbol,
};
use js_lexer::T;

// Zig: `fn ParseProperty(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    fn parse_method_expression(
        &mut self,
        kind: PropertyKind,
        opts: &mut PropertyOpts,
        is_computed: bool,
        key: &mut Expr,
        key_range: bun_ast::Range,
    ) -> Result<Option<G::Property>, bun_core::Error> {
        let p = self;
        if p.lexer.token == T::TOpenParen && kind != PropertyKind::Get && kind != PropertyKind::Set
        {
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
                js_ast::ExprData::EString(str_) => {
                    if !opts.is_static && str_.eql_comptime(b"constructor") {
                        if kind == PropertyKind::Get {
                            p.log().add_range_error(
                                Some(p.source),
                                key_range,
                                b"Class constructor cannot be a getter",
                            );
                        } else if kind == PropertyKind::Set {
                            p.log().add_range_error(
                                Some(p.source),
                                key_range,
                                b"Class constructor cannot be a setter",
                            );
                        } else if opts.is_async {
                            p.log().add_range_error(
                                Some(p.source),
                                key_range,
                                b"Class constructor cannot be an async function",
                            );
                        } else if opts.is_generator {
                            p.log().add_range_error(
                                Some(p.source),
                                key_range,
                                b"Class constructor cannot be a generator function",
                            );
                        } else {
                            is_constructor = true;
                        }
                    } else if opts.is_static && str_.eql_comptime(b"prototype") {
                        p.log().add_range_error(
                            Some(p.source),
                            key_range,
                            b"Invalid static method name \"prototype\"",
                        );
                    }
                }
                _ => {}
            }
        }

        let func = p.parse_fn(
            None,
            FnOrArrowDataParse {
                async_range: opts.async_range,
                needs_async_loc: key.loc,
                has_async_range: !opts.async_range.is_empty(),
                allow_await: if opts.is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                allow_yield: if opts.is_generator {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                allow_super_call: opts.class_has_extends && is_constructor,
                allow_super_property: true,
                allow_ts_decorators: opts.allow_ts_decorators,
                is_constructor,
                has_decorators: opts.ts_decorators.len() > 0
                    || (opts.has_class_decorators && is_constructor),

                // Only allow omitting the body if we're parsing TypeScript class
                allow_missing_body_for_type_script: Self::IS_TYPESCRIPT_ENABLED && opts.is_class,
                ..Default::default()
            },
        )?;

        opts.has_argument_decorators =
            opts.has_argument_decorators || p.fn_or_arrow_data_parse.has_argument_decorators;
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        // "class Foo { foo(): void; foo(): void {} }"
        if func.flags.contains(flags::Function::IsForwardDeclaration) {
            // Skip this property entirely
            p.pop_and_discard_scope(scope_index);
            return Ok(None);
        }

        p.pop_scope();
        // PORT NOTE: G::Fn is not Copy (FnBody/TS-metadata aren't), so mutate in place via the
        // E::Function payload after boxing rather than copying `func`.
        let mut func = func;
        func.flags.insert(flags::Function::IsUniqueFormalParameters);
        let args = func.args.slice();
        let value = p.new_expr(E::Function { func }, loc);

        // Enforce argument rules for accessors
        match kind {
            PropertyKind::Get => {
                if args.len() > 0 {
                    let r = js_lexer::range_of_identifier(p.source, args[0].binding.loc);
                    // TODO(port): Zig used p.keyNameForError(key) inline; borrowck reshape — pre-compute name.
                    let key_name = p.key_name_for_error(key);
                    p.log().add_range_error_fmt(
                        Some(p.source),
                        r,
                        format_args!(
                            "Getter {} must have zero arguments",
                            bstr::BStr::new(key_name)
                        ),
                    );
                }
            }
            PropertyKind::Set => {
                if args.len() != 1 {
                    let mut r = js_lexer::range_of_identifier(
                        p.source,
                        if args.len() > 0 {
                            args[0].binding.loc
                        } else {
                            loc
                        },
                    );
                    if args.len() > 1 {
                        r = js_lexer::range_of_identifier(p.source, args[1].binding.loc);
                    }
                    let key_name = p.key_name_for_error(key);
                    p.log().add_range_error_fmt(
                        Some(p.source),
                        r,
                        format_args!(
                            "Setter {} must have exactly 1 argument (there are {})",
                            bstr::BStr::new(key_name),
                            args.len()
                        ),
                    );
                }
            }
            _ => {}
        }

        // Special-case private identifiers
        match &mut key.data {
            js_ast::ExprData::EPrivateIdentifier(private) => {
                let declare: symbol::Kind = match kind {
                    PropertyKind::Get => {
                        if opts.is_static {
                            symbol::Kind::PrivateStaticGet
                        } else {
                            symbol::Kind::PrivateGet
                        }
                    }
                    PropertyKind::Set => {
                        if opts.is_static {
                            symbol::Kind::PrivateStaticSet
                        } else {
                            symbol::Kind::PrivateSet
                        }
                    }
                    _ => {
                        if opts.is_static {
                            symbol::Kind::PrivateStaticMethod
                        } else {
                            symbol::Kind::PrivateMethod
                        }
                    }
                };

                let name = p.load_name_from_ref(private.ref_);
                if name == b"#constructor" {
                    p.log().add_range_error(
                        Some(p.source),
                        key_range,
                        b"Invalid method name \"#constructor\"",
                    );
                }
                private.ref_ = p
                    .declare_symbol(declare, key.loc, name)
                    .expect("unreachable");
            }
            _ => {}
        }

        let mut prop_flags = flags::PropertySet::empty();
        if is_computed {
            prop_flags.insert(flags::Property::IsComputed);
        }
        prop_flags.insert(flags::Property::IsMethod);
        if opts.is_static {
            prop_flags.insert(flags::Property::IsStatic);
        }

        Ok(Some(G::Property {
            ts_decorators: ExprNodeList::from_slice(&opts.ts_decorators),
            kind,
            flags: prop_flags,
            key: Some(*key),
            value: Some(value),
            ts_metadata: TsMetadata::MFunction,
            ..Default::default()
        }))
    }

    pub fn parse_property(
        &mut self,
        kind_: PropertyKind,
        opts: &mut PropertyOpts,
        errors_: Option<&mut DeferredErrors>,
    ) -> Result<Option<G::Property>, bun_core::Error> {
        let p = self;
        if !p.stack_check.is_safe_to_recurse() {
            return Err(err!("StackOverflow"));
        }
        let mut kind = kind_;
        let mut errors = errors_;
        // This while loop exists to conserve stack space by reducing (but not completely eliminating) recursion.
        'restart: loop {
            // Every match arm below assigns `key` (or `continue 'restart` /
            // `return`) before any read; Zig's `var key: Expr = undefined` pre-
            // init is unnecessary here.
            let mut key: Expr;
            let key_range = p.lexer.range();
            let mut is_computed = false;

            match p.lexer.token {
                T::TNumericLiteral => {
                    key = p.new_expr(
                        E::Number {
                            value: p.lexer.number,
                        },
                        p.lexer.loc(),
                    );
                    // p.checkForLegacyOctalLiteral()
                    p.lexer.next()?;
                }
                T::TStringLiteral => {
                    key = p.parse_string_literal()?;
                }
                T::TBigIntegerLiteral => {
                    key = p.new_expr(
                        E::BigInt {
                            value: p.lexer.identifier.into(),
                        },
                        p.lexer.loc(),
                    );
                    // markSyntaxFeature
                    p.lexer.next()?;
                }
                T::TPrivateIdentifier => {
                    if !opts.is_class
                        || (opts.ts_decorators.len() > 0 && !p.options.features.standard_decorators)
                    {
                        p.lexer.expected(T::TIdentifier)?;
                    }

                    let ident = p.lexer.identifier;
                    let ref_ = p.store_name_in_ref(ident).expect("unreachable");
                    key = p.new_expr(E::PrivateIdentifier { ref_ }, p.lexer.loc());
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
                                js_ast::ExprData::EIdentifier(_) => {
                                    p.lexer.next()?;
                                    p.skip_type_script_type(Level::Lowest)?;
                                    p.lexer.expect(T::TCloseBracket)?;
                                    p.lexer.expect(T::TColon)?;
                                    p.skip_type_script_type(Level::Lowest)?;
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
                    if kind != PropertyKind::Normal || opts.is_generator {
                        p.lexer.unexpected()?;
                        return Err(err!("SyntaxError"));
                    }

                    p.lexer.next()?;
                    opts.is_generator = true;
                    kind = PropertyKind::Normal;
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
                    if kind == PropertyKind::Normal && !opts.is_generator {
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
                            if let Some(keyword) = PropertyModifierKeyword::find(name) {
                                match keyword {
                                    PropertyModifierKeyword::PGet => {
                                        if !opts.is_async
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PGet)
                                        {
                                            kind = PropertyKind::Get;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }

                                    PropertyModifierKeyword::PSet => {
                                        if !opts.is_async
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PSet)
                                        {
                                            // p.markSyntaxFeature(ObjectAccessors, name_range)
                                            kind = PropertyKind::Set;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PAsync => {
                                        if !opts.is_async
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PAsync)
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
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PStatic)
                                        {
                                            opts.is_static = true;
                                            kind = PropertyKind::Normal;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PDeclare => {
                                        // skip declare keyword entirely
                                        // https://github.com/oven-sh/bun/issues/1907
                                        if opts.is_class
                                            && Self::IS_TYPESCRIPT_ENABLED
                                            && raw == b"declare"
                                        {
                                            let scope_index = p.scopes_in_order.len();
                                            if let Some(_prop) =
                                                p.parse_property(kind, opts, None)?
                                            {
                                                let mut prop = _prop;
                                                if prop.kind == PropertyKind::Normal
                                                    && prop.value.is_none()
                                                    && opts.ts_decorators.len() > 0
                                                {
                                                    prop.kind = PropertyKind::Declare;
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
                                            if let Some(prop) =
                                                p.parse_property(kind, opts, None)?
                                            {
                                                if prop.kind == PropertyKind::Normal
                                                    && prop.value.is_none()
                                                    && opts.ts_decorators.len() > 0
                                                {
                                                    let mut prop_ = prop;
                                                    prop_.kind = PropertyKind::Abstract;
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
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PAccessor)
                                        {
                                            kind = PropertyKind::AutoAccessor;
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
                                            && PropertyModifierKeyword::find(raw) == Some(keyword)
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

                            let old_fn_or_arrow_data_parse = p.fn_or_arrow_data_parse.clone();
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

                            // PERF(port): was arena arena.create — bump.alloc returns &'a mut T;
                            // Vec::from_slice copies the bump-backed StmtList into a heap-backed list
                            // (Phase B: route ClassStaticBlock.stmts through arena slice directly).
                            let stmt_list = bun_alloc::AstVec::<Stmt>::from_slice(stmts.as_slice());
                            let block = p.arena.alloc(G::ClassStaticBlock {
                                stmts: stmt_list,
                                loc,
                            });

                            return Ok(Some(G::Property {
                                kind: PropertyKind::ClassStaticBlock,
                                class_static_block: Some(js_ast::StoreRef::from_bump(block)),
                                ..Default::default()
                            }));
                        }
                    }

                    // Handle invalid identifiers in property names
                    // https://github.com/oven-sh/bun/issues/12039
                    if p.lexer.token == T::TSyntaxError {
                        p.log().add_range_error_fmt(
                            Some(p.source),
                            name_range,
                            format_args!("Unexpected {}", bun_core::fmt::quote(name)),
                        );
                        return Err(err!("SyntaxError"));
                    }

                    key = p.new_expr(E::EString::init(name), name_range.loc);

                    // Parse a shorthand property
                    let is_shorthand_property = !opts.is_class
                        && kind == PropertyKind::Normal
                        && p.lexer.token != T::TColon
                        && p.lexer.token != T::TOpenParen
                        && p.lexer.token != T::TLessThan
                        && !opts.is_generator
                        && !opts.is_async
                        && js_lexer::keyword(name).is_none();

                    if is_shorthand_property {
                        if (p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                            && name == b"await")
                            || (p.fn_or_arrow_data_parse.allow_yield != AwaitOrYield::AllowIdent
                                && name == b"yield")
                        {
                            if name == b"await" {
                                p.log().add_range_error(
                                    Some(p.source),
                                    name_range,
                                    b"Cannot use \"await\" here",
                                );
                            } else {
                                p.log().add_range_error(
                                    Some(p.source),
                                    name_range,
                                    b"Cannot use \"yield\" here",
                                );
                            }
                        }

                        let ref_ = p.store_name_in_ref(name).expect("unreachable");
                        let value = p.new_expr(E::Identifier::init(ref_), key.loc);

                        // Destructuring patterns have an optional default value
                        let mut initializer: Option<Expr> = None;
                        if errors.is_some() && p.lexer.token == T::TEquals {
                            errors.as_mut().unwrap().invalid_expr_default_value =
                                Some(p.lexer.range());
                            p.lexer.next()?;
                            initializer = Some(p.parse_expr(Level::Comma)?);
                        }

                        return Ok(Some(G::Property {
                            kind,
                            key: Some(key),
                            value: Some(value),
                            initializer,
                            flags: flags::Property::WasShorthand.into(),
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
                        && (kind == PropertyKind::Normal || kind == PropertyKind::AutoAccessor)
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
                    has_type_parameters = p.skip_type_script_type_parameters(
                        TypeParameterFlag::ALLOW_CONST_MODIFIER,
                    )? != SkipTypeParameterResult::DidNotSkipAnything;
                }
            }

            // Parse a class field with an optional initial value
            if opts.is_class
                && (kind == PropertyKind::Normal || kind == PropertyKind::AutoAccessor)
                && !opts.is_async
                && !opts.is_generator
                && p.lexer.token != T::TOpenParen
                && !has_type_parameters
                && (p.lexer.token != T::TOpenParen || has_definite_assignment_assertion_operator)
            {
                let mut initializer: Option<Expr> = None;
                let mut ts_metadata = TsMetadata::default();

                // Forbid the names "constructor" and "prototype" in some cases
                if !is_computed {
                    match &key.data {
                        js_ast::ExprData::EString(str_) => {
                            if str_.eql_comptime(b"constructor")
                                || (opts.is_static && str_.eql_comptime(b"prototype"))
                            {
                                // TODO: fmt error message to include string value.
                                p.log().add_range_error(
                                    Some(p.source),
                                    key_range,
                                    b"Invalid field name",
                                );
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
                            ts_metadata = p.skip_type_script_type_with_metadata(Level::Lowest)?;
                        } else {
                            p.skip_type_script_type(Level::Lowest)?;
                        }
                    }
                }

                if p.lexer.token == T::TEquals {
                    if Self::IS_TYPESCRIPT_ENABLED {
                        if !opts.declare_range.is_empty() {
                            p.log().add_range_error(
                                Some(p.source),
                                p.lexer.range(),
                                b"Class fields that use \"declare\" cannot be initialized",
                            );
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
                    js_ast::ExprData::EPrivateIdentifier(private) => {
                        let name = p.load_name_from_ref(private.ref_);
                        if name == b"#constructor" {
                            p.log().add_range_error(
                                Some(p.source),
                                key_range,
                                b"Invalid field name \"#constructor\"",
                            );
                        }

                        let declare: symbol::Kind = if opts.is_static {
                            symbol::Kind::PrivateStaticField
                        } else {
                            symbol::Kind::PrivateField
                        };

                        private.ref_ = p
                            .declare_symbol(declare, key.loc, name)
                            .expect("unreachable");
                    }
                    _ => {}
                }

                p.lexer.expect_or_insert_semicolon()?;

                let mut prop_flags = flags::PropertySet::empty();
                if is_computed {
                    prop_flags.insert(flags::Property::IsComputed);
                }
                if opts.is_static {
                    prop_flags.insert(flags::Property::IsStatic);
                }

                return Ok(Some(G::Property {
                    ts_decorators: ExprNodeList::from_slice(&opts.ts_decorators),
                    kind,
                    flags: prop_flags,
                    key: Some(key),
                    initializer,
                    ts_metadata,
                    ..Default::default()
                }));
            }

            // Auto-accessor fields cannot be methods
            if kind == PropertyKind::AutoAccessor && p.lexer.token == T::TOpenParen {
                p.log().add_range_error(
                    Some(p.source),
                    key_range,
                    b"auto-accessor properties cannot have a method body",
                );
                return Err(err!("SyntaxError"));
            }

            // Parse a method expression
            if p.lexer.token == T::TOpenParen
                || kind != PropertyKind::Normal
                || opts.is_class
                || opts.is_async
                || opts.is_generator
            {
                return Self::parse_method_expression(
                    p,
                    kind,
                    opts,
                    is_computed,
                    &mut key,
                    key_range,
                );
            }

            // Parse an object key/value pair
            p.lexer.expect(T::TColon)?;
            let mut prop_flags = flags::PropertySet::empty();
            if is_computed {
                prop_flags.insert(flags::Property::IsComputed);
            }
            let mut property = G::Property {
                kind,
                flags: prop_flags,
                key: Some(key),
                value: Some(Expr {
                    data: js_ast::ExprData::EMissing(E::Missing {}),
                    loc: bun_ast::Loc::default(),
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

// ported from: src/js_parser/ast/parseProperty.zig
