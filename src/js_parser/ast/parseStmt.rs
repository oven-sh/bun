use bun_core::{self, err};
use bun_logger as logger;
use bun_str::strings;

use bun_js_parser as js_parser;
use bun_js_parser::js_ast;
use bun_js_parser::js_lexer;

use js_ast::{Binding, Expr, LocRef, Stmt, Symbol, G, S};
use js_ast::Op::Level;
use js_lexer::T;
use G::Decl;

use js_parser::{
    DeferredTsDecorators, JSXTransformType, ParseStatementOptions, ParsedPath, Ref, StmtList,
    TypeScript,
};
use js_parser::fs;
use bun_options_types::ImportKind;

// TODO(port): narrow error set
type Result<T> = core::result::Result<T, bun_core::Error>;

/// Type alias for the monomorphized parser. Mirrors Zig's
/// `const P = js_parser.NewParser_(ts, jsx, scan_only);`
type P<const TS: bool, const JSX: JSXTransformType, const SCAN: bool> =
    js_parser::NewParser_<TS, JSX, SCAN>;

/// Zig: `pub fn ParseStmt(comptime ts, comptime jsx, comptime scan_only) type { return struct {...} }`
/// Rust: zero-sized struct carrying the const-generic parser features; all methods are
/// associated fns that take `p: &mut P<..>` explicitly (matching the Zig free-fn shape).
pub struct ParseStmt<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

impl<const TS: bool, const JSX: JSXTransformType, const SCAN: bool> ParseStmt<TS, JSX, SCAN> {
    // const createDefaultName = P.createDefaultName;            → call as p.create_default_name(..)
    // const extractDeclsForBinding = P.extractDeclsForBinding;  → call as P::<..>::extract_decls_for_binding(..)
    const IS_TYPESCRIPT_ENABLED: bool = P::<TS, JSX, SCAN>::IS_TYPESCRIPT_ENABLED;
    const TRACK_SYMBOL_USAGE_DURING_PARSE_PASS: bool =
        P::<TS, JSX, SCAN>::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS;

    fn t_semicolon(p: &mut P<TS, JSX, SCAN>) -> Result<Stmt> {
        p.lexer.next()?;
        Ok(Stmt::empty())
    }

    fn t_export(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        let previous_export_keyword = p.esm_export_keyword;
        if opts.is_module_scope {
            p.esm_export_keyword = p.lexer.range();
        } else if !opts.is_namespace_scope {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }
        p.lexer.next()?;

        // TypeScript decorators only work on class declarations
        // "@decorator export class Foo {}"
        // "@decorator export abstract class Foo {}"
        // "@decorator export default class Foo {}"
        // "@decorator export default abstract class Foo {}"
        // "@decorator export declare class Foo {}"
        // "@decorator export declare abstract class Foo {}"
        if opts.ts_decorators.is_some()
            && p.lexer.token != T::TClass
            && p.lexer.token != T::TDefault
            && !p.lexer.is_contextual_keyword(b"abstract")
            && !p.lexer.is_contextual_keyword(b"declare")
        {
            p.lexer.expected(T::TClass)?;
        }

        match p.lexer.token {
            T::TClass | T::TConst | T::TFunction | T::TVar => {
                opts.is_export = true;
                p.parse_stmt(opts)
            }

            T::TImport => {
                // "export import foo = bar"
                if Self::IS_TYPESCRIPT_ENABLED && (opts.is_module_scope || opts.is_namespace_scope) {
                    opts.is_export = true;
                    return p.parse_stmt(opts);
                }

                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }

            T::TEnum => {
                if !Self::IS_TYPESCRIPT_ENABLED {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                opts.is_export = true;
                p.parse_stmt(opts)
            }

            T::TIdentifier => {
                if p.lexer.is_contextual_keyword(b"let") {
                    opts.is_export = true;
                    return p.parse_stmt(opts);
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    if opts.is_typescript_declare && p.lexer.is_contextual_keyword(b"as") {
                        // "export as namespace ns;"
                        p.lexer.next()?;
                        p.lexer.expect_contextual_keyword(b"namespace")?;
                        p.lexer.expect(T::TIdentifier)?;
                        p.lexer.expect_or_insert_semicolon()?;

                        return Ok(p.s(S::TypeScript {}, loc));
                    }
                }

                if p.lexer.is_contextual_keyword(b"async") {
                    let async_range = p.lexer.range();
                    p.lexer.next()?;
                    if p.lexer.has_newline_before {
                        p.log.add_range_error(
                            p.source,
                            async_range,
                            "Unexpected newline after \"async\"",
                        )?;
                    }

                    p.lexer.expect(T::TFunction)?;
                    opts.is_export = true;
                    return p.parse_fn_stmt(loc, opts, Some(async_range));
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    if let Some(ident) = TypeScript::Identifier::for_str(p.lexer.identifier) {
                        match ident {
                            TypeScript::Identifier::SType => {
                                // "export type foo = ..."
                                let type_range = p.lexer.range();
                                p.lexer.next()?;
                                if p.lexer.has_newline_before {
                                    p.log.add_error_fmt(
                                        p.source,
                                        type_range.end(),
                                        p.allocator,
                                        "Unexpected newline after \"type\"",
                                        format_args!(""),
                                    )?;
                                    return Err(err!("SyntaxError"));
                                }
                                let mut skipper = ParseStatementOptions {
                                    is_module_scope: opts.is_module_scope,
                                    is_export: true,
                                    ..Default::default()
                                };
                                p.skip_type_script_type_stmt(&mut skipper)?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }
                            TypeScript::Identifier::SNamespace
                            | TypeScript::Identifier::SAbstract
                            | TypeScript::Identifier::SModule
                            | TypeScript::Identifier::SInterface => {
                                // "export namespace Foo {}"
                                // "export abstract class Foo {}"
                                // "export module Foo {}"
                                // "export interface Foo {}"
                                opts.is_export = true;
                                return p.parse_stmt(opts);
                            }
                            TypeScript::Identifier::SDeclare => {
                                // "export declare class Foo {}"
                                opts.is_export = true;
                                opts.lexical_decl = LexicalDecl::AllowAll;
                                opts.is_typescript_declare = true;
                                return p.parse_stmt(opts);
                            }
                        }
                    }
                }

                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }

            T::TDefault => {
                if !opts.is_module_scope && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                let default_loc = p.lexer.loc();
                p.lexer.next()?;

                // TypeScript decorators only work on class declarations
                // "@decorator export default class Foo {}"
                // "@decorator export default abstract class Foo {}"
                if opts.ts_decorators.is_some()
                    && p.lexer.token != T::TClass
                    && !p.lexer.is_contextual_keyword(b"abstract")
                {
                    p.lexer.expected(T::TClass)?;
                }

                if p.lexer.is_contextual_keyword(b"async") {
                    let async_range = p.lexer.range();
                    p.lexer.next()?;
                    if p.lexer.token == T::TFunction && !p.lexer.has_newline_before {
                        p.lexer.next()?;
                        let mut stmt_opts = ParseStatementOptions {
                            is_name_optional: true,
                            lexical_decl: LexicalDecl::AllowAll,
                            ..Default::default()
                        };
                        let stmt = p.parse_fn_stmt(loc, &mut stmt_opts, Some(async_range))?;
                        if matches!(stmt.data, Stmt::Data::STypeScript(_)) {
                            // This was just a type annotation
                            return Ok(stmt);
                        }

                        let default_name = if let Some(name) = stmt.data.s_function().func.name {
                            js_ast::LocRef { loc: name.loc, ref_: name.ref_ }
                        } else {
                            p.create_default_name(default_loc)?
                        };

                        let value = js_ast::StmtOrExpr::Stmt(stmt);
                        return Ok(p.s(
                            S::ExportDefault { default_name, value },
                            loc,
                        ));
                    }

                    let default_name = p.create_default_name(loc)?;

                    let mut expr = p.parse_async_prefix_expr(async_range, Level::Comma)?;
                    p.parse_suffix(&mut expr, Level::Comma, None, Expr::EFlags::None)?;
                    p.lexer.expect_or_insert_semicolon()?;
                    let value = js_ast::StmtOrExpr::Expr(expr);
                    p.has_export_default = true;
                    return Ok(p.s(
                        S::ExportDefault { default_name, value },
                        loc,
                    ));
                }

                if p.lexer.token == T::TFunction
                    || p.lexer.token == T::TClass
                    || p.lexer.is_contextual_keyword(b"interface")
                {
                    let mut _opts = ParseStatementOptions {
                        ts_decorators: opts.ts_decorators,
                        is_name_optional: true,
                        lexical_decl: LexicalDecl::AllowAll,
                        ..Default::default()
                    };
                    let stmt = p.parse_stmt(&mut _opts)?;

                    let default_name: js_ast::LocRef = 'default_name_getter: {
                        match &stmt.data {
                            // This was just a type annotation
                            Stmt::Data::STypeScript(_) => {
                                return Ok(stmt);
                            }

                            Stmt::Data::SFunction(func_container) => {
                                if let Some(name) = func_container.func.name {
                                    break 'default_name_getter LocRef {
                                        loc: name.loc,
                                        ref_: name.ref_,
                                    };
                                }
                            }
                            Stmt::Data::SClass(class) => {
                                if let Some(name) = class.class.class_name {
                                    break 'default_name_getter LocRef {
                                        loc: name.loc,
                                        ref_: name.ref_,
                                    };
                                }
                            }
                            _ => {}
                        }

                        p.create_default_name(default_loc).expect("unreachable")
                    };
                    p.has_export_default = true;
                    p.has_es_module_syntax = true;
                    return Ok(p.s(
                        S::ExportDefault {
                            default_name,
                            value: js_ast::StmtOrExpr::Stmt(stmt),
                        },
                        loc,
                    ));
                }

                let is_identifier = p.lexer.token == T::TIdentifier;
                let name = p.lexer.identifier;
                let expr = p.parse_expr(Level::Comma)?;

                // Handle the default export of an abstract class in TypeScript
                if Self::IS_TYPESCRIPT_ENABLED
                    && is_identifier
                    && (p.lexer.token == T::TClass || opts.ts_decorators.is_some())
                    && name == b"abstract"
                {
                    match &expr.data {
                        Expr::Data::EIdentifier(_) => {
                            let mut stmt_opts = ParseStatementOptions {
                                ts_decorators: opts.ts_decorators,
                                is_name_optional: true,
                                ..Default::default()
                            };
                            let stmt: Stmt = p.parse_class_stmt(loc, &mut stmt_opts)?;

                            // Use the statement name if present, since it's a better name
                            let default_name: js_ast::LocRef = 'default_name_getter: {
                                match &stmt.data {
                                    // This was just a type annotation
                                    Stmt::Data::STypeScript(_) => {
                                        return Ok(stmt);
                                    }

                                    Stmt::Data::SFunction(func_container) => {
                                        if let Some(_name) = func_container.func.name {
                                            break 'default_name_getter LocRef {
                                                loc: default_loc,
                                                ref_: _name.ref_,
                                            };
                                        }
                                    }
                                    Stmt::Data::SClass(class) => {
                                        if let Some(_name) = class.class.class_name {
                                            break 'default_name_getter LocRef {
                                                loc: default_loc,
                                                ref_: _name.ref_,
                                            };
                                        }
                                    }
                                    _ => {}
                                }

                                p.create_default_name(default_loc).expect("unreachable")
                            };
                            p.has_export_default = true;
                            return Ok(p.s(
                                S::ExportDefault {
                                    default_name,
                                    value: js_ast::StmtOrExpr::Stmt(stmt),
                                },
                                loc,
                            ));
                        }
                        _ => {
                            p.panic("internal error: unexpected", format_args!(""));
                        }
                    }
                }

                p.lexer.expect_or_insert_semicolon()?;

                // Use the expression name if present, since it's a better name
                p.has_export_default = true;
                Ok(p.s(
                    S::ExportDefault {
                        default_name: p.default_name_for_expr(expr, default_loc),
                        value: js_ast::StmtOrExpr::Expr(expr),
                    },
                    loc,
                ))
            }
            T::TAsterisk => {
                if !opts.is_module_scope && !(opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                p.lexer.next()?;
                let mut namespace_ref: Ref = Ref::NONE;
                let mut alias: Option<js_ast::G::ExportStarAlias> = None;
                let path: ParsedPath;

                if p.lexer.is_contextual_keyword(b"as") {
                    // "export * as ns from 'path'"
                    p.lexer.next()?;
                    let name = p.parse_clause_alias(b"export")?;
                    namespace_ref = p.store_name_in_ref(name)?;
                    alias = Some(G::ExportStarAlias {
                        loc: p.lexer.loc(),
                        original_name: name,
                    });
                    p.lexer.next()?;
                    p.lexer.expect_contextual_keyword(b"from")?;
                    path = p.parse_path()?;
                } else {
                    // "export * from 'path'"
                    p.lexer.expect_contextual_keyword(b"from")?;
                    path = p.parse_path()?;
                    let name = fs::PathName::init(path.text).non_unique_name_string(p.allocator)?;
                    namespace_ref = p.store_name_in_ref(name)?;
                }

                let import_record_index = p.add_import_record(
                    ImportKind::Stmt,
                    path.loc,
                    path.text,
                    // TODO: import assertions
                    // path.assertions
                );

                if path.is_macro {
                    p.log
                        .add_error(p.source, path.loc, "cannot use macro in export statement")?;
                } else if path.import_tag != ImportTag::None {
                    p.log.add_error(
                        p.source,
                        loc,
                        "cannot use export statement with \"type\" attribute",
                    )?;
                }

                if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                    // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                    p.import_records.as_mut_slice()[import_record_index as usize]
                        .flags
                        .calls_runtime_re_export_fn = true;
                }

                p.lexer.expect_or_insert_semicolon()?;
                p.has_es_module_syntax = true;
                Ok(p.s(
                    S::ExportStar {
                        namespace_ref,
                        alias,
                        import_record_index,
                    },
                    loc,
                ))
            }
            T::TOpenBrace => {
                if !opts.is_module_scope && !(opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                let export_clause = p.parse_export_clause()?;
                if p.lexer.is_contextual_keyword(b"from") {
                    p.lexer.expect_contextual_keyword(b"from")?;
                    let parsed_path = p.parse_path()?;

                    p.lexer.expect_or_insert_semicolon()?;

                    if Self::IS_TYPESCRIPT_ENABLED {
                        // export {type Foo} from 'bar';
                        // ->
                        // nothing
                        // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                        if export_clause.clauses.len() == 0 && export_clause.had_type_only_exports {
                            return Ok(p.s(S::TypeScript {}, loc));
                        }
                    }

                    if parsed_path.is_macro {
                        p.log.add_error(
                            p.source,
                            loc,
                            "export from cannot be used with \"type\": \"macro\"",
                        )?;
                    } else if parsed_path.import_tag != ImportTag::None {
                        p.log.add_error(
                            p.source,
                            loc,
                            "export from cannot be used with \"type\" attribute",
                        )?;
                    }

                    let import_record_index =
                        p.add_import_record(ImportKind::Stmt, parsed_path.loc, parsed_path.text);
                    let path_name = fs::PathName::init(parsed_path.text);
                    // PERF(port): was arena allocPrint — profile in Phase B
                    let namespace_ref = {
                        use std::io::Write;
                        let mut buf: Vec<u8> = Vec::new();
                        write!(&mut buf, "import_{}", path_name.fmt_identifier()).unwrap();
                        // TODO(port): store_name_in_ref expects arena-owned slice; verify lifetime
                        p.store_name_in_ref(p.allocator.alloc_slice_copy(&buf))?
                    };

                    if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                        // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                        p.import_records.as_mut_slice()[import_record_index as usize]
                            .flags
                            .calls_runtime_re_export_fn = true;
                    }
                    p.current_scope.is_after_const_local_prefix = true;
                    p.has_es_module_syntax = true;
                    return Ok(p.s(
                        S::ExportFrom {
                            items: export_clause.clauses,
                            is_single_line: export_clause.is_single_line,
                            namespace_ref,
                            import_record_index,
                        },
                        loc,
                    ));
                }
                p.lexer.expect_or_insert_semicolon()?;

                if Self::IS_TYPESCRIPT_ENABLED {
                    // export {type Foo};
                    // ->
                    // nothing
                    // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                    if export_clause.clauses.len() == 0 && export_clause.had_type_only_exports {
                        return Ok(p.s(S::TypeScript {}, loc));
                    }
                }
                p.has_es_module_syntax = true;
                Ok(p.s(
                    S::ExportClause {
                        items: export_clause.clauses,
                        is_single_line: export_clause.is_single_line,
                    },
                    loc,
                ))
            }
            T::TEquals => {
                // "export = value;"

                p.esm_export_keyword = previous_export_keyword; // This wasn't an ESM export statement after all
                if Self::IS_TYPESCRIPT_ENABLED {
                    p.lexer.next()?;
                    let value = p.parse_expr(Level::Lowest)?;
                    p.lexer.expect_or_insert_semicolon()?;
                    return Ok(p.s(S::ExportEquals { value }, loc));
                }
                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }
            _ => {
                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }
        }
    }

    fn t_function(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        p.parse_fn_stmt(loc, opts, None)
    }

    fn t_enum(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        if !Self::IS_TYPESCRIPT_ENABLED {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }
        p.parse_typescript_enum_stmt(loc, opts)
    }

    fn t_at(p: &mut P<TS, JSX, SCAN>, opts: &mut ParseStatementOptions) -> Result<Stmt> {
        // Parse decorators before class statements, which are potentially exported
        if Self::IS_TYPESCRIPT_ENABLED || p.options.features.standard_decorators {
            let scope_index = p.scopes_in_order.len();
            let ts_decorators = p.parse_type_script_decorators()?;

            // If this turns out to be a "declare class" statement, we need to undo the
            // scopes that were potentially pushed while parsing the decorator arguments.
            // That can look like any one of the following:
            //
            //   "@decorator declare class Foo {}"
            //   "@decorator declare abstract class Foo {}"
            //   "@decorator export declare class Foo {}"
            //   "@decorator export declare abstract class Foo {}"
            //
            opts.ts_decorators = Some(DeferredTsDecorators {
                values: ts_decorators,
                scope_index,
            });

            // "@decorator class Foo {}"
            // "@decorator abstract class Foo {}"
            // "@decorator declare class Foo {}"
            // "@decorator declare abstract class Foo {}"
            // "@decorator export class Foo {}"
            // "@decorator export abstract class Foo {}"
            // "@decorator export declare class Foo {}"
            // "@decorator export declare abstract class Foo {}"
            // "@decorator export default class Foo {}"
            // "@decorator export default abstract class Foo {}"
            if p.lexer.token != T::TClass
                && p.lexer.token != T::TExport
                && !(Self::IS_TYPESCRIPT_ENABLED && p.lexer.is_contextual_keyword(b"abstract"))
                && !(Self::IS_TYPESCRIPT_ENABLED && p.lexer.is_contextual_keyword(b"declare"))
            {
                p.lexer.expected(T::TClass)?;
            }

            return p.parse_stmt(opts);
        }
        // notimpl();

        p.lexer.unexpected()?;
        Err(err!("SyntaxError"))
    }

    fn t_class(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        if opts.lexical_decl != LexicalDecl::AllowAll {
            p.forbid_lexical_decl(loc)?;
        }

        p.parse_class_stmt(loc, opts)
    }

    fn t_var(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        let mut decls = p.parse_and_declare_decls(Symbol::Kind::Hoisted, opts)?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(
            S::Local {
                kind: S::Local::Kind::KVar,
                decls: Decl::List::move_from_list(&mut decls),
                is_export: opts.is_export,
                ..Default::default()
            },
            loc,
        ))
    }

    fn t_const(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        if opts.lexical_decl != LexicalDecl::AllowAll {
            p.forbid_lexical_decl(loc)?;
        }
        // p.markSyntaxFeature(compat.Const, p.lexer.Range())

        p.lexer.next()?;

        if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TEnum {
            return p.parse_typescript_enum_stmt(loc, opts);
        }

        let mut decls = p.parse_and_declare_decls(Symbol::Kind::Constant, opts)?;
        p.lexer.expect_or_insert_semicolon()?;

        if !opts.is_typescript_declare {
            p.require_initializers(S::Local::Kind::KConst, decls.as_slice())?;
        }

        Ok(p.s(
            S::Local {
                kind: S::Local::Kind::KConst,
                decls: Decl::List::move_from_list(&mut decls),
                is_export: opts.is_export,
                ..Default::default()
            },
            loc,
        ))
    }

    fn t_if(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        let mut current_loc = loc;
        let mut root_if: Option<Stmt> = None;
        // PORT NOTE: raw *mut into arena-allocated S::If — borrowck cannot express the
        // back-reference into the previous iteration's allocation. Arena keeps nodes alive.
        let mut current_if: Option<*mut S::If> = None;

        loop {
            p.lexer.next()?;
            p.lexer.expect(T::TOpenParen)?;
            let test_ = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            let mut stmt_opts = ParseStatementOptions {
                lexical_decl: LexicalDecl::AllowFnInsideIf,
                ..Default::default()
            };
            let yes = p.parse_stmt(&mut stmt_opts)?;

            // Create the if node
            let if_stmt = p.s(
                S::If {
                    test_,
                    yes,
                    no: None,
                },
                current_loc,
            );

            // First if statement becomes root
            if root_if.is_none() {
                root_if = Some(if_stmt);
            }

            // Link to previous if statement's else branch
            if let Some(prev_if) = current_if {
                // SAFETY: prev_if points into arena-allocated S::If from prior iteration; arena outlives this fn.
                unsafe { (*prev_if).no = Some(if_stmt); }
            }

            // Set current if for next iteration
            // TODO(port): `if_stmt.data.s_if` accessor returning *mut S::If into arena
            current_if = Some(if_stmt.data.s_if_mut());

            if p.lexer.token != T::TElse {
                return Ok(root_if.unwrap());
            }

            p.lexer.next()?;

            // Handle final else
            if p.lexer.token != T::TIf {
                stmt_opts = ParseStatementOptions {
                    lexical_decl: LexicalDecl::AllowFnInsideIf,
                    ..Default::default()
                };
                // SAFETY: current_if was set just above in this iteration; arena keeps it alive.
                unsafe {
                    (*current_if.unwrap()).no = Some(p.parse_stmt(&mut stmt_opts)?);
                }
                return Ok(root_if.unwrap());
            }

            // Continue with else if
            current_loc = p.lexer.loc();
        }

        #[allow(unreachable_code)]
        { unreachable!() }
    }

    fn t_do(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;
        p.lexer.expect(T::TWhile)?;
        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        // This is a weird corner case where automatic semicolon insertion applies
        // even without a newline present
        if p.lexer.token == T::TSemicolon {
            p.lexer.next()?;
        }
        Ok(p.s(S::DoWhile { body, test_ }, loc))
    }

    fn t_while(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;

        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;

        Ok(p.s(S::While { body, test_ }, loc))
    }

    fn t_with(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        let body_loc = p.lexer.loc();
        p.lexer.expect(T::TCloseParen)?;

        // Push a scope so we make sure to prevent any bare identifiers referenced
        // within the body from being renamed. Renaming them might change the
        // semantics of the code.
        let _ = p.push_scope_for_parse_pass(Scope::Kind::With, body_loc)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;
        p.pop_scope();

        Ok(p.s(
            S::With {
                body,
                body_loc,
                value: test_,
            },
            loc,
        ))
    }

    fn t_switch(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;

        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        let body_loc = p.lexer.loc();
        let _ = p.push_scope_for_parse_pass(Scope::Kind::Block, body_loc)?;
        // TODO(port): was `defer p.popScope()` — scopeguard captures &mut p; verify error-path cleanup in Phase B
        scopeguard::defer! { p.pop_scope(); }

        p.lexer.expect(T::TOpenBrace)?;
        let mut cases = bumpalo::collections::Vec::<js_ast::Case>::new_in(p.allocator);
        let mut found_default = false;
        let mut stmt_opts = ParseStatementOptions {
            lexical_decl: LexicalDecl::AllowAll,
            ..Default::default()
        };
        let mut value: Option<js_ast::Expr> = None;
        while p.lexer.token != T::TCloseBrace {
            let mut body = StmtList::new_in(p.allocator);
            value = None;
            if p.lexer.token == T::TDefault {
                if found_default {
                    p.log.add_range_error(
                        p.source,
                        p.lexer.range(),
                        "Multiple default clauses are not allowed",
                    )?;
                    return Err(err!("SyntaxError"));
                }

                found_default = true;
                p.lexer.next()?;
                p.lexer.expect(T::TColon)?;
            } else {
                p.lexer.expect(T::TCase)?;
                value = Some(p.parse_expr(Level::Lowest)?);
                p.lexer.expect(T::TColon)?;
            }

            'case_body: loop {
                match p.lexer.token {
                    T::TCloseBrace | T::TCase | T::TDefault => {
                        break 'case_body;
                    }
                    _ => {
                        stmt_opts = ParseStatementOptions {
                            lexical_decl: LexicalDecl::AllowAll,
                            ..Default::default()
                        };
                        body.push(p.parse_stmt(&mut stmt_opts)?);
                    }
                }
            }
            cases.push(js_ast::Case {
                value,
                body: body.into_items(),
                loc: logger::Loc::EMPTY,
            });
        }
        p.lexer.expect(T::TCloseBrace)?;
        Ok(p.s(
            S::Switch {
                test_,
                body_loc,
                cases: cases.into_bump_slice(),
            },
            loc,
        ))
    }

    fn t_try(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        let body_loc = p.lexer.loc();
        p.lexer.expect(T::TOpenBrace)?;
        let _ = p.push_scope_for_parse_pass(Scope::Kind::Block, loc)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
        p.pop_scope();
        p.lexer.next()?;

        let mut catch_: Option<js_ast::Catch> = None;
        let mut finally: Option<js_ast::Finally> = None;

        if p.lexer.token == T::TCatch {
            let catch_loc = p.lexer.loc();
            let _ = p.push_scope_for_parse_pass(Scope::Kind::CatchBinding, catch_loc)?;
            p.lexer.next()?;
            let mut binding: Option<js_ast::Binding> = None;

            // The catch binding is optional, and can be omitted
            if p.lexer.token != T::TOpenBrace {
                p.lexer.expect(T::TOpenParen)?;
                let mut value = p.parse_binding(Default::default())?;

                // Skip over types
                if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon {
                    p.lexer.expect(T::TColon)?;
                    p.skip_type_script_type(Level::Lowest)?;
                }

                p.lexer.expect(T::TCloseParen)?;

                // Bare identifiers are a special case
                let mut kind = Symbol::Kind::Other;
                match value.data {
                    Binding::Data::BIdentifier(_) => {
                        kind = Symbol::Kind::CatchIdentifier;
                    }
                    _ => {}
                }
                p.declare_binding(kind, &mut value, &mut stmt_opts)?;
                binding = Some(value);
            }

            let catch_body_loc = p.lexer.loc();
            p.lexer.expect(T::TOpenBrace)?;

            let _ = p.push_scope_for_parse_pass(Scope::Kind::Block, catch_body_loc)?;
            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
            p.pop_scope();
            p.lexer.next()?;
            catch_ = Some(js_ast::Catch {
                loc: catch_loc,
                binding,
                body: stmts,
                body_loc: catch_body_loc,
            });
            p.pop_scope();
        }

        if p.lexer.token == T::TFinally || catch_.is_none() {
            let finally_loc = p.lexer.loc();
            let _ = p.push_scope_for_parse_pass(Scope::Kind::Block, finally_loc)?;
            p.lexer.expect(T::TFinally)?;
            p.lexer.expect(T::TOpenBrace)?;
            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
            p.lexer.next()?;
            finally = Some(js_ast::Finally {
                loc: finally_loc,
                stmts,
            });
            p.pop_scope();
        }

        Ok(p.s(
            S::Try {
                body_loc,
                body,
                catch_,
                finally,
            },
            loc,
        ))
    }

    fn t_for(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        let _ = p.push_scope_for_parse_pass(Scope::Kind::Block, loc)?;
        // TODO(port): was `defer p.popScope()` — verify error-path cleanup in Phase B
        scopeguard::defer! { p.pop_scope(); }

        p.lexer.next()?;

        // "for await (let x of y) {}"
        let mut is_for_await = p.lexer.is_contextual_keyword(b"await");
        if is_for_await {
            let await_range = p.lexer.range();
            if p.fn_or_arrow_data_parse.allow_await != AllowAwait::AllowExpr {
                p.log.add_range_error(
                    p.source,
                    await_range,
                    "Cannot use \"await\" outside an async function",
                )?;
                is_for_await = false;
            } else {
                // TODO: improve error handling here
                //                 didGenerateError := p.markSyntaxFeature(compat.ForAwait, awaitRange)
                if p.fn_or_arrow_data_parse.is_top_level {
                    p.top_level_await_keyword = await_range;
                    // p.markSyntaxFeature(compat.TopLevelAwait, awaitRange)
                }
            }
            p.lexer.next()?;
        }

        p.lexer.expect(T::TOpenParen)?;

        let mut init_: Option<Stmt> = None;
        let mut test_: Option<Expr> = None;
        let mut update: Option<Expr> = None;

        // "in" expressions aren't allowed here
        p.allow_in = false;

        let mut bad_let_range: Option<logger::Range> = None;
        if p.lexer.is_contextual_keyword(b"let") {
            bad_let_range = Some(p.lexer.range());
        }

        let mut decls: G::Decl::List = Default::default();
        let init_loc = p.lexer.loc();
        let mut is_var = false;
        match p.lexer.token {
            // for (var )
            T::TVar => {
                is_var = true;
                p.lexer.next()?;
                let mut stmt_opts = ParseStatementOptions::default();
                let mut decls_list = p.parse_and_declare_decls(Symbol::Kind::Hoisted, &mut stmt_opts)?;
                decls = G::Decl::List::move_from_list(&mut decls_list);
                init_ = Some(p.s(
                    S::Local {
                        kind: S::Local::Kind::KVar,
                        decls,
                        ..Default::default()
                    },
                    init_loc,
                ));
            }
            // for (const )
            T::TConst => {
                p.lexer.next()?;
                let mut stmt_opts = ParseStatementOptions::default();
                let mut decls_list = p.parse_and_declare_decls(Symbol::Kind::Constant, &mut stmt_opts)?;
                decls = G::Decl::List::move_from_list(&mut decls_list);
                init_ = Some(p.s(
                    S::Local {
                        kind: S::Local::Kind::KConst,
                        decls,
                        ..Default::default()
                    },
                    init_loc,
                ));
            }
            // for (;)
            T::TSemicolon => {}
            _ => {
                let mut stmt_opts = ParseStatementOptions {
                    lexical_decl: LexicalDecl::AllowAll,
                    is_for_loop_init: true,
                    ..Default::default()
                };

                let res = p.parse_expr_or_let_stmt(&mut stmt_opts)?;
                match res.stmt_or_expr {
                    js_ast::StmtOrExpr::Stmt(stmt) => {
                        bad_let_range = None;
                        init_ = Some(stmt);
                    }
                    js_ast::StmtOrExpr::Expr(expr) => {
                        init_ = Some(p.s(S::SExpr { value: expr, ..Default::default() }, init_loc));
                    }
                }
            }
        }

        // "in" expressions are allowed again
        p.allow_in = true;

        // Detect for-of loops
        if p.lexer.is_contextual_keyword(b"of") || is_for_await {
            if let Some(r) = bad_let_range {
                p.log.add_range_error(
                    p.source,
                    r,
                    "\"let\" must be wrapped in parentheses to be used as an expression here",
                )?;
                return Err(err!("SyntaxError"));
            }

            if is_for_await && !p.lexer.is_contextual_keyword(b"of") {
                if init_.is_some() {
                    p.lexer.expected_string(b"\"of\"")?;
                } else {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }
            }

            p.forbid_initializers(decls.slice(), b"of", false)?;
            p.lexer.next()?;
            let value = p.parse_expr(Level::Comma)?;
            p.lexer.expect(T::TCloseParen)?;
            let mut stmt_opts = ParseStatementOptions::default();
            let body = p.parse_stmt(&mut stmt_opts)?;
            return Ok(p.s(
                S::ForOf {
                    is_await: is_for_await,
                    init: init_.unwrap(),
                    value,
                    body,
                },
                loc,
            ));
        }

        // Detect for-in loops
        if p.lexer.token == T::TIn {
            p.forbid_initializers(decls.slice(), b"in", is_var)?;
            p.lexer.next()?;
            let value = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            let mut stmt_opts = ParseStatementOptions::default();
            let body = p.parse_stmt(&mut stmt_opts)?;
            return Ok(p.s(
                S::ForIn {
                    init: init_.unwrap(),
                    value,
                    body,
                },
                loc,
            ));
        }

        // Only require "const" statement initializers when we know we're a normal for loop
        if let Some(init_stmt) = &init_ {
            match &init_stmt.data {
                Stmt::Data::SLocal(local) => {
                    if local.kind == S::Local::Kind::KConst {
                        p.require_initializers(S::Local::Kind::KConst, decls.slice())?;
                    }
                }
                _ => {}
            }
        }

        p.lexer.expect(T::TSemicolon)?;
        if p.lexer.token != T::TSemicolon {
            test_ = Some(p.parse_expr(Level::Lowest)?);
        }

        p.lexer.expect(T::TSemicolon)?;

        if p.lexer.token != T::TCloseParen {
            update = Some(p.parse_expr(Level::Lowest)?);
        }

        p.lexer.expect(T::TCloseParen)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;
        Ok(p.s(
            S::For {
                init: init_,
                test_,
                update,
                body,
            },
            loc,
        ))
    }

    fn t_import(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        let previous_import_keyword = p.esm_import_keyword;
        p.esm_import_keyword = p.lexer.range();
        p.lexer.next()?;
        let mut stmt: S::Import = S::Import {
            namespace_ref: Ref::NONE,
            import_record_index: u32::MAX,
            ..Default::default()
        };
        let mut was_originally_bare_import = false;

        // "export import foo = bar"
        if (opts.is_export || (opts.is_namespace_scope && !opts.is_typescript_declare))
            && p.lexer.token != T::TIdentifier
        {
            p.lexer.expected(T::TIdentifier)?;
        }

        match p.lexer.token {
            // "import('path')"
            // "import.meta"
            T::TOpenParen | T::TDot => {
                p.esm_import_keyword = previous_import_keyword; // this wasn't an esm import statement after all
                let mut expr = p.parse_import_expr(loc, Level::Lowest)?;
                p.parse_suffix(&mut expr, Level::Lowest, None, Expr::EFlags::None)?;
                p.lexer.expect_or_insert_semicolon()?;
                return Ok(p.s(S::SExpr { value: expr, ..Default::default() }, loc));
            }
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                // "import 'path'"
                if !opts.is_module_scope && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }
                was_originally_bare_import = true;
            }
            T::TAsterisk => {
                // "import * as ns from 'path'"
                if !opts.is_module_scope && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                p.lexer.next()?;
                p.lexer.expect_contextual_keyword(b"as")?;
                stmt = S::Import {
                    namespace_ref: p.store_name_in_ref(p.lexer.identifier)?,
                    star_name_loc: Some(p.lexer.loc()),
                    import_record_index: u32::MAX,
                    ..Default::default()
                };
                p.lexer.expect(T::TIdentifier)?;
                p.lexer.expect_contextual_keyword(b"from")?;
            }
            T::TOpenBrace => {
                // "import {item1, item2} from 'path'"
                if !opts.is_module_scope && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }
                let import_clause = p.parse_import_clause()?;
                if Self::IS_TYPESCRIPT_ENABLED {
                    if import_clause.had_type_only_imports && import_clause.items.len() == 0 {
                        p.lexer.expect_contextual_keyword(b"from")?;
                        let _ = p.parse_path()?;
                        p.lexer.expect_or_insert_semicolon()?;
                        return Ok(p.s(S::TypeScript {}, loc));
                    }
                }

                stmt = S::Import {
                    namespace_ref: Ref::NONE,
                    import_record_index: u32::MAX,
                    items: import_clause.items,
                    is_single_line: import_clause.is_single_line,
                    ..Default::default()
                };
                p.lexer.expect_contextual_keyword(b"from")?;
            }
            T::TIdentifier => {
                // "import defaultItem from 'path'"
                // "import foo = bar"
                if !opts.is_module_scope && !opts.is_namespace_scope {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                let mut default_name = p.lexer.identifier;
                stmt = S::Import {
                    namespace_ref: Ref::NONE,
                    import_record_index: u32::MAX,
                    default_name: Some(LocRef {
                        loc: p.lexer.loc(),
                        ref_: p.store_name_in_ref(default_name)?,
                    }),
                    ..Default::default()
                };
                p.lexer.next()?;

                if Self::IS_TYPESCRIPT_ENABLED {
                    // Skip over type-only imports
                    if default_name == b"type" {
                        match p.lexer.token {
                            T::TIdentifier => {
                                if p.lexer.identifier != b"from" {
                                    default_name = p.lexer.identifier;
                                    stmt.default_name.as_mut().unwrap().loc = p.lexer.loc();
                                    p.lexer.next()?;

                                    if p.lexer.token == T::TEquals {
                                        // "import type foo = require('bar');"
                                        // "import type foo = bar.baz;"
                                        opts.is_typescript_declare = true;
                                        return p.parse_type_script_import_equals_stmt(
                                            loc,
                                            opts,
                                            stmt.default_name.unwrap().loc,
                                            default_name,
                                        );
                                    } else {
                                        // "import type foo from 'bar';"
                                        p.lexer.expect_contextual_keyword(b"from")?;
                                        let _ = p.parse_path()?;
                                        p.lexer.expect_or_insert_semicolon()?;
                                        return Ok(p.s(S::TypeScript {}, loc));
                                    }
                                }
                            }
                            T::TAsterisk => {
                                // "import type * as foo from 'bar';"
                                p.lexer.next()?;
                                p.lexer.expect_contextual_keyword(b"as")?;
                                p.lexer.expect(T::TIdentifier)?;
                                p.lexer.expect_contextual_keyword(b"from")?;
                                let _ = p.parse_path()?;
                                p.lexer.expect_or_insert_semicolon()?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }

                            T::TOpenBrace => {
                                // "import type {foo} from 'bar';"
                                let _ = p.parse_import_clause()?;
                                p.lexer.expect_contextual_keyword(b"from")?;
                                let _ = p.parse_path()?;
                                p.lexer.expect_or_insert_semicolon()?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }
                            _ => {}
                        }
                    }

                    // Parse TypeScript import assignment statements
                    if p.lexer.token == T::TEquals
                        || opts.is_export
                        || (opts.is_namespace_scope && !opts.is_typescript_declare)
                    {
                        p.esm_import_keyword = previous_import_keyword; // This wasn't an ESM import statement after all;
                        return p.parse_type_script_import_equals_stmt(
                            loc,
                            opts,
                            logger::Loc::EMPTY,
                            default_name,
                        );
                    }
                }

                if p.lexer.token == T::TComma {
                    p.lexer.next()?;

                    match p.lexer.token {
                        // "import defaultItem, * as ns from 'path'"
                        T::TAsterisk => {
                            p.lexer.next()?;
                            p.lexer.expect_contextual_keyword(b"as")?;
                            stmt.namespace_ref = p.store_name_in_ref(p.lexer.identifier)?;
                            stmt.star_name_loc = Some(p.lexer.loc());
                            p.lexer.expect(T::TIdentifier)?;
                        }
                        // "import defaultItem, {item1, item2} from 'path'"
                        T::TOpenBrace => {
                            let import_clause = p.parse_import_clause()?;

                            stmt.items = import_clause.items;
                            stmt.is_single_line = import_clause.is_single_line;
                        }
                        _ => {
                            p.lexer.unexpected()?;
                            return Err(err!("SyntaxError"));
                        }
                    }
                }

                p.lexer.expect_contextual_keyword(b"from")?;
            }
            _ => {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }
        }

        let path = p.parse_path()?;
        p.lexer.expect_or_insert_semicolon()?;

        p.process_import_statement(stmt, path, loc, was_originally_bare_import)
    }

    fn t_break(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        let name = p.parse_label_name()?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Break { label: name }, loc))
    }

    fn t_continue(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        let name = p.parse_label_name()?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Continue { label: name }, loc))
    }

    fn t_return(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        if p.fn_or_arrow_data_parse.is_return_disallowed {
            p.log.add_range_error(
                p.source,
                p.lexer.range(),
                "A return statement cannot be used here",
            )?;
        }
        p.lexer.next()?;
        let mut value: Option<Expr> = None;
        if p.lexer.token != T::TSemicolon
            && !p.lexer.has_newline_before
            && p.lexer.token != T::TCloseBrace
            && p.lexer.token != T::TEndOfFile
        {
            value = Some(p.parse_expr(Level::Lowest)?);
        }
        p.latest_return_had_semicolon = p.lexer.token == T::TSemicolon;
        p.lexer.expect_or_insert_semicolon()?;

        Ok(p.s(S::Return { value }, loc))
    }

    fn t_throw(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        if p.lexer.has_newline_before {
            p.log.add_error(
                p.source,
                logger::Loc { start: loc.start + 5 },
                "Unexpected newline after \"throw\"",
            )?;
            return Err(err!("SyntaxError"));
        }
        let expr = p.parse_expr(Level::Lowest)?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Throw { value: expr }, loc))
    }

    fn t_debugger(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Debugger {}, loc))
    }

    fn t_open_brace(
        p: &mut P<TS, JSX, SCAN>,
        _: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        let _ = p.push_scope_for_parse_pass(Scope::Kind::Block, loc)?;
        // TODO(port): was `defer p.popScope()` — verify error-path cleanup in Phase B
        scopeguard::defer! { p.pop_scope(); }
        p.lexer.next()?;
        let mut stmt_opts = ParseStatementOptions::default();
        let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
        let close_brace_loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.s(
            S::Block {
                stmts,
                close_brace_loc,
            },
            loc,
        ))
    }

    fn parse_stmt_fallthrough(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
        loc: logger::Loc,
    ) -> Result<Stmt> {
        let is_identifier = p.lexer.token == T::TIdentifier;
        let name = p.lexer.identifier;
        // Parse either an async function, an async expression, or a normal expression
        let mut expr: Expr = Expr {
            loc,
            data: Expr::Data::EMissing(Default::default()),
        };
        if is_identifier && p.lexer.raw() == b"async" {
            let async_range = p.lexer.range();
            p.lexer.next()?;
            if p.lexer.token == T::TFunction && !p.lexer.has_newline_before {
                p.lexer.next()?;

                return p.parse_fn_stmt(async_range.loc, opts, Some(async_range));
            }

            expr = p.parse_async_prefix_expr(async_range, Level::Lowest)?;
            p.parse_suffix(&mut expr, Level::Lowest, None, Expr::EFlags::None)?;
        } else {
            let expr_or_let = p.parse_expr_or_let_stmt(opts)?;
            match expr_or_let.stmt_or_expr {
                js_ast::StmtOrExpr::Stmt(stmt) => {
                    p.lexer.expect_or_insert_semicolon()?;
                    return Ok(stmt);
                }
                js_ast::StmtOrExpr::Expr(_expr) => {
                    expr = _expr;
                }
            }
        }
        if is_identifier {
            match &expr.data {
                Expr::Data::EIdentifier(ident) => {
                    if p.lexer.token == T::TColon && !opts.has_decorators() {
                        let _ = p.push_scope_for_parse_pass(Scope::Kind::Label, loc)?;
                        // TODO(port): was `defer p.popScope()` — verify error-path cleanup in Phase B
                        scopeguard::defer! { p.pop_scope(); }

                        // Parse a labeled statement
                        p.lexer.next()?;

                        let _name = LocRef { loc: expr.loc, ref_: ident.ref_ };
                        let mut nested_opts = ParseStatementOptions::default();

                        match opts.lexical_decl {
                            LexicalDecl::AllowAll | LexicalDecl::AllowFnInsideLabel => {
                                nested_opts.lexical_decl = LexicalDecl::AllowFnInsideLabel;
                            }
                            _ => {}
                        }
                        let stmt = p.parse_stmt(&mut nested_opts)?;
                        return Ok(p.s(S::Label { name: _name, stmt }, loc));
                    }
                }
                _ => {}
            }

            if Self::IS_TYPESCRIPT_ENABLED {
                if let Some(ts_stmt) = js_lexer::TypescriptStmtKeyword::LIST.get(name) {
                    match ts_stmt {
                        js_lexer::TypescriptStmtKeyword::TsStmtType => {
                            if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {
                                // "type Foo = any"
                                let mut stmt_opts = ParseStatementOptions {
                                    is_module_scope: opts.is_module_scope,
                                    ..Default::default()
                                };
                                p.skip_type_script_type_stmt(&mut stmt_opts)?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }
                        }
                        js_lexer::TypescriptStmtKeyword::TsStmtNamespace
                        | js_lexer::TypescriptStmtKeyword::TsStmtModule => {
                            // "namespace Foo {}"
                            // "module Foo {}"
                            // "declare module 'fs' {}"
                            // "declare module 'fs';"
                            if !p.lexer.has_newline_before
                                && (opts.is_module_scope || opts.is_namespace_scope)
                                && (p.lexer.token == T::TIdentifier
                                    || (p.lexer.token == T::TStringLiteral
                                        && opts.is_typescript_declare))
                            {
                                return p.parse_type_script_namespace_stmt(loc, opts);
                            }
                        }
                        js_lexer::TypescriptStmtKeyword::TsStmtInterface => {
                            // "interface Foo {}"
                            let mut stmt_opts = ParseStatementOptions {
                                is_module_scope: opts.is_module_scope,
                                ..Default::default()
                            };

                            p.skip_type_script_interface_stmt(&mut stmt_opts)?;
                            return Ok(p.s(S::TypeScript {}, loc));
                        }
                        js_lexer::TypescriptStmtKeyword::TsStmtAbstract => {
                            if p.lexer.token == T::TClass || opts.ts_decorators.is_some() {
                                return p.parse_class_stmt(loc, opts);
                            }
                        }
                        js_lexer::TypescriptStmtKeyword::TsStmtGlobal => {
                            // "declare module 'fs' { global { namespace NodeJS {} } }"
                            if opts.is_namespace_scope
                                && opts.is_typescript_declare
                                && p.lexer.token == T::TOpenBrace
                            {
                                p.lexer.next()?;
                                let _ = p.parse_stmts_up_to(T::TCloseBrace, opts)?;
                                p.lexer.next()?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }
                        }
                        js_lexer::TypescriptStmtKeyword::TsStmtDeclare => {
                            opts.lexical_decl = LexicalDecl::AllowAll;
                            opts.is_typescript_declare = true;

                            // "@decorator declare class Foo {}"
                            // "@decorator declare abstract class Foo {}"
                            if opts.ts_decorators.is_some()
                                && p.lexer.token != T::TClass
                                && !p.lexer.is_contextual_keyword(b"abstract")
                            {
                                p.lexer.expected(T::TClass)?;
                            }

                            // "declare global { ... }"
                            if p.lexer.is_contextual_keyword(b"global") {
                                p.lexer.next()?;
                                p.lexer.expect(T::TOpenBrace)?;
                                let _ = p.parse_stmts_up_to(T::TCloseBrace, opts)?;
                                p.lexer.next()?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }

                            // "declare const x: any"
                            let stmt = p.parse_stmt(opts)?;
                            if let Some(decs) = &opts.ts_decorators {
                                p.discard_scopes_up_to(decs.scope_index);
                            }

                            // Unlike almost all uses of "declare", statements that use
                            // "export declare" with "var/let/const" inside a namespace affect
                            // code generation. They cause any declared bindings to be
                            // considered exports of the namespace. Identifier references to
                            // those names must be converted into property accesses off the
                            // namespace object:
                            //
                            //   namespace ns {
                            //     export declare const x
                            //     export function y() { return x }
                            //   }
                            //
                            //   (ns as any).x = 1
                            //   console.log(ns.y())
                            //
                            // In this example, "return x" must be replaced with "return ns.x".
                            // This is handled by replacing each "export declare" statement
                            // inside a namespace with an "export var" statement containing all
                            // of the declared bindings. That "export var" statement will later
                            // cause identifiers to be transformed into property accesses.
                            if opts.is_namespace_scope && opts.is_export {
                                let mut decls: G::Decl::List = Default::default();
                                match &stmt.data {
                                    Stmt::Data::SLocal(local) => {
                                        let mut _decls =
                                            bumpalo::collections::Vec::<G::Decl>::with_capacity_in(
                                                usize::from(local.decls.len),
                                                p.allocator,
                                            );
                                        for decl in local.decls.slice() {
                                            P::<TS, JSX, SCAN>::extract_decls_for_binding(
                                                decl.binding,
                                                &mut _decls,
                                            )?;
                                        }
                                        decls = G::Decl::List::move_from_list(&mut _decls);
                                    }
                                    _ => {}
                                }

                                if decls.len > 0 {
                                    return Ok(p.s(
                                        S::Local {
                                            kind: S::Local::Kind::KVar,
                                            is_export: true,
                                            decls,
                                            ..Default::default()
                                        },
                                        loc,
                                    ));
                                }
                            }

                            return Ok(p.s(S::TypeScript {}, loc));
                        }
                    }
                }
            }
        }
        // Output.print("\n\nmVALUE {s}:{s}\n", .{ expr, name });
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::SExpr { value: expr, ..Default::default() }, loc))
    }

    pub fn parse_stmt(
        p: &mut P<TS, JSX, SCAN>,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt> {
        if !p.stack_check.is_safe_to_recurse() {
            bun_core::throw_stack_overflow()?;
        }

        // Zig used `inline ... => |function| @field(@This(), @tagName(function))(...)` to dispatch
        // by token name via comptime reflection. Rust has no `@field`/`@tagName`; expand the arms.
        match p.lexer.token {
            T::TSemicolon => Self::t_semicolon(p),
            T::TAt => Self::t_at(p, opts),

            T::TExport => Self::t_export(p, opts, p.lexer.loc()),
            T::TFunction => Self::t_function(p, opts, p.lexer.loc()),
            T::TEnum => Self::t_enum(p, opts, p.lexer.loc()),
            T::TClass => Self::t_class(p, opts, p.lexer.loc()),
            T::TVar => Self::t_var(p, opts, p.lexer.loc()),
            T::TConst => Self::t_const(p, opts, p.lexer.loc()),
            T::TIf => Self::t_if(p, opts, p.lexer.loc()),
            T::TDo => Self::t_do(p, opts, p.lexer.loc()),
            T::TWhile => Self::t_while(p, opts, p.lexer.loc()),
            T::TWith => Self::t_with(p, opts, p.lexer.loc()),
            T::TSwitch => Self::t_switch(p, opts, p.lexer.loc()),
            T::TTry => Self::t_try(p, opts, p.lexer.loc()),
            T::TFor => Self::t_for(p, opts, p.lexer.loc()),
            T::TImport => Self::t_import(p, opts, p.lexer.loc()),
            T::TBreak => Self::t_break(p, opts, p.lexer.loc()),
            T::TContinue => Self::t_continue(p, opts, p.lexer.loc()),
            T::TReturn => Self::t_return(p, opts, p.lexer.loc()),
            T::TThrow => Self::t_throw(p, opts, p.lexer.loc()),
            T::TDebugger => Self::t_debugger(p, opts, p.lexer.loc()),
            T::TOpenBrace => Self::t_open_brace(p, opts, p.lexer.loc()),

            _ => Self::parse_stmt_fallthrough(p, opts, p.lexer.loc()),
        }
    }
}

// TODO(port): these enum paths are guesses at the cross-file Rust names; Phase B fixes imports.
use js_parser::LexicalDecl;
use js_parser::AllowAwait;
use js_parser::ImportTag;
use js_ast::Scope;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseStmt.zig (1407 lines)
//   confidence: medium
//   todos:      8
//   notes:      const-generic ZST mirrors Zig comptime type-generator; `defer p.popScope()` → scopeguard (borrowck TBD); `t_if` keeps raw *mut S::If into arena; Stmt::Data/Expr::Data variant paths and LexicalDecl/AllowAwait/ImportTag/Scope::Kind import paths are placeholders for Phase B.
// ──────────────────────────────────────────────────────────────────────────
