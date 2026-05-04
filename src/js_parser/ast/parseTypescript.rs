use bun_core::{err, Error};
use bun_js_parser::js_ast::{
    self, B, Decl, DeclList, E, EnumValue, Expr, ExprEFlags, ExprNodeIndex, ExprNodeList, G,
    LocRef, S, Stmt, TSNamespaceMember, TSNamespaceMemberData,
};
use bun_js_parser::js_lexer::{self, T};
use bun_js_parser::{
    JSXTransformType, Level, NewParser, ParseStatementOptions, Ref, ScopeKind, ScopeOrder,
    SymbolKind,
};
use bun_logger as logger;
use bun_str::strings;
use bumpalo::collections::Vec as BumpVec;

// Zig: `pub fn ParseTypescript(comptime ...) type { return struct { ... } }`
// → zero-sized struct with const-generic params; nested fns become associated fns.
pub struct ParseTypescript<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

// TODO(port): Rust cannot bind a local `type P = NewParser<..>` alias inside an impl that
// references the impl's const generics; the full `NewParser<..>` path is spelled out per fn.
impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > ParseTypescript<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    const IS_TYPESCRIPT_ENABLED: bool =
        NewParser::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::IS_TYPESCRIPT_ENABLED;

    // TODO(port): narrow error set
    pub fn parse_type_script_decorators<'bump>(
        p: &mut NewParser<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<&'bump [ExprNodeIndex], Error> {
        if !Self::IS_TYPESCRIPT_ENABLED && !p.options.features.standard_decorators {
            return Ok(&[]);
        }

        let mut decorators: BumpVec<'bump, ExprNodeIndex> = BumpVec::new_in(p.allocator);
        while p.lexer.token == T::TAt {
            p.lexer.next()?;

            if p.options.features.standard_decorators {
                // TC39 standard decorator grammar:
                //   @Identifier
                //   @Identifier.member
                //   @Identifier.member(args)
                //   @(Expression)
                // PERF(port): was ensureUnusedCapacity + unusedCapacitySlice — profile in Phase B
                decorators.push(Self::parse_standard_decorator(p)?);
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
                // TODO(port): Zig `parseExprWithFlags` takes an out-param slot; reshaped to return value.
                decorators.push(p.parse_expr_with_flags(Level::New, ExprEFlags::TsDecorator)?);
            }
        }

        Ok(decorators.into_bump_slice())
    }

    /// Parse a standard (TC39) decorator expression following the `@` token.
    ///
    /// DecoratorExpression:
    ///   @ IdentifierReference
    ///   @ DecoratorMemberExpression
    ///   @ DecoratorCallExpression
    ///   @ DecoratorParenthesizedExpression
    // TODO(port): narrow error set
    pub fn parse_standard_decorator(
        p: &mut NewParser<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<ExprNodeIndex, Error> {
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

        let mut expr = p.new_expr(
            E::Identifier {
                ref_: p.store_name_in_ref(p.lexer.identifier)?,
            },
            loc,
        );
        p.lexer.next()?;

        // Skip TypeScript type arguments after the identifier (e.g., @foo<T>)
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_arguments(false)?;
        }

        // DecoratorMemberExpression: Identifier (.Identifier)*
        while p.lexer.token == T::TDot || p.lexer.token == T::TQuestionDot {
            // Forbid optional chaining in decorators
            if p.lexer.token == T::TQuestionDot {
                p.log.add_error(
                    p.source,
                    p.lexer.loc(),
                    "Optional chaining is not allowed in decorator expressions",
                )?;
                return Err(err!("SyntaxError"));
            }

            p.lexer.next()?;

            if !p.lexer.is_identifier_or_keyword() {
                p.lexer.expect(T::TIdentifier)?;
                return Err(err!("SyntaxError"));
            }

            let name = p.lexer.identifier;
            let name_loc = p.lexer.loc();
            p.lexer.next()?;

            expr = p.new_expr(
                E::Dot {
                    target: expr,
                    name,
                    name_loc,
                },
                loc,
            );

            // Skip TypeScript type arguments after member access (e.g., @foo.bar<T>)
            if Self::IS_TYPESCRIPT_ENABLED {
                let _ = p.skip_type_script_type_arguments(false)?;
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
                },
                loc,
            );
        }

        Ok(expr)
    }

    pub fn parse_type_script_namespace_stmt(
        p: &mut NewParser<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt, Error> {
        // "namespace foo {}";
        let name_loc = p.lexer.loc();
        let name_text = p.lexer.identifier;
        p.lexer.next()?;

        // Generate the namespace object
        let ts_namespace =
            p.get_or_create_exported_namespace_members(name_text, opts.is_export, false);
        let exported_members = ts_namespace.exported_members;
        let ns_member_data = TSNamespaceMemberData::Namespace(exported_members);

        // Declare the namespace and create the scope
        let mut name = LocRef {
            loc: name_loc,
            ref_: None,
        };
        let scope_index = p.push_scope_for_parse_pass(ScopeKind::Entry, loc)?;
        p.current_scope.ts_namespace = ts_namespace;

        let old_has_non_local_export_declare_inside_namespace =
            p.has_non_local_export_declare_inside_namespace;
        p.has_non_local_export_declare_inside_namespace = false;

        // Parse the statements inside the namespace
        let mut stmts: BumpVec<'_, Stmt> = BumpVec::new_in(p.allocator);
        if p.lexer.token == T::TDot {
            let dot_loc = p.lexer.loc();
            p.lexer.next()?;

            let mut _opts = ParseStatementOptions {
                is_export: true,
                is_namespace_scope: true,
                is_typescript_declare: opts.is_typescript_declare,
                ..ParseStatementOptions::default()
            };
            stmts.push(Self::parse_type_script_namespace_stmt(p, dot_loc, &mut _opts)?);
        } else if opts.is_typescript_declare && p.lexer.token != T::TOpenBrace {
            p.lexer.expect_or_insert_semicolon()?;
        } else {
            p.lexer.expect(T::TOpenBrace)?;
            let mut _opts = ParseStatementOptions {
                is_namespace_scope: true,
                is_typescript_declare: opts.is_typescript_declare,
                ..ParseStatementOptions::default()
            };
            // TODO(port): Zig `ListManaged.fromOwnedSlice` adopts the slice in-place; bumpalo has
            // no equivalent so this re-wraps. Phase B should make `parse_stmts_up_to` return a
            // BumpVec directly to avoid the round-trip.
            let parsed = p.parse_stmts_up_to(T::TCloseBrace, &mut _opts)?;
            stmts = BumpVec::from_iter_in(parsed.iter().cloned(), p.allocator);
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
                Stmt::Data::SFunction(func) => {
                    if func.func.flags.contains(js_ast::FnFlags::IS_EXPORT) {
                        let locref = func.func.name.unwrap();
                        let fn_name = p.symbols
                            [usize::try_from(locref.ref_.unwrap().inner_index).unwrap()]
                        .original_name;
                        exported_members.insert(
                            fn_name,
                            TSNamespaceMember {
                                loc: locref.loc,
                                data: TSNamespaceMemberData::Property,
                            },
                        )?;
                        p.ref_to_ts_namespace_member
                            .insert(locref.ref_.unwrap(), TSNamespaceMemberData::Property)?;
                    }
                }
                Stmt::Data::SClass(class) => {
                    if class.is_export {
                        let locref = class.class.class_name.unwrap();
                        let class_name = p.symbols
                            [usize::try_from(locref.ref_.unwrap().inner_index).unwrap()]
                        .original_name;
                        exported_members.insert(
                            class_name,
                            TSNamespaceMember {
                                loc: locref.loc,
                                data: TSNamespaceMemberData::Property,
                            },
                        )?;
                        p.ref_to_ts_namespace_member
                            .insert(locref.ref_.unwrap(), TSNamespaceMemberData::Property)?;
                    }
                }
                // Zig: `inline .s_namespace, .s_enum => |ns|` — written out per-variant.
                Stmt::Data::SNamespace(ns) => {
                    if ns.is_export {
                        if let Some(member_data) =
                            p.ref_to_ts_namespace_member.get(&ns.name.ref_.unwrap())
                        {
                            let member_data = *member_data;
                            exported_members.insert(
                                p.symbols
                                    [usize::try_from(ns.name.ref_.unwrap().inner_index).unwrap()]
                                .original_name,
                                TSNamespaceMember {
                                    data: member_data,
                                    loc: ns.name.loc,
                                },
                            )?;
                            p.ref_to_ts_namespace_member
                                .insert(ns.name.ref_.unwrap(), member_data)?;
                        }
                    }
                }
                Stmt::Data::SEnum(ns) => {
                    if ns.is_export {
                        if let Some(member_data) =
                            p.ref_to_ts_namespace_member.get(&ns.name.ref_.unwrap())
                        {
                            let member_data = *member_data;
                            exported_members.insert(
                                p.symbols
                                    [usize::try_from(ns.name.ref_.unwrap().inner_index).unwrap()]
                                .original_name,
                                TSNamespaceMember {
                                    data: member_data,
                                    loc: ns.name.loc,
                                },
                            )?;
                            p.ref_to_ts_namespace_member
                                .insert(ns.name.ref_.unwrap(), member_data)?;
                        }
                    }
                }
                Stmt::Data::SLocal(local) => {
                    if local.is_export {
                        for decl in local.decls.slice() {
                            p.define_exported_namespace_binding(exported_members, decl.binding)?;
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
                Stmt::Data::SLocal(local) => {
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
        if (stmts.len() == import_equal_count
            && !has_non_local_export_declare_inside_namespace)
            || opts.is_typescript_declare
        {
            p.pop_and_discard_scope(scope_index);
            if opts.is_module_scope {
                p.local_type_names.insert(name_text, true);
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
            if p.current_scope.members.contains_key(name_text) {
                // Add a "_" to make tests easier to read, since non-bundler tests don't
                // run the renamer. For external-facing things the renamer will avoid
                // collisions automatically so this isn't important for correctness.
                arg_ref = p
                    .new_symbol(
                        SymbolKind::Hoisted,
                        strings::cat(p.allocator, b"_", name_text).expect("unreachable"),
                    )
                    .expect("unreachable");
                p.current_scope.generated.push(arg_ref);
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
                .insert(name.ref_.unwrap(), ns_member_data)?;
        }

        Ok(p.s(
            S::Namespace {
                name,
                arg: arg_ref,
                stmts: stmts.into_bump_slice(),
                is_export: opts.is_export,
            },
            loc,
        ))
    }

    pub fn parse_type_script_import_equals_stmt(
        p: &mut NewParser<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
        opts: &mut ParseStatementOptions,
        default_name_loc: logger::Loc,
        default_name: &[u8],
    ) -> Result<Stmt, Error> {
        p.lexer.expect(T::TEquals)?;

        let kind = js_ast::LocalKind::KConst;
        let name = p.lexer.identifier;
        let target = p.new_expr(
            E::Identifier {
                ref_: p.store_name_in_ref(name).expect("unreachable"),
            },
            p.lexer.loc(),
        );
        let mut value = target;
        p.lexer.expect(T::TIdentifier)?;

        if name == b"require" && p.lexer.token == T::TOpenParen {
            // "import ns = require('x')"
            p.lexer.next()?;
            let path = p.new_expr(p.lexer.to_e_string()?, p.lexer.loc());
            p.lexer.expect(T::TStringLiteral)?;
            p.lexer.expect(T::TCloseParen)?;
            if !opts.is_typescript_declare {
                let args = ExprNodeList::init_one(p.allocator, path)?;
                value = p.new_expr(
                    E::Call {
                        target,
                        close_paren_loc: p.lexer.loc(),
                        args,
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
                value = p.new_expr(
                    E::Dot {
                        target: prev_value,
                        name: p.lexer.identifier,
                        name_loc: p.lexer.loc(),
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
        // PERF(port): was `allocator.alloc(Decl, 1)` into arena slice — profile in Phase B
        let decls = p.allocator.alloc_slice_copy(&[Decl {
            binding: p.b(B::Identifier { ref_ }, default_name_loc),
            value: Some(value),
        }]);
        Ok(p.s(
            S::Local {
                kind,
                decls: DeclList::from_owned_slice(decls),
                is_export: opts.is_export,
                was_ts_import_equals: true,
            },
            loc,
        ))
    }

    pub fn parse_typescript_enum_stmt(
        p: &mut NewParser<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt, Error> {
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
        let ts_namespace =
            p.get_or_create_exported_namespace_members(name_text, opts.is_export, true);
        let exported_members = ts_namespace.exported_members;
        let enum_member_data = TSNamespaceMemberData::Namespace(exported_members);

        // Declare the enum and create the scope
        let scope_index = p.scopes_in_order.len();
        if !opts.is_typescript_declare {
            name.ref_ = Some(p.declare_symbol(SymbolKind::TsEnum, name_loc, name_text)?);
            let _ = p.push_scope_for_parse_pass(ScopeKind::Entry, loc)?;
            p.current_scope.ts_namespace = ts_namespace;
            // Zig: putNoClobber — debug-assert no prior entry.
            let prev = p
                .ref_to_ts_namespace_member
                .insert(name.ref_.unwrap(), enum_member_data);
            debug_assert!(prev.is_none());
        }

        p.lexer.expect(T::TOpenBrace)?;

        // Parse the body
        let mut values: BumpVec<'_, EnumValue> = BumpVec::new_in(p.allocator);
        while p.lexer.token != T::TCloseBrace {
            // TODO(port): Zig `name = undefined` — placeholder empty slice; always overwritten or
            // we return SyntaxError before use.
            let mut value = EnumValue {
                loc: p.lexer.loc(),
                ref_: Ref::NONE,
                name: &[],
                value: None,
            };
            let mut needs_symbol = false;

            // Parse the name
            if p.lexer.token == T::TStringLiteral {
                value.name = p.lexer.to_utf8_e_string()?.slice8();
                needs_symbol = js_lexer::is_identifier(value.name);
            } else if p.lexer.is_identifier_or_keyword() {
                value.name = p.lexer.identifier;
                needs_symbol = true;
            } else {
                p.lexer.expect(T::TIdentifier)?;
                // error early, name is still `undefined`
                return Err(err!("SyntaxError"));
            }
            p.lexer.next()?;

            // Identifiers can be referenced by other values
            if !opts.is_typescript_declare && needs_symbol {
                value.ref_ = p.declare_symbol(SymbolKind::Other, value.loc, value.name)?;
            }

            // Parse the initializer
            if p.lexer.token == T::TEquals {
                p.lexer.next()?;
                value.value = Some(p.parse_expr(Level::Comma)?);
            }

            values.push(value);

            exported_members.insert(
                value.name,
                TSNamespaceMember {
                    loc: value.loc,
                    data: TSNamespaceMemberData::EnumProperty,
                },
            );

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
            if p.current_scope.members.contains_key(name_text) {
                // Add a "_" to make tests easier to read, since non-bundler tests don't
                // run the renamer. For external-facing things the renamer will avoid
                // collisions automatically so this isn't important for correctness.
                arg_ref = p
                    .new_symbol(
                        SymbolKind::Hoisted,
                        strings::cat(p.allocator, b"_", name_text).expect("unreachable"),
                    )
                    .expect("unreachable");
                p.current_scope.generated.push(arg_ref);
            } else {
                arg_ref = p
                    .declare_symbol(SymbolKind::Hoisted, name_loc, name_text)
                    .expect("unreachable");
            }
            p.ref_to_ts_namespace_member.insert(arg_ref, enum_member_data);
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

            let mut items: BumpVec<'_, ScopeOrder> =
                BumpVec::with_capacity_in(count, p.allocator);
            for item in &p.scopes_in_order[scope_index..] {
                let Some(item) = item else { continue };
                items.push(*item);
            }
            break 'scope_order_clone items.into_bump_slice();
        };
        // Zig: putNoClobber — debug-assert no prior entry.
        let prev = p.scopes_in_order_for_enum.insert(loc, scope_order_clone);
        debug_assert!(prev.is_none());

        Ok(p.s(
            S::Enum {
                name,
                arg: arg_ref,
                values: values.into_bump_slice(),
                is_export: opts.is_export,
            },
            loc,
        ))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseTypescript.zig (549 lines)
//   confidence: medium
//   todos:      7
//   notes:      const-generic mixin over NewParser; arena (bumpalo) threaded via p.allocator; Stmt::Data variant names + E/S struct-init shapes are guesses for Phase B to fix.
// ──────────────────────────────────────────────────────────────────────────
