#![warn(unused_must_use)]
use bun_collections::VecExt;

use crate::Error;
use crate::lexer::{self as js_lexer, T};
use crate::p::P;
use crate::parser::{FnOrArrowDataParse, ParseStatementOptions, Ref, ScopeOrder};
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

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn parse_type_script_decorators(&mut self) -> Result<ExprNodeList, Error> {
        let p = self;
        if !Self::IS_TYPESCRIPT_ENABLED && !p.options.features.standard_decorators {
            return Ok(bun_alloc::AstAlloc::vec());
        }

        let mut decorators: BumpVec<'_, ExprNodeIndex> = BumpVec::new_in(p.arena);
        while p.lexer.token == T::TAt {
            p.lexer.next()?;

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

    /// Parse a standard (TC39) decorator expression following the `@` token.
    ///
    /// DecoratorExpression:
    ///   @ IdentifierReference
    ///   @ DecoratorMemberExpression
    ///   @ DecoratorCallExpression
    ///   @ DecoratorParenthesizedExpression
    pub fn parse_standard_decorator(&mut self) -> Result<ExprNodeIndex, Error> {
        let p = self;

        // @(Expression) — parenthesized, any expression allowed
        if p.lexer.token == T::TOpenParen {
            p.lexer.next()?;
            let expr = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            return Ok(expr);
        }

        // Must start with an identifier
        if p.lexer.token != T::TIdentifier {
            p.lexer.expect(T::TIdentifier)?;
            return Err(crate::Error::SyntaxError);
        }

        let loc = p.lexer.loc();
        let ident = p.lexer.identifier;
        let ref_ = p.store_name_in_ref(ident)?;
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
                        let ref_ = p.store_name_in_ref(name)?;
                        let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
                        expr = p.new_expr(
                            E::Index {
                                target: expr,
                                index,
                                optional_chain: None,
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

    pub fn parse_type_script_namespace_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt, Error> {
        let p = self;
        // "namespace foo {}";
        let name_loc = p.lexer.loc();
        let name_text = p.lexer.identifier;
        p.lexer.next()?;

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

        // Parse the statements inside the namespace
        let mut stmts: BumpVec<'_, Stmt> = BumpVec::new_in(p.arena);
        if p.lexer.token == T::TDot {
            let dot_loc = p.lexer.loc();
            p.lexer.next()?;

            let mut _opts = ParseStatementOptions {
                is_export: true,
                is_namespace_scope: true,
                is_typescript_declare: opts.is_typescript_declare,
                ..ParseStatementOptions::default()
            };
            if !p.stack_check.is_safe_to_recurse() {
                return Err(crate::Error::StackOverflow);
            }
            stmts.push(p.parse_type_script_namespace_stmt(dot_loc, &mut _opts)?);
        } else if opts.is_typescript_declare && p.lexer.token != T::TOpenBrace {
            p.lexer.expect_or_insert_semicolon()?;
        } else {
            p.lexer.expect(T::TOpenBrace)?;
            let mut _opts = ParseStatementOptions {
                is_namespace_scope: true,
                is_typescript_declare: opts.is_typescript_declare,
                ..ParseStatementOptions::default()
            };
            stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut _opts)?;
            p.lexer.next()?;
        }
        let has_non_local_export_declare_inside_namespace =
            p.has_non_local_export_declare_inside_namespace;
        p.has_non_local_export_declare_inside_namespace =
            old_has_non_local_export_declare_inside_namespace;
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

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
                        let locref = class.class.class_name.unwrap();
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
                    if local.was_ts_import_equals && !local.is_export {
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
            if opts.is_module_scope {
                p.local_type_names.put(name_text, true)?;
            }
            return Ok(p.s(S::TypeScript {}, loc));
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
                arg_ref = p
                    .new_symbol(SymbolKind::Hoisted, prefixed)
                    .expect("unreachable");
                // SAFETY: see above.
                VecExt::append(&mut p.current_scope_mut().generated, arg_ref);
            } else {
                arg_ref = p
                    .new_symbol(SymbolKind::Hoisted, name_text)
                    .expect("unreachable");
            }
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

    pub fn parse_type_script_import_equals_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
        default_name_loc: bun_ast::Loc,
        default_name: &'a [u8],
    ) -> Result<Stmt, Error> {
        let p = self;
        p.lexer.expect(T::TEquals)?;

        let kind = js_ast::LocalKind::KConst;
        let name = p.lexer.identifier;
        let target_ref = p.store_name_in_ref(name).expect("unreachable");
        let target_loc = p.lexer.loc();
        let target = p.new_expr(
            E::Identifier {
                ref_: target_ref,
                ..Default::default()
            },
            target_loc,
        );
        let mut value = target;
        p.lexer.expect(T::TIdentifier)?;

        if name == b"require" && p.lexer.token == T::TOpenParen {
            // "import ns = require('x')"
            p.lexer.next()?;
            let path_estr = p.lexer.to_e_string()?;
            let path_loc = p.lexer.loc();
            let path = p.new_expr(path_estr, path_loc);
            p.lexer.expect(T::TStringLiteral)?;
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

        if opts.is_typescript_declare {
            // "import type foo = require('bar');"
            // "import type foo = bar.baz;"
            return Ok(p.s(S::TypeScript {}, loc));
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
                was_ts_import_equals: true,
                ..Default::default()
            },
            loc,
        ))
    }

    pub fn parse_typescript_enum_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt, Error> {
        let p = self;
        p.lexer.expect(T::TEnum)?;
        let name_loc = p.lexer.loc();
        let name_text = p.lexer.identifier;
        p.lexer.expect(T::TIdentifier)?;
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
        }

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
        while p.lexer.token != T::TCloseBrace {
            let mut value = EnumValue {
                loc: p.lexer.loc(),
                ref_: Ref::NONE,
                name: js_ast::StoreStr::new(b"" as &[u8]),
                value: None,
            };
            // Assigned in every live arm below; the error arm returns.
            let needs_symbol: bool;

            // Parse the name
            if p.lexer.token == T::TStringLiteral {
                // `slice8()` is currently duplicated in E.rs (two impl blocks);
                // read `.data` directly — `to_utf8_e_string` guarantees `is_utf16 == false`.
                let estr = p.lexer.to_utf8_e_string()?;
                debug_assert!(!estr.is_utf16);
                value.name = estr.data;
                needs_symbol = js_lexer::is_identifier(value.name.slice());
                p.lexer.next()?;
            } else if p.lexer.token == T::TOpenBracket {
                // TypeScript allows computed enum member names when the
                // expression is a string literal or a substitution-free
                // template literal: "enum E { ['a'] = 1, [`b`] = 2 }".
                p.lexer.next()?;
                if p.lexer.token != T::TStringLiteral
                    && p.lexer.token != T::TNoSubstitutionTemplateLiteral
                {
                    p.lexer.expect(T::TStringLiteral)?;
                    return Err(err!("SyntaxError"));
                }
                let estr = p.lexer.to_utf8_e_string()?;
                debug_assert!(!estr.is_utf16);
                value.name = estr.data;
                needs_symbol = js_lexer::is_identifier(value.name.slice());
                p.lexer.next()?;
                p.lexer.expect(T::TCloseBracket)?;
            } else if p.lexer.is_identifier_or_keyword() {
                value.name = js_ast::StoreStr::new(p.lexer.identifier);
                needs_symbol = true;
                p.lexer.next()?;
            } else {
                p.lexer.expect(T::TIdentifier)?;
                // error early, name is still `undefined`
                return Err(crate::Error::SyntaxError);
            }

            // Identifiers can be referenced by other values
            if !opts.is_typescript_declare && needs_symbol {
                value.ref_ = p.declare_symbol(SymbolKind::Other, value.loc, value.name.slice())?;
            }

            // Parse the initializer
            if p.lexer.token == T::TEquals {
                p.lexer.next()?;
                value.value = Some(p.parse_expr(Level::Comma)?);
            }

            let value_name = value.name;
            let value_loc = value.loc;
            values.push(value);

            exported_members.put(
                value_name.slice(),
                TSNamespaceMember {
                    loc: value_loc,
                    data: TSNamespaceMemberData::EnumProperty,
                },
            )?;

            if p.lexer.token != T::TComma && p.lexer.token != T::TSemicolon {
                break;
            }

            p.lexer.next()?;
        }

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
                arg_ref = p
                    .new_symbol(SymbolKind::Hoisted, prefixed)
                    .expect("unreachable");
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

        p.lexer.expect(T::TCloseBrace)?;

        if opts.is_typescript_declare {
            if opts.is_namespace_scope && opts.is_export {
                p.has_non_local_export_declare_inside_namespace = true;
            }

            return Ok(p.s(S::TypeScript {}, loc));
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
