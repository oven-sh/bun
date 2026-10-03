#![warn(unused_must_use)]

use bun_collections::VecExt;
use bun_core;

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
    G::{self, PropertyKind},
    Stmt, symbol,
};
use js_lexer::T;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    fn parse_method_expression(
        &mut self,
        kind: PropertyKind,
        opts: &mut PropertyOpts,
        is_computed: bool,
        key: &mut Expr,
        key_range: bun_ast::Range,
        type_parameters: Option<crate::sema::ts_syntax::TypeParams>,
    ) -> crate::CrateResult<Option<G::Property>> {
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
                        if (kind == PropertyKind::Get || kind == PropertyKind::Set)
                            && p.lexer.tolerant
                        {
                            // `checkAccessorDeclaration` objects to the word; the string is a name like any other.
                            if !matches!(
                                p.lexer.contents.get(key_range.loc.start as usize),
                                Some(b'"' | b'\'')
                            ) {
                                p.lexer.ts_grammar_error(key_range, 1341);
                            }
                        } else if kind == PropertyKind::Get {
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

        let mut func = p.parse_fn(
            None,
            FnOrArrowDataParse {
                needs_async_loc: p.real_loc(key.loc),
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
                // (`parseFunctionBlockOrSemicolon` allows it in object literals too, and the checker objects.)
                allow_missing_body_for_type_script: Self::IS_TYPESCRIPT_ENABLED
                    && (opts.is_class || p.lexer.tolerant),
                brace_or_semicolon: opts.is_class
                    && kind != PropertyKind::Get
                    && kind != PropertyKind::Set,
                ..Default::default()
            },
        )?;
        p.note_type_parameters(&mut func.open_parens_loc, type_parameters);

        opts.has_argument_decorators =
            opts.has_argument_decorators || p.fn_or_arrow_data_parse.has_argument_decorators;
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        // "class Foo { foo(): void; foo(): void {} }"
        if func.flags.contains(flags::Function::IsForwardDeclaration) {
            // A member of an object literal stays in the tree. The type checker is told of every member of a class.
            let stays = p.lexer.tolerant && !opts.is_class || p.preserves_type_syntax();
            if !stays {
                // Skip this property entirely
                p.pop_and_discard_scope(scope_index);
                return Ok(None);
            }
            if !opts.is_class && func.body.loc.is_empty() {
                // `checkGrammarMethod`, `checkGrammarAccessor`: '{' expected, at the last character of the member.
                let end = p.lexer.full_start();
                p.lexer.ts_grammar_expected(
                    bun_ast::Range {
                        loc: bun_ast::Loc {
                            start: end.start - 1,
                        },
                        len: 1,
                    },
                    "{",
                );
            }
        }

        p.pop_scope();
        func.flags.insert(flags::Function::IsUniqueFormalParameters);
        let args = func.args.slice();
        let value = p.new_expr(E::Function { func }, loc);

        // Enforce argument rules for accessors
        match kind {
            PropertyKind::Get => {
                if args.len() > 0 {
                    let r =
                        js_lexer::range_of_identifier(p.source, p.real_loc(args[0].binding.loc));
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
                            p.real_loc(args[0].binding.loc)
                        } else {
                            loc
                        },
                    );
                    if args.len() > 1 {
                        r = js_lexer::range_of_identifier(
                            p.source,
                            p.real_loc(args[1].binding.loc),
                        );
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
                    .declare_symbol(declare, p.real_loc(key.loc), name)
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

    /// `parsePropertyDeclaration`: the initializer of a field is outside the await and yield contexts of what is around
    /// the class, so both words are names here. `parse_prefix` still takes one for the start of an expression if an operand
    /// follows (`isAwaitExpression`, `isYieldExpression`).
    #[cold]
    #[inline(never)]
    fn parse_initializer_out_of_await_and_yield(&mut self) -> crate::CrateResult<Expr> {
        let old_await = self.fn_or_arrow_data_parse.allow_await;
        let old_yield = self.fn_or_arrow_data_parse.allow_yield;
        self.fn_or_arrow_data_parse.allow_await = AwaitOrYield::AllowIdent;
        self.fn_or_arrow_data_parse.allow_yield = AwaitOrYield::AllowIdent;
        let initializer = self.parse_expr(Level::Comma);
        self.fn_or_arrow_data_parse.allow_await = old_await;
        self.fn_or_arrow_data_parse.allow_yield = old_yield;
        initializer
    }

    pub(crate) fn parse_property(
        &mut self,
        kind_: PropertyKind,
        opts: &mut PropertyOpts,
        errors_: Option<&mut DeferredErrors>,
    ) -> crate::CrateResult<Option<G::Property>> {
        let p = self;
        if !p.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        let mut kind = kind_;
        let mut errors = errors_;
        // Tolerant mode: modifiers taken before a member of an object literal. `lone_object_modifier` is the only one,
        // if `checkGrammarMethod` reports it (1184).
        let mut has_object_modifier = false;
        let mut lone_object_modifier: Option<bun_ast::Range> = None;
        // This while loop exists to conserve stack space by reducing (but not completely eliminating) recursion.
        'restart: loop {
            // Every match arm below assigns `key` (or `continue 'restart` /
            // `return`) before any read.
            let mut key: Expr;
            let key_range = p.lexer.range();
            let mut is_computed = false;
            // Tolerant mode: the "?" or "!" after the name of an object literal member was taken.
            let mut has_postfix_token = false;

            match p.lexer.token {
                T::TNumericLiteral => {
                    key = p.new_expr(E::Number::new(p.lexer.number), p.lexer.loc());
                    // p.checkForLegacyOctalLiteral()
                    p.lexer.next()?;
                }
                T::TStringLiteral => {
                    key = p.parse_string_literal()?;
                    let next = p.lexer.loc();
                    p.note_loc(&mut key.loc, crate::sema::Mark::StringLiteralName, next);
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
                    // `parsePropertyNameWorker` takes a private name whatever decorates the member;
                    // `checkGrammarModifiers` objects to the decorators.
                    if !opts.is_class
                        || (opts.ts_decorators.len() > 0
                            && !p.options.features.standard_decorators
                            && !p.lexer.tolerant)
                    {
                        if p.lexer.tolerant {
                            // In an object literal: `checkGrammarObjectLiteralExpression`
                            p.lexer.ts_grammar_error(p.lexer.range(), 18016);
                        } else {
                            p.lexer.expected(T::TIdentifier)?;
                        }
                    }

                    let ident = p.lexer.identifier;
                    let ref_ = p.store_name_in_ref(ident);
                    key = p.new_expr(E::PrivateIdentifier { ref_ }, p.lexer.loc());
                    p.lexer.next()?;
                }
                T::TOpenBracket => {
                    // `parseClassElement` asks `isIndexSignature` after get/set and before a computed name.
                    if Self::IS_TYPESCRIPT_ENABLED
                        && p.lexer.tolerant
                        && opts.is_class
                        && !opts.is_generator
                        && !matches!(kind, PropertyKind::Get | PropertyKind::Set)
                        && p.is_unambiguously_index_signature()
                    {
                        p.parse_class_index_signature()?;
                        return Ok(None);
                    }
                    is_computed = true;
                    // p.markSyntaxFeature(compat.objectExtensions, p.lexer.range())
                    p.lexer.next()?;
                    let was_identifier = p.lexer.token == T::TIdentifier;
                    let mut expr = p.parse_expr(Level::Comma)?;

                    if p.lexer.token == T::TComma
                        && p.lexer.tolerant
                        // `nextIsUnambiguouslyIndexSignature`: `[id,` in a class starts an index signature.
                        && !(opts.is_class
                            && was_identifier
                            && matches!(expr.data, js_ast::ExprData::EIdentifier(_)))
                    {
                        // `parseComputedPropertyName` takes any expression; `checkGrammarComputedPropertyName`
                        // objects to the comma. In a class other checks of the member come first.
                        let start = p.real_loc(expr.loc);
                        p.parse_suffix(&mut expr, Level::Lowest, None, js_ast::expr::EFlags::None)?;
                        if !opts.is_class {
                            p.lexer.ts_grammar_error(p.lexer.range_from(start), 1171);
                        }
                    }

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
                    p.note_loc(&mut key.loc, crate::sema::Mark::ComputedName, key_range.loc);
                }
                T::TAsterisk => {
                    // `canFollowModifier`: `accessor` is a modifier before a `*` too.
                    if (kind != PropertyKind::Normal
                        && !(kind == PropertyKind::AutoAccessor && p.lexer.tolerant))
                        || opts.is_generator
                    {
                        p.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }

                    p.lexer.next()?;
                    opts.is_generator = true;
                    kind = PropertyKind::Normal;
                    continue 'restart;
                }

                _ => 'name: {
                    let name = p.lexer.identifier;
                    let raw = p.lexer.raw();
                    let name_range = p.lexer.range();

                    if !p.lexer.is_identifier_or_keyword() {
                        if p.lexer.tolerant && !p.lexer.is_log_disabled {
                            key = p.missing_property_name()?;
                            break 'name;
                        }
                        p.lexer.expect(T::TIdentifier)?;
                    }

                    p.lexer.next()?;

                    // Support contextual keywords
                    // `parseModifiersEx` takes the modifiers in whatever order: `accessor` need not be the last.
                    if (kind == PropertyKind::Normal
                        || (kind == PropertyKind::AutoAccessor && p.lexer.tolerant))
                        && !opts.is_generator
                    {
                        // Does the following token look like a key?
                        let could_be_modifier_keyword = p.lexer.is_identifier_or_keyword()
                            || matches!(
                                p.lexer.token,
                                T::TOpenBracket
                                    | T::TNumericLiteral
                                    | T::TStringLiteral
                                    | T::TPrivateIdentifier
                            )
                            || (p.lexer.token == T::TAsterisk
                                && (opts.is_async || (raw != b"get" && raw != b"set")))
                            // `isLiteralPropertyName`
                            || (p.lexer.token == T::TBigIntegerLiteral && p.lexer.tolerant);

                        // If so, check for a modifier keyword
                        if could_be_modifier_keyword {
                            // TODO: micro-optimization, use a smaller list for non-typescript files.
                            if let Some(keyword) = PropertyModifierKeyword::find(name) {
                                // `parseObjectLiteralElement` takes modifiers too.
                                if !opts.is_class
                                    && p.lexer.tolerant
                                    && Self::IS_TYPESCRIPT_ENABLED
                                    && !matches!(
                                        keyword,
                                        PropertyModifierKeyword::PGet
                                            | PropertyModifierKeyword::PSet
                                            | PropertyModifierKeyword::PAsync
                                    )
                                    && PropertyModifierKeyword::find(raw) == Some(keyword)
                                    && (keyword == PropertyModifierKeyword::PStatic
                                        || !p.lexer.has_newline_before)
                                {
                                    // `checkGrammarModifiers` has errors of its own for these three on a method.
                                    let is_plain = !matches!(
                                        keyword,
                                        PropertyModifierKeyword::PReadonly
                                            | PropertyModifierKeyword::PAbstract
                                            | PropertyModifierKeyword::PAccessor
                                    );
                                    lone_object_modifier =
                                        (is_plain && !has_object_modifier && !opts.is_async)
                                            .then_some(name_range);
                                    has_object_modifier = true;
                                    // `checkGrammarObjectLiteralExpression`
                                    p.lexer.ts_grammar_error(name_range, 1042);
                                    continue 'restart;
                                }
                                match keyword {
                                    PropertyModifierKeyword::PGet => {
                                        // `parseClassElement` takes every modifier first, "async" too, and then looks for "get". The
                                        // accessor is not parsed in an await context, and the checker reports the "async" (1042).
                                        if (!opts.is_async || p.lexer.tolerant)
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PGet)
                                        {
                                            opts.is_async = false;
                                            kind = PropertyKind::Get;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }

                                    PropertyModifierKeyword::PSet => {
                                        if (!opts.is_async || p.lexer.tolerant)
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PSet)
                                        {
                                            opts.is_async = false;
                                            // p.markSyntaxFeature(ObjectAccessors, name_range)
                                            kind = PropertyKind::Set;
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PAsync => {
                                        // `tryParseModifier` refuses no word for having been said, but `static`.
                                        if (!opts.is_async || p.lexer.tolerant)
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PAsync)
                                            && !p.lexer.has_newline_before
                                        {
                                            if opts.is_async && !opts.is_class {
                                                // `checkGrammarModifiers`. Those of a class member are gone over
                                                // when it is lowered.
                                                p.lexer.ts_grammar_error(name_range, 1030);
                                            }
                                            opts.is_async = true;
                                            p.push_member_modifier(opts, keyword, name_range.loc);

                                            // p.markSyntaxFeature(ObjectAccessors, name_range)

                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                    PropertyModifierKeyword::PStatic => {
                                        // `parseModifiersEx`: `static` is a modifier after `async` too.
                                        if !opts.is_static
                                            && (!opts.is_async || p.lexer.tolerant)
                                            && opts.is_class
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PStatic)
                                        {
                                            opts.is_static = true;
                                            p.push_member_modifier(opts, keyword, name_range.loc);
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
                                            && !p.lexer.has_newline_before
                                            && raw == b"declare"
                                        {
                                            p.push_member_modifier(opts, keyword, name_range.loc);
                                            let scope_index = p.scopes_in_order.len();
                                            if let Some(_prop) =
                                                p.parse_property(kind, opts, None)?
                                            {
                                                if p.preserves_type_syntax() {
                                                    return Ok(Some(_prop));
                                                }
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
                                        // `tryParseModifier`: a modifier the second time too.
                                        if opts.is_class
                                            && Self::IS_TYPESCRIPT_ENABLED
                                            && !p.lexer.has_newline_before
                                            && (!opts.is_ts_abstract || p.lexer.tolerant)
                                            && raw == b"abstract"
                                        {
                                            opts.is_ts_abstract = true;
                                            p.push_member_modifier(opts, keyword, name_range.loc);
                                            let scope_index = p.scopes_in_order.len();
                                            if let Some(prop) =
                                                p.parse_property(kind, opts, None)?
                                            {
                                                if p.preserves_type_syntax() {
                                                    return Ok(Some(prop));
                                                }
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
                                        // `tryParseModifier` knows of no option: a modifier with either kind of them.
                                        if opts.is_class
                                            && !p.lexer.has_newline_before
                                            && (p.options.features.standard_decorators
                                                || p.lexer.tolerant)
                                            && PropertyModifierKeyword::find(raw)
                                                == Some(PropertyModifierKeyword::PAccessor)
                                        {
                                            p.push_member_modifier(opts, keyword, name_range.loc);
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
                                        // `nextTokenIsOnSameLineAndCanFollowModifier`: a name before a line break.
                                        if opts.is_class
                                            && Self::IS_TYPESCRIPT_ENABLED
                                            && PropertyModifierKeyword::find(raw) == Some(keyword)
                                            && !(p.lexer.has_newline_before && p.lexer.tolerant)
                                        {
                                            p.push_member_modifier(opts, keyword, name_range.loc);
                                            errors = None;
                                            continue 'restart;
                                        }
                                    }
                                }
                            } else if p.lexer.tolerant
                                && Self::IS_TYPESCRIPT_ENABLED
                                && p.is_uncommon_modifier(raw, opts.is_class)
                            {
                                if !opts.is_class {
                                    lone_object_modifier = (raw == b"export"
                                        && !has_object_modifier
                                        && !opts.is_async)
                                        .then_some(name_range);
                                    has_object_modifier = true;
                                    // `checkGrammarObjectLiteralExpression`
                                    p.lexer.ts_grammar_error(name_range, 1042);
                                } else {
                                    p.push_uncommon_member_modifier(raw, name_range.loc);
                                }
                                continue 'restart;
                            }
                        } else if opts.is_class
                            && p.lexer.token == T::TOpenBrace
                            && name == b"static"
                        {
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
                            // `parseClassStaticBlockBody` is `parseBlock`.
                            p.lexer.expect_closing(T::TCloseBrace, loc)?;

                            // Vec::from_slice copies the bump-backed StmtList into a heap-backed list.
                            // TODO(perf): route ClassStaticBlock.stmts through arena slice directly.
                            let stmt_list = bun_alloc::AstVec::<Stmt>::from_slice(stmts.as_slice());
                            let block = p.arena.alloc(G::ClassStaticBlock {
                                stmts: stmt_list,
                                loc,
                            });

                            return Ok(Some(G::Property {
                                kind: PropertyKind::ClassStaticBlock,
                                class_static_block: Some(js_ast::StoreRef::from_bump(block)),
                                // For the type checker only: nothing else expects a static block to have any.
                                ts_decorators: if p.preserves_type_syntax() {
                                    ExprNodeList::from_slice(&opts.ts_decorators)
                                } else {
                                    ExprNodeList::from_slice(&[])
                                },
                                ..Default::default()
                            }));
                        } else if matches!(p.lexer.token, T::TOpenBrace | T::TDotDotDot)
                            && opts.is_class
                            && p.lexer.tolerant
                            && !p.lexer.is_log_disabled
                            && p.is_modifier_without_name(raw, opts.is_static)
                        {
                            // `parseClassElement`: a property whose name is missing, right after the last modifier.
                            let at = name_range.end();
                            p.lexer.ts_error(bun_ast::Range { loc: at, len: 0 }, 1146);
                            opts.is_static = opts.is_static || raw == b"static";
                            key = p.new_expr(E::EString::init(b""), at);
                            break 'name;
                        }
                    }

                    // Handle invalid identifiers in property names
                    // https://github.com/oven-sh/bun/issues/12039
                    // In tolerant mode the lexer has reported the character (1127).
                    if p.lexer.token == T::TSyntaxError && !p.lexer.tolerant {
                        p.log().add_range_error_fmt(
                            Some(p.source),
                            name_range,
                            format_args!("Unexpected {}", bun_core::fmt::quote(name)),
                        );
                        return Err(crate::Error::SyntaxError);
                    }

                    key = p.new_expr(E::EString::init(name), name_range.loc);

                    // `parseObjectLiteralElement` takes a "?" or "!" after the name. The checker reports it (1162, 1255).
                    if matches!(p.lexer.token, T::TQuestion | T::TExclamation)
                        && !opts.is_class
                        && kind == PropertyKind::Normal
                        && p.lexer.tolerant
                    {
                        p.note_loc(&mut key.loc, crate::sema::Mark::PostfixToken, p.lexer.loc());
                        if p.lexer.token == T::TQuestion {
                            p.note_loc(&mut key.loc, crate::sema::Mark::Optional, p.lexer.loc());
                        }
                        p.lexer.next()?;
                        has_postfix_token = true;
                    }

                    // Parse a shorthand property
                    let mut is_shorthand_property = !opts.is_class
                        && kind == PropertyKind::Normal
                        && p.lexer.token != T::TColon
                        && p.lexer.token != T::TOpenParen
                        && p.lexer.token != T::TLessThan
                        && !opts.is_generator
                        && !opts.is_async
                        && js_lexer::keyword(name).is_none();

                    if is_shorthand_property
                        && ((p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                            && name == b"await")
                            || (p.fn_or_arrow_data_parse.allow_yield != AwaitOrYield::AllowIdent
                                && name == b"yield"))
                    {
                        if p.lexer.tolerant {
                            if p.fn_or_arrow_data_parse.is_top_level
                                && p.fn_or_arrow_data_parse.allow_await == AwaitOrYield::AllowExpr
                            {
                                // At the top of a file `await` is a name to `parseObjectLiteralElement`;
                                // `checkContextualIdentifier` objects to it if the file is a module.
                                p.log().add_range_error(
                                    Some(p.source),
                                    name_range,
                                    b"Cannot use \"yield\" or \"await\" here.",
                                );
                            } else {
                                // `parseObjectLiteralElement`: `isIdentifier` refuses the word in its own context,
                                // so this is no shorthand and a `:` is expected.
                                is_shorthand_property = false;
                            }
                        } else if name == b"await" {
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

                    if is_shorthand_property {
                        let ref_ = p.store_name_in_ref(name);
                        let value = p.new_expr(E::Identifier::init(ref_), key.loc);

                        // Destructuring patterns have an optional default value
                        let mut initializer: Option<Expr> = None;
                        if let Some(errors) = errors.as_mut() {
                            if p.lexer.token == T::TEquals {
                                errors.invalid_expr_default_value = Some(p.lexer.range());
                                p.lexer.next()?;
                                initializer = Some(p.parse_expr(Level::Comma)?);
                            }
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
            let mut type_parameters = None;
            let mut has_definite_assignment_assertion_operator = false;

            if Self::IS_TYPESCRIPT_ENABLED {
                if opts.is_class {
                    if p.lexer.token == T::TQuestion {
                        // "class X { foo?: number }"
                        // "class X { foo!: number }"
                        p.note_loc(&mut key.loc, crate::sema::Mark::Optional, p.lexer.loc());
                        p.lexer.next()?;
                    } else if p.lexer.token == T::TExclamation
                        && !p.lexer.has_newline_before
                        && (kind == PropertyKind::Normal || kind == PropertyKind::AutoAccessor)
                        && !opts.is_async
                        && !opts.is_generator
                    {
                        // "class X { foo!: number }"
                        p.note_flag(&mut key.loc, crate::sema::Mark::Definite);
                        p.lexer.next()?;
                        has_definite_assignment_assertion_operator = true;
                    }
                } else if matches!(p.lexer.token, T::TQuestion | T::TExclamation)
                    && !has_postfix_token
                    && kind == PropertyKind::Normal
                    && p.lexer.tolerant
                {
                    // `parseObjectLiteralElement`, after a name that is a literal, computed or missing.
                    p.note_loc(&mut key.loc, crate::sema::Mark::PostfixToken, p.lexer.loc());
                    if p.lexer.token == T::TQuestion {
                        p.note_loc(&mut key.loc, crate::sema::Mark::Optional, p.lexer.loc());
                    }
                    p.lexer.next()?;
                }

                // "class X { foo?<T>(): T }"
                // "const x = { foo<T>(): T {} }"
                if !has_definite_assignment_assertion_operator {
                    let skipped = p.skip_type_script_type_parameters(
                        TypeParameterFlag::ALLOW_CONST_MODIFIER,
                    )?;
                    has_type_parameters = skipped != SkipTypeParameterResult::DidNotSkipAnything;
                    type_parameters = p.saved_type_parameters(skipped);
                }
            }

            // Parse a class field with an optional initial value
            if opts.is_class
                && (kind == PropertyKind::Normal || kind == PropertyKind::AutoAccessor)
                && (!opts.is_async || p.lexer.tolerant)
                && !opts.is_generator
                && p.lexer.token != T::TOpenParen
                && !has_type_parameters
                && (p.lexer.token != T::TOpenParen || has_definite_assignment_assertion_operator)
            {
                let mut initializer: Option<Expr> = None;
                let mut ts_metadata = TsMetadata::default();

                // Forbid the names "constructor" and "prototype" in some cases
                let mut is_constructor_keyword = false;
                if !is_computed {
                    match &key.data {
                        js_ast::ExprData::EString(str_) => {
                            if str_.eql_comptime(b"constructor")
                                || (opts.is_static && str_.eql_comptime(b"prototype"))
                            {
                                if p.lexer.tolerant {
                                    // TypeScript's parser accepts both names. The string "constructor" is a name like any other.
                                    is_constructor_keyword = str_.eql_comptime(b"constructor")
                                        && !matches!(
                                            p.lexer.contents.get(key_range.loc.start as usize),
                                            Some(b'"' | b'\'')
                                        );
                                } else {
                                    // TODO: fmt error message to include string value.
                                    p.log().add_range_error(
                                        Some(p.source),
                                        key_range,
                                        b"Invalid field name",
                                    );
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if is_constructor_keyword {
                    // `tryParseConstructorDeclaration`: the keyword alone makes a constructor. `parse_fn` reports the missing "(".
                    return Self::parse_method_expression(
                        p,
                        PropertyKind::Normal,
                        opts,
                        is_computed,
                        &mut key,
                        key_range,
                        None,
                    );
                }

                let has_type = Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon;
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
                        p.note_type(&mut key.loc, crate::sema::Mark::Annotation);
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

                    initializer = Some(if p.lexer.tolerant {
                        p.parse_initializer_out_of_await_and_yield()?
                    } else {
                        p.parse_expr(Level::Comma)?
                    });

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
                            .declare_symbol(declare, p.real_loc(key.loc), name)
                            .expect("unreachable");
                    }
                    _ => {}
                }

                if p.lexer.token != T::TSemicolon && p.lexer.tolerant && !p.lexer.is_log_disabled {
                    p.semicolon_after_property_name(
                        &key,
                        is_computed,
                        has_type,
                        initializer.is_some(),
                    )?;
                } else {
                    p.lexer.expect_or_insert_semicolon()?;
                }

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
                if !p.lexer.tolerant {
                    p.log().add_range_error(
                        Some(p.source),
                        key_range,
                        b"auto-accessor properties cannot have a method body",
                    );
                    return Err(crate::Error::SyntaxError);
                }
                // `parsePropertyOrMethodDeclaration`: a method all the same.
                // `checkGrammarModifiers` objects to `accessor`.
                kind = PropertyKind::Normal;
            }

            // Parse a method expression
            if p.lexer.token == T::TOpenParen
                || kind != PropertyKind::Normal
                || opts.is_class
                || opts.is_async
                || opts.is_generator
            {
                if let Some(modifier) = lone_object_modifier
                    && kind == PropertyKind::Normal
                {
                    // `checkGrammarMethod`
                    p.lexer.ts_grammar_error(modifier, 1184);
                }
                return Self::parse_method_expression(
                    p,
                    kind,
                    opts,
                    is_computed,
                    &mut key,
                    key_range,
                    type_parameters,
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

            // `errors` is Option<&mut _>; reborrow via as_deref_mut so the caller's binding stays usable
            p.parse_expr_or_bindings(
                Level::Comma,
                errors.as_deref_mut(),
                property.value.as_mut().unwrap(),
            )?;
            return Ok(Some(property));
        }
    }

    /// `tryParseModifier` for the words of `IsModifierKind` that `PropertyModifierKeyword` lacks: const, default, export, in, out.
    /// Called on the token after `word`, which is one that `canFollowModifier` accepts.
    #[cold]
    #[inline(never)]
    fn is_uncommon_modifier(&mut self, word: &[u8], is_class: bool) -> bool {
        match word {
            // Without `permitConstAsModifier`, only before `enum`.
            b"const" if !is_class => self.lexer.token == T::TEnum,
            b"const" | b"in" | b"out" => !self.lexer.has_newline_before,
            b"default" => self.can_follow_default_keyword(),
            b"export" => {
                let is_default = self.lexer.token == T::TDefault;
                if !is_default && !self.lexer.is_contextual_keyword(b"type") {
                    return self.can_follow_export_modifier();
                }
                let here = self.lexer.snapshot();
                self.lexer.is_log_disabled = true;
                let found = self.lexer.next().is_ok()
                    && if is_default {
                        self.can_follow_default_keyword()
                    } else {
                        self.can_follow_export_modifier()
                    };
                self.lexer.restore(&here);
                found
            }
            _ => false,
        }
    }

    /// `canFollowExportModifier`
    fn can_follow_export_modifier(&self) -> bool {
        match self.lexer.token {
            T::TAt
            | T::TOpenBracket
            | T::TDotDotDot
            | T::TPrivateIdentifier
            | T::TStringLiteral
            | T::TNumericLiteral
            | T::TBigIntegerLiteral => true,
            _ => self.lexer.is_identifier_or_keyword() && !self.lexer.is_contextual_keyword(b"as"),
        }
    }

    /// `nextTokenCanFollowDefaultKeyword`, on the token after `default`.
    fn can_follow_default_keyword(&mut self) -> bool {
        let wanted = match self.lexer.token {
            T::TClass | T::TFunction | T::TAt => return true,
            T::TIdentifier => match self.lexer.raw() {
                b"interface" => return true,
                b"abstract" => T::TClass,
                b"async" => T::TFunction,
                _ => return false,
            },
            _ => return false,
        };
        let here = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let found = self.lexer.next().is_ok()
            && self.lexer.token == wanted
            && !self.lexer.has_newline_before;
        self.lexer.restore(&here);
        found
    }

    /// Whether `word` is a modifier of a class member before the `{` or `...` the lexer is at. `canFollowModifier` accepts both,
    /// and neither starts a name.
    #[cold]
    #[inline(never)]
    fn is_modifier_without_name(&self, word: &[u8], has_static: bool) -> bool {
        match word {
            // `tryParseModifier`: a second `static` is a name.
            b"static" => !has_static,
            // `canFollowExportModifier`
            b"export" => self.lexer.token != T::TOpenBrace,
            b"abstract" | b"accessor" | b"async" | b"const" | b"declare" | b"in" | b"out"
            | b"override" | b"private" | b"protected" | b"public" | b"readonly" => {
                !self.lexer.has_newline_before
            }
            _ => false,
        }
    }

    /// `parseIdentifierName` at a token that is no name: reports 1003 and makes a missing name (`createMissingIdentifier`).
    /// Consumes nothing.
    #[cold]
    #[inline(never)]
    fn missing_property_name(&mut self) -> crate::CrateResult<Expr> {
        let at = self.lexer.full_start();
        if self.lexer.token == T::TEndOfFile {
            self.lexer
                .ts_error(bun_ast::Range { loc: at, len: 0 }, 1003);
        } else {
            self.lexer.expect(T::TIdentifier)?;
        }
        Ok(self.new_expr(E::EString::init(b""), at))
    }

    /// `parseSemicolonAfterPropertyName`, at the token after a class field.
    #[cold]
    #[inline(never)]
    fn semicolon_after_property_name(
        &mut self,
        key: &Expr,
        is_computed: bool,
        has_type: bool,
        has_initializer: bool,
    ) -> crate::CrateResult<()> {
        let before = self.lexer.prev_error_loc;
        let here = self.lexer.range();
        if self.lexer.token == T::TAt && !self.lexer.has_newline_before {
            self.lexer.ts_error(here, 1436);
            self.lexer.put_up_with(before)?;
            return Ok(());
        }
        if self.lexer.token == T::TOpenParen {
            self.lexer.ts_error(here, 1441);
            self.lexer.next()?;
            return Ok(());
        }
        if self.can_parse_semicolon() {
            self.lexer.expect_or_insert_semicolon()?;
            return Ok(());
        }
        if has_initializer {
            self.lexer.expect(T::TSemicolon)?;
            return Ok(());
        }
        if has_type {
            self.lexer.ts_error(here, 1442);
            self.lexer.put_up_with(before)?;
            return Ok(());
        }
        // Only an identifier or keyword has a text for `parseErrorForMissingSemicolonAfter`.
        let name: &[u8] = match &key.data {
            js_ast::ExprData::EString(text)
                if !is_computed
                    && text.is_utf8()
                    && !matches!(
                        self.lexer
                            .contents
                            .get(self.real_loc(key.loc).start as usize),
                        Some(b'"' | b'\'')
                    ) =>
            {
                text.slice8()
            }
            _ => b"",
        };
        self.missing_semicolon_after(name, self.real_loc(key.loc))
    }
}
