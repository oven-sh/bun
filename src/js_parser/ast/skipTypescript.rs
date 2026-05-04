use bun_core::{self, err, Error};
use bun_logger as logger;
use bun_js_parser::{
    self as js_parser, JSXTransformType, ParseStatementOptions, Ref, SkipTypeParameterResult,
    TypeParameterFlag, TypeScript,
};
use bun_js_parser::ast::{self as js_ast, Op};
use bun_js_parser::ast::Op::Level;
use bun_js_parser::lexer::T;
use bun_js_parser::TypeScript::{Metadata, SkipTypeOptions};
// TODO(port): verify exact module paths for TypeScript::{Metadata, SkipTypeOptions, Identifier}
// TODO(port): narrow error set

// In Zig this file defines `fn SkipTypescript(comptime ts, comptime jsx, comptime scan_only) type`
// which returns an anonymous struct of associated fns taking `p: *P`. The parser type mixes these
// in via `usingnamespace`. In Rust we collapse this into an inherent `impl` block on the parser
// type `P` so call sites (`p.skip_type_script_type(...)`) match 1:1.
// PORT NOTE: reshaped — the `SkipTypescript` type-returning wrapper is dropped; methods live
// directly on `P<TS, JSX, SCAN_ONLY>`.

type P<const TS: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> =
    js_parser::NewParser_<TS, JSX, SCAN_ONLY>;

// Local alias matching Zig `const List = std.ArrayListUnmanaged;`
// js_parser is an AST crate (§Allocators) and the Zig feeds `p.allocator` (arena) into
// `List(Ref).initCapacity` / `.append`, so this is bumpalo-backed, not std `Vec`.
// TODO(port): `Metadata::MDot` payload type must agree with this (`bumpalo::collections::Vec<'bump, Ref>`); verify parser arena field name (`self.bump`).
type List<'bump, T> = bumpalo::collections::Vec<'bump, T>;

type SkipTypeOptionsBitset = SkipTypeOptions::Bitset;
// TODO(port): `SkipTypeOptions::Bitset` path — in Rust `SkipTypeOptions` is likely an enum and
// `Bitset` is `enumset::EnumSet<SkipTypeOptions>` or a sibling type. Adjust path in Phase B.

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    #[inline]
    pub fn skip_typescript_return_type(&mut self) -> Result<(), Error> {
        self.skip_type_script_type_with_opts::<false>(
            Level::Lowest,
            SkipTypeOptionsBitset::init_one(SkipTypeOptions::IsReturnType),
            None,
        )
    }

    #[inline]
    pub fn skip_typescript_return_type_with_metadata(&mut self) -> Result<Metadata, Error> {
        let mut result = Metadata::DEFAULT;
        self.skip_type_script_type_with_opts::<true>(
            Level::Lowest,
            SkipTypeOptionsBitset::init_one(SkipTypeOptions::IsReturnType),
            Some(&mut result),
        )?;
        Ok(result)
    }

    #[inline]
    pub fn skip_type_script_type(&mut self, level: Level) -> Result<(), Error> {
        self.mark_type_script_only();
        self.skip_type_script_type_with_opts::<false>(level, SkipTypeOptionsBitset::EMPTY, None)
    }

    #[inline]
    pub fn skip_type_script_type_with_metadata(&mut self, level: Level) -> Result<Metadata, Error> {
        self.mark_type_script_only();
        let mut result = Metadata::DEFAULT;
        self.skip_type_script_type_with_opts::<true>(
            level,
            SkipTypeOptionsBitset::EMPTY,
            Some(&mut result),
        )?;
        Ok(result)
    }

    pub fn skip_type_script_binding(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
        match self.lexer.token {
            T::TIdentifier | T::TThis => {
                self.lexer.next()?;
            }
            T::TOpenBracket => {
                self.lexer.next()?;

                // "[, , a]"

                while self.lexer.token == T::TComma {
                    self.lexer.next()?;
                }
                // "[a, b]"
                while self.lexer.token != T::TCloseBracket {
                    // "[...a]"
                    if self.lexer.token == T::TDotDotDot {
                        self.lexer.next()?;
                    }

                    self.skip_type_script_binding()?;

                    if self.lexer.token != T::TComma {
                        break;
                    }
                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBracket)?;
            }
            T::TOpenBrace => {
                self.lexer.next()?;

                while self.lexer.token != T::TCloseBrace {
                    let mut found_identifier = false;

                    match self.lexer.token {
                        T::TIdentifier => {
                            found_identifier = true;
                            self.lexer.next()?;
                        }

                        // "{...x}"
                        T::TDotDotDot => {
                            self.lexer.next()?;

                            if self.lexer.token != T::TIdentifier {
                                self.lexer.unexpected()?;
                            }

                            found_identifier = true;
                            self.lexer.next()?;
                        }

                        // "{1: y}"
                        // "{'x': y}"
                        T::TStringLiteral | T::TNumericLiteral => {
                            self.lexer.next()?;
                        }

                        _ => {
                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else {
                                self.lexer.unexpected()?;
                            }
                        }
                    }

                    if self.lexer.token == T::TColon || !found_identifier {
                        self.lexer.expect(T::TColon)?;
                        self.skip_type_script_binding()?;
                    }

                    if self.lexer.token != T::TComma {
                        break;
                    }

                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBrace)?;
            }
            _ => {
                // try p.lexer.unexpected();
                return Err(err!("Backtrack"));
            }
        }
        Ok(())
    }

    pub fn skip_typescript_fn_args(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();

        self.lexer.expect(T::TOpenParen)?;

        while self.lexer.token != T::TCloseParen {
            // "(...a)"
            if self.lexer.token == T::TDotDotDot {
                self.lexer.next()?;
            }

            self.skip_type_script_binding()?;

            // "(a?)"
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }

            // "(a: any)"
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            // "(a, b)"
            if self.lexer.token != T::TComma {
                break;
            }

            self.lexer.next()?;
        }

        self.lexer.expect(T::TCloseParen)?;
        Ok(())
    }

    /// This is a spot where the TypeScript grammar is highly ambiguous. Here are
    /// some cases that are valid:
    ///
    ///     let x = (y: any): (() => {}) => { };
    ///     let x = (y: any): () => {} => { };
    ///     let x = (y: any): (y) => {} => { };
    ///     let x = (y: any): (y[]) => {};
    ///     let x = (y: any): (a | b) => {};
    ///
    /// Here are some cases that aren't valid:
    ///
    ///     let x = (y: any): (y) => {};
    ///     let x = (y: any): (y) => {return 0};
    ///     let x = (y: any): asserts y is (y) => {};
    ///
    pub fn skip_type_script_paren_or_fn_type<const GET_METADATA: bool>(
        &mut self,
        result: Option<&mut Metadata>,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        if self.try_skip_type_script_arrow_args_with_backtracking() {
            self.skip_typescript_return_type()?;
            if GET_METADATA {
                *result.unwrap() = Metadata::MFunction;
            }
        } else {
            self.lexer.expect(T::TOpenParen)?;
            if GET_METADATA {
                *result.unwrap() = self.skip_type_script_type_with_metadata(Level::Lowest)?;
            } else {
                self.skip_type_script_type(Level::Lowest)?;
            }
            self.lexer.expect(T::TCloseParen)?;
        }
        Ok(())
    }

    // PORT NOTE: Zig signature is `result: if (get_metadata) *TypeScript.Metadata else void`.
    // Rust cannot express a const-generic-dependent param type on stable; we use
    // `Option<&mut Metadata>` and require callers to pass `Some` iff `GET_METADATA == true`.
    // The const generic is kept so `if GET_METADATA { ... }` branches monomorphize away.
    // PERF(port): was comptime monomorphization — profile in Phase B.
    pub fn skip_type_script_type_with_opts<const GET_METADATA: bool>(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
        mut result: Option<&mut Metadata>,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        loop {
            match self.lexer.token {
                T::TNumericLiteral => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MNumber;
                    }
                }
                T::TBigIntegerLiteral => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MBigint;
                    }
                }
                T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MString;
                    }
                }
                T::TTrue | T::TFalse => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MBoolean;
                    }
                }
                T::TNull => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MNull;
                    }
                }
                T::TVoid => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MVoid;
                    }
                }
                T::TConst => {
                    let r = self.lexer.range();
                    self.lexer.next()?;

                    // ["const: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.token == T::TColon
                    {
                        self.log
                            .add_range_error(self.source, r, "Unexpected \"const\"")?;
                    }
                }

                T::TThis => {
                    self.lexer.next()?;

                    // "function check(): this is boolean"
                    if self.lexer.is_contextual_keyword(b"is") && !self.lexer.has_newline_before {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        return Ok(());
                    }

                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MObject;
                    }
                }
                T::TMinus => {
                    // "-123"
                    // "-123n"
                    self.lexer.next()?;

                    if self.lexer.token == T::TBigIntegerLiteral {
                        self.lexer.next()?;
                        if GET_METADATA {
                            **result.as_mut().unwrap() = Metadata::MBigint;
                        }
                    } else {
                        self.lexer.expect(T::TNumericLiteral)?;
                        if GET_METADATA {
                            **result.as_mut().unwrap() = Metadata::MNumber;
                        }
                    }
                }
                T::TAmpersand | T::TBar => {
                    // Support things like "type Foo = | A | B" and "type Foo = & A & B"
                    self.lexer.next()?;
                    continue;
                }
                T::TImport => {
                    // "import('fs')"
                    self.lexer.next()?;

                    // "[import: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.token == T::TColon
                    {
                        return Ok(());
                    }

                    self.lexer.expect(T::TOpenParen)?;
                    self.lexer.expect(T::TStringLiteral)?;

                    // "import('./foo.json', { assert: { type: 'json' } })"
                    // "import('./foo.json', { with: { type: 'json' } })"
                    if self.lexer.token == T::TComma {
                        self.lexer.next()?;
                        self.skip_type_script_object_type()?;

                        // "import('./foo.json', { assert: { type: 'json' } }, )"
                        // "import('./foo.json', { with: { type: 'json' } }, )"
                        if self.lexer.token == T::TComma {
                            self.lexer.next()?;
                        }
                    }

                    self.lexer.expect(T::TCloseParen)?;
                }
                T::TNew => {
                    // "new () => Foo"
                    // "new <T>() => Foo<T>"
                    self.lexer.next()?;

                    // "[new: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.token == T::TColon
                    {
                        return Ok(());
                    }

                    let _ = self.skip_type_script_type_parameters(TypeParameterFlag {
                        allow_const_modifier: true,
                        ..TypeParameterFlag::default()
                    })?;
                    self.skip_type_script_paren_or_fn_type::<GET_METADATA>(
                        result.as_deref_mut(),
                    )?;
                }
                T::TLessThan => {
                    // "<T>() => Foo<T>"
                    let _ = self.skip_type_script_type_parameters(TypeParameterFlag {
                        allow_const_modifier: true,
                        ..TypeParameterFlag::default()
                    })?;
                    self.skip_type_script_paren_or_fn_type::<GET_METADATA>(
                        result.as_deref_mut(),
                    )?;
                }
                T::TOpenParen => {
                    // "(number | string)"
                    self.skip_type_script_paren_or_fn_type::<GET_METADATA>(
                        result.as_deref_mut(),
                    )?;
                }
                T::TIdentifier => {
                    let kind = TypeScript::Identifier::IMAP
                        .get(self.lexer.identifier)
                        .copied()
                        .unwrap_or(TypeScript::Identifier::Normal);
                    // TODO(port): `IMap` is a `ComptimeStringMap` → `phf::Map<&'static [u8], _>`

                    let mut check_type_parameters = true;

                    match kind {
                        TypeScript::Identifier::PrefixKeyof => {
                            self.lexer.next()?;

                            // Valid:
                            //   "[keyof: string]"
                            //   "{[keyof: string]: number}"
                            //   "{[keyof in string]: number}"
                            //
                            // Invalid:
                            //   "A extends B ? keyof : string"
                            //
                            if (self.lexer.token != T::TColon && self.lexer.token != T::TIn)
                                || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                    && !opts.contains(SkipTypeOptions::AllowTupleLabels))
                            {
                                self.skip_type_script_type(Level::Prefix)?;
                            }

                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MObject;
                            }

                            break;
                        }
                        TypeScript::Identifier::PrefixReadonly => {
                            self.lexer.next()?;

                            if (self.lexer.token != T::TColon && self.lexer.token != T::TIn)
                                || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                    && !opts.contains(SkipTypeOptions::AllowTupleLabels))
                            {
                                self.skip_type_script_type(Level::Prefix)?;
                            }

                            // assume array or tuple literal
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MArray;
                            }

                            break;
                        }
                        TypeScript::Identifier::Infer => {
                            self.lexer.next()?;

                            // "type Foo = Bar extends [infer T] ? T : null"
                            // "type Foo = Bar extends [infer T extends string] ? T : null"
                            // "type Foo = Bar extends [infer T extends string ? infer T : never] ? T : null"
                            // "type Foo = { [infer in Bar]: number }"
                            if (self.lexer.token != T::TColon && self.lexer.token != T::TIn)
                                || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                    && !opts.contains(SkipTypeOptions::AllowTupleLabels))
                            {
                                self.lexer.expect(T::TIdentifier)?;
                                if self.lexer.token == T::TExtends {
                                    let _ = self
                                        .try_skip_type_script_constraint_of_infer_type_with_backtracking(
                                            opts,
                                        );
                                }
                            }

                            break;
                        }
                        TypeScript::Identifier::Unique => {
                            self.lexer.next()?;

                            // "let foo: unique symbol"
                            if self.lexer.is_contextual_keyword(b"symbol") {
                                self.lexer.next()?;
                                break;
                            }
                        }
                        TypeScript::Identifier::Abstract => {
                            self.lexer.next()?;

                            // "let foo: abstract new () => {}" added in TypeScript 4.2
                            if self.lexer.token == T::TNew {
                                continue;
                            }
                        }
                        TypeScript::Identifier::Asserts => {
                            self.lexer.next()?;

                            // "function assert(x: boolean): asserts x"
                            // "function assert(x: boolean): asserts x is boolean"
                            if opts.contains(SkipTypeOptions::IsReturnType)
                                && !self.lexer.has_newline_before
                                && (self.lexer.token == T::TIdentifier
                                    || self.lexer.token == T::TThis)
                            {
                                self.lexer.next()?;
                            }
                        }
                        TypeScript::Identifier::PrimitiveAny => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MAny;
                            }
                        }
                        TypeScript::Identifier::PrimitiveNever => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MNever;
                            }
                        }
                        TypeScript::Identifier::PrimitiveUnknown => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MUnknown;
                            }
                        }
                        TypeScript::Identifier::PrimitiveUndefined => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MUndefined;
                            }
                        }
                        TypeScript::Identifier::PrimitiveObject => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MObject;
                            }
                        }
                        TypeScript::Identifier::PrimitiveNumber => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MNumber;
                            }
                        }
                        TypeScript::Identifier::PrimitiveString => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MString;
                            }
                        }
                        TypeScript::Identifier::PrimitiveBoolean => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MBoolean;
                            }
                        }
                        TypeScript::Identifier::PrimitiveBigint => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MBigint;
                            }
                        }
                        TypeScript::Identifier::PrimitiveSymbol => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result.as_mut().unwrap() = Metadata::MSymbol;
                            }
                        }
                        _ => {
                            if GET_METADATA {
                                let find_result = self
                                    .find_symbol(logger::Loc::EMPTY, self.lexer.identifier)
                                    .expect("unreachable");
                                **result.as_mut().unwrap() =
                                    Metadata::MIdentifier(find_result.r#ref);
                            }

                            self.lexer.next()?;
                        }
                    }

                    // "function assert(x: any): x is boolean"
                    if self.lexer.is_contextual_keyword(b"is") && !self.lexer.has_newline_before {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        return Ok(());
                    }

                    // "let foo: any \n <number>foo" must not become a single type
                    if check_type_parameters && !self.lexer.has_newline_before {
                        let _ = self.skip_type_script_type_arguments::<false>()?;
                    }
                }
                T::TTypeof => {
                    self.lexer.next()?;

                    // "[typeof: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.token == T::TColon
                    {
                        return Ok(());
                    }

                    // always `Object`
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MObject;
                    }

                    if self.lexer.token == T::TImport {
                        // "typeof import('fs')"
                        continue;
                    } else {
                        // "typeof x"
                        if !self.lexer.is_identifier_or_keyword() {
                            self.lexer.expected(T::TIdentifier)?;
                        }
                        self.lexer.next()?;

                        // "typeof x.#y"
                        // "typeof x.y"
                        while self.lexer.token == T::TDot {
                            self.lexer.next()?;

                            if !self.lexer.is_identifier_or_keyword()
                                && self.lexer.token != T::TPrivateIdentifier
                            {
                                self.lexer.expected(T::TIdentifier)?;
                            }
                            self.lexer.next()?;
                        }

                        if !self.lexer.has_newline_before {
                            let _ = self.skip_type_script_type_arguments::<false>()?;
                        }
                    }
                }
                T::TOpenBracket => {
                    // "[number, string]"
                    // "[first: number, second: string]"
                    self.lexer.next()?;

                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MArray;
                    }

                    while self.lexer.token != T::TCloseBracket {
                        if self.lexer.token == T::TDotDotDot {
                            self.lexer.next()?;
                        }
                        self.skip_type_script_type_with_opts::<false>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::init_one(SkipTypeOptions::AllowTupleLabels),
                            None,
                        )?;
                        if self.lexer.token == T::TQuestion {
                            self.lexer.next()?;
                        }
                        if self.lexer.token == T::TColon {
                            self.lexer.next()?;
                            self.skip_type_script_type(Level::Lowest)?;
                        }
                        if self.lexer.token != T::TComma {
                            break;
                        }
                        self.lexer.next()?;
                    }
                    self.lexer.expect(T::TCloseBracket)?;
                }
                T::TOpenBrace => {
                    self.skip_type_script_object_type()?;
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MObject;
                    }
                }
                T::TTemplateHead => {
                    // "`${'a' | 'b'}-${'c' | 'd'}`"
                    loop {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        self.lexer.rescan_close_brace_as_template_token()?;

                        if self.lexer.token == T::TTemplateTail {
                            self.lexer.next()?;
                            break;
                        }
                    }
                    if GET_METADATA {
                        **result.as_mut().unwrap() = Metadata::MString;
                    }
                }

                _ => {
                    // "[function: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.is_identifier_or_keyword()
                    {
                        if self.lexer.token != T::TFunction {
                            self.lexer.unexpected()?;
                        }
                        self.lexer.next()?;

                        if self.lexer.token != T::TColon {
                            self.lexer.expect(T::TColon)?;
                        }

                        return Ok(());
                    }

                    self.lexer.unexpected()?;
                }
            }
            break;
        }

        loop {
            match self.lexer.token {
                T::TBar => {
                    if level.gte(Level::BitwiseOr) {
                        return Ok(());
                    }

                    self.lexer.next()?;

                    if GET_METADATA {
                        let mut left = (**result.as_mut().unwrap()).clone();
                        // TODO(port): Metadata may be Copy; clone() used defensively
                        if let Some(final_) = left.finish_union(self) {
                            // finish skipping the rest of the type without collecting type metadata.
                            **result.as_mut().unwrap() = final_;
                            self.skip_type_script_type_with_opts::<false>(
                                Level::BitwiseOr,
                                opts,
                                None,
                            )?;
                        } else {
                            self.skip_type_script_type_with_opts::<GET_METADATA>(
                                Level::BitwiseOr,
                                opts,
                                result.as_deref_mut(),
                            )?;
                            result.as_mut().unwrap().merge_union(left);
                        }
                    } else {
                        self.skip_type_script_type_with_opts::<false>(
                            Level::BitwiseOr,
                            opts,
                            None,
                        )?;
                    }
                }
                T::TAmpersand => {
                    if level.gte(Level::BitwiseAnd) {
                        return Ok(());
                    }

                    self.lexer.next()?;

                    if GET_METADATA {
                        let mut left = (**result.as_mut().unwrap()).clone();
                        if let Some(final_) = left.finish_intersection(self) {
                            // finish skipping the rest of the type without collecting type metadata.
                            **result.as_mut().unwrap() = final_;
                            self.skip_type_script_type_with_opts::<false>(
                                Level::BitwiseAnd,
                                opts,
                                None,
                            )?;
                        } else {
                            self.skip_type_script_type_with_opts::<GET_METADATA>(
                                Level::BitwiseAnd,
                                opts,
                                result.as_deref_mut(),
                            )?;
                            result.as_mut().unwrap().merge_intersection(left);
                        }
                    } else {
                        self.skip_type_script_type_with_opts::<false>(
                            Level::BitwiseAnd,
                            opts,
                            None,
                        )?;
                    }
                }
                T::TExclamation => {
                    // A postfix "!" is allowed in JSDoc types in TypeScript, which are only
                    // present in comments. While it's not valid in a non-comment position,
                    // it's still parsed and turned into a soft error by the TypeScript
                    // compiler. It turns out parsing this is important for correctness for
                    // "as" casts because the "!" token must still be consumed.
                    if self.lexer.has_newline_before {
                        return Ok(());
                    }

                    self.lexer.next()?;
                }
                T::TDot => {
                    self.lexer.next()?;
                    if !self.lexer.is_identifier_or_keyword() {
                        self.lexer.expect(T::TIdentifier)?;
                    }

                    if GET_METADATA {
                        let r = result.as_mut().unwrap();
                        if let Metadata::MIdentifier(id_ref) = **r {
                            let mut dot: List<'_, Ref> =
                                bumpalo::collections::Vec::with_capacity_in(2, self.bump);
                            // PERF(port): was assume_capacity
                            dot.push(id_ref);
                            let find_result = self
                                .find_symbol(logger::Loc::EMPTY, self.lexer.identifier)
                                .expect("unreachable");
                            // PERF(port): was assume_capacity
                            dot.push(find_result.r#ref);
                            **r = Metadata::MDot(dot);
                        } else if let Metadata::MDot(ref mut dot) = **r {
                            if self.lexer.is_identifier_or_keyword() {
                                let find_result = self
                                    .find_symbol(logger::Loc::EMPTY, self.lexer.identifier)
                                    .expect("unreachable");
                                dot.push(find_result.r#ref);
                            }
                        }
                        // PORT NOTE: reshaped for borrowck — `find_symbol` borrows `self` while
                        // `r`/`dot` borrow through `result` (disjoint from `self.lexer`); Phase B
                        // may need to capture `self.lexer.identifier` into a local first.
                    }

                    self.lexer.next()?;

                    // "{ <A extends B>(): c.d \n <E extends F>(): g.h }" must not become a single type
                    if !self.lexer.has_newline_before {
                        let _ = self.skip_type_script_type_arguments::<false>()?;
                    }
                }
                T::TOpenBracket => {
                    // "{ ['x']: string \n ['y']: string }" must not become a single type
                    if self.lexer.has_newline_before {
                        return Ok(());
                    }
                    self.lexer.next()?;
                    let mut skipped = false;
                    if self.lexer.token != T::TCloseBracket {
                        skipped = true;
                        self.skip_type_script_type(Level::Lowest)?;
                    }
                    self.lexer.expect(T::TCloseBracket)?;

                    if GET_METADATA {
                        let r = result.as_mut().unwrap();
                        if matches!(**r, Metadata::MNone) {
                            **r = Metadata::MArray;
                        } else {
                            // if something was skipped, it is object type
                            if skipped {
                                **r = Metadata::MObject;
                            } else {
                                **r = Metadata::MArray;
                            }
                        }
                    }
                }
                T::TExtends => {
                    // "{ x: number \n extends: boolean }" must not become a single type
                    if self.lexer.has_newline_before
                        || opts.contains(SkipTypeOptions::DisallowConditionalTypes)
                    {
                        return Ok(());
                    }

                    self.lexer.next()?;

                    // The type following "extends" is not permitted to be another conditional type
                    let mut extends_type = if GET_METADATA {
                        Some(Metadata::DEFAULT)
                    } else {
                        None
                    };
                    self.skip_type_script_type_with_opts::<GET_METADATA>(
                        Level::Lowest,
                        SkipTypeOptionsBitset::init_one(SkipTypeOptions::DisallowConditionalTypes),
                        extends_type.as_mut(),
                    )?;

                    if GET_METADATA {
                        // intersection
                        self.lexer.expect(T::TQuestion)?;
                        let mut left = self.skip_type_script_type_with_metadata(Level::Lowest)?;
                        self.lexer.expect(T::TColon)?;
                        if let Some(final_) = left.finish_intersection(self) {
                            **result.as_mut().unwrap() = final_;
                            self.skip_type_script_type(Level::Lowest)?;
                        } else {
                            self.skip_type_script_type_with_opts::<GET_METADATA>(
                                Level::BitwiseAnd,
                                SkipTypeOptionsBitset::EMPTY,
                                result.as_deref_mut(),
                            )?;
                            result.as_mut().unwrap().merge_intersection(left);
                        }
                    } else {
                        self.lexer.expect(T::TQuestion)?;
                        self.skip_type_script_type(Level::Lowest)?;
                        self.lexer.expect(T::TColon)?;
                        self.skip_type_script_type(Level::Lowest)?;
                    }
                }
                _ => {
                    return Ok(());
                }
            }
        }
    }

    pub fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();

        self.lexer.expect(T::TOpenBrace)?;

        while self.lexer.token != T::TCloseBrace {
            // "{ -readonly [K in keyof T]: T[K] }"
            // "{ +readonly [K in keyof T]: T[K] }"
            if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
                self.lexer.next()?;
            }

            // Skip over modifiers and the property identifier
            let mut found_key = false;
            while self.lexer.is_identifier_or_keyword()
                || self.lexer.token == T::TStringLiteral
                || self.lexer.token == T::TNumericLiteral
            {
                self.lexer.next()?;
                found_key = true;
            }

            if self.lexer.token == T::TOpenBracket {
                // Index signature or computed property
                self.lexer.next()?;
                self.skip_type_script_type_with_opts::<false>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::init_one(SkipTypeOptions::IsIndexSignature),
                    None,
                )?;

                // "{ [key: string]: number }"
                // "{ readonly [K in keyof T]: T[K] }"
                match self.lexer.token {
                    T::TColon => {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                    }
                    T::TIn => {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        if self.lexer.is_contextual_keyword(b"as") {
                            // "{ [K in keyof T as `get-${K}`]: T[K] }"
                            self.lexer.next()?;
                            self.skip_type_script_type(Level::Lowest)?;
                        }
                    }
                    _ => {}
                }

                self.lexer.expect(T::TCloseBracket)?;

                // "{ [K in keyof T]+?: T[K] }"
                // "{ [K in keyof T]-?: T[K] }"
                match self.lexer.token {
                    T::TPlus | T::TMinus => {
                        self.lexer.next()?;
                    }
                    _ => {}
                }

                found_key = true;
            }

            // "?" indicates an optional property
            // "!" indicates an initialization assertion
            if found_key
                && (self.lexer.token == T::TQuestion || self.lexer.token == T::TExclamation)
            {
                self.lexer.next()?;
            }

            // Type parameters come right after the optional mark
            let _ = self.skip_type_script_type_parameters(TypeParameterFlag {
                allow_const_modifier: true,
                ..TypeParameterFlag::default()
            })?;

            match self.lexer.token {
                T::TColon => {
                    // Regular property
                    if !found_key {
                        self.lexer.expect(T::TIdentifier)?;
                    }

                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                }
                T::TOpenParen => {
                    // Method signature
                    self.skip_typescript_fn_args()?;

                    if self.lexer.token == T::TColon {
                        self.lexer.next()?;
                        self.skip_typescript_return_type()?;
                    }
                }
                _ => {
                    if !found_key {
                        self.lexer.unexpected()?;
                        return Err(err!("SyntaxError"));
                    }
                }
            }
            match self.lexer.token {
                T::TCloseBrace => {}
                T::TComma | T::TSemicolon => {
                    self.lexer.next()?;
                }
                _ => {
                    if !self.lexer.has_newline_before {
                        self.lexer.unexpected()?;
                        return Err(err!("SyntaxError"));
                    }
                }
            }
        }
        self.lexer.expect(T::TCloseBrace)?;
        Ok(())
    }

    // This is the type parameter declarations that go with other symbol
    // declarations (class, function, type, etc.)
    pub fn skip_type_script_type_parameters(
        &mut self,
        flags: TypeParameterFlag,
    ) -> Result<SkipTypeParameterResult, Error> {
        self.mark_type_script_only();

        if self.lexer.token != T::TLessThan {
            return Ok(SkipTypeParameterResult::DidNotSkipAnything);
        }

        let mut result = SkipTypeParameterResult::CouldBeTypeCast;
        self.lexer.next()?;

        if self.lexer.token == T::TGreaterThan && flags.allow_empty_type_parameters {
            self.lexer.next()?;
            return Ok(SkipTypeParameterResult::DefinitelyTypeParameters);
        }

        loop {
            let mut has_in = false;
            let mut has_out = false;
            let mut expect_identifier = true;

            let mut invalid_modifier_range = logger::Range::NONE;

            // Scan over a sequence of "in" and "out" modifiers (a.k.a. optional
            // variance annotations) as well as "const" modifiers
            loop {
                if self.lexer.token == T::TConst {
                    if invalid_modifier_range.len == 0 && !flags.allow_const_modifier {
                        // Valid:
                        //   "class Foo<const T> {}"
                        // Invalid:
                        //   "interface Foo<const T> {}"
                        invalid_modifier_range = self.lexer.range();
                    }

                    result = SkipTypeParameterResult::DefinitelyTypeParameters;
                    self.lexer.next()?;
                    expect_identifier = true;
                    continue;
                }

                if self.lexer.token == T::TIn {
                    if invalid_modifier_range.len == 0
                        && (!flags.allow_in_out_variance_annotations || has_in || has_out)
                    {
                        // Valid:
                        //   "type Foo<in T> = T"
                        // Invalid:
                        //   "type Foo<in in T> = T"
                        //   "type Foo<out in T> = T"
                        invalid_modifier_range = self.lexer.range();
                    }

                    self.lexer.next()?;
                    has_in = true;
                    expect_identifier = true;
                    continue;
                }

                if self.lexer.is_contextual_keyword(b"out") {
                    let r = self.lexer.range();
                    if invalid_modifier_range.len == 0 && !flags.allow_in_out_variance_annotations {
                        // Valid:
                        //   "type Foo<out T> = T"
                        // Invalid:
                        //   "type Foo<out out T> = T"
                        //   "type Foo<in out T> = T"
                        invalid_modifier_range = r;
                    }

                    self.lexer.next()?;
                    if invalid_modifier_range.len == 0
                        && has_out
                        && (self.lexer.token == T::TIn || self.lexer.token == T::TIdentifier)
                    {
                        // Valid:
                        //   "type Foo<out T> = T"
                        //   "type Foo<out out> = T"
                        //   "type Foo<out out, T> = T"
                        //   "type Foo<out out = T> = T"
                        //   "type Foo<out out extends T> = T"
                        // Invalid:
                        //   "type Foo<out out in T> = T"
                        //   "type Foo<out out T> = T"
                        invalid_modifier_range = r;
                    }
                    has_out = true;
                    expect_identifier = false;
                    continue;
                }

                break;
            }

            // Only report an error for the first invalid modifier
            if invalid_modifier_range.len > 0 {
                self.log.add_range_error_fmt(
                    self.source,
                    invalid_modifier_range,
                    format_args!(
                        "The modifier \"{}\" is not valid here",
                        bstr::BStr::new(self.source.text_for_range(invalid_modifier_range)),
                    ),
                )?;
            }

            // expectIdentifier => Mandatory identifier (e.g. after "type Foo <in ___")
            // !expectIdentifier => Optional identifier (e.g. after "type Foo <out ___" since "out" may be the identifier)
            if expect_identifier || self.lexer.token == T::TIdentifier {
                self.lexer.expect(T::TIdentifier)?;
            }

            // "class Foo<T extends number> {}"
            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            // "class Foo<T = void> {}"
            if self.lexer.token == T::TEquals {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            if self.lexer.token != T::TComma {
                break;
            }

            self.lexer.next()?;

            if self.lexer.token == T::TGreaterThan {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                break;
            }
        }

        self.lexer.expect_greater_than(false)?;
        Ok(result)
    }

    pub fn skip_type_script_type_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
    ) -> Result<(), Error> {
        if opts.is_export {
            match self.lexer.token {
                T::TOpenBrace => {
                    // "export type {foo}"
                    // "export type {foo} from 'bar'"
                    let _ = self.parse_export_clause()?;
                    if self.lexer.is_contextual_keyword(b"from") {
                        self.lexer.next()?;
                        let _ = self.parse_path()?;
                    }
                    self.lexer.expect_or_insert_semicolon()?;
                    return Ok(());
                }
                T::TAsterisk => {
                    // https://github.com/microsoft/TypeScript/pull/52217
                    // - export type * as Foo from 'bar';
                    // - export type Foo from 'bar';
                    self.lexer.next()?;
                    if self.lexer.is_contextual_keyword(b"as") {
                        // "export type * as ns from 'path'"
                        self.lexer.next()?;
                        let _ = self.parse_clause_alias(b"export")?;
                        self.lexer.next()?;
                    }
                    self.lexer.expect_contextual_keyword(b"from")?;
                    let _ = self.parse_path()?;
                    self.lexer.expect_or_insert_semicolon()?;
                    return Ok(());
                }
                _ => {}
            }
        }

        let name = self.lexer.identifier;
        self.lexer.expect(T::TIdentifier)?;

        if opts.is_module_scope {
            self.local_type_names
                .put(name, true)
                .expect("unreachable");
            // TODO(port): `local_type_names` is a StringHashMap — `put` drops allocator arg
        }

        let _ = self.skip_type_script_type_parameters(TypeParameterFlag {
            allow_in_out_variance_annotations: true,
            allow_empty_type_parameters: true,
            ..TypeParameterFlag::default()
        })?;

        self.lexer.expect(T::TEquals)?;
        self.skip_type_script_type(Level::Lowest)?;
        self.lexer.expect_or_insert_semicolon()?;
        Ok(())
    }

    pub fn skip_type_script_interface_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
    ) -> Result<(), Error> {
        let name = self.lexer.identifier;
        self.lexer.expect(T::TIdentifier)?;

        if opts.is_module_scope {
            self.local_type_names
                .put(name, true)
                .expect("unreachable");
        }

        let _ = self.skip_type_script_type_parameters(TypeParameterFlag {
            allow_in_out_variance_annotations: true,
            allow_empty_type_parameters: true,
            ..TypeParameterFlag::default()
        })?;

        if self.lexer.token == T::TExtends {
            self.lexer.next()?;

            loop {
                self.skip_type_script_type(Level::Lowest)?;
                if self.lexer.token != T::TComma {
                    break;
                }
                self.lexer.next()?;
            }
        }

        if self.lexer.is_contextual_keyword(b"implements") {
            self.lexer.next()?;
            loop {
                self.skip_type_script_type(Level::Lowest)?;
                if self.lexer.token != T::TComma {
                    break;
                }
                self.lexer.next()?;
            }
        }

        self.skip_type_script_object_type()?;
        Ok(())
    }

    pub fn skip_type_script_type_arguments<const IS_INSIDE_JSX_ELEMENT: bool>(
        &mut self,
    ) -> Result<bool, Error> {
        self.mark_type_script_only();
        match self.lexer.token {
            T::TLessThan
            | T::TLessThanEquals
            | T::TLessThanLessThan
            | T::TLessThanLessThanEquals => {}
            _ => {
                return Ok(false);
            }
        }

        self.lexer.expect_less_than(false)?;

        loop {
            self.skip_type_script_type(Level::Lowest)?;
            if self.lexer.token != T::TComma {
                break;
            }
            self.lexer.next()?;
        }

        // This type argument list must end with a ">"
        self.lexer.expect_greater_than(IS_INSIDE_JSX_ELEMENT)?;
        Ok(true)
    }

    // ───────────────────────── Backtracking ─────────────────────────
    // Zig defines `pub const Backtracking = struct { ... }` with comptime-reflective
    // `lexerBacktracker` / `lexerBacktrackerWithArgs` that branch on `bun.meta.ReturnOf(func)`.
    // Rust cannot inspect a closure's return type at compile time, so we split into two
    // concrete helpers covering the actual call patterns:
    //   - `lexer_backtracker_bool`   — fn returns Result<()>/Result<bool>, helper returns bool
    //   - `lexer_backtracker_result` — fn returns Result<SkipTypeParameterResult>
    // TODO(port): comptime reflection split into concrete helpers — verify behavior parity.

    #[inline]
    fn lexer_backtracker_bool<F, R>(&mut self, func: F) -> bool
    where
        F: FnOnce(&mut Self) -> Result<R, Error>,
    {
        self.mark_type_script_only();
        // PORT NOTE: Zig copies the lexer by value; Rust Lexer must be Clone.
        let old_lexer = self.lexer.clone();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        match func(self) {
            Ok(_) => {}
            Err(e) => {
                if e == err!("Backtrack") {
                    backtrack = true;
                } else if self.lexer.did_panic {
                    backtrack = true;
                }
            }
        }

        if backtrack {
            self.lexer.restore(&old_lexer);
        }
        self.lexer.is_log_disabled = old_log_disabled;

        // Covers both Zig branches:
        //   FnReturnType == anyerror!bool  → !backtrack
        //   ReturnType == bool/void        → !backtrack
        !backtrack
    }

    #[inline]
    fn lexer_backtracker_result<F>(&mut self, func: F) -> SkipTypeParameterResult
    where
        F: FnOnce(&mut Self) -> Result<SkipTypeParameterResult, Error>,
    {
        self.mark_type_script_only();
        let old_lexer = self.lexer.clone();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        let result = match func(self) {
            Ok(r) => r,
            Err(e) => {
                if e == err!("Backtrack") {
                    backtrack = true;
                } else if self.lexer.did_panic {
                    backtrack = true;
                }
                SkipTypeParameterResult::DidNotSkipAnything
            }
        };

        if backtrack {
            self.lexer.restore(&old_lexer);
        }
        self.lexer.is_log_disabled = old_log_disabled;

        result
    }

    #[inline]
    fn lexer_backtracker_with_args_bool<F>(&mut self, func: F) -> bool
    where
        F: FnOnce(&mut Self) -> Result<bool, Error>,
    {
        // PORT NOTE: matches Zig `lexerBacktrackerWithArgs` — does NOT check `did_panic` on
        // non-Backtrack errors (unlike `lexerBacktracker`).
        self.mark_type_script_only();
        let old_lexer = self.lexer.clone();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;

        let mut backtrack = false;
        match func(self) {
            Ok(_) => {}
            Err(e) => {
                if e == err!("Backtrack") {
                    backtrack = true;
                }
            }
        }

        if backtrack {
            self.lexer.restore(&old_lexer);
        }
        self.lexer.is_log_disabled = old_log_disabled;

        // FnReturnType == anyerror!bool path: returns true on success, false on backtrack.
        !backtrack
    }

    pub fn skip_type_script_type_parameters_then_open_paren_with_backtracking(
        &mut self,
    ) -> Result<SkipTypeParameterResult, Error> {
        let result = self.skip_type_script_type_parameters(TypeParameterFlag {
            allow_const_modifier: true,
            ..TypeParameterFlag::default()
        })?;
        if self.lexer.token != T::TOpenParen {
            return Err(err!("Backtrack"));
        }

        Ok(result)
    }

    pub fn skip_type_script_constraint_of_infer_type_with_backtracking(
        &mut self,
        flags: SkipTypeOptionsBitset,
    ) -> Result<bool, Error> {
        self.lexer.expect(T::TExtends)?;
        self.skip_type_script_type_with_opts::<false>(
            Level::Prefix,
            SkipTypeOptionsBitset::init_one(SkipTypeOptions::DisallowConditionalTypes),
            None,
        )?;

        if !flags.contains(SkipTypeOptions::DisallowConditionalTypes)
            && self.lexer.token == T::TQuestion
        {
            return Err(err!("Backtrack"));
        }

        Ok(true)
    }

    pub fn skip_type_script_arrow_args_with_backtracking(&mut self) -> Result<bool, Error> {
        self.skip_typescript_fn_args()?;
        if let Err(_) = self.lexer.expect(T::TEqualsGreaterThan) {
            return Err(err!("Backtrack"));
        }

        Ok(true)
    }

    pub fn skip_type_script_type_arguments_with_backtracking(&mut self) -> Result<bool, Error> {
        if self.skip_type_script_type_arguments::<false>()? {
            // Check the token after this and backtrack if it's the wrong one
            if !TypeScript::can_follow_type_arguments_in_expression(self) {
                return Err(err!("Backtrack"));
            }
        }

        Ok(true)
    }

    pub fn skip_type_script_arrow_return_type_with_backtracking(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TColon)?;

        self.skip_typescript_return_type()?;
        // Check the token after this and backtrack if it's the wrong one
        if self.lexer.token != T::TEqualsGreaterThan {
            return Err(err!("Backtrack"));
        }
        Ok(())
    }

    // ─────────────────────── try_* wrappers ───────────────────────

    pub fn try_skip_type_script_type_parameters_then_open_paren_with_backtracking(
        &mut self,
    ) -> SkipTypeParameterResult {
        self.lexer_backtracker_result(
            Self::skip_type_script_type_parameters_then_open_paren_with_backtracking,
        )
    }

    pub fn try_skip_type_script_type_arguments_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_type_arguments_with_backtracking)
    }

    pub fn try_skip_type_script_arrow_return_type_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_arrow_return_type_with_backtracking)
    }

    pub fn try_skip_type_script_arrow_args_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_arrow_args_with_backtracking)
    }

    pub fn try_skip_type_script_constraint_of_infer_type_with_backtracking(
        &mut self,
        flags: SkipTypeOptionsBitset,
    ) -> bool {
        self.lexer_backtracker_with_args_bool(|p| {
            p.skip_type_script_constraint_of_infer_type_with_backtracking(flags)
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/skipTypescript.zig (1317 lines)
//   confidence: medium
//   todos:      8
//   notes:      Zig type-returning fn collapsed into inherent impl on P<TS,JSX,SCAN_ONLY>; `comptime get_metadata` → const generic + Option<&mut Metadata>; Backtracking comptime reflection split into 3 concrete closure helpers; borrowck reshaping needed in TDot arm (find_symbol vs result borrow).
// ──────────────────────────────────────────────────────────────────────────
