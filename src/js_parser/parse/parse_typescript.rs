#![warn(unused_must_use)]
use bun_collections::VecExt;

use crate::Error;
use crate::lexer::{self as js_lexer, T};
use crate::p::P;
use crate::parse::lists::{ListKind, ListStep};
use crate::parser::AwaitOrYield;
use crate::parser::{FnOrArrowDataParse, ParseStatementOptions, Ref, ScopeOrder, StatementScope};
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::expr::EFlags;
use bun_ast::flags;
use bun_ast::op::Level;
use bun_ast::scope::Kind as ScopeKind;
use bun_ast::symbol::Kind as SymbolKind;
use bun_ast::ts::Data as TSNamespaceMemberData;
use bun_ast::{
    self as js_ast, B, E, EnumValue, Expr, ExprNodeIndex, ExprNodeList, G, LocRef, S, Stmt,
    StmtData, TSNamespaceMember, TSNamespaceMemberMap,
};
use bun_core::strings;

// `ts::Data` carries only Copy payloads but lacks a `derive(Clone)` upstream;
// local helper so we can re-insert values fetched from `ref_to_ts_namespace_member`.
#[inline]
fn clone_ts_member_data(d: &TSNamespaceMemberData) -> TSNamespaceMemberData {
    match d {
        TSNamespaceMemberData::Property => TSNamespaceMemberData::Property,
        TSNamespaceMemberData::Namespace(m) => TSNamespaceMemberData::Namespace(*m),
        TSNamespaceMemberData::EnumNumber(n) => TSNamespaceMemberData::EnumNumber(*n),
        TSNamespaceMemberData::EnumString(s) => TSNamespaceMemberData::EnumString(*s),
        TSNamespaceMemberData::EnumProperty => TSNamespaceMemberData::EnumProperty,
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    pub(crate) fn parse_type_script_decorators(&mut self) -> Result<ExprNodeList, Error> {
        let p = self;
        if !Self::IS_TYPESCRIPT_ENABLED && !p.options.features.standard_decorators {
            return Ok(bun_alloc::AstAlloc::vec());
        }

        let mut decorators: BumpVec<'_, ExprNodeIndex> = BumpVec::new_in(p.arena);
        while p.lexer.token == T::TAt {
            let at_sign = p.lexer.loc();
            p.lexer.next()?;

            if p.is_tolerant() {
                let mut decorator = p.parse_decorator_expression_tolerant()?;
                p.note_loc(&mut decorator.loc, crate::sema::Mark::AtSign, at_sign);
                p.note_token_full_start(&mut decorator.loc, crate::sema::Mark::DecoratorEnd);
                decorators.push(decorator);
                continue;
            }

            if p.options.features.standard_decorators {
                // TC39 standard decorator grammar:
                //   @Identifier
                //   @Identifier.member
                //   @Identifier.member(args)
                //   @(Expression)
                decorators.push(p.parse_standard_decorator()?);
            } else {
                // Parse a new/call expression with "exprFlagTSDecorator" so we ignore
                // EIndex expressions, since they may be part of a computed property:
                //
                //   class Foo {
                //     @foo ['computed']() {}
                //   }
                //
                // This matches the behavior of the TypeScript compiler.
                let mut expr = Expr::EMPTY;
                p.parse_expr_with_flags(Level::New, EFlags::TsDecorator, &mut expr)?;
                decorators.push(expr);
            }
        }

        Ok(ExprNodeList::from_bump_vec(decorators))
    }

    /// `parseDecoratorExpression`: any left-hand-side expression, for both kinds of decorators. The checker reports 1497.
    #[cold]
    #[inline(never)]
    fn parse_decorator_expression_tolerant(&mut self) -> Result<ExprNodeIndex, Error> {
        let p = self;
        let is_await_keyword = p.lexer.token == T::TIdentifier
            && p.lexer.raw() == b"await"
            && p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent;
        // `parse_prefix` starts a unary expression or a cast at these. `parsePrimaryExpression` has no case for them.
        let starts_no_primary_expression = matches!(
            p.lexer.token,
            T::TLessThan
                | T::TVoid
                | T::TTypeof
                | T::TDelete
                | T::TPlus
                | T::TMinus
                | T::TTilde
                | T::TExclamation
                | T::TPlusPlus
                | T::TMinusMinus
        );
        if is_await_keyword || starts_no_primary_expression {
            // 1109 and a missing identifier. Only `await` is consumed.
            let (range, before) = (p.lexer.range(), p.lexer.prev_error_loc);
            p.lexer.ts_error(range, 1109);
            let mut expr = p.new_expr(E::Missing {}, range.loc);
            if is_await_keyword {
                // In a script `await` is an identifier at the top level: the file is then reparsed.
                if p.fn_or_arrow_data_parse.is_top_level {
                    p.top_level_await_keyword = range;
                }
                p.lexer.next()?;
            } else {
                p.lexer.put_up_with(before)?;
            }
            p.parse_suffix(&mut expr, Level::New, None, EFlags::TsDecorator)?;
            return Ok(expr);
        }
        let mut expr = Expr::EMPTY;
        p.parse_expr_with_flags(Level::New, EFlags::TsDecorator, &mut expr)?;
        Ok(expr)
    }

    /// The decorators of a missing declaration or of a `this` parameter. They stay in TypeScript's
    /// tree, and `checkDecorators` never visits them. Each becomes a statement of the list being
    /// parsed. `end`: the start of the syntax that follows them.
    #[cold]
    #[inline(never)]
    pub(crate) fn note_stray_decorators(&mut self, decorators: &[Expr], end: bun_ast::Loc) {
        if !self.is_tolerant() || self.lexer.is_log_disabled || !self.preserves_type_syntax() {
            return;
        }
        for decorator in decorators {
            self.note_stray_decorator(decorator, end);
            self.stray_decorators.push(*decorator);
        }
    }

    /// Parse a standard (TC39) decorator expression following the `@` token.
    ///
    /// DecoratorExpression:
    ///   @ IdentifierReference
    ///   @ DecoratorMemberExpression
    ///   @ DecoratorCallExpression
    ///   @ DecoratorParenthesizedExpression
    pub(crate) fn parse_standard_decorator(&mut self) -> Result<ExprNodeIndex, Error> {
        let p = self;

        // @(Expression) — parenthesized, any expression allowed
        if p.lexer.token == T::TOpenParen {
            let open = p.lexer.loc();
            p.lexer.next()?;
            let mut expr = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            p.mark_paren(&mut expr, open, bun_ast::Loc::EMPTY);
            return Ok(expr);
        }

        // Must start with an identifier
        if p.lexer.token != T::TIdentifier {
            p.lexer.expect(T::TIdentifier)?;
            return Err(crate::Error::SyntaxError);
        }

        let loc = p.lexer.loc();
        let ident = p.lexer.identifier;
        let ref_ = p.store_name_in_ref(ident);
        let mut expr = p.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            loc,
        );
        p.lexer.next()?;

        loop {
            match p.lexer.token {
                T::TExclamation => {
                    // Skip over TypeScript non-null assertions
                    if p.lexer.has_newline_before {
                        break;
                    }
                    if !Self::IS_TYPESCRIPT_ENABLED {
                        p.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                    p.lexer.next()?;
                }

                T::TDot | T::TQuestionDot => {
                    // The grammar for "DecoratorMemberExpression" currently forbids "?."
                    if p.lexer.token == T::TQuestionDot {
                        p.log().add_range_error(
                            Some(p.source),
                            p.lexer.range(),
                            b"Optional chaining is not allowed in decorator expressions; wrap the expression in parentheses to use it as a decorator",
                        );
                    }
                    p.lexer.next()?;

                    if p.lexer.token == T::TPrivateIdentifier && p.allow_private_identifiers {
                        let name = p.lexer.identifier;
                        let name_loc = p.lexer.loc();
                        p.lexer.next()?;
                        let ref_ = p.store_name_in_ref(name);
                        let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
                        expr = p.new_expr(
                            E::Index {
                                target: expr,
                                index,
                                optional_chain: None,
                                is_import_property_use: false,
                            },
                            loc,
                        );
                    } else {
                        if !p.lexer.is_identifier_or_keyword() {
                            p.lexer.expect(T::TIdentifier)?;
                            return Err(crate::Error::SyntaxError);
                        }
                        let name = E::Str::new(p.lexer.identifier);
                        let name_loc = p.lexer.loc();
                        p.lexer.next()?;
                        expr = p.new_expr(
                            E::Dot {
                                target: expr,
                                name,
                                name_loc,
                                ..Default::default()
                            },
                            loc,
                        );
                    }
                }

                T::TOpenParen => {
                    let args = p.parse_call_args()?;
                    expr = p.new_expr(
                        E::Call {
                            target: expr,
                            args: args.list,
                            close_paren_loc: args.loc,
                            ..Default::default()
                        },
                        loc,
                    );

                    // The grammar for "DecoratorCallExpression" is terminal
                    if p.lexer.token == T::TDot {
                        p.log().add_range_error(
                            Some(p.source),
                            p.lexer.range(),
                            b"A decorator call expression cannot be followed by a property access; wrap the expression in parentheses to use it as a decorator",
                        );
                        continue;
                    }
                    break;
                }

                _ => {
                    // "@x<y>" / "@x.y<z>"
                    if Self::IS_TYPESCRIPT_ENABLED
                        && p.skip_type_script_type_arguments::<false, false>()?
                    {
                        continue;
                    }
                    break;
                }
            }
        }

        Ok(expr)
    }

    pub(crate) fn parse_type_script_namespace_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
        is_nested: bool,
        is_module_keyword: bool,
    ) -> Result<Stmt, Error> {
        let p = self;
        // "namespace foo {}";
        let name_loc = p.lexer.loc();
        let mut name_text = p.lexer.identifier;
        // `parseModuleDeclaration`: `parseAmbientExternalModuleDeclaration` only right after `module`.
        let name_is_string = p.lexer.token == T::TStringLiteral
            && (is_module_keyword && !is_nested || !p.is_tolerant());
        let mut string_name: &'a [u8] = b"";
        let mut has_body = true;
        // `parseIdentifierName` after a dot, `parseIdentifier` after `namespace`.
        let is_name = if is_nested {
            p.is_identifier_or_keyword()
        } else {
            p.is_identifier_in_context()
        };
        if is_name || !p.is_tolerant() {
            p.lexer.next()?;
        } else {
            // A string names no symbol. Any other token is not consumed, and the name is missing.
            name_text = b"";
            if name_is_string {
                if p.preserves_type_syntax() {
                    string_name = p.lexer.to_utf8_e_string()?.data.slice();
                }
                p.lexer.next()?;
            } else {
                p.report_missing_identifier()?;
            }
        }

        // Generate the namespace object
        // Arena-owned `StoreRef<TSNamespaceScope>`.
        let mut ts_namespace: js_ast::StoreRef<js_ast::TSNamespaceScope> =
            p.get_or_create_exported_namespace_members(name_text, opts.is_export, false);
        let mut exported_members: js_ast::StoreRef<TSNamespaceMemberMap> =
            ts_namespace.exported_members;
        let ns_member_data = TSNamespaceMemberData::Namespace(exported_members);

        // Declare the namespace and create the scope
        let mut name = LocRef {
            loc: name_loc,
            ref_: Ref::NONE,
        };
        let scope_index = p.push_scope_for_parse_pass(ScopeKind::Entry, loc)?;
        p.current_scope_mut().ts_namespace = Some(ts_namespace);

        let old_has_non_local_export_declare_inside_namespace =
            p.has_non_local_export_declare_inside_namespace;
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        p.has_non_local_export_declare_inside_namespace = false;
        p.fn_or_arrow_data_parse = FnOrArrowDataParse {
            is_this_disallowed: true,
            is_return_disallowed: true,
            // parse_fn.rs reads is_top_level to consume a react-hooks
            // suppression after a namespace member function; every other
            // consumer is gated on allow_await == AllowExpr (AllowIdent here).
            is_top_level: old_fn_or_arrow_data.is_top_level,
            ..Default::default()
        };
        // `parseModuleBlock` stays in the [Await] and [Yield] contexts of the function around it.
        if p.is_tolerant() && !old_fn_or_arrow_data.is_top_level {
            p.fn_or_arrow_data_parse.allow_await = old_fn_or_arrow_data.allow_await;
            p.fn_or_arrow_data_parse.allow_yield = old_fn_or_arrow_data.allow_yield;
        }

        // Parse the statements inside the namespace
        let mut stmts: BumpVec<'_, Stmt> = BumpVec::new_in(p.arena);
        if p.lexer.token == T::TDot {
            let dot_loc = p.lexer.loc();
            p.lexer.next()?;
            let inner_start = p.lexer.loc();
            let inner_full_start = p.lexer.full_start();

            let mut _opts = ParseStatementOptions {
                is_export: true,
                scope: StatementScope::Namespace,
                is_typescript_declare: opts.is_typescript_declare,
                ..ParseStatementOptions::default()
            };
            if !p.stack_check.is_safe_to_recurse() {
                return Err(crate::Error::StackOverflow);
            }
            let inner_loc = if p.preserves_type_syntax() {
                inner_start
            } else {
                dot_loc
            };
            let mut inner =
                p.parse_type_script_namespace_stmt(inner_loc, &mut _opts, true, is_module_keyword)?;
            p.finish_node(&mut inner.loc, inner_full_start);
            stmts.push(inner);
        } else if p.lexer.token != T::TOpenBrace
            // `parseAmbientExternalModuleDeclaration`: in TypeScript only a module named by a
            // string may omit its body.
            && (if p.is_tolerant() {
                name_is_string
            } else {
                opts.is_typescript_declare
            })
        {
            has_body = false;
            p.lexer.expect_or_insert_semicolon()?;
        } else {
            // `parseModuleBlock`: without a "{" there are no statements and no "}" is expected.
            let has_body = p.lexer.token == T::TOpenBrace || !p.is_tolerant();
            p.lexer.expect(T::TOpenBrace)?;
            let mut _opts = ParseStatementOptions {
                scope: StatementScope::Namespace,
                is_typescript_declare: opts.is_typescript_declare,
                ..ParseStatementOptions::default()
            };
            if has_body {
                stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut _opts)?;
                p.lexer.expect(T::TCloseBrace)?;
            }
        }
        let has_non_local_export_declare_inside_namespace =
            p.has_non_local_export_declare_inside_namespace;
        p.has_non_local_export_declare_inside_namespace =
            old_has_non_local_export_declare_inside_namespace;
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // The rest is only needed for code generation.
        if p.preserves_type_syntax() {
            use crate::sema::parse_declarations::ModuleNameKind;
            p.pop_and_discard_scope(scope_index);
            let (name, kind) = if name_is_string {
                (string_name, ModuleNameKind::String)
            } else if is_module_keyword {
                (name_text, ModuleNameKind::AfterModule)
            } else {
                (name_text, ModuleNameKind::Identifier)
            };
            let body = has_body.then(|| stmts.into_bump_slice_mut());
            return Ok(p.keep_module(loc, name_loc, name, kind, body, opts.is_export));
        }

        // Add any exported members from this namespace's body as members of the
        // associated namespace object.
        for stmt in stmts.iter() {
            match &stmt.data {
                StmtData::SFunction(func) => {
                    if func.func.flags.contains(flags::Function::IsExport) {
                        let locref = func.func.name.unwrap();
                        let ref_ = locref.ref_;
                        // SAFETY: original_name is an arena-owned slice valid for 'a.
                        let fn_name: &[u8] =
                            p.symbols[ref_.inner_index() as usize].original_name.slice();
                        exported_members.put(
                            fn_name,
                            TSNamespaceMember {
                                loc: locref.loc,
                                data: TSNamespaceMemberData::Property,
                            },
                        )?;
                        p.ref_to_ts_namespace_member
                            .insert(ref_, TSNamespaceMemberData::Property);
                    }
                }
                StmtData::SClass(class) => {
                    if class.is_export {
                        // Tolerant mode: `export class {}`.
                        let Some(locref) = class.class.class_name else {
                            continue;
                        };
                        let ref_ = locref.ref_;
                        // SAFETY: original_name is an arena-owned slice valid for 'a.
                        let class_name: &[u8] =
                            p.symbols[ref_.inner_index() as usize].original_name.slice();
                        exported_members.put(
                            class_name,
                            TSNamespaceMember {
                                loc: locref.loc,
                                data: TSNamespaceMemberData::Property,
                            },
                        )?;
                        p.ref_to_ts_namespace_member
                            .insert(ref_, TSNamespaceMemberData::Property);
                    }
                }
                StmtData::SNamespace(ns) => {
                    if ns.is_export {
                        let ref_ = ns.name.ref_;
                        if let Some(member_data) = p.ref_to_ts_namespace_member.get(&ref_) {
                            let member_data = clone_ts_member_data(member_data);
                            // SAFETY: original_name is arena-owned, valid for 'a.
                            let ns_name: &[u8] =
                                p.symbols[ref_.inner_index() as usize].original_name.slice();
                            exported_members.put(
                                ns_name,
                                TSNamespaceMember {
                                    data: clone_ts_member_data(&member_data),
                                    loc: ns.name.loc,
                                },
                            )?;
                            p.ref_to_ts_namespace_member.insert(ref_, member_data);
                        }
                    }
                }
                StmtData::SEnum(ns) => {
                    if ns.is_export {
                        let ref_ = ns.name.ref_;
                        if let Some(member_data) = p.ref_to_ts_namespace_member.get(&ref_) {
                            let member_data = clone_ts_member_data(member_data);
                            // SAFETY: original_name is arena-owned, valid for 'a.
                            let enum_name: &[u8] =
                                p.symbols[ref_.inner_index() as usize].original_name.slice();
                            exported_members.put(
                                enum_name,
                                TSNamespaceMember {
                                    data: clone_ts_member_data(&member_data),
                                    loc: ns.name.loc,
                                },
                            )?;
                            p.ref_to_ts_namespace_member.insert(ref_, member_data);
                        }
                    }
                }
                StmtData::SLocal(local) => {
                    if local.is_export {
                        for decl in local.decls.slice() {
                            p.define_exported_namespace_binding(
                                &mut exported_members,
                                decl.binding,
                            )?;
                        }
                    }
                }
                _ => {}
            }
        }

        // Import assignments may be only used in type expressions, not value
        // expressions. If this is the case, the TypeScript compiler removes
        // them entirely from the output. That can cause the namespace itself
        // to be considered empty and thus be removed.
        let mut import_equal_count: usize = 0;
        for stmt in stmts.iter() {
            match &stmt.data {
                StmtData::SLocal(local) => {
                    if local.origin.is_ts_import_equals() && !local.is_export {
                        import_equal_count += 1;
                    }
                }
                _ => {}
            }
        }

        // TypeScript omits namespaces without values. These namespaces
        // are only allowed to be used in type expressions. They are
        // allowed to be exported, but can also only be used in type
        // expressions when imported. So we shouldn't count them as a
        // real export either.
        //
        // TypeScript also strangely counts namespaces containing only
        // "export declare" statements as non-empty even though "declare"
        // statements are only type annotations. We cannot omit the namespace
        // in that case. See https://github.com/evanw/esbuild/issues/1158.
        if (stmts.len() == import_equal_count && !has_non_local_export_declare_inside_namespace)
            || opts.is_typescript_declare
        {
            p.pop_and_discard_scope(scope_index);
            if opts.scope.is_module() {
                p.local_type_names.put(name_text, true)?;
            }
            return Ok(p.s(S::TypeScript::default(), loc));
        }

        let mut arg_ref = Ref::NONE;
        if !opts.is_typescript_declare {
            // Avoid a collision with the namespace closure argument variable if the
            // namespace exports a symbol with the same name as the namespace itself:
            //
            //   namespace foo {
            //     export let foo = 123
            //     console.log(foo)
            //   }
            //
            // TypeScript generates the following code in this case:
            //
            //   var foo;
            //   (function (foo_1) {
            //     foo_1.foo = 123;
            //     console.log(foo_1.foo);
            //   })(foo || (foo = {}));
            //
            // SAFETY: current_scope is an arena-owned Scope pointer valid for 'a.
            if p.current_scope().members.contains_key(name_text) {
                // Add a "_" to make tests easier to read, since non-bundler tests don't
                // run the renamer. Keep adding "_" until the argument does not collide
                // with a symbol declared in the namespace body: paths that skip the
                // renamer (runtime transpiler, Bun.Transpiler, `bun build --no-bundle`)
                // print symbols by their original name, so a colliding argument would
                // re-declare a block-scoped member:
                //
                //   namespace m { class m {} class _m {} }
                //
                // Candidates are built in the parse arena; the
                // chosen one becomes the symbol's original name and is freed together
                // with the rest of the AST arena.
                let mut underscores: usize = 1;
                let prefixed: &'a [u8] = loop {
                    let candidate = p
                        .arena
                        .alloc_slice_fill_copy(underscores + name_text.len(), b'_');
                    candidate[underscores..].copy_from_slice(name_text);
                    if !p.current_scope().members.contains_key(candidate) {
                        break candidate;
                    }
                    underscores += 1;
                };
                arg_ref = p.new_symbol(SymbolKind::Hoisted, prefixed);
            } else {
                // Not a member: a reference to the name inside the namespace
                // resolves to a merged sibling's export of that name first.
                arg_ref = p.new_symbol(SymbolKind::Hoisted, name_text);
            }
            // Named in this scope so that no binding inside shadows it.
            VecExt::append(&mut p.current_scope_mut().generated, arg_ref);
            ts_namespace.arg_ref = arg_ref;
        }
        p.pop_scope();

        if !opts.is_typescript_declare {
            name.ref_ = p.declare_symbol(SymbolKind::TsNamespace, name_loc, name_text)?;
            p.ref_to_ts_namespace_member
                .insert(name.ref_, ns_member_data);
        }

        // S::Namespace.stmts is `StoreSlice<Stmt>` (arena slice). BumpVec → bump slice.
        let stmts_slice: &'a mut [Stmt] = stmts.into_bump_slice_mut();
        Ok(p.s(
            S::Namespace {
                name,
                arg: arg_ref,
                stmts: bun_ast::StoreSlice::new_mut(stmts_slice),
                is_export: opts.is_export,
            },
            loc,
        ))
    }

    pub(crate) fn parse_type_script_import_equals_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
        default_name_loc: bun_ast::Loc,
        default_name: &'a [u8],
    ) -> Result<Stmt, Error> {
        let p = self;
        p.lexer.expect(T::TEquals)?;
        let names_base = p.begin_entity_name();
        let mut external = None;

        let kind = js_ast::LocalKind::KConst;
        // `parseEntityName`: any token but a name is not consumed, and the name is missing.
        let is_name = matches!(p.lexer.token, T::TIdentifier | T::TPrivateIdentifier);
        let name: &'a [u8] = if is_name || !p.is_tolerant() {
            p.lexer.identifier
        } else {
            b""
        };
        let target_ref = p.store_name_in_ref(name);
        let target_loc = p.lexer.loc();
        let target = p.new_expr(
            E::Identifier {
                ref_: target_ref,
                ..Default::default()
            },
            target_loc,
        );
        let mut value = target;
        p.push_entity_name();
        let escaped_name = if p.lexer.token == T::TIdentifier {
            p.lexer.escaped_word()
        } else {
            None
        };
        p.expect_identifier()?;

        if name == b"require" && p.lexer.token == T::TOpenParen {
            // "import ns = require('x')"
            p.lexer.keyword_was_taken(escaped_name);
            p.lexer.next()?;
            let path = if p.lexer.token != T::TStringLiteral && p.is_tolerant() {
                // `parseModuleSpecifier`: any expression. `checkExternalImportOrExportDeclaration` reports 1141 unless it is
                // missing. `checkGrammarModuleElementContext` returns first.
                let at = p.lexer.loc();
                let specifier = p.parse_expr(Level::Lowest)?;
                let is_written = !specifier.is_missing();
                if is_written && p.is_in_appropriate_context() {
                    p.ts_checker_error(p.lexer.range_from(at), 1141);
                }
                external = Some(crate::sema::ts_syntax::ModuleReference::External {
                    text: None,
                    loc: at,
                    expression: is_written.then_some(specifier),
                });
                specifier
            } else {
                external = p.external_module_reference();
                let path_estr = p.lexer.to_e_string()?;
                let path_loc = p.lexer.loc();
                let path = p.new_expr(path_estr, path_loc);
                p.lexer.expect(T::TStringLiteral)?;
                path
            };
            p.lexer.expect(T::TCloseParen)?;
            if !opts.is_typescript_declare {
                let args = ExprNodeList::init_one(path);
                let close_paren_loc = p.lexer.loc();
                value = p.new_expr(
                    E::Call {
                        target,
                        close_paren_loc,
                        args,
                        ..Default::default()
                    },
                    loc,
                );
            }
        } else {
            // "import Foo = Bar"
            // "import Foo = Bar.Baz"
            let mut prev_value = value;
            while p.lexer.token == T::TDot {
                p.lexer.next()?;
                if p.is_tolerant() && p.lexer.token == T::TPrivateIdentifier {
                    let name = p.skip_private_identifier_after_dot()?;
                    if p.preserves_type_syntax() {
                        p.type_syntax_mut().name_stack.push(name);
                    }
                    continue;
                }
                p.push_entity_name();
                let dot_name = E::Str::new(p.lexer.identifier);
                let dot_name_loc = p.lexer.loc();
                value = p.new_expr(
                    E::Dot {
                        target: prev_value,
                        name: dot_name,
                        name_loc: dot_name_loc,
                        ..Default::default()
                    },
                    loc,
                );
                p.lexer.expect(T::TIdentifier)?;
                prev_value = value;
            }
        }

        p.lexer.expect_or_insert_semicolon()?;

        if p.preserves_type_syntax() {
            return Ok(p.keep_import_equals(names_base, external, loc));
        }
        if opts.is_typescript_declare {
            // "import type foo = require('bar');"
            // "import type foo = bar.baz;"
            return Ok(p.s(S::TypeScript::default(), loc));
        }

        let ref_ = p
            .declare_symbol(SymbolKind::Constant, default_name_loc, default_name)
            .expect("unreachable");
        let binding = p.b(B::Identifier { r#ref: ref_ }, default_name_loc);
        let decls = G::DeclList::init_one(G::Decl {
            binding,
            value: Some(value),
        });
        Ok(p.s(
            S::Local {
                kind,
                decls,
                is_export: opts.is_export,
                origin: S::LocalOrigin::TsImportEquals,
            },
            loc,
        ))
    }

    /// `parsePropertyName` for the names of enum members that only TypeScript's parser accepts: a number, a bigint, a private name or
    /// `[expression]`. The checker reports them (2452, 18024, 1164). Leaves the lexer on the last token of the name. Returns false if
    /// the current token starts no such name.
    #[cold]
    #[inline(never)]
    fn parse_other_enum_member_name(&mut self, value: &mut EnumValue) -> Result<bool, Error> {
        let p = self;
        match p.lexer.token {
            T::TNumericLiteral => {
                let text = bun_sema::atom::number_to_string(p.lexer.number);
                value.name = js_ast::StoreStr::new(p.arena.alloc_slice_copy(&text));
                p.note(&mut value.loc, crate::sema::Mark::NameKind, 2);
            }
            T::TBigIntegerLiteral => value.name = js_ast::StoreStr::new(p.lexer.raw()),
            T::TPrivateIdentifier => value.name = js_ast::StoreStr::new(p.lexer.identifier),
            T::TOpenBracket => {
                p.lexer.next()?;
                // `[("a")]`: a `ParenthesizedExpression` is no literal.
                let is_literal = p.lexer.token != T::TOpenParen;
                let old_allow_in = core::mem::replace(&mut p.allow_in, true);
                let name = p.parse_expr(Level::Lowest);
                p.allow_in = old_allow_in;
                // `["a"]` and `[1]` are names like `"a"` and `1`. Any other expression leaves the member without a name.
                let name = name?;
                match name.data {
                    js_ast::ExprData::EString(string) if is_literal && !string.is_utf16 => {
                        value.name = string.data;
                        p.note(&mut value.loc, crate::sema::Mark::NameKind, 3);
                    }
                    js_ast::ExprData::ENumber(number) if is_literal => {
                        let text = bun_sema::atom::number_to_string(number.value());
                        value.name = js_ast::StoreStr::new(p.arena.alloc_slice_copy(&text));
                        p.note(&mut value.loc, crate::sema::Mark::NameKind, 4);
                    }
                    js_ast::ExprData::EString(_) if is_literal => {}
                    // `checkEnumMember` never checks it.
                    _ => {
                        p.note_expr(&mut value.loc, crate::sema::Mark::ComputedName, name);
                    }
                }
                if p.lexer.token != T::TCloseBracket {
                    p.lexer.expect(T::TCloseBracket)?;
                    return Err(crate::Error::SyntaxError);
                }
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    pub(crate) fn parse_typescript_enum_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt, Error> {
        let p = self;
        p.lexer.expect(T::TEnum)?;
        let mut name_loc = p.lexer.loc();
        let mut name_text: &'a [u8] = p.lexer.identifier;
        // `parseIdentifier`: any other token but a private name is not consumed, and the name is
        // missing.
        if p.is_tolerant()
            && p.lexer.token != T::TPrivateIdentifier
            && !p.is_identifier_in_context()
        {
            name_loc = p.report_missing_identifier()?;
            name_text = b"";
        } else {
            p.expect_identifier()?;
        }
        let mut name = LocRef {
            loc: name_loc,
            ref_: Ref::NONE,
        };

        // Generate the namespace object
        let mut arg_ref: Ref = Ref::NONE;
        let mut ts_namespace: js_ast::StoreRef<js_ast::TSNamespaceScope> =
            p.get_or_create_exported_namespace_members(name_text, opts.is_export, true);
        let mut exported_members: js_ast::StoreRef<TSNamespaceMemberMap> =
            ts_namespace.exported_members;

        // Declare the enum and create the scope
        let scope_index = p.scopes_in_order.len();
        if !opts.is_typescript_declare {
            name.ref_ = p.declare_symbol(SymbolKind::TsEnum, name_loc, name_text)?;
            let _ = p.push_scope_for_parse_pass(ScopeKind::Entry, loc)?;
            p.current_scope_mut().ts_namespace = Some(ts_namespace);
            // Overwrite allowed: on a forbidden redeclaration `declare_symbol` returns
            // the existing ref for every colliding enum, so the key repeats; the value
            // is the same map `get_or_create_exported_namespace_members` already reused.
            p.ref_to_ts_namespace_member.insert(
                name.ref_,
                TSNamespaceMemberData::Namespace(exported_members),
            );
        } else if p.preserves_type_syntax() {
            name = p.keep_name(name_loc, name_text);
        }

        // `parseEnumDeclaration`: without a "{" there are no members and no "}" is expected.
        let has_body = p.lexer.token == T::TOpenBrace || !p.is_tolerant();
        p.lexer.expect(T::TOpenBrace)?;

        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        p.fn_or_arrow_data_parse = FnOrArrowDataParse {
            is_this_disallowed: true,
            // See the namespace body: preserve is_top_level for parse_fn.rs's
            // react-hooks suppression consume.
            is_top_level: old_fn_or_arrow_data.is_top_level,
            ..Default::default()
        };

        // Parse the body
        let mut values: BumpVec<'_, EnumValue> = BumpVec::new_in(p.arena);
        let saved_contexts = p.enter_list(ListKind::EnumMembers);
        while p.lexer.token != T::TCloseBrace && has_body {
            match p.classify_list_token(ListKind::EnumMembers)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let value_full_start = p.lexer.full_start();
            let mut value = EnumValue {
                loc: p.lexer.loc(),
                ref_: Ref::NONE,
                name: js_ast::StoreStr::new(b"" as &[u8]),
                value: None,
            };
            // Parse the name
            let needs_symbol: bool = if p.lexer.token == T::TStringLiteral {
                // `slice8()` is currently duplicated in E.rs (two impl blocks);
                // read `.data` directly — `to_utf8_e_string` guarantees `is_utf16 == false`.
                let estr = p.lexer.to_utf8_e_string()?;
                debug_assert!(!estr.is_utf16);
                value.name = estr.data;
                p.note(&mut value.loc, crate::sema::Mark::NameKind, 1);
                js_lexer::is_identifier(value.name.slice())
            } else if p.lexer.is_identifier_or_keyword() {
                value.name = js_ast::StoreStr::new(p.lexer.identifier);
                true
            } else if p.is_tolerant() && p.parse_other_enum_member_name(&mut value)? {
                false
            } else {
                p.lexer.expect(T::TIdentifier)?;
                // error early, name is still `undefined`
                return Err(crate::Error::SyntaxError);
            };
            p.lexer.next()?;

            // Identifiers can be referenced by other values
            if !opts.is_typescript_declare && needs_symbol {
                value.ref_ =
                    p.declare_symbol(SymbolKind::Other, p.real_loc(value.loc), value.name.slice())?;
            }

            // Parse the initializer
            if p.lexer.token == T::TEquals {
                p.lexer.next()?;
                value.value = Some(p.parse_expr(Level::Comma)?);
            }

            let value_name = value.name;
            let value_loc = p.real_loc(value.loc);
            p.finish_node(&mut value.loc, value_full_start);
            values.push(value);

            exported_members.put(
                value_name.slice(),
                TSNamespaceMember {
                    loc: value_loc,
                    data: TSNamespaceMemberData::EnumProperty,
                },
            )?;

            // `parseDelimitedList`: only a comma separates members.
            if p.lexer.token != T::TComma && (p.lexer.token != T::TSemicolon || p.is_tolerant()) {
                if p.recover_missing_comma(ListKind::EnumMembers, value_loc)? {
                    continue;
                }
                break;
            }

            p.lexer.next()?;
        }
        p.lexer.list_contexts = saved_contexts;

        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        if !opts.is_typescript_declare {
            // Avoid a collision with the enum closure argument variable if the
            // enum exports a symbol with the same name as the enum itself:
            //
            //   enum foo {
            //     foo = 123,
            //     bar = foo,
            //   }
            //
            // TypeScript generates the following code in this case:
            //
            //   var foo;
            //   (function (foo) {
            //     foo[foo["foo"] = 123] = "foo";
            //     foo[foo["bar"] = 123] = "bar";
            //   })(foo || (foo = {}));
            //
            // Whereas in this case:
            //
            //   enum foo {
            //     bar = foo as any,
            //   }
            //
            // TypeScript generates the following code:
            //
            //   var foo;
            //   (function (foo) {
            //     foo[foo["bar"] = foo] = "bar";
            //   })(foo || (foo = {}));
            // SAFETY: current_scope is an arena-owned Scope pointer valid for 'a.
            if p.current_scope().members.contains_key(name_text) {
                // Add a "_" to make tests easier to read, since non-bundler tests don't
                // run the renamer. For external-facing things the renamer will avoid
                // collisions automatically so this isn't important for correctness.
                // PERF: strings::cat heap-allocates — could allocate into p.arena.
                let prefixed = strings::cat(b"_", name_text).expect("unreachable");
                let prefixed: &'a [u8] = p.arena.alloc_slice_copy(&prefixed);
                arg_ref = p.new_symbol(SymbolKind::Hoisted, prefixed);
                // SAFETY: see above.
                VecExt::append(&mut p.current_scope_mut().generated, arg_ref);
            } else {
                arg_ref = p
                    .declare_symbol(SymbolKind::Hoisted, name_loc, name_text)
                    .expect("unreachable");
            }
            p.ref_to_ts_namespace_member
                .insert(arg_ref, TSNamespaceMemberData::Namespace(exported_members));
            ts_namespace.arg_ref = arg_ref;

            p.pop_scope();
        }

        if has_body {
            p.lexer.expect(T::TCloseBrace)?;
        }

        if opts.is_typescript_declare {
            if opts.scope.is_namespace() && opts.is_export {
                p.has_non_local_export_declare_inside_namespace = true;
            }
            if p.preserves_type_syntax() {
                return Ok(p.s(
                    S::Enum {
                        name,
                        arg: Ref::NONE,
                        values: bun_ast::StoreSlice::new_mut(values.into_bump_slice_mut()),
                        is_export: opts.is_export,
                    },
                    loc,
                ));
            }

            return Ok(p.s(S::TypeScript::default(), loc));
        }

        // Save these for when we do out-of-order enum visiting
        //
        // Make a copy of "scopesInOrder" instead of a slice or index since
        // the original array may be flattened in the future by
        // "popAndFlattenScope"
        let scope_order_clone = 'scope_order_clone: {
            let mut count: usize = 0;
            for i in &p.scopes_in_order[scope_index..] {
                if i.is_some() {
                    count += 1;
                }
            }

            let mut items: BumpVec<'_, ScopeOrder> = BumpVec::with_capacity_in(count, p.arena);
            for item in &p.scopes_in_order[scope_index..] {
                let Some(item) = item else { continue };
                items.push(*item);
            }
            break 'scope_order_clone items.into_bump_slice();
        };
        // debug-assert no prior entry.
        // Stored as `&'a [ScopeOrder]`; the visit pass only reads these, so
        // `scope_order_to_visit` may alias the same arena slice freely.
        let prev = p.scopes_in_order_for_enum.insert(loc, scope_order_clone);
        debug_assert!(prev.is_none());

        Ok(p.s(
            S::Enum {
                name,
                arg: arg_ref,
                values: bun_ast::StoreSlice::new_mut(values.into_bump_slice_mut()),
                is_export: opts.is_export,
            },
            loc,
        ))
    }
}
