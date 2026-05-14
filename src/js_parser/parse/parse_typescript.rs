#![allow(unused_imports, unused_variables, dead_code, unused_mut)]
#![warn(unused_must_use)]
use bun_collections::VecExt;
use core::ptr::NonNull;

use crate::lexer::{self as js_lexer, T};
use crate::p::P;
use crate::parser::{ParseStatementOptions, Ref, ScopeOrder};
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
use bun_core::{Error, err};

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

// Zig: `pub fn ParseTypescript(comptime ...) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // TODO(port): narrow error set
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
                // PERF(port): was ensureUnusedCapacity + unusedCapacitySlice — profile in Phase B
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
                // PERF(port): was ensureUnusedCapacity + unusedCapacitySlice — profile in Phase B
                // PORT NOTE: Zig `parseExprWithFlags` takes an out-param slot; preserved here.
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
    // TODO(port): narrow error set
    pub fn parse_standard_decorator(&mut self) -> Result<ExprNodeIndex, Error> {
        let p = self;
        let loc = p.lexer.loc();

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
            return Err(err!("SyntaxError"));
        }

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

        // Skip TypeScript type arguments after the identifier (e.g., @foo<T>)
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_arguments::<false>()?;
        }

        // DecoratorMemberExpression: Identifier (.Identifier)*
        while p.lexer.token == T::TDot || p.lexer.token == T::TQuestionDot {
            // Forbid optional chaining in decorators
            if p.lexer.token == T::TQuestionDot {
                let err_loc = p.lexer.loc();
                p.log().add_error(
                    Some(p.source),
                    err_loc,
                    b"Optional chaining is not allowed in decorator expressions",
                );
                return Err(err!("SyntaxError"));
            }

            p.lexer.next()?;

            if !p.lexer.is_identifier_or_keyword() {
                p.lexer.expect(T::TIdentifier)?;
                return Err(err!("SyntaxError"));
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

            // Skip TypeScript type arguments after member access (e.g., @foo.bar<T>)
            if Self::IS_TYPESCRIPT_ENABLED {
                let _ = p.skip_type_script_type_arguments::<false>()?;
            }
        }

        // DecoratorCallExpression: DecoratorMemberExpression Arguments
        // Only a single call is allowed, no chaining after the call
        if p.lexer.token == T::TOpenParen {
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
        // Arena-owned `StoreRef<TSNamespaceScope>` (Zig held a pointer into the arena).
        let mut ts_namespace: js_ast::StoreRef<js_ast::TSNamespaceScope> =
            p.get_or_create_exported_namespace_members(name_text, opts.is_export, false);
        let mut exported_members: js_ast::StoreRef<TSNamespaceMemberMap> =
            ts_namespace.exported_members;
        let ns_member_data = TSNamespaceMemberData::Namespace(exported_members);

        // Declare the namespace and create the scope
        let mut name = LocRef {
            loc: name_loc,
            ref_: None,
        };
        let scope_index = p.push_scope_for_parse_pass(ScopeKind::Entry, loc)?;
        p.current_scope_mut().ts_namespace = Some(ts_namespace);

        let old_has_non_local_export_declare_inside_namespace =
            p.has_non_local_export_declare_inside_namespace;
        p.has_non_local_export_declare_inside_namespace = false;

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
                return Err(err!("StackOverflow"));
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
            // TODO(port): Zig `ListManaged.fromOwnedSlice` adopts the slice in-place;
            // `parse_stmts_up_to` already returns a BumpVec<'a, Stmt> so just take it.
            stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut _opts)?;
            p.lexer.next()?;
        }
        let has_non_local_export_declare_inside_namespace =
            p.has_non_local_export_declare_inside_namespace;
        p.has_non_local_export_declare_inside_namespace =
            old_has_non_local_export_declare_inside_namespace;

        // Add any exported members from this namespace's body as members of the
        // associated namespace object.
        for stmt in stmts.iter() {
            match &stmt.data {
                StmtData::SFunction(func) => {
                    if func.func.flags.contains(flags::Function::IsExport) {
                        let locref = func.func.name.unwrap();
                        let ref_ = locref.ref_.expect("infallible: ref bound");
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
                        let ref_ = locref.ref_.expect("infallible: ref bound");
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
                // Zig: `inline .s_namespace, .s_enum => |ns|` — written out per-variant.
                StmtData::SNamespace(ns) => {
                    if ns.is_export {
                        let ref_ = ns.name.ref_.expect("infallible: ref bound");
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
                        let ref_ = ns.name.ref_.expect("infallible: ref bound");
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
                // run the renamer. For external-facing things the renamer will avoid
                // collisions automatically so this isn't important for correctness.
                // PERF(port): strings::cat heap-allocates; Zig allocated into p.arena.
                // Phase B: route through bump arena.
                let prefixed = strings::cat(b"_", name_text).expect("unreachable");
                let prefixed: &'a [u8] = p.arena.alloc_slice_copy(&prefixed);
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
            name.ref_ = Some(p.declare_symbol(SymbolKind::TsNamespace, name_loc, name_text)?);
            p.ref_to_ts_namespace_member
                .insert(name.ref_.expect("infallible: ref bound"), ns_member_data);
        }

        // PORT NOTE: S::Namespace.stmts is `StoreSlice<Stmt>` (arena slice). BumpVec → bump slice.
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
        // PERF(port): was `arena.alloc(Decl, 1)` into arena slice — profile in Phase B
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
            ref_: Some(Ref::NONE),
        };

        // Generate the namespace object
        // TODO(port): Zig `var arg_ref: Ref = undefined;` — initialized to NONE here; only read on
        // paths where it has been assigned below.
        let mut arg_ref: Ref = Ref::NONE;
        let mut ts_namespace: js_ast::StoreRef<js_ast::TSNamespaceScope> =
            p.get_or_create_exported_namespace_members(name_text, opts.is_export, true);
        let mut exported_members: js_ast::StoreRef<TSNamespaceMemberMap> =
            ts_namespace.exported_members;

        // Declare the enum and create the scope
        let scope_index = p.scopes_in_order.len();
        if !opts.is_typescript_declare {
            name.ref_ = Some(p.declare_symbol(SymbolKind::TsEnum, name_loc, name_text)?);
            let _ = p.push_scope_for_parse_pass(ScopeKind::Entry, loc)?;
            p.current_scope_mut().ts_namespace = Some(ts_namespace);
            // Zig: putNoClobber — debug-assert no prior entry.
            let prev = p.ref_to_ts_namespace_member.insert(
                name.ref_.expect("infallible: ref bound"),
                TSNamespaceMemberData::Namespace(exported_members),
            );
            debug_assert!(prev.is_none());
        }

        p.lexer.expect(T::TOpenBrace)?;

        // Parse the body
        let mut values: BumpVec<'_, EnumValue> = BumpVec::new_in(p.arena);
        while p.lexer.token != T::TCloseBrace {
            // TODO(port): Zig `name = undefined` — placeholder empty slice; always overwritten or
            // we return SyntaxError before use.
            let mut value = EnumValue {
                loc: p.lexer.loc(),
                ref_: Ref::NONE,
                name: js_ast::StoreStr::new(b"" as &[u8]),
                value: None,
            };
            // Assigned in both live arms below; the third arm returns.
            let needs_symbol: bool;

            // Parse the name
            if p.lexer.token == T::TStringLiteral {
                // PORT NOTE: `slice8()` is currently duplicated in E.rs (two impl blocks);
                // read `.data` directly — `to_utf8_e_string` guarantees `is_utf16 == false`.
                let estr = p.lexer.to_utf8_e_string()?;
                debug_assert!(!estr.is_utf16);
                value.name = estr.data;
                needs_symbol = js_lexer::is_identifier(value.name.slice());
            } else if p.lexer.is_identifier_or_keyword() {
                value.name = js_ast::StoreStr::new(p.lexer.identifier);
                needs_symbol = true;
            } else {
                p.lexer.expect(T::TIdentifier)?;
                // error early, name is still `undefined`
                return Err(err!("SyntaxError"));
            }
            p.lexer.next()?;

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
                // PERF(port): strings::cat heap-allocates; Zig allocated into p.arena.
                // Phase B: route through bump arena.
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
        // Zig: putNoClobber — debug-assert no prior entry.
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

// ported from: src/js_parser/ast/parseTypescript.zig
