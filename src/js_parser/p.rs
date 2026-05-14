use bun_collections::VecExt;
// Port of src/js_parser/ast/P.zig
//
// This file defines the `P` parser struct (generic over typescript/jsx/scan_only
// const params) and its core methods. The Zig original uses
// `fn NewParser_(comptime ...) type { return struct {...} }` which becomes a
// generic struct + impl in Rust.

use core::ptr::NonNull;
use std::io::Write as _;

use bun_alloc::Arena as Bump;

use bun_alloc::ArenaVecExt as _;
use bun_ast::{ImportKind, ImportRecord};
use bun_collections::{ArrayHashMap, HashMap, StringHashMap};
use bun_core::Output;
use bun_core::strings;
use bun_wyhash::Wyhash;

use crate::defines::{Define, DefineData};
use crate::lexer as js_lexer;
use crate::parse::parse_entry::Options as ParserOptions;
use crate::{
    ARGUMENTS_STR as arguments_str, DeferredArrowArgErrors, DeferredErrors,
    DeferredImportNamespace, EXPORTS_STRING_NAME as exports_string_name, ExprBindingTuple,
    FindLabelSymbolResult, FnOnlyDataVisit, FnOrArrowDataParse, FnOrArrowDataVisit, FunctionKind,
    IdentifierOpts, ImportItemForNamespaceMap, ImportNamespaceCallOrConstruct, InvalidLoc,
    JSXImport, JSXTransformType, Jest, LOC_MODULE_SCOPE as loc_module_scope, LocList,
    MacroState, ParseStatementOptions, ParsedPath, PrependTempRefsOpts, ReactRefresh, Ref, RefMap,
    RefRefMap, RuntimeImports, ScopeOrder, ScopeOrderList, SideEffects, StrictModeFeature,
    StringBoolMap, Substitution, TempRef, ThenCatchChain, TransposeState, WrapMode, fs,
    is_eval_or_arguments, options, statement_cares_about_scope,
};
use bun_ast as js_ast;
use bun_ast::DeclaredSymbol;
use bun_ast::g::{Arg, Decl};
use bun_ast::part::{SymbolPropertyUseMap, SymbolUseMap};
use bun_ast::{
    B, Binding, BindingNodeIndex, E, Expr, ExprNodeIndex, ExprNodeList, Flags, G, LocRef, S, Scope,
    Stmt, StmtNodeList, Symbol,
};
// Round-D/E modules: stub re-exports so type signatures referencing them compile.
// Real bodies un-gate per-file later.
use crate::renamer;

// Type aliases matching the Zig `const List = std.ArrayListUnmanaged;` etc.
// In this AST crate, lists are arena-backed.
type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;
type List<'a, T> = BumpVec<'a, T>;
type ListManaged<'a, T> = BumpVec<'a, T>;
type Map<K, V> = HashMap<K, V>;

/// Erases `P<'a, TS, SCAN>`'s const-generics so helpers like `JSXTag::parse`
/// (which Zig wrote as `comptime P: type`) can take any instantiation. Only the
/// surface those helpers actually touch is exposed; round-D widens this as the
/// parse_* / visit_* sibling files un-gate.
pub trait ParserLike<'a> {
    fn lexer(&mut self) -> &mut js_lexer::Lexer<'a>;
    fn log(&self) -> &mut bun_ast::Log;
    fn bump(&self) -> &'a Bump;
    fn source(&self) -> &'a bun_ast::Source;
    fn new_expr<T: js_ast::expr::IntoExprData>(&mut self, t: T, loc: bun_ast::Loc) -> Expr;
    fn store_name_in_ref(&mut self, name: &'a [u8]) -> Result<Ref, bun_core::Error>;
}
// Round-C: trait + impl defined so round-B Expr methods can bound on it. Method
// bodies forward to the (currently-gated) inherent impls; until those un-gate
// in round-D, calling through ParserLike panics — which is fine since no live
// code does so yet (callers are in parse_*/visit_* which are also gated).
impl<'a, const TS: bool, const SCAN: bool> ParserLike<'a> for P<'a, TS, SCAN> {
    #[inline]
    fn lexer(&mut self) -> &mut js_lexer::Lexer<'a> {
        &mut self.lexer
    }
    #[inline]
    fn log(&self) -> &mut bun_ast::Log {
        P::log(self)
    }
    #[inline]
    fn bump(&self) -> &'a Bump {
        self.arena
    }
    #[inline]
    fn source(&self) -> &'a bun_ast::Source {
        self.source
    }
    #[inline]
    fn new_expr<T: js_ast::expr::IntoExprData>(&mut self, t: T, loc: bun_ast::Loc) -> Expr {
        P::new_expr(self, t, loc)
    }
    #[inline]
    fn store_name_in_ref(&mut self, name: &'a [u8]) -> Result<Ref, bun_core::Error> {
        P::store_name_in_ref(self, name)
    }
}

#[derive(Default, Clone, Copy)]
pub struct ParserFeatures {
    pub typescript: bool,
    pub jsx: JSXTransformType,
    pub scan_only: bool,
}

// workaround for https://github.com/ziglang/zig/issues/10903 — not needed in Rust;
// `NewParser` is just an alias for the generic struct.
pub type NewParser<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> =
    P<'a, TYPESCRIPT, SCAN_ONLY>;
// TODO(port): the Zig `NewParser(features)` call sites pass a struct literal; in Rust callers
// must spell out the three const params directly.

// ─── Conditional field types (Zig: `if (only_scan_imports_and_do_not_visit) *T else T`) ───
// Zig switched the field type at comptime. Rust const generics cannot select a type, so we
// store both variants behind an enum and gate access in methods.
// TODO(port): revisit with associated types / GATs in Phase B.
pub enum ImportRecordList<'a> {
    Owned(BumpVec<'a, ImportRecord>),
    Borrowed(&'a mut Vec<ImportRecord>),
}
impl<'a> ImportRecordList<'a> {
    #[inline]
    pub fn items(&self) -> &[ImportRecord] {
        match self {
            Self::Owned(v) => v.as_slice(),
            Self::Borrowed(v) => v.as_slice(),
        }
    }
    #[inline]
    pub fn items_mut(&mut self) -> &mut [ImportRecord] {
        match self {
            Self::Owned(v) => v.as_mut_slice(),
            Self::Borrowed(v) => v.as_mut_slice(),
        }
    }
    #[inline]
    pub fn push(&mut self, record: ImportRecord) {
        match self {
            Self::Owned(v) => v.push(record),
            Self::Borrowed(v) => v.push(record),
        }
    }
    #[inline]
    pub fn len(&self) -> usize {
        match self {
            Self::Owned(v) => v.len(),
            Self::Borrowed(v) => v.len(),
        }
    }

    /// Zig: `ImportRecord.List.moveFromList(&p.import_records)` — transfer the
    /// backing storage into a `Vec<ImportRecord>` and leave `self` empty
    /// (so the parser can be dropped without aliasing the records the linker /
    /// printer now own).
    ///
    /// Round-G fix: previously `to_ast` reached through `items_mut()` and
    /// wrapped the *live* BumpVec slice, leaving `self` non-empty; the BumpVec's
    /// Drop then ran element destructors on records the returned `Ast` still
    /// pointed at. This adapter restores Zig's move-and-zero semantics for both
    /// the bump-backed and externally-borrowed variants.
    pub fn move_to_baby_list(&mut self, arena: &'a Bump) -> Vec<ImportRecord> {
        match core::mem::replace(self, Self::Owned(BumpVec::new_in(arena))) {
            Self::Owned(v) => Vec::from_bump_vec(v),
            Self::Borrowed(v) => core::mem::take(v),
        }
    }
}

pub enum NamedImportsType<'a> {
    Owned(bun_ast::ast_result::NamedImports),
    Borrowed(&'a mut bun_ast::ast_result::NamedImports),
}
impl<'a> core::ops::Deref for NamedImportsType<'a> {
    type Target = bun_ast::ast_result::NamedImports;
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Owned(v) => v,
            Self::Borrowed(v) => *v,
        }
    }
}
impl<'a> core::ops::DerefMut for NamedImportsType<'a> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        match self {
            Self::Owned(v) => v,
            Self::Borrowed(v) => *v,
        }
    }
}

// In Zig: `if (only_scan_imports_and_do_not_visit) bool else void`.
pub type NeedsJSXType = bool;
// In Zig: `if (track_symbol_usage_during_parse_pass) *Map else void`.
pub type ParsePassSymbolUsageType<'a> = Option<&'a mut crate::ParsePassSymbolUsageMap>;
// In Zig: `if (allow_macros) u32 else u0`.
pub type MacroCallCountType = u32;

// ─── Re-exports of sibling-module impls (Zig: `pub const X = mod.X;`) ───
// In Rust these are inherent methods on `P` defined in sibling files via separate
// `impl<...> P<...>` blocks. Round-D/E: those files un-gate per-module; until
// then their re-exports are gated so the *struct* + core helpers compile.
pub use crate::parse::parse_skip_typescript::*;
pub use crate::parse::*;
pub use crate::visit::*;
// Re-export the real visitor so `P::binary_expression_stack` is typed against
// the same struct `visitExpr.rs` pushes into it (cross-call buffer reuse,
// matching Zig's `p.binary_expression_stack`).
pub use crate::visit::visit_binary::BinaryExpressionVisitor;

pub struct RecentlyVisitedTSNamespace {
    pub expr: js_ast::ExprData,
    // ARENA back-pointer — `StoreRef` for safe `Deref` at the read sites.
    pub map: Option<js_ast::StoreRef<js_ast::TSNamespaceMemberMap>>,
}

// Unused in Zig (per LIFETIMES.tsv evidence).
pub enum RecentlyVisitedTSNamespaceExpressionData {
    Ref(Ref),
    Ptr(*const E::Dot),
}

#[derive(Clone, Copy)]
pub struct ReactRefreshImportClause<'a> {
    pub name: &'a [u8],
    pub enabled: bool,
    pub r#ref: Ref,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReactRefreshExportKind {
    Named,
    Default,
}

// ─────────────────────────────────────────────────────────────────────────────
// P — the parser struct.
// `'a` covers borrowed init() params (log/define/source) AND the arena (`bump`).
// ─────────────────────────────────────────────────────────────────────────────
pub struct P<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> {
    /// Runtime JSX transform mode. Was the `<J: JsxT>` const-generic type
    /// parameter; demoted to a field because JSX only affects a handful of
    /// expression arms (see the `bun .` startup note in `parser.rs`) and the
    /// 4× monomorphization (TYPESCRIPT × JSX) faulted in four copies of every
    /// parser / visitor / lowerer body at startup.
    pub jsx_transform: JSXTransformType,
    pub macro_: MacroState<'a>,
    pub arena: &'a Bump,
    pub options: ParserOptions<'a>,
    /// Raw pointer alias of `lexer.log`. Zig held two `*Log` (`p.log` and
    /// `lexer.log`); Rust cannot store two `&'a mut Log` to one allocation
    /// (Stacked-Borrows UB), so this is a `NonNull` and reborrowed at use sites
    /// via `P::log()`. The pointee outlives `'a` (enforced by `Parser::init`).
    pub log: core::ptr::NonNull<bun_ast::Log>,
    pub define: &'a Define,
    pub source: &'a bun_ast::Source,
    pub lexer: js_lexer::Lexer<'a>,
    pub allow_in: bool,
    pub allow_private_identifiers: bool,

    pub has_top_level_return: bool,
    pub latest_return_had_semicolon: bool,
    pub has_import_meta: bool,
    pub has_es_module_syntax: bool,
    pub top_level_await_keyword: bun_ast::Range,
    pub fn_or_arrow_data_parse: FnOrArrowDataParse,
    pub fn_or_arrow_data_visit: FnOrArrowDataVisit,
    pub fn_only_data_visit: FnOnlyDataVisit<'a>,
    pub allocated_names: List<'a, &'a [u8]>,
    // allocated_names: ListManaged(string) = ListManaged(string).init(bun.default_allocator),
    // allocated_names_pool: ?*AllocatedNamesPool.Node = null,
    pub latest_arrow_arg_loc: bun_ast::Loc,
    pub forbid_suffix_after_as_loc: bun_ast::Loc,
    pub current_scope: js_ast::StoreRef<js_ast::Scope>,
    pub scopes_for_current_part: List<'a, *mut js_ast::Scope>,
    pub symbols: ListManaged<'a, js_ast::Symbol>,
    pub ts_use_counts: List<'a, u32>,
    pub exports_ref: Ref,
    pub require_ref: Ref,
    pub module_ref: Ref,
    pub filename_ref: Ref,
    pub dirname_ref: Ref,
    pub import_meta_ref: Ref,
    pub hmr_api_ref: Ref,

    /// If bake is enabled and this is a server-side file, we want to use
    /// special `Response` class inside the `bun:app` built-in module to
    /// support syntax like `return Response(<jsx />, {...})` or `return Response.render("/my-page")`
    /// or `return Response.redirect("/other")`.
    ///
    /// So we'll need to add a `import { Response } from 'bun:app'` to the
    /// top of the file
    ///
    /// We need to declare this `response_ref` upfront
    pub response_ref: Ref,
    /// We also need to declare the namespace ref for `bun:app` and attach
    /// it to the symbol so the code generated `e_import_identifier`'s
    pub bun_app_namespace_ref: Ref,

    /// Used to track the `feature` function from `import { feature } from "bun:bundle"`.
    /// When visiting e_call, if the target ref matches this, we replace the call with
    /// a boolean based on whether the feature flag is enabled.
    pub bundler_feature_flag_ref: Ref,
    /// Set to true when visiting an if/ternary condition. feature() calls are only valid in this context.
    pub in_branch_condition: bool,

    pub scopes_in_order_visitor_index: usize,
    pub has_classic_runtime_warned: bool,
    pub macro_call_count: MacroCallCountType,

    pub hoisted_ref_for_sloppy_mode_block_fn: RefRefMap,

    /// Used for transforming export default -> module.exports
    pub has_export_default: bool,
    pub has_export_keyword: bool,

    // Used for forcing CommonJS
    pub has_with_scope: bool,

    pub is_file_considered_to_have_esm_exports: bool,

    pub has_called_runtime: bool,

    pub legacy_cjs_import_stmts: ListManaged<'a, Stmt>,

    pub injected_define_symbols: List<'a, Ref>,
    pub symbol_uses: SymbolUseMap,
    pub declared_symbols: bun_ast::DeclaredSymbolList,
    pub declared_symbols_for_reuse: bun_ast::DeclaredSymbolList,
    pub runtime_imports: RuntimeImports,

    /// Used with unwrap_commonjs_packages
    pub imports_to_convert_from_require: List<'a, DeferredImportNamespace>,
    pub unwrap_all_requires: bool,

    pub commonjs_named_exports: bun_ast::ast_result::CommonJSNamedExports,
    pub commonjs_named_exports_deoptimized: bool,
    pub commonjs_module_exports_assigned_deoptimized: bool,
    pub commonjs_named_exports_needs_conversion: u32,
    pub had_commonjs_named_exports_this_visit: bool,
    pub commonjs_replacement_stmts: StmtNodeList,

    pub parse_pass_symbol_uses: ParsePassSymbolUsageType<'a>,

    /// Used by commonjs_at_runtime
    pub has_commonjs_export_names: bool,

    pub stack_check: bun_core::StackCheck,
    /// Hard recursion cap for `parse_stmt`. Zig relies on `stack_check` alone,
    /// but its `parseStmt` uses an `inline` switch that pulls every `t_*`
    /// handler into one multi-KB frame, so 15k nested statements exhaust the
    /// 18 MB Windows stack and trip `is_safe_to_recurse()`. Rust dispatches to
    /// out-of-line `t_*` fns; the `parse_stmt`→`t_for` cycle is only a few
    /// hundred bytes, so the 15k-level `lots-of-for-loop.js` fixture (~4 MB)
    /// never trips the 256 KB threshold on Windows' 18 MB worker stack — parse
    /// completes, then the (uncapped) visitor/printer recurse 15k times and
    /// hard-overflow. Same `MAX_STMT_DEPTH` rationale as `interchange/json.rs`.
    pub parse_stmt_depth: u32,

    /// When this flag is enabled, we attempt to fold all expressions that
    /// TypeScript would consider to be "constant expressions". This flag is
    /// enabled inside each enum body block since TypeScript requires numeric
    /// constant folding in enum definitions.
    ///
    /// We also enable this flag in certain cases in JavaScript files such as when
    /// parsing "const" declarations at the top of a non-ESM file, but we still
    /// reuse TypeScript's notion of "constant expressions" for our own convenience.
    ///
    /// As of TypeScript 5.0, a "constant expression" is defined as follows:
    ///
    ///   An expression is considered a constant expression if it is
    ///
    ///   * a number or string literal,
    ///   * a unary +, -, or ~ applied to a numeric constant expression,
    ///   * a binary +, -, *, /, %, **, <<, >>, >>>, |, &, ^ applied to two numeric constant expressions,
    ///   * a binary + applied to two constant expressions whereof at least one is a string,
    ///   * a template expression where each substitution expression is a constant expression,
    ///   * a parenthesized constant expression,
    ///   * a dotted name (e.g. x.y.z) that references a const variable with a constant expression initializer and no type annotation,
    ///   * a dotted name that references an enum member with an enum literal type, or
    ///   * a dotted name indexed by a string literal (e.g. x.y["z"]) that references an enum member with an enum literal type.
    ///
    /// More detail: https://github.com/microsoft/TypeScript/pull/50528. Note that
    /// we don't implement certain items in this list. For example, we don't do all
    /// number-to-string conversions since ours might differ from how JavaScript
    /// would do it, which would be a correctness issue.
    ///
    /// This flag is also set globally when minify_syntax is enabled, in which this means
    /// we always fold constant expressions.
    pub should_fold_typescript_constant_expressions: bool,

    pub emitted_namespace_vars: RefMap,
    pub is_exported_inside_namespace: RefRefMap,
    pub local_type_names: StringBoolMap,

    // This is the reference to the generated function argument for the namespace,
    // which is different than the reference to the namespace itself:
    //
    //   namespace ns {
    //   }
    //
    // The code above is transformed into something like this:
    //
    //   var ns1;
    //   (function(ns2) {
    //   })(ns1 or (ns1 = {}));
    //
    // This variable is "ns2" not "ns1". It is only used during the second
    // "visit" pass.
    pub enclosing_namespace_arg_ref: Option<Ref>,

    pub jsx_imports: crate::JSXImportSymbols,

    /// only applicable when `.options.features.react_fast_refresh` is set.
    /// populated before visit pass starts.
    pub react_refresh: ReactRefresh<'a>,

    /// only applicable when `.options.features.server_components` is
    /// configured to wrap exports. populated before visit pass starts.
    pub server_components_wrap_ref: Ref,

    pub jest: Jest,

    // Imports (both ES6 and CommonJS) are tracked at the top level
    pub import_records: ImportRecordList<'a>,
    pub import_records_for_current_part: List<'a, u32>,
    pub export_star_import_records: List<'a, u32>,
    pub import_symbol_property_uses: SymbolPropertyUseMap,

    // These are for handling ES6 imports and exports
    pub esm_import_keyword: bun_ast::Range,
    pub esm_export_keyword: bun_ast::Range,
    pub enclosing_class_keyword: bun_ast::Range,
    pub import_items_for_namespace: HashMap<Ref, ImportItemForNamespaceMap>,
    pub is_import_item: RefMap,
    pub named_imports: NamedImportsType<'a>,
    pub named_exports: bun_ast::ast_result::NamedExports,
    pub import_namespace_cc_map: Map<ImportNamespaceCallOrConstruct, bool>,

    // When we're only scanning the imports
    // If they're using the automatic JSX runtime
    // We won't know that we need to import JSX robustly because we don't track
    // symbol counts. Instead, we ask:
    // "Did we parse anything that looked like JSX"?
    // If yes, then automatically add the JSX import.
    pub needs_jsx_import: NeedsJSXType,

    // The parser does two passes and we need to pass the scope tree information
    // from the first pass to the second pass. That's done by tracking the calls
    // to pushScopeForParsePass() and popScope() during the first pass in
    // scopesInOrder.
    //
    // Then, when the second pass calls pushScopeForVisitPass() and popScope(),
    // we consume entries from scopesInOrder and make sure they are in the same
    // order. This way the second pass can efficiently use the same scope tree
    // as the first pass without having to attach the scope tree to the AST.
    //
    // We need to split this into two passes because the pass that declares the
    // symbols must be separate from the pass that binds identifiers to declared
    // symbols to handle declaring a hoisted "var" symbol in a nested scope and
    // binding a name to it in a parent or sibling scope.
    pub scopes_in_order: ScopeOrderList<'a>,
    // Shared slice: the visit pass only ever *reads* `ScopeOrder` (which is
    // `Copy`) and advances/reslices the cursor. A `&'a mut [_]` here forced
    // raw-ptr round-trips at the enum-preprocess save/restore sites and
    // produced overlapping `&mut` under Stacked Borrows when the inner
    // `visit_stmts` re-looked-up the same arena slice from
    // `scopes_in_order_for_enum`. A `&'a [_]` is `Copy`, so save/restore is a
    // plain value copy and the map can hand out the same slice freely.
    pub scope_order_to_visit: &'a [ScopeOrder<'a>],

    // These properties are for the visit pass, which runs after the parse pass.
    // The visit pass binds identifiers to declared symbols, does constant
    // folding, substitutes compile-time variable definitions, and lowers certain
    // syntactic constructs as appropriate.
    pub stmt_expr_value: js_ast::ExprData,
    pub call_target: js_ast::ExprData,
    pub delete_target: js_ast::ExprData,
    pub loop_body: js_ast::StmtData,
    pub module_scope: js_ast::StoreRef<js_ast::Scope>,
    pub module_scope_directive_loc: bun_ast::Loc,
    pub is_control_flow_dead: bool,

    /// We must be careful to avoid revisiting nodes that have scopes.
    pub is_revisit_for_substitution: bool,

    pub method_call_must_be_replaced_with_undefined: bool,

    // Inside a TypeScript namespace, an "export declare" statement can be used
    // to cause a namespace to be emitted even though it has no other observable
    // effect. This flag is used to implement this feature.
    //
    // Specifically, namespaces should be generated for all of the following
    // namespaces below except for "f", which should not be generated:
    //
    //   namespace a { export declare const a }
    //   namespace b { export declare let [[b]] }
    //   namespace c { export declare function c() }
    //   namespace d { export declare class d {} }
    //   namespace e { export declare enum e {} }
    //   namespace f { export declare namespace f {} }
    //
    // The TypeScript compiler compiles this into the following code (notice "f"
    // is missing):
    //
    //   var a; (function (a_1) {})(a or (a = {}));
    //   var b; (function (b_1) {})(b or (b = {}));
    //   var c; (function (c_1) {})(c or (c = {}));
    //   var d; (function (d_1) {})(d or (d = {}));
    //   var e; (function (e_1) {})(e or (e = {}));
    //
    // Note that this should not be implemented by declaring symbols for "export
    // declare" statements because the TypeScript compiler doesn't generate any
    // code for these statements, so these statements are actually references to
    // global variables. There is one exception, which is that local variables
    // *should* be declared as symbols because they are replaced with. This seems
    // like very arbitrary behavior but it's what the TypeScript compiler does,
    // so we try to match it.
    //
    // Specifically, in the following code below "a" and "b" should be declared
    // and should be substituted with "ns.a" and "ns.b" but the other symbols
    // shouldn't. References to the other symbols actually refer to global
    // variables instead of to symbols that are exported from the namespace.
    // This is the case as of TypeScript 4.3. I assume this is a TypeScript bug:
    //
    //   namespace ns {
    //     export declare const a
    //     export declare let [[b]]
    //     export declare function c()
    //     export declare class d { }
    //     export declare enum e { }
    //     console.log(a, b, c, d, e)
    //   }
    //
    // The TypeScript compiler compiles this into the following code:
    //
    //   var ns;
    //   (function (ns) {
    //       console.log(ns.a, ns.b, c, d, e);
    //   })(ns or (ns = {}));
    //
    // Relevant issue: https://github.com/evanw/esbuild/issues/1158
    pub has_non_local_export_declare_inside_namespace: bool,

    // This helps recognize the "await import()" pattern. When this is present,
    // warnings about non-string import paths will be omitted inside try blocks.
    pub await_target: Option<js_ast::ExprData>,

    pub to_expr_wrapper_namespace: Binding2ExprWrapperNamespace,
    pub to_expr_wrapper_hoisted: Binding2ExprWrapperHoisted,

    // This helps recognize the "import().catch()" pattern. We also try to avoid
    // warning about this just like the "try { await import() }" pattern.
    pub then_catch_chain: ThenCatchChain,

    // Temporary variables used for lowering
    pub temp_refs_to_declare: List<'a, TempRef>,
    pub temp_ref_count: i32,

    // When bundling, hoisted top-level local variables declared with "var" in
    // nested scopes are moved up to be declared in the top-level scope instead.
    // The old "var" statements are turned into regular assignments instead. This
    // makes it easier to quickly scan the top-level statements for "var" locals
    // with the guarantee that all will be found.
    pub relocated_top_level_vars: List<'a, js_ast::LocRef>,

    // ArrowFunction is a special case in the grammar. Although it appears to be
    // a PrimaryExpression, it's actually an AssignmentExpression. This means if
    // a AssignmentExpression ends up producing an ArrowFunction then nothing can
    // come after it other than the comma operator, since the comma operator is
    // the only thing above AssignmentExpression under the Expression rule:
    //
    //   AssignmentExpression:
    //     ArrowFunction
    //     ConditionalExpression
    //     LeftHandSideExpression = AssignmentExpression
    //     LeftHandSideExpression AssignmentOperator AssignmentExpression
    //
    //   Expression:
    //     AssignmentExpression
    //     Expression , AssignmentExpression
    //
    pub after_arrow_body_loc: bun_ast::Loc,
    pub import_transposer: ImportTransposer<'a, TYPESCRIPT, SCAN_ONLY>,
    pub require_transposer: RequireTransposer<'a, TYPESCRIPT, SCAN_ONLY>,
    pub require_resolve_transposer: RequireResolveTransposer<'a, TYPESCRIPT, SCAN_ONLY>,

    pub const_values: bun_ast::ast_result::ConstValuesMap,

    // These are backed by stack fallback allocators in _parse, and are uninitialized until then.
    // PERF(port): was stack-fallback alloc — profile in Phase B
    pub binary_expression_stack: ListManaged<'a, BinaryExpressionVisitor>,
    // TODO(b2-blocked): SideEffects::BinaryExpressionSimplifyVisitor — round-D (SideEffects.rs)
    pub binary_expression_simplify_stack: ListManaged<'a, ()>,

    /// We build up enough information about the TypeScript namespace hierarchy to
    /// be able to resolve scope lookups and property accesses for TypeScript enum
    /// and namespace features. Each JavaScript scope object inside a namespace
    /// has a reference to a map of exported namespace members from sibling scopes.
    ///
    /// In addition, there is a map from each relevant symbol reference to the data
    /// associated with that namespace or namespace member: "ref_to_ts_namespace_member".
    /// This gives enough info to be able to resolve queries into the namespace.
    pub ref_to_ts_namespace_member: HashMap<Ref, js_ast::ts::Data>,
    /// When visiting expressions, namespace metadata is associated with the most
    /// recently visited node. If namespace metadata is present, "tsNamespaceTarget"
    /// will be set to the most recently visited node (as a way to mark that this
    /// node has metadata) and "tsNamespaceMemberData" will be set to the metadata.
    pub ts_namespace: RecentlyVisitedTSNamespace,
    pub top_level_enums: List<'a, Ref>,

    // Value is a shared `&'a [ScopeOrder<'a>]` (Zig: `[]ScopeOrder` slice
    // value). The visit pass never writes through these slices — it only reads
    // `Copy` elements and advances a cursor — so the map and
    // `scope_order_to_visit` may safely alias the same arena allocation.
    pub scopes_in_order_for_enum: ArrayHashMap<bun_ast::Loc, &'a [ScopeOrder<'a>]>,

    // If this is true, then all top-level statements are wrapped in a try/catch
    pub will_wrap_module_in_try_catch_for_using: bool,

    /// Used for react refresh, it must be able to insert `const _s = $RefreshSig$();`
    pub nearest_stmt_list: Option<NonNull<ListManaged<'a, Stmt>>>,
    // TODO(port): lifetime — points at a stack local saved/restored across calls
    /// Name from assignment context for anonymous decorated class expressions.
    /// Set before visitExpr, consumed by lowerStandardDecoratorsImpl.
    pub decorator_class_name: Option<&'a [u8]>,
}

// Transposer helpers (Zig: `const ImportTransposer = ExpressionTransposer(P, ..., P.transposeImport);`)
//
// PORT NOTE: Zig's `ExpressionTransposer` is a comptime type-generator that
// captures `*P` and recursively pushes `import()` / `require()` / `require.resolve()`
// through `?:` arms. Routing that through `crate::ExpressionTransposer` would
// require materialising `&mut P` while a `&mut self` borrow of the transposer
// field (a sub-range of `P`) is still live on the `maybe_transpose_if` frame —
// an aliased-`&mut` shape PORTING.md forbids. Instead the recursion lives as
// inherent `P` methods (`maybe_transpose_if_{import,require,require_resolve}`)
// so the only live `&mut` is the caller's `&mut P`.
//
// The structs below are ZST placeholders kept so the `P` struct retains the
// `import_transposer` / `require_transposer` / `require_resolve_transposer`
// field shape from Zig. They no longer carry a `*mut P` self-pointer: storing
// `addr_of_mut!(*self)` in `prepare_for_visit_pass` produced a raw pointer
// whose Stacked-Borrows tag was a child of *that* `&mut self` retag — every
// later `&mut self` retag (entering any visit method) invalidated it, so the
// shim's `&mut *(stored as *mut P)` was UB. Call sites now invoke the inherent
// `P::maybe_transpose_if_*` / `P::transpose_known_to_be_if_*` methods directly.
pub struct ImportTransposer<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>(
    core::marker::PhantomData<&'a ()>,
);
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Clone
    for ImportTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
    fn clone(&self) -> Self {
        *self
    }
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Copy
    for ImportTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>
    ImportTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
    const fn dangling() -> Self {
        Self(core::marker::PhantomData)
    }
}

pub struct RequireTransposer<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>(
    core::marker::PhantomData<&'a ()>,
);
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Clone
    for RequireTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
    fn clone(&self) -> Self {
        *self
    }
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Copy
    for RequireTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>
    RequireTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
    const fn dangling() -> Self {
        Self(core::marker::PhantomData)
    }
}

pub struct RequireResolveTransposer<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>(
    core::marker::PhantomData<&'a ()>,
);
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Clone
    for RequireResolveTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
    fn clone(&self) -> Self {
        *self
    }
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Copy
    for RequireResolveTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool>
    RequireResolveTransposer<'a, TYPESCRIPT, SCAN_ONLY>
{
    const fn dangling() -> Self {
        Self(core::marker::PhantomData)
    }
}

// Zig: `const Binding2ExprWrapper = struct { pub const Namespace = Binding.ToExpr(P, P.wrapIdentifierNamespace); ... }`
// PORT NOTE: `Binding.ToExpr(P, fn)` is a comptime type-generator returning a
// struct that holds `*P` + arena and dispatches `wrapIdentifier` to the
// captured fn. The Rust port type-erases `*P` (which is generic over
// `<'a, TYPESCRIPT, J, SCAN_ONLY>`) into `binding::ToExprWrapper` - same shim
// pattern as `ImportTransposer` above. Wired in `prepare_for_visit_pass`.
pub type Binding2ExprWrapperNamespace = bun_ast::binding::ToExprWrapper;
pub type Binding2ExprWrapperHoisted = bun_ast::binding::ToExprWrapper;

// ═══════════════════════════════════════════════════════════════════════════
// Round-C: associated consts kept live (cheap, used by ParserLike + Parser.rs).
// The full method-body impl block below is gated wholesale — 600+ type errors
// from method bodies referencing not-yet-real Expr/Symbol/Log surface; round-D
// un-gates method-groups (scope mgmt → allocate → error reporting → predicates).
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub const IS_TYPESCRIPT_ENABLED: bool = TYPESCRIPT;
    pub const ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT: bool = SCAN_ONLY;
    pub const TRACK_SYMBOL_USAGE_DURING_PARSE_PASS: bool = SCAN_ONLY && TYPESCRIPT;

    /// Runtime replacement for the former `IS_JSX_ENABLED` associated const
    /// (JSX is no longer a const-generic type parameter — see `jsx_transform`).
    #[inline]
    pub fn is_jsx_enabled(&self) -> bool {
        self.jsx_transform.is_enabled()
    }

    #[inline]
    pub fn parser_features(&self) -> ParserFeatures {
        ParserFeatures { typescript: TYPESCRIPT, jsx: self.jsx_transform, scan_only: SCAN_ONLY }
    }

    /// Reborrow the shared `Log`. The `&self` receiver lets call sites pass
    /// other `self.*` fields as arguments (`self.log().add_error(Some(self.source), …)`)
    /// without a borrow-checker conflict; callers must not hold two results of
    /// `log()` live at once. Matches Zig's two-aliasing-`*Log` model.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn log(&self) -> &mut bun_ast::Log {
        // SAFETY: `self.log` was created from an `&'a mut Log` that outlives
        // `'a` (and therefore `self`). `self.lexer.log` aliases the same
        // allocation as a `NonNull` (not `&mut`), so no long-lived Unique tag
        // exists to be invalidated by this transient reborrow.
        unsafe { &mut *self.log.as_ptr() }
    }

    /// Safe mutable projection of `nearest_stmt_list`.
    ///
    /// The pointer targets a `ListManaged` living on a parent
    /// `visit_stmts_and_prepend_temp_refs` stack frame (saved/restored around
    /// each visit), disjoint from `*self`, so a transient `&mut` tied to
    /// `&mut self` cannot alias any other live borrow. Centralises the
    /// `unsafe` so call sites stay safe.
    #[inline]
    pub fn nearest_stmt_list_mut(&mut self) -> Option<&mut ListManaged<'a, Stmt>> {
        // SAFETY: `nearest_stmt_list` is a back-pointer to stack storage on
        // the enclosing visit frame, set before recursion and restored before
        // that frame returns. It is disjoint from `*self` and from any other
        // `&mut` reachable through `self`. The `&mut self` receiver ensures no
        // concurrent caller is projecting it.
        self.nearest_stmt_list.map(|mut p| unsafe { p.as_mut() })
    }

    /// Shared borrow of the current scope.
    ///
    /// `current_scope` is a [`StoreRef`](js_ast::StoreRef) into the parser
    /// arena: initialised to a valid arena-allocated Scope in `init()` and
    /// every reassignment (push/pop scope) stores another arena-owned handle;
    /// the pointee outlives `'a` and is never freed during parsing.
    #[inline]
    pub fn current_scope(&self) -> &js_ast::Scope {
        &self.current_scope
    }

    /// Unique borrow of the current scope. Takes `&mut self` so two live
    /// `&mut Scope` cannot alias from a shared `&P` (PORTING.md §Forbidden).
    /// Caller must not also hold a borrow obtained via `module_scope[_mut]()`
    /// when the two handles alias (top level).
    #[inline]
    pub fn current_scope_mut(&mut self) -> &mut js_ast::Scope {
        &mut self.current_scope
    }

    /// Shared borrow of the module (top-level) scope.
    #[inline]
    pub fn module_scope(&self) -> &js_ast::Scope {
        &self.module_scope
    }

    /// Unique borrow of the module scope. Takes `&mut self` (see
    /// `current_scope_mut`).
    #[inline]
    pub fn module_scope_mut(&mut self) -> &mut js_ast::Scope {
        &mut self.module_scope
    }

    /// `current_scope` as an arena-backed [`StoreRef`](js_ast::StoreRef) handle.
    ///
    /// Use this for parent-chain walks that need to hold the cursor across
    /// `&mut self` calls — `StoreRef` is `Copy` and does not borrow `self`, so
    /// it sidesteps the borrowck conflict that `current_scope()` (which
    /// returns a `&Scope` tied to `&self`) would hit.
    #[inline]
    pub fn current_scope_ref(&self) -> js_ast::StoreRef<js_ast::Scope> {
        self.current_scope
    }

    /// `module_scope` as an arena-backed [`StoreRef`](js_ast::StoreRef) handle.
    /// Same rationale as [`current_scope_ref`] — `Copy` and does not borrow
    /// `self`, so it can be held across `&mut self` calls.
    #[inline]
    pub fn module_scope_ref(&self) -> js_ast::StoreRef<js_ast::Scope> {
        self.module_scope
    }

    // ── thin allocate-helpers (un-gated so the parse_*/visit_* mixin bodies
    //    can reference them; the full bodies with SCAN_ONLY require-scan and
    //    @typeInfo branches stay in the gated block below) ────────────────
    #[inline]
    pub fn new_expr<T>(&mut self, t: T, loc: bun_ast::Loc) -> Expr
    where
        T: js_ast::expr::IntoExprData,
    {
        // PORT NOTE: Zig's `comptime Type == E.Call` check is done post-init by
        // matching on the constructed `Data` (Rust has no comptime type-eq).
        // Semantically equivalent — the import-record side-effect is order-
        // independent of `Expr.init`'s Store allocation.
        let expr = Expr::init(t, loc);
        if SCAN_ONLY {
            if let js_ast::ExprData::ECall(call) = expr.data {
                if let js_ast::ExprData::EIdentifier(ident) = call.target.data {
                    // is this a require("something")
                    if self.load_name_from_ref(ident.ref_) == b"require" && call.args.len_u32() == 1
                    {
                        if let js_ast::ExprData::EString(s) = call.args.at(0).data {
                            let _ = self.add_import_record(
                                ImportKind::Require,
                                loc,
                                s.string(self.arena).expect("unreachable"),
                            );
                        }
                    }
                }
            }
        }
        expr
    }

    #[inline]
    pub fn s<T>(&self, t: T, loc: bun_ast::Loc) -> Stmt
    where
        T: js_ast::stmt::StatementData,
    {
        Stmt::alloc(t, loc)
    }

    pub fn load_name_from_ref(&self, r#ref: Ref) -> &'a [u8] {
        use js_ast::base::RefTag;
        match r#ref.tag() {
            // SAFETY: original_name is an arena-owned slice valid for 'a (Symbol is created
            // from p.arena / source.contents in this same parse).
            RefTag::Symbol => self.symbols[r#ref.inner_index() as usize]
                .original_name
                .slice(),
            RefTag::SourceContentsSlice => {
                let start = r#ref.source_index() as usize;
                let end = start + r#ref.inner_index() as usize;
                &self.source.contents[start..end]
            }
            RefTag::AllocatedName => self.allocated_names[r#ref.inner_index() as usize],
            _ => panic!("Internal error: JS parser tried to load an invalid name from a Ref"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Round-D: core helper methods on P. Un-gated in groups; heavy bodies that
// touch unfinished E/S/ts surface or call into parse_*/visit_* sibling files
// stay individually ` // blocked_on:` below.
// ═══════════════════════════════════════════════════════════════════════════
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub const ALLOW_MACROS: bool = true /* TODO(b2-blocked): feature_flag::IS_MACRO_ENABLED */;

    /// use this instead of checking p.source.index
    /// because when not bundling, p.source.index is `0`
    #[inline]
    pub fn is_source_runtime(&self) -> bool {
        // Zig: Index.isRuntime() — index 0 is the synthetic runtime chunk.
        self.options.bundle && self.source.index.0 == 0
    }

    /// Extracts a matchable "shape" from a dynamic import argument.
    /// Template literals: static parts joined by \x00 placeholders.
    /// Everything else: empty string.
    fn extract_dynamic_specifier_shape<'b>(
        &mut self,
        arg: Expr,
        buf: &'b mut BumpVec<'a, u8>,
    ) -> Result<&'b [u8], bun_core::Error> {
        if let Some(tmpl) = arg.data.e_template() {
            if tmpl.tag.is_some() {
                return Ok(b""); // tagged template — opaque
            }
            match &tmpl.head {
                js_ast::e::TemplateContents::Cooked(head) => {
                    buf.extend_from_slice(head.string(self.arena)?);
                }
                js_ast::e::TemplateContents::Raw(_) => return Ok(b""), // shouldn't happen post-visit but be safe
            }
            for part in tmpl.parts().iter() {
                buf.push(0); // \x00 placeholder per interpolation
                match &part.tail {
                    js_ast::e::TemplateContents::Cooked(tail) => {
                        buf.extend_from_slice(tail.string(self.arena)?);
                    }
                    js_ast::e::TemplateContents::Raw(_) => return Ok(b""), // raw tail — treat as opaque
                }
            }
            return Ok(buf.as_slice());
        }
        Ok(b"")
    }

    pub fn check_dynamic_specifier(
        &mut self,
        arg: Expr,
        loc: bun_ast::Loc,
        kind: &'static str,
    ) -> Result<(), bun_core::Error> {
        if !self.options.bundle
            || matches!(
                self.options.allow_unresolved,
                crate::parser::options::AllowUnresolved::All
            )
        {
            return Ok(());
        }

        let mut shape_buf = BumpVec::new_in(self.arena);
        let shape = self.extract_dynamic_specifier_shape(arg, &mut shape_buf)?;
        if !self.options.allow_unresolved.allows(shape) {
            let r = js_lexer::range_of_identifier(self.source, loc);
            if !shape.is_empty() {
                // Print a human-readable shape: replace \x00 with *
                let display = self.arena.alloc_slice_copy(shape);
                for c in display.iter_mut() {
                    if *c == 0 {
                        *c = b'*';
                    }
                }
                self.log().add_range_error_fmt_with_note(
                        Some(self.source),
                        r,
                        format_args!(
                            "This {} expression will not be bundled because the argument is not a string literal",
                            kind
                        ),
                        format_args!(
                            "The specifier shape \"{0}\" does not match any --allow-unresolved pattern. \
                             To allow it, add a matching pattern: Bun.build({{ allowUnresolved: [\"{0}\"] }}) or --allow-unresolved '{0}'",
                            bstr::BStr::new(display)
                        ),
                        r,
                    );
            } else {
                self.log().add_range_error_fmt_with_note(
                        Some(self.source),
                        r,
                        format_args!(
                            "This {} expression will not be bundled because the argument is not a string literal",
                            kind
                        ),
                        format_args!(
                            "To allow opaque dynamic specifiers, use Bun.build({{ allowUnresolved: [\"\"] }}) or pass --allow-unresolved with an empty-string pattern"
                        ),
                        r,
                    );
            }
        }
        Ok(())
    }

    // ───────────────────────────────────────────────────────────────────────
    // Inlined ExpressionTransposer recursion (Zig: parser.zig:163-199).
    // Defined as `&mut self` methods so the only live `&mut` is the caller's
    // `&mut P` — avoids the aliased-`&mut` that arises when a transposer
    // *field* holds `&mut self` while a `&mut P` is materialised inside the
    // visitor (PORTING.md §Forbidden).
    pub fn maybe_transpose_if_import(&mut self, arg: Expr, state: &TransposeState) -> Expr {
        match arg.data {
            js_ast::ExprData::EIf(ex) => Expr::init(
                E::If {
                    yes: self.maybe_transpose_if_import(ex.yes, state),
                    no: self.maybe_transpose_if_import(ex.no, state),
                    test_: ex.test_,
                },
                arg.loc,
            ),
            _ => self.transpose_import(arg, state),
        }
    }

    pub fn maybe_transpose_if_require(&mut self, arg: Expr, state: &TransposeState) -> Expr {
        match arg.data {
            js_ast::ExprData::EIf(ex) => Expr::init(
                E::If {
                    yes: self.maybe_transpose_if_require(ex.yes, state),
                    no: self.maybe_transpose_if_require(ex.no, state),
                    test_: ex.test_,
                },
                arg.loc,
            ),
            _ => self.transpose_require(arg, state),
        }
    }

    pub fn transpose_known_to_be_if_require(&mut self, arg: Expr, state: &TransposeState) -> Expr {
        // Caller guarantees `arg.data` is `EIf`.
        let js_ast::ExprData::EIf(ex) = arg.data else {
            unreachable!()
        };
        Expr::init(
            E::If {
                yes: self.maybe_transpose_if_require(ex.yes, state),
                no: self.maybe_transpose_if_require(ex.no, state),
                test_: ex.test_,
            },
            arg.loc,
        )
    }

    pub fn maybe_transpose_if_require_resolve(&mut self, arg: Expr, state: Expr) -> Expr {
        match arg.data {
            js_ast::ExprData::EIf(ex) => Expr::init(
                E::If {
                    yes: self.maybe_transpose_if_require_resolve(ex.yes, state),
                    no: self.maybe_transpose_if_require_resolve(ex.no, state),
                    test_: ex.test_,
                },
                arg.loc,
            ),
            _ => self.transpose_require_resolve(arg, state),
        }
    }

    pub fn transpose_known_to_be_if_require_resolve(&mut self, arg: Expr, state: Expr) -> Expr {
        // Caller guarantees `arg.data` is `EIf`.
        let js_ast::ExprData::EIf(ex) = arg.data else {
            unreachable!()
        };
        Expr::init(
            E::If {
                yes: self.maybe_transpose_if_require_resolve(ex.yes, state),
                no: self.maybe_transpose_if_require_resolve(ex.no, state),
                test_: ex.test_,
            },
            arg.loc,
        )
    }

    pub fn transpose_import(&mut self, arg: Expr, state: &TransposeState) -> Expr {
        // The argument must be a string
        if let Some(mut str_) = arg.data.as_e_string() {
            // Ignore calls to import() if the control flow is provably dead here.
            // We don't want to spend time scanning the required files if they will
            // never be used.
            if self.is_control_flow_dead {
                return self.new_expr(E::Null {}, arg.loc);
            }

            let import_record_index =
                self.add_import_record(ImportKind::Dynamic, arg.loc, str_.slice(self.arena));

            if let Some(tag) = state.import_record_tag {
                self.import_records.items_mut()[import_record_index as usize].tag = tag;
            }

            if let Some(loader) = state.import_loader {
                self.import_records.items_mut()[import_record_index as usize].loader = Some(loader);
            }

            self.import_records.items_mut()[import_record_index as usize]
                .flags
                .set(
                    bun_ast::ImportRecordFlags::HANDLES_IMPORT_ERRORS,
                    (state.is_await_target && self.fn_or_arrow_data_visit.try_body_count != 0)
                        || state.is_then_catch_target,
                );
            self.import_records_for_current_part
                .push(import_record_index);

            return self.new_expr(
                E::Import {
                    expr: arg,
                    import_record_index,
                    options: state.import_options,
                },
                state.loc,
            );
        }

        if self.options.warn_about_unbundled_modules {
            // Use a debug log so people can see this if they want to
            let r = js_lexer::range_of_identifier(self.source, state.loc);
            self.log()
                .add_range_debug(
                    Some(self.source),
                    r,
                    b"This \"import\" expression cannot be bundled because the argument is not a string literal",
                );
        }

        let _ = self.check_dynamic_specifier(arg, state.loc, "import()");

        self.new_expr(
            E::Import {
                expr: arg,
                options: state.import_options,
                import_record_index: u32::MAX,
            },
            state.loc,
        )
    }

    pub fn transpose_require_resolve(&mut self, arg: Expr, require_resolve_ref: Expr) -> Expr {
        // The argument must be a string
        if matches!(arg.data, js_ast::ExprData::EString(_)) {
            return self.transpose_require_resolve_known_string(arg);
        }

        if self.options.warn_about_unbundled_modules {
            // Use a debug log so people can see this if they want to
            let r = js_lexer::range_of_identifier(self.source, arg.loc);
            self.log()
                .add_range_debug(
                    Some(self.source),
                    r,
                    b"This \"require.resolve\" expression cannot be bundled because the argument is not a string literal",
                );
        }

        let _ = self.check_dynamic_specifier(arg, arg.loc, "require.resolve()");

        // Zig: `arena.alloc(Expr, 1); args[0] = arg; ExprNodeList.fromOwnedSlice(args)`.
        // PORT NOTE: Vec::from_owned_slice wants Box<[T]>; init_one is the
        // single-element equivalent (matches transpose_require below).
        self.new_expr(
            E::Call {
                target: require_resolve_ref,
                args: ExprNodeList::init_one(arg),
                ..Default::default()
            },
            arg.loc,
        )
    }

    #[inline]
    pub fn transpose_require_resolve_known_string(&mut self, arg: Expr) -> Expr {
        debug_assert!(matches!(arg.data, js_ast::ExprData::EString(_)));

        // Ignore calls to import() if the control flow is provably dead here.
        // We don't want to spend time scanning the required files if they will
        // never be used.
        if self.is_control_flow_dead {
            return self.new_expr(E::Null {}, arg.loc);
        }

        let import_record_index = self.add_import_record(
            ImportKind::RequireResolve,
            arg.loc,
            arg.data
                .e_string()
                .expect("infallible: variant checked")
                .string(self.arena)
                .expect("unreachable"),
        );
        self.import_records.items_mut()[import_record_index as usize]
            .flags
            .set(
                bun_ast::ImportRecordFlags::HANDLES_IMPORT_ERRORS,
                self.fn_or_arrow_data_visit.try_body_count != 0,
            );
        self.import_records_for_current_part
            .push(import_record_index);

        self.new_expr(
            E::RequireResolveString {
                import_record_index,
                // .leading_interior_comments = arg.getString().
            },
            arg.loc,
        )
    }

    pub fn transpose_require(&mut self, arg: Expr, state: &TransposeState) -> Expr {
        if !self.options.features.allow_runtime {
            return self.new_expr(
                E::Call {
                    target: self.value_for_require(arg.loc),
                    args: ExprNodeList::init_one(arg),
                    ..Default::default()
                },
                arg.loc,
            );
        }

        match arg.data {
            js_ast::ExprData::EString(mut str_) => {
                // Ignore calls to require() if the control flow is provably dead here.
                // We don't want to spend time scanning the required files if they will
                // never be used.
                if self.is_control_flow_dead {
                    return Expr {
                        data: null_expr_data(),
                        loc: arg.loc,
                    };
                }

                str_.resolve_rope_if_needed(self.arena);
                let pathname = str_.string(self.arena).expect("unreachable");
                let path = fs::Path::init(pathname);

                let handles_import_errors = self.fn_or_arrow_data_visit.try_body_count != 0;

                // For unwrapping CommonJS into ESM to fully work
                // we must also unwrap requires into imports.
                let should_unwrap_require = self.options.features.unwrap_commonjs_to_esm
                    && (self.unwrap_all_requires
                        || path_package_name(&path)
                            .map(|pkg| self.options.features.should_unwrap_require(pkg))
                            .unwrap_or(false))
                    // We cannot unwrap a require wrapped in a try/catch because
                    // import statements cannot be wrapped in a try/catch and
                    // require cannot return a promise.
                    && !handles_import_errors;

                if should_unwrap_require {
                    let import_record_index = self.add_import_record_by_range_and_path(
                        ImportKind::Stmt,
                        self.source.range_of_string(arg.loc),
                        path,
                    );
                    self.import_records.items_mut()[import_record_index as usize]
                        .flags
                        .set(
                            bun_ast::ImportRecordFlags::HANDLES_IMPORT_ERRORS,
                            handles_import_errors,
                        );

                    // Note that this symbol may be completely removed later.
                    let path_name = fs::PathName::init(pathname);
                    // Zig: `path_name.nonUniqueNameString(arena)` — render the
                    // sanitized-identifier formatter into the bump arena.
                    let name: &'a [u8] = {
                        use core::fmt::Write as _;
                        let mut buf = bun_alloc::ArenaString::new_in(self.arena);
                        write!(
                            &mut buf,
                            "{}",
                            bun_core::fmt::fmt_identifier(path_name.non_unique_name_string_base())
                        )
                        .expect("unreachable");
                        buf.into_bump_str().as_bytes()
                    };
                    let namespace_ref = self
                        .new_symbol(js_ast::symbol::Kind::Other, name)
                        .expect("oom");

                    self.imports_to_convert_from_require
                        .push(DeferredImportNamespace {
                            namespace: LocRef {
                                ref_: Some(namespace_ref),
                                loc: arg.loc,
                            },
                            import_record_id: import_record_index,
                        });
                    self.import_items_for_namespace
                        .insert(namespace_ref, ImportItemForNamespaceMap::default());
                    self.record_usage(namespace_ref);

                    if !state.is_require_immediately_assigned_to_decl {
                        return self.new_expr(
                            E::Identifier {
                                ref_: namespace_ref,
                                ..Default::default()
                            },
                            arg.loc,
                        );
                    }

                    return self.new_expr(
                        E::RequireString {
                            import_record_index,
                            unwrapped_id: u32::try_from(
                                self.imports_to_convert_from_require.len() - 1,
                            )
                            .expect("int cast"),
                        },
                        arg.loc,
                    );
                }

                let import_record_index = self.add_import_record_by_range_and_path(
                    ImportKind::Require,
                    self.source.range_of_string(arg.loc),
                    path,
                );
                self.import_records.items_mut()[import_record_index as usize]
                    .flags
                    .set(
                        bun_ast::ImportRecordFlags::HANDLES_IMPORT_ERRORS,
                        handles_import_errors,
                    );
                self.import_records_for_current_part
                    .push(import_record_index);

                self.new_expr(
                    E::RequireString {
                        import_record_index,
                        ..Default::default()
                    },
                    arg.loc,
                )
            }
            _ => {
                let _ = self.check_dynamic_specifier(arg, arg.loc, "require()");
                self.record_usage_of_runtime_require();
                self.new_expr(
                    E::Call {
                        target: self.value_for_require(arg.loc),
                        args: ExprNodeList::init_one(arg),
                        ..Default::default()
                    },
                    arg.loc,
                )
            }
        }
    }

    #[inline]
    pub fn should_unwrap_common_js_to_esm(&self) -> bool {
        self.options.features.unwrap_commonjs_to_esm
    }

    // ─── Parser.rs `_parse` calls these names (commonjs as one word); other ───
    // ─── visit modules call the `_common_js_` two-word forms above. Keep    ───
    // ─── both spellings until round-E reconciles call sites.               ───
    #[inline]
    pub fn should_unwrap_commonjs_to_esm(&self) -> bool {
        self.should_unwrap_common_js_to_esm()
    }
    #[inline]
    pub fn is_deoptimized_commonjs(&self) -> bool {
        self.is_deoptimized_common_js()
    }
    #[inline]
    pub fn deoptimize_commonjs_named_exports(&mut self) {
        self.deoptimize_common_js_named_exports();
    }

    fn is_binding_used(&mut self, binding: Binding, default_export_ref: Ref) -> bool {
        match binding.data {
            js_ast::b::B::BIdentifier(ident) => {
                let ident = ident.get();
                if default_export_ref.eql(ident.r#ref) {
                    return true;
                }
                if self.named_imports.contains(&ident.r#ref) {
                    return true;
                }

                for named_export in self.named_exports.values() {
                    if named_export.ref_.eql(ident.r#ref) {
                        return true;
                    }
                }

                let symbol: &Symbol = &self.symbols[ident.r#ref.inner_index() as usize];
                symbol.use_count_estimate > 0
            }
            js_ast::b::B::BArray(array) => {
                for item in array.items.slice() {
                    if self.is_binding_used(item.binding, default_export_ref) {
                        return true;
                    }
                }
                false
            }
            js_ast::b::B::BObject(obj) => {
                for prop in obj.properties.slice() {
                    if self.is_binding_used(prop.value, default_export_ref) {
                        return true;
                    }
                }
                false
            }
            js_ast::b::B::BMissing(_) => false,
        }
    }

    // blocked_on: is_binding_used; SideEffects::to_boolean; Part fields; named_exports key type
    pub fn tree_shake(&mut self, parts: &mut &'a mut [js_ast::Part], merge: bool) {
        let mut parts_ = core::mem::take(parts);
        // PORT NOTE: Zig used `defer` to merge parts after the loop. We replicate by
        // running the merge logic explicitly after the while-loop below.

        let default_export_ref = self
            .named_exports
            .get(b"default" as &[u8])
            .map(|d| d.ref_)
            .unwrap_or(Ref::NONE);

        while parts_.len() > 1 {
            let mut parts_end: usize = 0;
            let last_end = parts_.len();

            for i in 0..parts_.len() {
                // PORT NOTE: Zig copied `Part` by value (POD struct). Rust `Part` is
                // not `Clone`, so borrow it for the dead-check; the only mutation
                // is the swap into `parts_[parts_end]` at the bottom.
                let part = &parts_[i];
                let is_dead = part.can_be_removed_if_unused
                    && 'can_remove_part: {
                        for stmt in part.stmts.iter() {
                            match &stmt.data {
                                js_ast::StmtData::SLocal(local) => {
                                    if local.is_export {
                                        break 'can_remove_part false;
                                    }
                                    for decl in local.decls.slice() {
                                        if self.is_binding_used(decl.binding, default_export_ref) {
                                            break 'can_remove_part false;
                                        }
                                    }
                                }
                                js_ast::StmtData::SIf(if_statement) => {
                                    let result =
                                        SideEffects::to_boolean(self, &if_statement.test_.data);
                                    if !(result.ok
                                        && result.side_effects == SideEffects::NoSideEffects
                                        && !result.value)
                                    {
                                        break 'can_remove_part false;
                                    }
                                }
                                js_ast::StmtData::SWhile(while_statement) => {
                                    let result =
                                        SideEffects::to_boolean(self, &while_statement.test_.data);
                                    if !(result.ok
                                        && result.side_effects == SideEffects::NoSideEffects
                                        && !result.value)
                                    {
                                        break 'can_remove_part false;
                                    }
                                }
                                js_ast::StmtData::SFor(for_statement) => {
                                    if let Some(expr) = &for_statement.test_ {
                                        let result = SideEffects::to_boolean(self, &expr.data);
                                        if !(result.ok
                                            && result.side_effects == SideEffects::NoSideEffects
                                            && !result.value)
                                        {
                                            break 'can_remove_part false;
                                        }
                                    }
                                }
                                js_ast::StmtData::SFunction(func) => {
                                    if func.func.flags.contains(Flags::Function::IsExport) {
                                        break 'can_remove_part false;
                                    }
                                    if let Some(name) = &func.func.name {
                                        let name_ref = name.ref_.expect("infallible: ref bound");
                                        let symbol: &Symbol =
                                            &self.symbols[name_ref.inner_index() as usize];

                                        if name_ref.eql(default_export_ref)
                                        || symbol.use_count_estimate > 0
                                        // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                                        || self.named_exports.contains_key(symbol.original_name.slice())
                                        || self.named_imports.contains(&name_ref)
                                        || self.is_import_item.get(&name_ref).is_some()
                                        {
                                            break 'can_remove_part false;
                                        }
                                    }
                                }
                                js_ast::StmtData::SImport(_)
                                | js_ast::StmtData::SExportClause(_)
                                | js_ast::StmtData::SExportFrom(_)
                                | js_ast::StmtData::SExportDefault(_) => {
                                    break 'can_remove_part false;
                                }

                                js_ast::StmtData::SClass(class) => {
                                    if class.is_export {
                                        break 'can_remove_part false;
                                    }
                                    if let Some(name) = &class.class.class_name {
                                        let name_ref = name.ref_.expect("infallible: ref bound");
                                        let symbol: &Symbol =
                                            &self.symbols[name_ref.inner_index() as usize];

                                        if name_ref.eql(default_export_ref)
                                        || symbol.use_count_estimate > 0
                                        // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                                        || self.named_exports.contains_key(symbol.original_name.slice())
                                        || self.named_imports.contains(&name_ref)
                                        || self.is_import_item.get(&name_ref).is_some()
                                        {
                                            break 'can_remove_part false;
                                        }
                                    }
                                }

                                _ => break 'can_remove_part false,
                            }
                        }
                        true
                    };

                if is_dead {
                    // `parts_` is the caller-owned `&'a mut [Part]` (taken via
                    // `mem::take(parts)` above), disjoint from `*self`, so a
                    // shared reborrow of `parts_[i]` coexists with `&mut self`
                    // here — no raw-ptr roundtrip needed.
                    self.clear_symbol_usages_from_dead_part(&parts_[i]);
                    continue;
                }

                parts_.swap(parts_end, i);
                parts_end += 1;
            }

            parts_ = &mut parts_[..parts_end];
            // PORT NOTE: reshaped for borrowck — Zig wrote parts_.len = parts_end
            if last_end == parts_.len() {
                break;
            }
        }

        // (deferred merge logic)
        if merge && parts_.len() > 1 {
            let mut first_none_part: usize = parts_.len();
            let mut stmts_count: usize = 0;
            for (i, part) in parts_.iter().enumerate() {
                if part.tag == bun_ast::PartTag::None {
                    stmts_count += part.stmts.len();
                    first_none_part = i.min(first_none_part);
                }
            }

            if first_none_part < parts_.len() {
                let stmts_list = self
                    .arena
                    .alloc_slice_fill_with::<Stmt, _>(stmts_count, |_| Stmt::empty());
                let mut stmts_remain = &mut stmts_list[..];

                for part in parts_.iter() {
                    if part.tag == bun_ast::PartTag::None {
                        let src = part.stmts.slice();
                        stmts_remain[..src.len()].copy_from_slice(src);
                        stmts_remain = &mut stmts_remain[src.len()..];
                    }
                }

                parts_[first_none_part].stmts = bun_ast::StoreSlice::new_mut(stmts_list);
                parts_ = &mut parts_[..first_none_part + 1];
            }
        }

        *parts = parts_;
    }

    fn clear_symbol_usages_from_dead_part(&mut self, part: &js_ast::Part) {
        let symbol_use_refs = part.symbol_uses.keys();
        let symbol_use_values = part.symbol_uses.values();
        let symbols = self.symbols.as_mut_slice();

        debug_assert_eq!(symbol_use_refs.len(), symbol_use_values.len());
        for (r#ref, prev) in symbol_use_refs.iter().zip(symbol_use_values) {
            symbols[r#ref.inner_index() as usize].use_count_estimate = symbols
                [r#ref.inner_index() as usize]
                .use_count_estimate
                .saturating_sub(prev.count_estimate);
        }
        let declared_refs = part.declared_symbols.refs();
        for declared in declared_refs {
            symbols[declared.inner_index() as usize].use_count_estimate = 0;
        }
    }

    // s() lives in the round-C live block above (deduped).

    fn compute_character_frequency(&mut self) -> Option<js_ast::CharFreq> {
        if !self.options.features.minify_identifiers || self.is_source_runtime() {
            return None;
        }

        // Add everything in the file to the histogram
        let mut freq = js_ast::CharFreq { freqs: [0i32; 64] };

        freq.scan(&self.source.contents, 1);

        // Subtract out all comments
        for comment_range in self.lexer.all_comments.iter() {
            freq.scan(self.source.text_for_range(*comment_range), -1);
        }

        // Subtract out all import paths
        for record in self.import_records.items() {
            freq.scan(record.path.text, -1);
        }

        fn visit(
            symbols: &[js_ast::Symbol],
            char_freq: &mut js_ast::CharFreq,
            scope: &js_ast::Scope,
        ) {
            for (_, member) in scope.members.iter() {
                let symbol: &Symbol = &symbols[member.ref_.inner_index() as usize];
                if symbol.slot_namespace() != js_ast::symbol::SlotNamespace::MustNotBeRenamed {
                    // SAFETY: Symbol.original_name is an arena-owned slice valid for the parser lifetime.
                    char_freq.scan(
                        symbol.original_name.slice(),
                        -(i32::try_from(symbol.use_count_estimate).expect("int cast")),
                    );
                }
            }

            if let Some(r#ref) = scope.label_ref {
                let symbol = &symbols[r#ref.inner_index() as usize];
                if symbol.slot_namespace() != js_ast::symbol::SlotNamespace::MustNotBeRenamed {
                    // SAFETY: see above.
                    char_freq.scan(
                        symbol.original_name.slice(),
                        -(i32::try_from(symbol.use_count_estimate).expect("int cast")) - 1,
                    );
                }
            }

            for child in scope.children.slice() {
                visit(symbols, char_freq, child);
            }
        }
        visit(self.symbols.as_slice(), &mut freq, self.module_scope());

        // TODO: mangledProps

        Some(freq)
    }

    // new_expr() lives in the round-C live block above (deduped). The
    // SCAN_ONLY require("...") sniff branch is restored there once
    // IntoExprData::as_e_call() lands.

    /// Zig: `p.b(t, loc)` — bump-allocate a binding payload and wrap it in `Binding`.
    /// `BindingAlloc` (Binding.rs round-G2) replaces the Zig `@TypeOf(t)` switch.
    ///
    /// PORT NOTE: Zig's `p.b(t: anytype)` had a `@typeInfo == .pointer` arm that
    /// dispatched to `Binding.init(t, loc)` (wrap-existing-allocation) instead of
    /// `Binding.alloc`. That arm is intentionally dropped here: every Zig caller
    /// passes `t` by value, so only the alloc path was ever exercised. If a future
    /// caller needs to wrap an already-stored payload, call `Binding::init` directly.
    #[inline]
    pub fn b<T>(&mut self, t: T, loc: bun_ast::Loc) -> Binding
    where
        T: js_ast::binding::BindingAlloc,
    {
        Binding::alloc(self.arena, t, loc)
    }

    pub fn record_exported_binding(&mut self, binding: Binding) {
        match binding.data {
            js_ast::b::B::BMissing(_) => {}
            js_ast::b::B::BIdentifier(ident) => {
                let ident = ident.get();
                // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                let name: &'a [u8] = self.symbols[ident.r#ref.inner_index() as usize]
                    .original_name
                    .slice();
                self.record_export(binding.loc, name, ident.r#ref)
                    .expect("unreachable");
            }
            js_ast::b::B::BArray(array) => {
                for prop in array.items.slice() {
                    self.record_exported_binding(prop.binding);
                }
            }
            js_ast::b::B::BObject(obj) => {
                for prop in obj.properties.slice() {
                    self.record_exported_binding(prop.value);
                }
            }
        }
    }

    pub fn record_export(
        &mut self,
        loc: bun_ast::Loc,
        alias: &'a [u8],
        r#ref: Ref,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(name) = self.named_exports.get(alias) {
            // Duplicate exports are an error
            let notes: Box<[bun_ast::Data]> = Box::new([bun_ast::Data {
                text: std::borrow::Cow::Owned(
                    format!(
                        "\"{}\" was originally exported here",
                        bstr::BStr::new(alias)
                    )
                    .into_bytes(),
                ),
                location: bun_ast::Location::init_or_null(
                    Some(self.source),
                    js_lexer::range_of_identifier(self.source, name.alias_loc),
                ),
                ..Default::default()
            }]);
            self.log().add_range_error_fmt_with_notes(
                Some(self.source),
                js_lexer::range_of_identifier(self.source, loc),
                notes,
                format_args!(
                    "Multiple exports with the same name \"{}\"",
                    bstr::BStr::new(bun_core::trim(alias, b"\"'"))
                ),
            );
        } else if !self.is_deoptimized_common_js() {
            self.named_exports.put(
                alias,
                js_ast::NamedExport {
                    alias_loc: loc,
                    ref_: r#ref,
                },
            )?;
        }
        Ok(())
    }

    pub fn is_deoptimized_common_js(&self) -> bool {
        self.commonjs_named_exports_deoptimized && self.commonjs_named_exports.count() > 0
    }

    pub fn record_usage(&mut self, ref_: Ref) {
        if self.is_revisit_for_substitution {
            return;
        }
        // The use count stored in the symbol is used for generating symbol names
        // during minification. These counts shouldn't include references inside dead
        // code regions since those will be culled.
        if !self.is_control_flow_dead {
            if cfg!(debug_assertions) {
                debug_assert!(self.symbols.len() > ref_.inner_index() as usize);
            }
            self.symbols[ref_.inner_index() as usize].use_count_estimate += 1;
            let result = self.symbol_uses.get_or_put(ref_).expect("unreachable");
            if !result.found_existing {
                *result.value_ptr = js_ast::symbol::Use { count_estimate: 1 };
            } else {
                result.value_ptr.count_estimate += 1;
            }
        }

        // The correctness of TypeScript-to-JavaScript conversion relies on accurate
        // symbol use counts for the whole file, including dead code regions. This is
        // tracked separately in a parser-only data structure.
        if TYPESCRIPT {
            self.ts_use_counts[ref_.inner_index() as usize] += 1;
        }
    }

    pub fn log_arrow_arg_errors(&mut self, errors: &mut DeferredArrowArgErrors) {
        if errors.invalid_expr_await.len > 0 {
            let r = errors.invalid_expr_await;
            self.log().add_range_error(
                Some(self.source),
                r,
                b"Cannot use an \"await\" expression here",
            );
        }

        if errors.invalid_expr_yield.len > 0 {
            let r = errors.invalid_expr_yield;
            self.log().add_range_error(
                Some(self.source),
                r,
                b"Cannot use a \"yield\" expression here",
            );
        }
    }

    // Only reached while building diagnostics — keep it off the hot parse path.
    #[cold]
    #[inline(never)]
    pub fn key_name_for_error(&mut self, key: &js_ast::Expr) -> &'a [u8] {
        match &key.data {
            js_ast::ExprData::EString(s) => s.string(self.arena).expect("unreachable"),
            js_ast::ExprData::EPrivateIdentifier(private) => self.load_name_from_ref(private.ref_),
            _ => b"property",
        }
    }

    /// This function is very very hot.
    pub fn handle_identifier(
        &mut self,
        loc: bun_ast::Loc,
        ident: E::Identifier,
        original_name: Option<&'a [u8]>,
        opts: IdentifierOpts,
    ) -> Expr {
        let ref_ = ident.ref_;

        if self.options.features.inlining {
            if let Some(replacement) = self.const_values.get(&ref_) {
                let replacement = *replacement;
                self.ignore_usage(ref_);
                return replacement;
            }
        }

        // Create an error for assigning to an import namespace
        if (opts.assign_target() != js_ast::AssignTarget::None || opts.is_delete_target())
            && self.symbols[ref_.inner_index() as usize].kind == js_ast::symbol::Kind::Import
        {
            let r = js_lexer::range_of_identifier(self.source, loc);
            // SAFETY: original_name is an arena-owned slice valid for 'a.
            let original = self.symbols[ref_.inner_index() as usize]
                .original_name
                .slice();
            self.log().add_range_error_fmt(
                Some(self.source),
                r,
                format_args!("Cannot assign to import \"{}\"", bstr::BStr::new(original)),
            );
        }

        // Substitute an EImportIdentifier now if this has a namespace alias
        if opts.assign_target() == js_ast::AssignTarget::None && !opts.is_delete_target() {
            // PORT NOTE: copy the alias out so the &self.symbols borrow is released
            // before the &mut self calls below.
            let ns_alias_opt = self.symbols[ref_.inner_index() as usize]
                .namespace_alias
                .as_ref()
                .map(|a| (a.namespace_ref, a.alias));
            if let Some((ns_ref, alias_ptr)) = ns_alias_opt {
                let alias: &'a [u8] = alias_ptr.slice();
                if let Some(&js_ast::ts::Data::Namespace(ns)) =
                    self.ref_to_ts_namespace_member.get(&ns_ref)
                {
                    let ns_map: &js_ast::TSNamespaceMemberMap = &ns;
                    if let Some(member) = ns_map.get(alias) {
                        match member.data {
                            js_ast::ts::Data::EnumNumber(num) => {
                                // SAFETY: arena-owned original_name slice.
                                let name = self.symbols[ref_.inner_index() as usize]
                                    .original_name
                                    .slice();
                                return self.wrap_inlined_enum(
                                    Expr {
                                        loc,
                                        data: js_ast::ExprData::ENumber(E::Number { value: num }),
                                    },
                                    name,
                                );
                            }
                            js_ast::ts::Data::EnumString(str_ptr) => {
                                // SAFETY: arena-owned original_name slice.
                                let name = self.symbols[ref_.inner_index() as usize]
                                    .original_name
                                    .slice();
                                let value = self.new_expr(&*str_ptr, loc);
                                return self.wrap_inlined_enum(value, name);
                            }
                            js_ast::ts::Data::Namespace(map) => {
                                let target = self.new_expr(E::Identifier::init(ns_ref), loc);
                                let expr = self.new_expr(
                                    E::Dot {
                                        target,
                                        name: alias.into(),
                                        name_loc: loc,
                                        ..Default::default()
                                    },
                                    loc,
                                );
                                self.ts_namespace = RecentlyVisitedTSNamespace {
                                    expr: expr.data,
                                    map: Some(map),
                                };
                                return expr;
                            }
                            _ => {}
                        }
                    }
                }

                return self.new_expr(E::ImportIdentifier::new(ident.ref_, true), loc);
            }
        }

        // Substitute an EImportIdentifier now if this is an import item
        if self.is_import_item.contains_key(&ref_) {
            return self.new_expr(
                E::ImportIdentifier::new(ref_, opts.was_originally_identifier()),
                loc,
            );
        }

        if TYPESCRIPT {
            if let Some(member_data) = self.ref_to_ts_namespace_member.get(&ref_) {
                match member_data {
                    js_ast::ts::Data::EnumNumber(num) => {
                        let num = *num;
                        // SAFETY: arena-owned original_name slice.
                        let name = self.symbols[ref_.inner_index() as usize]
                            .original_name
                            .slice();
                        return self.wrap_inlined_enum(
                            Expr {
                                loc,
                                data: js_ast::ExprData::ENumber(E::Number { value: num }),
                            },
                            name,
                        );
                    }
                    js_ast::ts::Data::EnumString(str_ptr) => {
                        let str_ptr = *str_ptr;
                        // SAFETY: arena-owned original_name slice.
                        let name = self.symbols[ref_.inner_index() as usize]
                            .original_name
                            .slice();
                        let value = self.new_expr(&*str_ptr, loc);
                        return self.wrap_inlined_enum(value, name);
                    }
                    js_ast::ts::Data::Namespace(map) => {
                        let map = *map;
                        let expr = Expr {
                            data: js_ast::ExprData::EIdentifier(ident),
                            loc,
                        };
                        self.ts_namespace = RecentlyVisitedTSNamespace {
                            expr: expr.data,
                            map: Some(map),
                        };
                        return expr;
                    }
                    _ => {}
                }
            }

            // Substitute a namespace export reference now if appropriate
            if let Some(ns_ref) = self.is_exported_inside_namespace.get(&ref_).copied() {
                // SAFETY: arena-owned original_name slice.
                let name: &'a [u8] = self.symbols[ref_.inner_index() as usize]
                    .original_name
                    .slice();

                self.record_usage(ns_ref);
                let target = self.new_expr(E::Identifier::init(ns_ref), loc);
                let prop = self.new_expr(
                    E::Dot {
                        target,
                        name: name.into(),
                        name_loc: loc,
                        ..Default::default()
                    },
                    loc,
                );

                if matches!(self.ts_namespace.expr, js_ast::ExprData::EIdentifier(e) if e.ref_.eql(ident.ref_))
                {
                    self.ts_namespace.expr = prop.data;
                }

                return prop;
            }
        }

        if let Some(name) = original_name {
            let result = self.find_symbol(loc, name).expect("unreachable");
            let mut id_clone = ident;
            // Zig: `id_clone.ref = result.ref` — flags are separate fields and
            // survive. Here they ride in `ref_`'s user-bit lane, so re-apply
            // them across the identity write or the visitor's
            // must_keep_due_to_with_stmt / can_be_removed_if_unused /
            // call_can_be_unwrapped_if_unused hints would be silently dropped.
            id_clone.ref_ = result.r#ref.with_user_bits_from(ident.ref_);
            return self.new_expr(id_clone, loc);
        }

        Expr {
            data: js_ast::ExprData::EIdentifier(ident),
            loc,
        }
    }

    pub fn generate_import_stmt_for_bake_response(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(!self.response_ref.is_empty());
        debug_assert!(!self.bun_app_namespace_ref.is_empty());
        let arena = self.arena;

        let import_path: &'static [u8] = b"bun:app";

        let import_record_i =
            self.add_import_record_by_range(ImportKind::Stmt, bun_ast::Range::NONE, import_path);

        let mut declared_symbols = bun_ast::DeclaredSymbolList::default();
        declared_symbols.ensure_total_capacity(2)?;

        declared_symbols.append_assume_capacity(DeclaredSymbol {
            ref_: self.bun_app_namespace_ref,
            is_top_level: true,
        });
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let bun_app_ns_ref = self.bun_app_namespace_ref;
        VecExt::append(&mut self.module_scope_mut().generated, bun_app_ns_ref);

        let response_ref = self.response_ref;
        let clause_items =
            arena.alloc_slice_fill_with::<js_ast::ClauseItem, _>(1, |_| js_ast::ClauseItem {
                alias: js_ast::StoreStr::new(b"Response"),
                original_name: js_ast::StoreStr::new(b"Response"),
                alias_loc: bun_ast::Loc::default(),
                name: LocRef {
                    ref_: Some(response_ref),
                    loc: bun_ast::Loc::default(),
                },
            });

        declared_symbols.append_assume_capacity(DeclaredSymbol {
            ref_: self.response_ref,
            is_top_level: true,
        });

        // ensure every e_import_identifier holds the namespace
        if self.options.features.hot_module_reloading {
            let symbol = &mut self.symbols[self.response_ref.inner_index() as usize];
            debug_assert!(symbol.namespace_alias.is_some());
            symbol.namespace_alias.as_mut().unwrap().import_record_index = import_record_i;
        }

        self.is_import_item.insert(self.response_ref, ());
        self.named_imports.put(
            self.response_ref,
            js_ast::NamedImport {
                alias: Some(js_ast::StoreStr::new(b"Response")),
                alias_loc: Some(bun_ast::Loc::default()),
                namespace_ref: Some(self.bun_app_namespace_ref),
                import_record_index: import_record_i,
                local_parts_with_uses: Default::default(),
                alias_is_star: false,
                is_exported: false,
            },
        )?;

        let import_stmt = self.s(
            S::Import {
                namespace_ref: self.bun_app_namespace_ref,
                items: clause_items.into(),
                import_record_index: import_record_i,
                is_single_line: true,
                default_name: None,
                star_name_loc: None,
            },
            bun_ast::Loc::default(),
        );
        let stmts = arena.alloc_slice_fill_with::<Stmt, _>(1, |_| import_stmt);

        // This import is placed in a part before the main code, however
        // the bundler ends up re-ordering this to be after... The order
        // does not matter as ESM imports are always hoisted.
        parts.push(js_ast::Part {
            stmts: stmts.into(),
            declared_symbols,
            import_record_indices: js_ast::PartImportRecordIndices::init_one(import_record_i),
            tag: bun_ast::PartTag::Runtime,
            ..Default::default()
        });
        Ok(())
    }

    pub fn generate_import_stmt<I, Sym>(
        &mut self,
        import_path: &'a [u8],
        imports: I,
        parts: &mut ListManaged<'a, js_ast::Part>,
        symbols: &Sym,
        additional_stmt: Option<Stmt>,
        prefix: &'static [u8],
        is_internal: bool,
    ) -> Result<(), bun_core::Error>
    where
        I: AsRef<[<Sym as GenerateImportSymbols>::Key]>,
        Sym: GenerateImportSymbols,
    {
        // TODO(port): `imports: anytype` + `symbols: anytype` — modeled via a helper trait;
        // Phase B should verify shapes match the two call sites (RuntimeImports vs map).
        let arena = self.arena;
        let imports = imports.as_ref();
        let import_record_i =
            self.add_import_record_by_range(ImportKind::Stmt, bun_ast::Range::NONE, import_path);
        {
            let import_record = &mut self.import_records.items_mut()[import_record_i as usize];
            if is_internal {
                import_record.path.namespace = b"runtime";
            }
            import_record
                .flags
                .set(bun_ast::ImportRecordFlags::IS_INTERNAL, is_internal);
        }
        // Zig: `nonUniqueNameString` = MutableString.ensureValidIdentifier(nonUniqueNameStringBase()).
        // Render the sanitized-identifier formatter into the bump arena (same
        // pattern as `transpose_require` above).
        let import_path_identifier: &'a [u8] = {
            use core::fmt::Write as _;
            let base = self.import_records.items()[import_record_i as usize]
                .path
                .name
                .non_unique_name_string_base();
            let mut buf = bun_alloc::ArenaString::new_in(arena);
            write!(&mut buf, "{}", bun_core::fmt::fmt_identifier(base)).expect("unreachable");
            buf.into_bump_str().as_bytes()
        };
        let mut namespace_identifier =
            BumpVec::with_capacity_in(import_path_identifier.len() + prefix.len(), arena);
        namespace_identifier.extend_from_slice(prefix);
        namespace_identifier.extend_from_slice(import_path_identifier);
        let namespace_identifier = namespace_identifier.into_bump_slice();

        let clause_items =
            arena.alloc_slice_fill_with::<js_ast::ClauseItem, _>(imports.len(), |_| {
                js_ast::ClauseItem {
                    alias: js_ast::StoreStr::new(b""),
                    original_name: js_ast::StoreStr::new(b""),
                    alias_loc: bun_ast::Loc::default(),
                    name: LocRef::default(),
                }
            });
        let mut declared_symbols = bun_ast::DeclaredSymbolList::default();
        declared_symbols.ensure_total_capacity(imports.len() + 1)?;

        let namespace_ref = self.new_symbol(js_ast::symbol::Kind::Other, namespace_identifier)?;
        declared_symbols.append_assume_capacity(DeclaredSymbol {
            ref_: namespace_ref,
            is_top_level: true,
        });
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        VecExt::append(&mut self.module_scope_mut().generated, namespace_ref);
        for (alias, clause_item) in imports.iter().zip(clause_items.iter_mut()) {
            let ref_ = symbols.get(alias).expect("unreachable");
            let alias_name: &'static [u8] = symbols.alias_name(alias);
            *clause_item = js_ast::ClauseItem {
                alias: js_ast::StoreStr::new(alias_name),
                original_name: js_ast::StoreStr::new(alias_name),
                alias_loc: bun_ast::Loc::default(),
                name: LocRef {
                    ref_: Some(ref_),
                    loc: bun_ast::Loc::default(),
                },
            };
            declared_symbols.append_assume_capacity(DeclaredSymbol {
                ref_,
                is_top_level: true,
            });

            // ensure every e_import_identifier holds the namespace
            if self.options.features.hot_module_reloading {
                let symbol = &mut self.symbols[ref_.inner_index() as usize];
                if symbol.namespace_alias.is_none() {
                    symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                        namespace_ref,
                        alias: js_ast::StoreStr::new(alias_name),
                        import_record_index: import_record_i,
                        was_originally_property_access: false,
                    });
                }
            }

            self.is_import_item.insert(ref_, ());
            self.named_imports.put(
                ref_,
                js_ast::NamedImport {
                    alias: Some(js_ast::StoreStr::new(alias_name)),
                    alias_loc: Some(bun_ast::Loc::default()),
                    namespace_ref: Some(namespace_ref),
                    import_record_index: import_record_i,
                    local_parts_with_uses: Default::default(),
                    alias_is_star: false,
                    is_exported: false,
                },
            )?;
        }

        let import_stmt = self.s(
            S::Import {
                namespace_ref,
                items: clause_items.into(),
                import_record_index: import_record_i,
                is_single_line: true,
                default_name: None,
                star_name_loc: None,
            },
            bun_ast::Loc::default(),
        );
        let stmts = arena
            .alloc_slice_fill_with::<Stmt, _>(1 + usize::from(additional_stmt.is_some()), |_| {
                import_stmt
            });
        if let Some(add) = additional_stmt {
            stmts[1] = add;
        }

        // This import is placed in a part before the main code, however
        // the bundler ends up re-ordering this to be after... The order
        // does not matter as ESM imports are always hoisted.
        parts.push(js_ast::Part {
            stmts: stmts.into(),
            declared_symbols,
            import_record_indices: js_ast::PartImportRecordIndices::init_one(import_record_i),
            tag: bun_ast::PartTag::Runtime,
            ..Default::default()
        });
        Ok(())
    }

    pub fn generate_react_refresh_import(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
        import_path: &'a [u8],
        clauses: &[ReactRefreshImportClause<'a>],
    ) -> Result<(), bun_core::Error> {
        if self.options.features.hot_module_reloading {
            self.generate_react_refresh_import_hmr::<true>(parts, import_path, clauses)
        } else {
            self.generate_react_refresh_import_hmr::<false>(parts, import_path, clauses)
        }
    }

    fn generate_react_refresh_import_hmr<const HOT_MODULE_RELOADING: bool>(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
        import_path: &'a [u8],
        clauses: &[ReactRefreshImportClause<'a>],
    ) -> Result<(), bun_core::Error> {
        // If `hot_module_reloading`, we are going to generate a require call:
        //
        //     const { $RefreshSig$, $RefreshReg$ } = require("react-refresh/runtime")`
        //
        // Otherwise we are going to settle on an import statement. Using
        // require is fine in HMR bundling because `react-refresh` itself is
        // already a CommonJS module, and it will actually be more efficient
        // at runtime this way.
        let arena = self.arena;
        let import_record_index =
            self.add_import_record_by_range(ImportKind::Stmt, bun_ast::Range::NONE, import_path);

        // PORT NOTE: Zig used `if (hot_module_reloading) B.Object.Property else js_ast.ClauseItem`
        // as the comptime item type. Rust const-generics can't select a type
        // for a local, so we keep two arena vecs and only fill the one the
        // const-generic arm selects (the other stays empty / zero-cost).
        let len = 1
            + usize::from(self.react_refresh.register_used)
            + usize::from(self.react_refresh.signature_used);
        let mut items_hmr = BumpVec::<B::Property>::with_capacity_in(
            if HOT_MODULE_RELOADING { len } else { 0 },
            arena,
        );
        let mut items_import = BumpVec::<js_ast::ClauseItem>::with_capacity_in(
            if HOT_MODULE_RELOADING { 0 } else { len },
            arena,
        );

        let mut declared_symbols = bun_ast::DeclaredSymbolList::default();
        declared_symbols.ensure_total_capacity(len)?;

        let namespace_ref = self.new_symbol(js_ast::symbol::Kind::Other, b"RefreshRuntime")?;
        declared_symbols.append_assume_capacity(DeclaredSymbol {
            ref_: namespace_ref,
            is_top_level: true,
        });
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        VecExt::append(&mut self.module_scope_mut().generated, namespace_ref);

        for entry in clauses {
            if entry.enabled {
                if HOT_MODULE_RELOADING {
                    let key = self.new_expr(E::String::init(entry.name), bun_ast::Loc::EMPTY);
                    let value = self.b(B::Identifier { r#ref: entry.r#ref }, bun_ast::Loc::EMPTY);
                    // PERF(port): was assume_capacity
                    items_hmr.push(B::Property {
                        flags: Default::default(),
                        key,
                        value,
                        default_value: None,
                    });
                } else {
                    // PERF(port): was assume_capacity
                    items_import.push(js_ast::ClauseItem {
                        alias: js_ast::StoreStr::new(entry.name),
                        original_name: js_ast::StoreStr::new(entry.name),
                        alias_loc: bun_ast::Loc::default(),
                        name: LocRef {
                            ref_: Some(entry.r#ref),
                            loc: bun_ast::Loc::default(),
                        },
                    });
                }
                declared_symbols.append_assume_capacity(DeclaredSymbol {
                    ref_: entry.r#ref,
                    is_top_level: true,
                });
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                VecExt::append(&mut self.module_scope_mut().generated, entry.r#ref);
                self.is_import_item.insert(entry.r#ref, ());
                self.named_imports.put(
                    entry.r#ref,
                    js_ast::NamedImport {
                        alias: Some(js_ast::StoreStr::new(entry.name)),
                        alias_loc: Some(bun_ast::Loc::EMPTY),
                        namespace_ref: Some(namespace_ref),
                        import_record_index,
                        local_parts_with_uses: Default::default(),
                        alias_is_star: false,
                        is_exported: false,
                    },
                )?;
            }
        }

        let stmt = if HOT_MODULE_RELOADING {
            let binding = self.b(
                B::Object {
                    properties: bun_ast::StoreSlice::from_bump(items_hmr),
                    is_single_line: false,
                },
                bun_ast::Loc::EMPTY,
            );
            let value = self.new_expr(
                E::RequireString {
                    import_record_index,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
            self.s(
                S::Local {
                    kind: js_ast::s::Kind::KConst,
                    decls: G::DeclList::from_slice(&[Decl {
                        binding,
                        value: Some(value),
                    }]),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            )
        } else {
            self.s(
                S::Import {
                    namespace_ref,
                    items: bun_ast::StoreSlice::from_bump(items_import),
                    import_record_index,
                    is_single_line: false,
                    default_name: None,
                    star_name_loc: None,
                },
                bun_ast::Loc::EMPTY,
            )
        };
        let stmts = arena.alloc_slice_fill_with::<Stmt, _>(1, |_| stmt);

        parts.push(js_ast::Part {
            stmts: stmts.into(),
            declared_symbols,
            import_record_indices: js_ast::PartImportRecordIndices::init_one(import_record_index),
            tag: bun_ast::PartTag::Runtime,
            ..Default::default()
        });
        Ok(())
    }

    pub fn substitute_single_use_symbol_in_stmt(
        &mut self,
        stmt: Stmt,
        r#ref: Ref,
        replacement: Expr,
    ) -> bool {
        // Zig matched on `stmt.data` and took `*Expr` into the arena-owned payload.
        // `StmtData` stores `StoreRef<S::*>` (Copy NonNull); matching by value yields
        // an owned `StoreRef` whose `DerefMut` reaches the same arena slot Zig wrote
        // through, so writing to `*expr` below mutates the AST in place.
        let mut expr: js_ast::StoreRef<Expr> = 'brk: {
            match stmt.data {
                js_ast::StmtData::SExpr(mut exp) => {
                    break 'brk js_ast::StoreRef::from_bump(&mut exp.value);
                }
                js_ast::StmtData::SThrow(mut throw) => {
                    break 'brk js_ast::StoreRef::from_bump(&mut throw.value);
                }
                js_ast::StmtData::SReturn(mut ret) => {
                    if let Some(value) = ret.value.as_mut() {
                        break 'brk js_ast::StoreRef::from_bump(value);
                    }
                }
                js_ast::StmtData::SIf(mut if_stmt) => {
                    break 'brk js_ast::StoreRef::from_bump(&mut if_stmt.test_);
                }
                js_ast::StmtData::SSwitch(mut switch_stmt) => {
                    break 'brk js_ast::StoreRef::from_bump(&mut switch_stmt.test_);
                }
                js_ast::StmtData::SLocal(mut local) => {
                    if local.decls.len_u32() > 0 {
                        let first = &mut local.decls.slice_mut()[0];
                        if matches!(first.binding.data, js_ast::b::B::BIdentifier(_)) {
                            if let Some(value) = first.value.as_mut() {
                                break 'brk js_ast::StoreRef::from_bump(value);
                            }
                        }
                    }
                }
                _ => {}
            }
            return false;
        };
        // `StoreRef<Expr>: DerefMut` — arena-owned slot, parser holds exclusive
        // access during the single-threaded visit pass (same contract as Zig `*Expr`).
        let expr = &mut *expr;

        // Only continue trying to insert this replacement into sub-expressions
        // after the first one if the replacement has no side effects:
        //
        //   // Substitution is ok
        //   let replacement = 123;
        //   return x + replacement;
        //
        //   // Substitution is not ok because "fn()" may change "x"
        //   let replacement = fn();
        //   return x + replacement;
        //
        //   // Substitution is not ok because "x == x" may change "x" due to "valueOf()" evaluation
        //   let replacement = [x];
        //   return (x == x) + replacement;
        //
        let replacement_can_be_removed = self.expr_can_be_removed_if_unused(&replacement);
        match self.substitute_single_use_symbol_in_expr(
            *expr,
            r#ref,
            replacement,
            replacement_can_be_removed,
        ) {
            Substitution::Success(result) => {
                if matches!(
                    result.data,
                    js_ast::ExprData::EBinary(_)
                        | js_ast::ExprData::EUnary(_)
                        | js_ast::ExprData::EIf(_)
                ) {
                    let prev_substituting = self.is_revisit_for_substitution;
                    self.is_revisit_for_substitution = true;
                    // O(n^2) and we will need to think more carefully about
                    // this once we implement syntax compression
                    *expr = result;
                    self.visit_expr(expr);
                    self.is_revisit_for_substitution = prev_substituting;
                } else {
                    *expr = result;
                }
                return true;
            }
            _ => {}
        }

        false
    }

    fn substitute_single_use_symbol_in_expr(
        &mut self,
        expr: Expr,
        r#ref: Ref,
        replacement: Expr,
        replacement_can_be_removed: bool,
    ) -> Substitution {
        // Zig matched on `expr.data` (a tagged union of `*E.*`) and mutated through
        // the captured pointer. `ExprData` is `Copy`; matching by value yields owned
        // `StoreRef<E::*>` copies whose `DerefMut` writes to the same arena slot,
        // so `e.target = result` mutates the AST in place exactly as Zig did.
        'outer: {
            match expr.data {
                js_ast::ExprData::EIdentifier(ident) => {
                    if ident.ref_.eql(r#ref)
                        || self.symbols[ident.ref_.inner_index() as usize]
                            .link
                            .get()
                            .eql(r#ref)
                    {
                        self.ignore_usage(r#ref);
                        return Substitution::Success(replacement);
                    }
                }
                js_ast::ExprData::ENew(mut new) => {
                    match self.substitute_single_use_symbol_in_expr(
                        new.target,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            new.target = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            new.target = result;
                            return Substitution::Failure(expr);
                        }
                    }

                    if replacement_can_be_removed {
                        for arg in new.args.slice_mut() {
                            match self.substitute_single_use_symbol_in_expr(
                                *arg,
                                r#ref,
                                replacement,
                                replacement_can_be_removed,
                            ) {
                                Substitution::Continue(_) => {}
                                Substitution::Success(result) => {
                                    *arg = result;
                                    return Substitution::Success(expr);
                                }
                                Substitution::Failure(result) => {
                                    *arg = result;
                                    return Substitution::Failure(expr);
                                }
                            }
                        }
                    }
                }
                js_ast::ExprData::ESpread(mut spread) => {
                    match self.substitute_single_use_symbol_in_expr(
                        spread.value,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            spread.value = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            spread.value = result;
                            return Substitution::Failure(expr);
                        }
                    }
                }
                js_ast::ExprData::EAwait(mut await_expr) => {
                    match self.substitute_single_use_symbol_in_expr(
                        await_expr.value,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            await_expr.value = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            await_expr.value = result;
                            return Substitution::Failure(expr);
                        }
                    }
                }
                js_ast::ExprData::EYield(mut yield_) => {
                    let value = yield_.value.unwrap_or(Expr {
                        data: js_ast::ExprData::EMissing(E::Missing {}),
                        loc: expr.loc,
                    });
                    match self.substitute_single_use_symbol_in_expr(
                        value,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            yield_.value = Some(result);
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            yield_.value = Some(result);
                            return Substitution::Failure(expr);
                        }
                    }
                }
                js_ast::ExprData::EImport(mut import) => {
                    match self.substitute_single_use_symbol_in_expr(
                        import.expr,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            import.expr = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            import.expr = result;
                            return Substitution::Failure(expr);
                        }
                    }

                    // The "import()" expression has side effects but the side effects are
                    // always asynchronous so there is no way for the side effects to modify
                    // the replacement value. So it's ok to reorder the replacement value
                    // past the "import()" expression assuming everything else checks out.

                    if replacement_can_be_removed
                        && self.expr_can_be_removed_if_unused(&import.expr)
                    {
                        return Substitution::Continue(expr);
                    }
                }
                js_ast::ExprData::EUnary(mut e) => {
                    match e.op {
                        js_ast::op::Code::UnPreInc
                        | js_ast::op::Code::UnPostInc
                        | js_ast::op::Code::UnPreDec
                        | js_ast::op::Code::UnPostDec
                        | js_ast::op::Code::UnDelete => {
                            // Do not substitute into an assignment position
                        }
                        _ => match self.substitute_single_use_symbol_in_expr(
                            e.value,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        ) {
                            Substitution::Continue(_) => {}
                            Substitution::Success(result) => {
                                e.value = result;
                                return Substitution::Success(expr);
                            }
                            Substitution::Failure(result) => {
                                e.value = result;
                                return Substitution::Failure(expr);
                            }
                        },
                    }
                }
                js_ast::ExprData::EDot(mut e) => {
                    match self.substitute_single_use_symbol_in_expr(
                        e.target,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            e.target = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            e.target = result;
                            return Substitution::Failure(expr);
                        }
                    }
                }
                js_ast::ExprData::EBinary(mut e) => {
                    // Do not substitute into an assignment position
                    if js_ast::op::Code::binary_assign_target(e.op) == js_ast::AssignTarget::None {
                        match self.substitute_single_use_symbol_in_expr(
                            e.left,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        ) {
                            Substitution::Continue(_) => {}
                            Substitution::Success(result) => {
                                e.left = result;
                                return Substitution::Success(expr);
                            }
                            Substitution::Failure(result) => {
                                e.left = result;
                                return Substitution::Failure(expr);
                            }
                        }
                    } else if !self.expr_can_be_removed_if_unused(&e.left) {
                        // Do not reorder past a side effect in an assignment target, as that may
                        // change the replacement value. For example, "fn()" may change "a" here:
                        //
                        //   let a = 1;
                        //   foo[fn()] = a;
                        //
                        return Substitution::Failure(expr);
                    } else if js_ast::op::Code::binary_assign_target(e.op)
                        == js_ast::AssignTarget::Update
                        && !replacement_can_be_removed
                    {
                        // If this is a read-modify-write assignment and the replacement has side
                        // effects, don't reorder it past the assignment target. The assignment
                        // target is being read so it may be changed by the side effect. For
                        // example, "fn()" may change "foo" here:
                        //
                        //   let a = fn();
                        //   foo += a;
                        //
                        return Substitution::Failure(expr);
                    }

                    // If we get here then it should be safe to attempt to substitute the
                    // replacement past the left operand into the right operand.
                    match self.substitute_single_use_symbol_in_expr(
                        e.right,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            e.right = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            e.right = result;
                            return Substitution::Failure(expr);
                        }
                    }
                }
                js_ast::ExprData::EIf(mut e) => {
                    match self.substitute_single_use_symbol_in_expr(
                        e.test_,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            e.test_ = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            e.test_ = result;
                            return Substitution::Failure(expr);
                        }
                    }

                    // Do not substitute our unconditionally-executed value into a branch
                    // unless the value itself has no side effects
                    if replacement_can_be_removed {
                        // Unlike other branches in this function such as "a && b" or "a?.[b]",
                        // the "a ? b : c" form has potential code evaluation along both control
                        // flow paths. Handle this by allowing substitution into either branch.
                        // Side effects in one branch should not prevent the substitution into
                        // the other branch.

                        let yes = self.substitute_single_use_symbol_in_expr(
                            e.yes,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        );
                        if let Substitution::Success(r) = yes {
                            e.yes = r;
                            return Substitution::Success(expr);
                        }

                        let no = self.substitute_single_use_symbol_in_expr(
                            e.no,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        );
                        if let Substitution::Success(r) = no {
                            e.no = r;
                            return Substitution::Success(expr);
                        }

                        // Side effects in either branch should stop us from continuing to try to
                        // substitute the replacement after the control flow branches merge again.
                        if !matches!(yes, Substitution::Continue(_))
                            || !matches!(no, Substitution::Continue(_))
                        {
                            return Substitution::Failure(expr);
                        }
                    }
                }
                js_ast::ExprData::EIndex(mut index) => {
                    match self.substitute_single_use_symbol_in_expr(
                        index.target,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            index.target = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            index.target = result;
                            return Substitution::Failure(expr);
                        }
                    }

                    // Do not substitute our unconditionally-executed value into a branch
                    // unless the value itself has no side effects
                    if replacement_can_be_removed || index.optional_chain.is_none() {
                        match self.substitute_single_use_symbol_in_expr(
                            index.index,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        ) {
                            Substitution::Continue(_) => {}
                            Substitution::Success(result) => {
                                index.index = result;
                                return Substitution::Success(expr);
                            }
                            Substitution::Failure(result) => {
                                index.index = result;
                                return Substitution::Failure(expr);
                            }
                        }
                    }
                }
                js_ast::ExprData::ECall(mut e) => {
                    // Don't substitute something into a call target that could change "this"
                    match replacement.data {
                        js_ast::ExprData::EDot(_) | js_ast::ExprData::EIndex(_) => {
                            if matches!(e.target.data, js_ast::ExprData::EIdentifier(id) if id.ref_.eql(r#ref))
                            {
                                break 'outer;
                            }
                        }
                        _ => {}
                    }

                    match self.substitute_single_use_symbol_in_expr(
                        e.target,
                        r#ref,
                        replacement,
                        replacement_can_be_removed,
                    ) {
                        Substitution::Continue(_) => {}
                        Substitution::Success(result) => {
                            e.target = result;
                            return Substitution::Success(expr);
                        }
                        Substitution::Failure(result) => {
                            e.target = result;
                            return Substitution::Failure(expr);
                        }
                    }

                    // Do not substitute our unconditionally-executed value into a branch
                    // unless the value itself has no side effects
                    if replacement_can_be_removed || e.optional_chain.is_none() {
                        for arg in e.args.slice_mut() {
                            match self.substitute_single_use_symbol_in_expr(
                                *arg,
                                r#ref,
                                replacement,
                                replacement_can_be_removed,
                            ) {
                                Substitution::Continue(_) => {}
                                Substitution::Success(result) => {
                                    *arg = result;
                                    return Substitution::Success(expr);
                                }
                                Substitution::Failure(result) => {
                                    *arg = result;
                                    return Substitution::Failure(expr);
                                }
                            }
                        }
                    }
                }
                js_ast::ExprData::EArray(mut e) => {
                    for item in e.items.slice_mut() {
                        match self.substitute_single_use_symbol_in_expr(
                            *item,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        ) {
                            Substitution::Continue(_) => {}
                            Substitution::Success(result) => {
                                *item = result;
                                return Substitution::Success(expr);
                            }
                            Substitution::Failure(result) => {
                                *item = result;
                                return Substitution::Failure(expr);
                            }
                        }
                    }
                }
                js_ast::ExprData::EObject(mut e) => {
                    for property in e.properties.slice_mut() {
                        // Check the key
                        if property.flags.contains(Flags::Property::IsComputed) {
                            match self.substitute_single_use_symbol_in_expr(
                                property.key.expect("infallible: prop has key"),
                                r#ref,
                                replacement,
                                replacement_can_be_removed,
                            ) {
                                Substitution::Continue(_) => {}
                                Substitution::Success(result) => {
                                    property.key = Some(result);
                                    return Substitution::Success(expr);
                                }
                                Substitution::Failure(result) => {
                                    property.key = Some(result);
                                    return Substitution::Failure(expr);
                                }
                            }

                            // Stop now because both computed keys and property spread have side effects
                            return Substitution::Failure(expr);
                        }

                        // Check the value
                        if let Some(value) = property.value {
                            match self.substitute_single_use_symbol_in_expr(
                                value,
                                r#ref,
                                replacement,
                                replacement_can_be_removed,
                            ) {
                                Substitution::Continue(_) => {}
                                Substitution::Success(result) => {
                                    property.value =
                                        if matches!(result.data, js_ast::ExprData::EMissing(_)) {
                                            None
                                        } else {
                                            Some(result)
                                        };
                                    return Substitution::Success(expr);
                                }
                                Substitution::Failure(result) => {
                                    property.value =
                                        if matches!(result.data, js_ast::ExprData::EMissing(_)) {
                                            None
                                        } else {
                                            Some(result)
                                        };
                                    return Substitution::Failure(expr);
                                }
                            }
                        }
                    }
                }
                js_ast::ExprData::ETemplate(mut e) => {
                    if let Some(tag) = e.tag.as_mut() {
                        match self.substitute_single_use_symbol_in_expr(
                            *tag,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        ) {
                            Substitution::Continue(_) => {}
                            Substitution::Success(result) => {
                                *tag = result;
                                return Substitution::Success(expr);
                            }
                            Substitution::Failure(result) => {
                                *tag = result;
                                return Substitution::Failure(expr);
                            }
                        }
                    }

                    // Zig held `[]TemplatePart` and mutated `part.value` in place;
                    // `E::Template.parts` is `StoreSlice<TemplatePart>` (arena-owned, mutable
                    // provenance preserved end-to-end) so derive the unique view directly.
                    // SAFETY: arena-owned slice; single-threaded visit pass has exclusive
                    // access and no other borrow of this slice is live across the loop body.
                    for part in e.parts_mut().iter_mut() {
                        match self.substitute_single_use_symbol_in_expr(
                            part.value,
                            r#ref,
                            replacement,
                            replacement_can_be_removed,
                        ) {
                            Substitution::Continue(_) => {}
                            Substitution::Success(result) => {
                                part.value = result;
                                // todo: mangle template parts
                                return Substitution::Success(expr);
                            }
                            Substitution::Failure(result) => {
                                part.value = result;
                                return Substitution::Failure(expr);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // If both the replacement and this expression have no observable side
        // effects, then we can reorder the replacement past this expression
        if replacement_can_be_removed && self.expr_can_be_removed_if_unused(&expr) {
            return Substitution::Continue(expr);
        }

        // We can always reorder past primitive values
        if js_ast::ExprTag::is_primitive_literal(expr.data.tag()) {
            return Substitution::Continue(expr);
        }

        // Otherwise we should stop trying to substitute past this point
        Substitution::Failure(expr)
    }

    pub fn prepare_for_visit_pass(&mut self) -> Result<(), bun_core::Error> {
        {
            // Zig: `Binding2ExprWrapper.{Namespace,Hoisted}.init(this)`.
            // The wrapper stores only the arena and a non-capturing
            // fn-pointer trampoline; the `*mut P` context is supplied *at call
            // time* (see `Binding::to_expr`) so the raw pointer's provenance is
            // a child of the live `&mut P` at the call site rather than a stale
            // tag captured here. The transposer shims need no wiring at all —
            // call sites invoke `P::maybe_transpose_if_*` etc. directly.
            self.to_expr_wrapper_namespace =
                bun_ast::binding::ToExprWrapper::new(self.arena, |ctx, loc, ref_| {
                    // SAFETY: `ctx` was derived from the caller's live `&mut P`
                    // immediately before `Binding::to_expr`; no other `&mut P`
                    // borrow is active for the duration of this call.
                    let p = unsafe { &mut *ctx.cast::<P<'a, TYPESCRIPT, SCAN_ONLY>>() };
                    p.wrap_identifier_namespace(loc, ref_)
                });
            self.to_expr_wrapper_hoisted =
                bun_ast::binding::ToExprWrapper::new(self.arena, |ctx, loc, ref_| {
                    // SAFETY: same as above.
                    let p = unsafe { &mut *ctx.cast::<P<'a, TYPESCRIPT, SCAN_ONLY>>() };
                    p.wrap_identifier_hoisting(loc, ref_)
                });
        }

        {
            // Compact `scopes_in_order` (parse pass leaves None holes from
            // popAndDiscardScope) into a dense bump-slice for the visit pass.
            let mut buf =
                BumpVec::<ScopeOrder<'a>>::with_capacity_in(self.scopes_in_order.len(), self.arena);
            for item in self.scopes_in_order.iter() {
                if let Some(item_) = item {
                    buf.push(*item_);
                }
            }
            // `into_bump_slice()` leaks the BumpVec into the arena and returns
            // a `&'a [T]` for that allocation (Zig: `p.arena.alloc(ScopeOrder, n)`).
            self.scope_order_to_visit = buf.into_bump_slice();
        }

        self.is_file_considered_to_have_esm_exports = !self.top_level_await_keyword.is_empty()
            || !self.esm_export_keyword.is_empty()
            || self.options.module_type == options::ModuleType::Esm;

        self.push_scope_for_visit_pass(js_ast::scope::Kind::Entry, loc_module_scope)?;
        self.fn_or_arrow_data_visit.is_outside_fn_or_arrow = true;
        self.module_scope = self.current_scope;
        self.has_es_module_syntax = self.has_es_module_syntax
            || self.esm_import_keyword.len > 0
            || self.esm_export_keyword.len > 0
            || self.top_level_await_keyword.len > 0;

        if let Some(factory) = self.lexer.jsx_pragma.jsx() {
            // `Span.text` is a `StoreStr` into lexer-owned source; valid for 'a.
            let text = factory.text.slice();
            self.options.jsx.factory =
                options::JSX::Pragma::member_list_to_components_if_different(
                    core::mem::take(&mut self.options.jsx.factory),
                    text,
                )
                .expect("unreachable");
        }

        if let Some(fragment) = self.lexer.jsx_pragma.jsx_frag() {
            // SAFETY: Span.text is `ArenaStr` valid for 'a.
            let text = fragment.text.slice();
            self.options.jsx.fragment =
                options::JSX::Pragma::member_list_to_components_if_different(
                    core::mem::take(&mut self.options.jsx.fragment),
                    text,
                )
                .expect("unreachable");
        }

        if let Some(import_source) = self.lexer.jsx_pragma.jsx_import_source() {
            // SAFETY: Span.text is `ArenaStr` valid for 'a.
            let text = import_source.text.slice();
            self.options.jsx.classic_import_source = text.to_vec().into();
            self.options.jsx.package_name = self.options.jsx.classic_import_source.clone();
            self.options.jsx.set_import_source();
        }

        if let Some(runtime) = self.lexer.jsx_pragma.jsx_runtime() {
            // SAFETY: Span.text is `ArenaStr` valid for 'a.
            let text = runtime.text.slice();
            if let Some(jsx_runtime) = options::JSX::RUNTIME_MAP.get(text) {
                self.options.jsx.runtime = jsx_runtime.runtime;
                if let Some(dev) = jsx_runtime.development {
                    self.options.jsx.development = dev;
                }
            } else {
                // make this a warning instead of an error because we don't support "preserve" right now
                self.log().add_range_warning_fmt(
                    Some(self.source),
                    runtime.range,
                    format_args!("Unsupported JSX runtime: \"{}\"", bstr::BStr::new(text)),
                );
            }
        }

        // ECMAScript modules are always interpreted as strict mode. This has to be
        // done before "hoistSymbols" because strict mode can alter hoisting (!).
        if self.esm_import_keyword.len > 0 {
            self.module_scope_mut()
                .recursive_set_strict_mode(js_ast::StrictModeKind::ImplicitStrictModeImport);
        } else if self.esm_export_keyword.len > 0 {
            self.module_scope_mut()
                .recursive_set_strict_mode(js_ast::StrictModeKind::ImplicitStrictModeExport);
        } else if self.top_level_await_keyword.len > 0 {
            self.module_scope_mut()
                .recursive_set_strict_mode(js_ast::StrictModeKind::ImplicitStrictModeTopLevelAwait);
        }

        self.hoist_symbols(self.module_scope_ref());

        let mut generated_symbols_count: u32 = 3;

        if self.options.features.react_fast_refresh {
            generated_symbols_count += 3;
        }

        if self.is_jsx_enabled() {
            generated_symbols_count += 7;
            if self.options.jsx.development {
                generated_symbols_count += 1;
            }
        }

        let module_scope = self.module_scope_mut();
        module_scope
            .generated
            .ensure_unused_capacity(generated_symbols_count as usize * 3);
        module_scope.members.ensure_unused_capacity(
            generated_symbols_count as usize * 3 + module_scope.members.count(),
        )?;

        self.exports_ref =
            self.declare_common_js_symbol(js_ast::symbol::Kind::Hoisted, b"exports")?;
        self.module_ref =
            self.declare_common_js_symbol(js_ast::symbol::Kind::Hoisted, b"module")?;

        self.require_ref =
            self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"require")?;
        self.dirname_ref =
            self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"__dirname")?;
        self.filename_ref =
            self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"__filename")?;

        if self.options.features.inject_jest_globals {
            self.jest.test =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"test")?;
            self.jest.it = self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"it")?;
            self.jest.describe =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"describe")?;
            self.jest.expect =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"expect")?;
            self.jest.expect_type_of =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"expectTypeOf")?;
            self.jest.before_all =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"beforeAll")?;
            self.jest.before_each =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"beforeEach")?;
            self.jest.after_each =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"afterEach")?;
            self.jest.after_all =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"afterAll")?;
            self.jest.jest =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"jest")?;
            self.jest.vi = self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"vi")?;
            self.jest.xit = self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"xit")?;
            self.jest.xtest =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"xtest")?;
            self.jest.xdescribe =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"xdescribe")?;
        }

        if self.options.features.react_fast_refresh {
            self.react_refresh.create_signature_ref =
                self.declare_generated_symbol(js_ast::symbol::Kind::Other, b"$RefreshSig$")?;
            self.react_refresh.register_ref =
                self.declare_generated_symbol(js_ast::symbol::Kind::Other, b"$RefreshReg$")?;
        }

        // blocked_on: `options::ServerComponents` is a Phase-A stub struct
        // (parser.rs:195) — Zig has a 5-variant enum (None / ClientSide /
        // WrapExportsForClientReference / WrapAnonServerFunctions /
        // WrapExportsForServerReference). The two switches below un-gate once
        // that enum is ported into options::JSX or bundler::options.

        {
            match self.options.features.server_components {
                options::ServerComponents::None | options::ServerComponents::ClientSide => {}
                options::ServerComponents::WrapExportsForClientReference => {
                    self.server_components_wrap_ref = self.declare_generated_symbol(
                        js_ast::symbol::Kind::Other,
                        b"registerClientReference",
                    )?;
                }
                // TODO: these wrapping modes.
                options::ServerComponents::WrapAnonServerFunctions => {}
                options::ServerComponents::WrapExportsForServerReference => {}
            }

            // Server-side components:
            // Declare upfront the symbols for "Response" and "bun:app"
            match self.options.features.server_components {
                options::ServerComponents::None | options::ServerComponents::ClientSide => {}
                _ => {
                    self.response_ref =
                        self.declare_generated_symbol(js_ast::symbol::Kind::Import, b"Response")?;
                    self.bun_app_namespace_ref =
                        self.new_symbol(js_ast::symbol::Kind::Other, b"import_bun_app")?;
                    let symbol = &mut self.symbols[self.response_ref.inner_index() as usize];
                    symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                        namespace_ref: self.bun_app_namespace_ref,
                        alias: js_ast::StoreStr::new(b"Response"),
                        was_originally_property_access: false,
                        import_record_index: u32::MAX,
                    });
                }
            }
        } // end 

        if self.options.features.hot_module_reloading {
            self.hmr_api_ref =
                self.declare_common_js_symbol(js_ast::symbol::Kind::Unbound, b"hmr")?;
        }
        Ok(())
    }

    fn ensure_require_symbol(&mut self) {
        if self.runtime_imports.__require.is_some() {
            return;
        }
        // Spec P.zig:2224-2229 calls declareSymbolMaybeGenerated with
        // generatedSymbolName("__require") (the hashed name) directly,
        // regardless of bundle mode. Do NOT route through
        // declare_generated_symbol — that helper skips the hash when
        // `options.bundle == true`, which would let a user-level
        // `var __require` collide in `current_scope.members` and link the
        // runtime require to the user symbol via the IS_GENERATED merge path.
        // Runtime equivalent of `generated_symbol_name!("__require")`:
        let hash = bun_wyhash::hash(b"__require");
        let hashed: &'a [u8] = bun_alloc::arena_format!(
            in self.arena,
            "{}_{}",
            bstr::BStr::new(b"__require".as_slice()),
            bun_core::fmt::truncated_hash32(hash)
        )
        .into_bump_str()
        .as_bytes();
        let ref_ = self
            .declare_symbol_maybe_generated::<true>(
                js_ast::symbol::Kind::Other,
                bun_ast::Loc::EMPTY,
                hashed,
            )
            .expect("oom");
        self.runtime_imports.__require = Some(ref_);
        self.runtime_imports.put(b"__require", ref_);
    }

    pub fn resolve_common_js_symbols(&mut self) {
        if !self.options.features.allow_runtime {
            return;
        }
        self.ensure_require_symbol();
    }

    fn will_use_renamer(&self) -> bool {
        self.options.bundle || self.options.features.minify_identifiers
    }

    fn hoist_symbols(&mut self, mut scope: js_ast::StoreRef<js_ast::Scope>) {
        // `StoreRef` is the arena back-pointer with safe `Deref`/`DerefMut` —
        // scope is arena-owned and valid for the parser 'a lifetime; the visit
        // pass is single-threaded so no aliasing `&mut` is outstanding. Read the
        // immutable bits (kind/parent/strict_mode/members snapshot) up front; the
        // only later access is the `scope.generated` push (DerefMut, after the
        // shared borrow is dropped) and the post-loop `children` walk.
        let scope_ref = &*scope;
        if !scope_ref.kind_stops_hoisting() {
            let arena = self.arena;
            // PORT NOTE: Zig captured `var symbols = p.symbols.items;` and asserted it
            // wasn't resized; we re-borrow `self.symbols` after each `new_symbol` call.

            // Check for collisions that would prevent to hoisting "var" symbols up to the enclosing function scope
            if let Some(scope_parent) = scope_ref.parent {
                let scope_strict_mode = scope_ref.strict_mode;
                // PORT NOTE: reshaped for borrowck — Zig iterated `scope.members` while
                // pushing to `scope.generated` and inserting into ancestor scopes' members.
                // The loop never inserts into `scope.members` itself (only ancestors), so
                // snapshotting `(name_ptr, Member)` pairs up front is semantically identical
                // and lets us re-borrow `*scope` mutably inside the body.
                let member_snapshot: BumpVec<'a, (js_ast::StoreStr, js_ast::scope::Member)> = {
                    let members = &scope_ref.members;
                    let mut v = BumpVec::with_capacity_in(members.count(), arena);
                    for (k, m) in members.iter() {
                        v.push((js_ast::StoreStr::new(k.as_ref()), *m));
                    }
                    v
                };
                // `scope_ref` (shared borrow of the `StoreRef` local) must end
                // before the `DerefMut` write to `scope.generated` inside the
                // loop; NLL drops it at last use (the snapshot block above).
                let _ = scope_ref;

                'next_member: for (_key_ptr, mut value) in member_snapshot.into_iter() {
                    let mut symbol_idx = value.ref_.inner_index() as usize;

                    // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                    let name: &'a [u8] = self.symbols[symbol_idx].original_name.slice();
                    let mut hash: Option<u64> = None;

                    if scope_parent.kind == js_ast::scope::Kind::CatchBinding
                        && self.symbols[symbol_idx].kind != js_ast::symbol::Kind::Hoisted
                    {
                        hash = Some(Scope::get_member_hash(name));
                        if let Some(existing_member) =
                            scope_parent.get_member_with_hash(name, hash.unwrap())
                        {
                            self.log().add_symbol_already_declared_error(
                                self.source,
                                name,
                                value.loc,
                                existing_member.loc,
                            );
                            continue;
                        }
                    }

                    if !self.symbols[symbol_idx].is_hoisted() {
                        continue;
                    }

                    let mut __scope: Option<js_ast::StoreRef<Scope>> = Some(scope_parent);
                    debug_assert!(__scope.is_some());

                    let mut is_sloppy_mode_block_level_fn_stmt = false;
                    let original_member_ref = value.ref_;

                    if self.will_use_renamer()
                        && self.symbols[symbol_idx].kind == js_ast::symbol::Kind::HoistedFunction
                    {
                        // Block-level function declarations behave like "let" in strict mode
                        if scope_strict_mode != js_ast::StrictModeKind::SloppyMode {
                            continue;
                        }

                        // In sloppy mode, block level functions behave like "let" except with
                        // an assignment to "var", sort of. This code:
                        //
                        //   if (x) {
                        //     f();
                        //     function f() {}
                        //   }
                        //   f();
                        //
                        // behaves like this code:
                        //
                        //   if (x) {
                        //     let f2 = function() {}
                        //     var f = f2;
                        //     f2();
                        //   }
                        //   f();
                        //
                        // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                        let original_name: &'a [u8] =
                            self.symbols[symbol_idx].original_name.slice();
                        let hoisted_ref = self
                            .new_symbol(js_ast::symbol::Kind::Hoisted, original_name)
                            .expect("unreachable");
                        // No live `&` borrow of `scope` exists here (the members
                        // snapshot was taken by value); `StoreRef` `DerefMut`.
                        VecExt::append(&mut scope.generated, hoisted_ref);
                        self.hoisted_ref_for_sloppy_mode_block_fn
                            .insert(value.ref_, hoisted_ref);
                        value.ref_ = hoisted_ref;
                        symbol_idx = hoisted_ref.inner_index() as usize;
                        is_sloppy_mode_block_level_fn_stmt = true;
                    }

                    if hash.is_none() {
                        hash = Some(Scope::get_member_hash(name));
                    }

                    while let Some(mut _scope_ptr) = __scope {
                        // `_scope_ptr` walks the parent chain so it never aliases `scope`
                        // (whose only live borrow is the by-value members snapshot above).
                        let _scope = &mut *_scope_ptr;
                        let scope_kind = _scope.kind;

                        // Variable declarations hoisted past a "with" statement may actually end
                        // up overwriting a property on the target of the "with" statement instead
                        // of initializing the variable. We must not rename them or we risk
                        // causing a behavior change.
                        //
                        //   var obj = { foo: 1 }
                        //   with (obj) { var foo = 2 }
                        //   assert(foo === undefined)
                        //   assert(obj.foo === 2)
                        //
                        if scope_kind == js_ast::scope::Kind::With {
                            self.symbols[symbol_idx].must_not_be_renamed = true;
                        }

                        if let Some(member_in_scope) =
                            _scope.get_member_with_hash(name, hash.unwrap())
                        {
                            let existing_idx = member_in_scope.ref_.inner_index() as usize;
                            let existing_kind = self.symbols[existing_idx].kind;

                            // We can hoist the symbol from the child scope into the symbol in
                            // this scope if:
                            //
                            //   - The symbol is unbound (i.e. a global variable access)
                            //   - The symbol is also another hoisted variable
                            //   - The symbol is a function of any kind and we're in a function or module scope
                            //
                            // Is this unbound (i.e. a global access) or also hoisted?
                            if existing_kind == js_ast::symbol::Kind::Unbound
                                || existing_kind == js_ast::symbol::Kind::Hoisted
                                || (Symbol::is_kind_function(existing_kind)
                                    && (scope_kind == js_ast::scope::Kind::Entry
                                        || scope_kind == js_ast::scope::Kind::FunctionBody))
                            {
                                // Silently merge this symbol into the existing symbol
                                self.symbols[symbol_idx].link.set(member_in_scope.ref_);
                                // PORT NOTE: Zig also wrote `entry.key_ptr.* = name`; the Rust
                                // `StringHashMap` get_or_put already stores the key on insert and
                                // cannot hand out `&mut K` (see StringHashMapGetOrPut docs), so
                                // the key write is a no-op here.
                                *_scope
                                    .get_or_put_member_with_hash(name, hash.unwrap())
                                    .value_ptr = member_in_scope;
                                continue 'next_member;
                            }

                            // Otherwise if this isn't a catch identifier, it's a collision
                            if existing_kind != js_ast::symbol::Kind::CatchIdentifier
                                && existing_kind != js_ast::symbol::Kind::Arguments
                            {
                                // An identifier binding from a catch statement and a function
                                // declaration can both silently shadow another hoisted symbol
                                if self.symbols[symbol_idx].kind
                                    != js_ast::symbol::Kind::CatchIdentifier
                                    && self.symbols[symbol_idx].kind
                                        != js_ast::symbol::Kind::HoistedFunction
                                {
                                    if !is_sloppy_mode_block_level_fn_stmt {
                                        let r =
                                            js_lexer::range_of_identifier(self.source, value.loc);
                                        let mut msg = Vec::<u8>::new();
                                        let _ = write!(
                                            &mut msg,
                                            "{} was originally declared here",
                                            bstr::BStr::new(name)
                                        );
                                        let notes: Box<[bun_ast::Data]> =
                                            Box::new([bun_ast::range_data(
                                                Some(self.source),
                                                r,
                                                msg,
                                            )]);
                                        self.log().add_range_error_fmt_with_notes(
                                            Some(self.source),
                                            js_lexer::range_of_identifier(
                                                self.source,
                                                member_in_scope.loc,
                                            ),
                                            notes,
                                            format_args!(
                                                "{} has already been declared",
                                                bstr::BStr::new(name)
                                            ),
                                        );
                                    } else if _scope_ptr == scope_parent {
                                        // Never mind about this, turns out it's not needed after all
                                        let _ = self
                                            .hoisted_ref_for_sloppy_mode_block_fn
                                            .remove(&original_member_ref);
                                    }
                                }
                                continue 'next_member;
                            }

                            // If this is a catch identifier, silently merge the existing symbol
                            // into this symbol but continue hoisting past this catch scope
                            self.symbols[existing_idx].link.set(value.ref_);
                            *_scope
                                .get_or_put_member_with_hash(name, hash.unwrap())
                                .value_ptr = value;
                        }

                        if _scope.kind_stops_hoisting() {
                            *_scope
                                .get_or_put_member_with_hash(name, hash.unwrap())
                                .value_ptr = value;
                            break;
                        }

                        __scope = _scope.parent;
                    }
                }
            }
        }

        {
            // `StoreRef` Deref — arena-owned, valid for parser 'a lifetime; the
            // recursive calls only touch descendant scopes.
            let children = scope.children.slice();
            for child in children {
                self.hoist_symbols(*child);
            }
        }
    }

    #[inline]
    fn next_scope_in_order_for_visit_pass(&mut self) -> ScopeOrder<'a> {
        // Zig: `const order = scope_order_to_visit[0]; scope_order_to_visit = scope_order_to_visit[1..]`
        let (head, rest) = self
            .scope_order_to_visit
            .split_first()
            .expect("scope_order_to_visit empty");
        self.scope_order_to_visit = rest;
        *head
    }

    pub fn push_scope_for_visit_pass(
        &mut self,
        kind: js_ast::scope::Kind,
        loc: bun_ast::Loc,
    ) -> Result<(), bun_core::Error> {
        let order = self.next_scope_in_order_for_visit_pass();

        // Sanity-check that the scopes generated by the first and second passes match
        // PORT NOTE: Zig `and` binds tighter than `or`, so the original
        // `allow_assert and loc_mismatch or kind_mismatch` keeps the kind check
        // unconditional in release builds. Preserve that grouping here.
        let order_scope = order.scope_ref();
        if (cfg!(debug_assertions) && order.loc.start != loc.start) || order_scope.kind != kind {
            self.log().level = bun_ast::Level::Verbose;
            let _ = self.log().add_debug_fmt(
                Some(self.source),
                loc,
                format_args!("Expected this scope (.{})", <&'static str>::from(kind)),
            );
            let _ = self.log().add_debug_fmt(
                Some(self.source),
                order.loc,
                format_args!(
                    "Found this scope (.{})",
                    <&'static str>::from(order_scope.kind)
                ),
            );
            self.panic("Scope mismatch while visiting", format_args!(""));
        }

        self.current_scope = order.scope_ref();
        self.scopes_for_current_part.push(order.scope);
        Ok(())
    }

    // PORT NOTE: Zig took `comptime kind` (adt_const_params on stable). All
    // call sites pass a literal so the branch on `kind` is trivially predicted.
    #[allow(non_snake_case)]
    pub fn push_scope_for_parse_pass(
        &mut self,
        KIND: js_ast::scope::Kind,
        loc: bun_ast::Loc,
    ) -> Result<usize, bun_core::Error> {
        let mut parent: js_ast::StoreRef<Scope> = self.current_scope;
        let arena = self.arena;
        // Consume the arena `&mut Scope` directly into a `NonNull` so the
        // SharedRW raw-pointer tag derived inside `NonNull::from` is the one
        // stored in `parent.children` / `current_scope` / `scopes_in_order`.
        // Deriving `scope_nn` from a `&mut` reborrow and then writing through
        // the original `&mut` would pop `scope_nn`'s tag off the borrow stack
        // (Stacked Borrows); going `&mut → NonNull → StoreRef` avoids that —
        // every later deref/store goes through the `StoreRef` wrapping `scope_nn`.
        // `..Scope::EMPTY` (a `const`) instead of `..Default::default()` so the
        // remaining fields are filled from a compile-time value: no temporary
        // `Scope` is built via the `Default` chain and then partially dropped,
        // and the `members`/`children`/`generated` empty headers const-fold.
        // This runs once per pushed scope (every block/fn/class body).
        let scope_nn: NonNull<Scope> = NonNull::from(arena.alloc(Scope {
            kind: KIND,
            parent: Some(parent),
            ..Scope::EMPTY
        }));
        // `StoreRef` wraps the SharedRW `NonNull` derived above; every later
        // `Deref`/`DerefMut` goes through `scope_nn`, so reborrows do not pop
        // its tag (see comment above).
        let mut scope = js_ast::StoreRef::from(scope_nn);

        // `parent != scope` (fresh alloc) so the two `&mut` do not alias.
        VecExt::append(&mut parent.children, scope);
        scope.strict_mode = parent.strict_mode;

        self.current_scope = scope;

        if KIND == js_ast::scope::Kind::With {
            // "with" statements change the default from ESModule to CommonJS at runtime.
            // "with" statements are not allowed in strict mode.
            if self.options.features.commonjs_at_runtime {
                self.has_with_scope = true;
            }
        }

        if cfg!(debug_assertions) {
            // Enforce that scope locations are strictly increasing to help catch bugs
            // where the pushed scopes are mismatched between the first and second passes
            if !self.scopes_in_order.is_empty() {
                let mut last_i = self.scopes_in_order.len() - 1;
                while self.scopes_in_order[last_i].is_none() && last_i > 0 {
                    last_i -= 1;
                }

                // PORT NOTE: reshaped for borrowck — copy out loc before borrowing self mutably.
                if let Some(prev_loc) = self.scopes_in_order[last_i].as_ref().map(|s| s.loc) {
                    if prev_loc.start >= loc.start {
                        self.log().level = bun_ast::Level::Verbose;
                        let _ = self.log().add_debug_fmt(
                            Some(self.source),
                            prev_loc,
                            format_args!("Previous Scope"),
                        );
                        let _ = self.log().add_debug_fmt(
                            Some(self.source),
                            loc,
                            format_args!("Next Scope"),
                        );
                        self.panic(
                            "Scope location must be greater than previous",
                            format_args!("{} must be greater than {}", loc.start, prev_loc.start),
                        );
                    }
                }
            }
        }

        // Copy down function arguments into the function body scope. That way we get
        // errors if a statement in the function body tries to re-declare any of the
        // arguments.
        if KIND == js_ast::scope::Kind::FunctionBody {
            // `parent` is the saved old `current_scope`; arena-owned, distinct
            // from the freshly-allocated `scope`, so the read does not alias the
            // `&mut *scope` write below.
            debug_assert!(parent.kind == js_ast::scope::Kind::FunctionArgs);

            for (key, value) in parent.members.iter() {
                // Don't copy down the optional function expression name. Re-declaring
                // the name of a function expression is allowed.
                let value = *value;
                let adjacent_kind = self.symbols[value.ref_.inner_index() as usize].kind;
                if adjacent_kind != js_ast::symbol::Kind::HoistedFunction {
                    // SAFETY: `key` derefs to a slice into source text / the
                    // lexer string-table (see `get_or_put_member_with_hash`),
                    // both of which outlive every arena-backed `Scope`. Avoids
                    // a per-argument `mi_heap_malloc` on every function body.
                    unsafe { scope.members.put_borrowed(key, value)? };
                }
            }
        }

        // Remember the length in case we call popAndDiscardScope() later
        let scope_index = self.scopes_in_order.len();
        self.scopes_in_order
            .push(Some(ScopeOrder::new(loc, scope.as_ptr())));
        // Output.print("\nLoc: {d}\n", .{loc.start});
        Ok(scope_index)
    }

    // Note: do not write to "p.log" in this function. Any errors due to conversion
    // from expression to binding should be written to "invalidLog" instead. That
    // way we can potentially keep this as an expression if it turns out it's not
    // needed as a binding after all.
    // round-D: needs ArrayBinding (B.rs gated trait), Flags::PropertyInit
    fn convert_expr_to_binding(
        &mut self,
        expr: ExprNodeIndex,
        invalid_loc: &mut LocList,
    ) -> Option<Binding> {
        match expr.data {
            js_ast::ExprData::EMissing(_) => return None,
            js_ast::ExprData::EIdentifier(ex) => {
                return Some(self.b(B::Identifier { r#ref: ex.ref_ }, expr.loc));
            }
            js_ast::ExprData::EArray(ex) => {
                if let Some(spread) = ex.comma_after_spread {
                    invalid_loc.push(InvalidLoc {
                        loc: spread,
                        kind: crate::parser::InvalidLocTag::Spread,
                    });
                }

                if ex.is_parenthesized {
                    invalid_loc.push(InvalidLoc {
                        loc: self.source.range_of_operator_before(expr.loc, b"(").loc,
                        kind: crate::parser::InvalidLocTag::Parentheses,
                    });
                }

                // p.markSyntaxFeature(Destructing)
                let mut items = BumpVec::with_capacity_in(ex.items.len_u32() as usize, self.arena);
                let mut is_spread = false;
                for i in 0..ex.items.len_u32() as usize {
                    let mut item = ex.items.slice()[i];
                    if matches!(item.data, js_ast::ExprData::ESpread(_)) {
                        is_spread = true;
                        item = item
                            .data
                            .e_spread()
                            .expect("infallible: variant checked")
                            .value;
                    }
                    let res = self.convert_expr_to_binding_and_initializer(
                        &mut item,
                        invalid_loc,
                        is_spread,
                    );

                    items.push(bun_ast::ArrayBinding {
                        // It's valid for it to be missing
                        // An example:
                        //      Promise.all(promises).then(([, len]) => true);
                        //                                   ^ Binding is missing there
                        binding: res
                            .binding
                            .unwrap_or_else(|| self.b(B::Missing {}, item.loc)),
                        default_value: res.expr,
                    });
                    // PERF(port): was assume_capacity
                }

                return Some(self.b(
                    B::Array {
                        items: bun_ast::StoreSlice::new_mut(items.into_bump_slice_mut()),
                        has_spread: is_spread,
                        is_single_line: ex.is_single_line,
                    },
                    expr.loc,
                ));
            }
            js_ast::ExprData::EObject(mut ex) => {
                if let Some(sp) = ex.comma_after_spread {
                    invalid_loc.push(InvalidLoc {
                        loc: sp,
                        kind: crate::parser::InvalidLocTag::Spread,
                    });
                }

                if ex.is_parenthesized {
                    invalid_loc.push(InvalidLoc {
                        loc: self.source.range_of_operator_before(expr.loc, b"(").loc,
                        kind: crate::parser::InvalidLocTag::Parentheses,
                    });
                }
                // p.markSyntaxFeature(compat.Destructuring, p.source.RangeOfOperatorAfter(expr.Loc, "{"))

                let mut properties =
                    BumpVec::with_capacity_in(ex.properties.len_u32() as usize, self.arena);
                for item in ex.properties.slice_mut() {
                    if item.flags.contains(Flags::Property::IsMethod)
                        || item.kind == js_ast::g::PropertyKind::Get
                        || item.kind == js_ast::g::PropertyKind::Set
                    {
                        invalid_loc.push(InvalidLoc {
                            loc: item.key.expect("infallible: prop has key").loc,
                            kind: if item.flags.contains(Flags::Property::IsMethod) {
                                crate::parser::InvalidLocTag::Method
                            } else if item.kind == js_ast::g::PropertyKind::Get {
                                crate::parser::InvalidLocTag::Getter
                            } else {
                                crate::parser::InvalidLocTag::Setter
                            },
                        });
                        continue;
                    }
                    let value = item.value.as_mut().unwrap();
                    let tup =
                        self.convert_expr_to_binding_and_initializer(value, invalid_loc, false);
                    let initializer = tup.expr.or(item.initializer);
                    let is_spread = item.kind == js_ast::g::PropertyKind::Spread
                        || item.flags.contains(Flags::Property::IsSpread);
                    let mut flags = Flags::PropertySet::empty();
                    if is_spread {
                        flags |= Flags::Property::IsSpread;
                    }
                    if item.flags.contains(Flags::Property::IsComputed) {
                        flags |= Flags::Property::IsComputed;
                    }
                    properties.push(B::Property {
                        flags,
                        key: item
                            .key
                            .unwrap_or_else(|| self.new_expr(E::Missing {}, expr.loc)),
                        value: tup
                            .binding
                            .unwrap_or_else(|| self.b(B::Missing {}, expr.loc)),
                        default_value: initializer,
                    });
                    // PERF(port): was assume_capacity
                }

                return Some(self.b(
                    B::Object {
                        properties: bun_ast::StoreSlice::new_mut(properties.into_bump_slice_mut()),
                        is_single_line: ex.is_single_line,
                    },
                    expr.loc,
                ));
            }
            _ => {
                invalid_loc.push(InvalidLoc {
                    loc: expr.loc,
                    kind: crate::parser::InvalidLocTag::Unknown,
                });
                return None;
            }
        }
        #[allow(unreachable_code)]
        None
    }

    // round-D: heavy body, depends on parse_*/visit_*/ImportScanner/full E surface
    pub fn convert_expr_to_binding_and_initializer(
        &mut self,
        _expr: &mut ExprNodeIndex,
        invalid_log: &mut LocList,
        is_spread: bool,
    ) -> ExprBindingTuple {
        let mut initializer: Option<ExprNodeIndex> = None;
        // `Expr` is `Copy`; read it by value so the `EBinary` arm can switch
        // `expr` to `bin.left` via `StoreRef::Deref` (safe arena read) instead
        // of forging a `&mut` through `as_ptr()`. The result is only ever read.
        let mut expr = *_expr;
        if let js_ast::ExprData::EBinary(bin) = expr.data {
            if bin.op == js_ast::op::Code::BinAssign {
                initializer = Some(bin.right);
                expr = bin.left;
            }
        }

        let bind = self.convert_expr_to_binding(expr, invalid_log);
        if let Some(initial) = initializer {
            let equals_range = self.source.range_of_operator_before(initial.loc, b"=");
            if is_spread {
                self.log().add_range_error(
                    Some(self.source),
                    equals_range,
                    b"A rest argument cannot have a default initializer",
                );
            } else {
                // p.markSyntaxFeature();
            }
        }
        ExprBindingTuple {
            binding: bind,
            expr: initializer,
        }
    }

    #[cold]
    #[inline(never)]
    pub fn forbid_lexical_decl(&mut self, loc: bun_ast::Loc) -> Result<(), bun_core::Error> {
        Ok(self.log().add_error(
            Some(self.source),
            loc,
            b"Cannot use a declaration in a single-statement context",
        ))
    }

    /// If we attempt to parse TypeScript syntax outside of a TypeScript file
    /// make it a compile error
    #[inline]
    pub fn mark_type_script_only(&self) {
        // TODO(port): Zig used @compileError; const-generic specialization can't express
        // a compile error in Rust. Phase B may move TS-only methods behind a trait.
        if !TYPESCRIPT {
            unreachable!();
        }
    }

    pub fn log_expr_errors(&mut self, errors: &mut DeferredErrors) {
        if let Some(r) = errors.invalid_expr_default_value {
            self.log()
                .add_range_error(Some(self.source), r, b"Unexpected \"=\"");
        }

        if let Some(r) = errors.invalid_expr_after_question {
            self.log().add_range_error_fmt(
                Some(self.source),
                r,
                format_args!(
                    "Unexpected {}",
                    bstr::BStr::new(&self.source.contents[r.loc.i()..r.end_i()])
                ),
            );
        }

        // if (errors.array_spread_feature) |err| {
        //     p.markSyntaxFeature(compat.ArraySpread, errors.arraySpreadFeature)
        // }
    }

    pub fn pop_and_discard_scope(&mut self, scope_index: usize) {
        // Move up to the parent scope
        let to_discard = self.current_scope_ref();
        let parent = to_discard.parent.expect("unreachable");

        self.current_scope = parent;

        // Truncate the scope order where we started to pretend we never saw this scope
        self.scopes_in_order.truncate(scope_index);

        let children = &parent.children;
        // Remove the last child from the parent scope
        let last = children.len_u32() - 1;
        if children.slice()[last as usize] != to_discard {
            self.panic("Internal error", format_args!(""));
        }

        // PORT NOTE (spec parity): Zig P.zig:2700-2707 does `var children =
        // parent.children;` (a *value copy* of the Vec header) then
        // `_ = children.pop();` — the pop mutates only the local copy, so
        // `parent.children` is left unchanged (contrast `discardScopesUpTo`
        // which writes back via `defer scope.children = children`). The
        // discarded scope therefore remains in `parent.children` and is later
        // visited by `hoistSymbols`/`computeCharacterFrequency` recursion.
        // Match spec: only assert above, do not actually pop.
    }

    // blocked_on: S::Import field set; crate::parser::MacroRefData; ParsedPath fields; ImportItemForNamespaceMap API
    pub fn process_import_statement(
        &mut self,
        stmt_: S::Import,
        path: ParsedPath<'a>,
        loc: bun_ast::Loc,
        was_originally_bare_import: bool,
    ) -> Result<Stmt, bun_core::Error> {
        let is_macro = true /* TODO(b2-blocked): feature_flag::IS_MACRO_ENABLED */ && (path.is_macro || crate::Macro::is_macro_path(path.text));
        let mut stmt = stmt_;
        if is_macro {
            let id = self.add_import_record(ImportKind::Stmt, path.loc, path.text);
            self.import_records.items_mut()[id as usize].path.namespace = crate::Macro::NAMESPACE;
            self.import_records.items_mut()[id as usize]
                .flags
                .insert(bun_ast::ImportRecordFlags::IS_UNUSED);

            if let Some(name_loc) = stmt.default_name {
                let name = self.load_name_from_ref(name_loc.ref_.expect("infallible: ref bound"));
                let r#ref = self.declare_symbol(js_ast::symbol::Kind::Other, name_loc.loc, name)?;
                self.is_import_item.insert(r#ref, ());
                self.macro_.refs.put(
                    r#ref,
                    crate::parser::MacroRefData {
                        import_record_id: id,
                        name: Some(b"default"),
                    },
                )?;
            }

            if let Some(star) = stmt.star_name_loc {
                let name = self.load_name_from_ref(stmt.namespace_ref);
                let r#ref = self.declare_symbol(js_ast::symbol::Kind::Other, star, name)?;
                stmt.namespace_ref = r#ref;
                self.macro_.refs.put(
                    r#ref,
                    crate::parser::MacroRefData {
                        import_record_id: id,
                        name: None,
                    },
                )?;
            }

            // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a.
            for item in stmt.items.iter() {
                let name = self.load_name_from_ref(item.name.ref_.expect("infallible: ref bound"));
                let r#ref =
                    self.declare_symbol(js_ast::symbol::Kind::Other, item.name.loc, name)?;
                self.is_import_item.insert(r#ref, ());
                // `ClauseItem.alias` is an arena-owned `StoreStr` valid for 'a.
                self.macro_.refs.put(
                    r#ref,
                    crate::parser::MacroRefData {
                        import_record_id: id,
                        name: Some(item.alias.slice()),
                    },
                )?;
            }

            return Ok(self.s(S::Empty {}, loc));
        }

        // Handle `import { feature } from "bun:bundle"` - this is a special import
        // that provides static feature flag checking at bundle time.
        // We handle it here at parse time (similar to macros) rather than at visit time.
        if path.text == b"bun:bundle" {
            // Look for the "feature" import and validate specifiers
            // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a;
            // loop body only reads from `item`, so a shared borrow suffices and
            // avoids holding a unique borrow across `&mut self` method calls.
            for item in stmt.items.iter() {
                // In ClauseItem from parseImportClause:
                // - alias is the name from the source module ("feature")
                // - original_name is the local binding name
                // - name.ref is the ref for the local binding
                // `ClauseItem.alias` is an arena-owned `StoreStr` valid for 'a.
                let alias: &'a [u8] = item.alias.slice();
                if alias == b"feature" {
                    // Check for duplicate imports of feature
                    if self.bundler_feature_flag_ref.is_valid() {
                        self.log().add_error(
                            Some(self.source),
                            item.alias_loc,
                            b"`feature` from \"bun:bundle\" may only be imported once",
                        );
                        continue;
                    }
                    // Declare the symbol and store the ref
                    let name =
                        self.load_name_from_ref(item.name.ref_.expect("infallible: ref bound"));
                    let r#ref =
                        self.declare_symbol(js_ast::symbol::Kind::Other, item.name.loc, name)?;
                    self.bundler_feature_flag_ref = r#ref;
                } else {
                    self.log().add_error_fmt(
                        self.source,
                        item.alias_loc,
                        format_args!(
                            "\"bun:bundle\" has no export named \"{}\"",
                            bstr::BStr::new(alias)
                        ),
                    );
                }
            }
            // Return empty statement - the import is completely removed
            return Ok(self.s(S::Empty {}, loc));
        }

        let macro_remap = if Self::ALLOW_MACROS {
            self.options
                .macro_context
                .as_deref()
                .and_then(|ctx| ctx.get_remap(path.text))
        } else {
            None
        };

        stmt.import_record_index = self.add_import_record(ImportKind::Stmt, path.loc, path.text);
        self.import_records.items_mut()[stmt.import_record_index as usize]
            .flags
            .set(
                bun_ast::ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT,
                was_originally_bare_import,
            );

        if let Some(star) = stmt.star_name_loc {
            let name = self.load_name_from_ref(stmt.namespace_ref);
            stmt.namespace_ref = self.declare_symbol(js_ast::symbol::Kind::Import, star, name)?;

            if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                if let Some(uses) = &mut self.parse_pass_symbol_uses {
                    uses.put(
                        name,
                        crate::parser::ParsePassSymbolUse {
                            r#ref: stmt.namespace_ref,
                            used: false,
                            import_record_index: stmt.import_record_index,
                        },
                    )
                    .expect("unreachable");
                }
            }

            // TODO: not sure how to handle macro remappings for namespace imports
        } else {
            let path_name = fs::PathName::init(path.text);
            let name: &'a [u8] = bun_alloc::arena_format!(
                in self.arena,
                "import_{}",
                bun_core::fmt::fmt_identifier(path_name.non_unique_name_string_base())
            )
            .into_bump_str()
            .as_bytes();
            stmt.namespace_ref = self.new_symbol(js_ast::symbol::Kind::Other, name)?;
            VecExt::append(&mut self.current_scope_mut().generated, stmt.namespace_ref);
        }

        let mut item_refs = ImportItemForNamespaceMap::new();
        // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a.
        let count_excluding_namespace = u16::try_from(stmt.items.len()).expect("int cast")
            + u16::from(stmt.default_name.is_some());

        item_refs.ensure_unused_capacity(count_excluding_namespace as usize)?;
        // Even though we allocate ahead of time here
        // we cannot use putAssumeCapacity because a symbol can have existing links
        // those may write to this hash table, so this estimate may be innaccurate
        self.is_import_item
            .reserve(count_excluding_namespace as usize);
        let mut remap_count: u32 = 0;
        // Link the default item to the namespace
        if let Some(name_loc) = &mut stmt.default_name {
            'outer: {
                let name = self.load_name_from_ref(name_loc.ref_.expect("infallible: ref bound"));
                let r#ref =
                    self.declare_symbol(js_ast::symbol::Kind::Import, name_loc.loc, name)?;
                name_loc.ref_ = Some(r#ref);
                self.is_import_item.insert(r#ref, ());

                // ensure every e_import_identifier holds the namespace
                if self.options.features.hot_module_reloading {
                    let symbol = &mut self.symbols[r#ref.inner_index() as usize];
                    if symbol.namespace_alias.is_none() {
                        symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                            namespace_ref: stmt.namespace_ref,
                            alias: js_ast::StoreStr::new(b"default"),
                            import_record_index: stmt.import_record_index,
                            was_originally_property_access: false,
                        });
                    }
                }

                if let Some(remap) = macro_remap {
                    if let Some(remapped_path) = remap.get(b"default") {
                        let new_import_id =
                            self.add_import_record(ImportKind::Stmt, path.loc, remapped_path);
                        self.macro_.refs.put(
                            r#ref,
                            crate::parser::MacroRefData {
                                import_record_id: new_import_id,
                                name: Some(b"default"),
                            },
                        )?;

                        self.import_records.items_mut()[new_import_id as usize]
                            .path
                            .namespace = crate::Macro::NAMESPACE;
                        self.import_records.items_mut()[new_import_id as usize]
                            .flags
                            .insert(bun_ast::ImportRecordFlags::IS_UNUSED);
                        if SCAN_ONLY {
                            self.import_records.items_mut()[new_import_id as usize]
                                .flags
                                .insert(bun_ast::ImportRecordFlags::IS_INTERNAL);
                            self.import_records.items_mut()[new_import_id as usize]
                                .path
                                .is_disabled = true;
                        }
                        stmt.default_name = None;
                        remap_count += 1;
                        break 'outer;
                    }
                }

                if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                    if let Some(uses) = &mut self.parse_pass_symbol_uses {
                        uses.put(
                            name,
                            crate::parser::ParsePassSymbolUse {
                                r#ref,
                                used: false,
                                import_record_index: stmt.import_record_index,
                            },
                        )
                        .expect("unreachable");
                    }
                }

                // Zig had a duplicate `if (ParsePassSymbolUsageType != void)` block here;
                // both gates resolve to the same condition in Rust so we omit the second.

                // No need to add the `default_name` to `item_refs` because
                // `.scanImportsAndExports(...)` special cases and handles
                // `default_name` separately
            }
        }
        let mut end: usize = 0;

        let items_slice: &mut [js_ast::ClauseItem] = stmt.items.slice_mut();
        for i in 0..items_slice.len() {
            // PORT NOTE: Zig copied `ClauseItem` by value (POD struct). Rust's
            // `ClauseItem` does not derive `Copy`; bit-copy via `ptr::read` —
            // all fields are POD (`StoreStr`/`Loc`/`LocRef`).
            // SAFETY: items_slice[i] is a live initialised `ClauseItem`; the
            // original slot is overwritten or compacted below before any drop.
            let mut item = unsafe { core::ptr::read(&raw const items_slice[i]) };
            let name = self.load_name_from_ref(item.name.ref_.expect("unreachable"));
            let r#ref = self.declare_symbol(js_ast::symbol::Kind::Import, item.name.loc, name)?;
            item.name.ref_ = Some(r#ref);

            self.is_import_item.insert(r#ref, ());
            // `ClauseItem.alias` is an arena-owned `StoreStr` valid for 'a.
            let alias: &'a [u8] = item.alias.slice();
            self.check_for_non_bmp_code_point(item.alias_loc, alias);

            // ensure every e_import_identifier holds the namespace
            if self.options.features.hot_module_reloading {
                let symbol = &mut self.symbols[r#ref.inner_index() as usize];
                if symbol.namespace_alias.is_none() {
                    symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                        namespace_ref: stmt.namespace_ref,
                        alias: js_ast::StoreStr::new(alias),
                        import_record_index: stmt.import_record_index,
                        was_originally_property_access: false,
                    });
                }
            }

            if let Some(remap) = macro_remap {
                if let Some(remapped_path) = remap.get(alias) {
                    let new_import_id =
                        self.add_import_record(ImportKind::Stmt, path.loc, remapped_path);
                    self.macro_.refs.put(
                        r#ref,
                        crate::parser::MacroRefData {
                            import_record_id: new_import_id,
                            name: Some(alias),
                        },
                    )?;

                    self.import_records.items_mut()[new_import_id as usize]
                        .path
                        .namespace = crate::Macro::NAMESPACE;
                    self.import_records.items_mut()[new_import_id as usize]
                        .flags
                        .insert(bun_ast::ImportRecordFlags::IS_UNUSED);
                    if SCAN_ONLY {
                        self.import_records.items_mut()[new_import_id as usize]
                            .flags
                            .insert(bun_ast::ImportRecordFlags::IS_INTERNAL);
                        self.import_records.items_mut()[new_import_id as usize]
                            .path
                            .is_disabled = true;
                    }
                    remap_count += 1;
                    continue;
                }
            }

            if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                if let Some(uses) = &mut self.parse_pass_symbol_uses {
                    uses.put(
                        name,
                        crate::parser::ParsePassSymbolUse {
                            r#ref,
                            used: false,
                            import_record_index: stmt.import_record_index,
                        },
                    )
                    .expect("unreachable");
                }
            }

            item_refs.put_assume_capacity(alias, item.name);
            items_slice[end] = item;
            end += 1;
        }
        stmt.items = bun_ast::StoreSlice::new_mut(&mut items_slice[..end]);

        // If we remapped the entire import away
        // i.e. import {graphql} "react-relay"

        // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a.
        if remap_count > 0 && stmt.items.is_empty() && stmt.default_name.is_none() {
            self.import_records.items_mut()[stmt.import_record_index as usize]
                .path
                .namespace = crate::Macro::NAMESPACE;
            self.import_records.items_mut()[stmt.import_record_index as usize]
                .flags
                .insert(bun_ast::ImportRecordFlags::IS_UNUSED);

            if SCAN_ONLY {
                self.import_records.items_mut()[stmt.import_record_index as usize]
                    .path
                    .is_disabled = true;
                self.import_records.items_mut()[stmt.import_record_index as usize]
                    .flags
                    .insert(bun_ast::ImportRecordFlags::IS_INTERNAL);
            }

            return Ok(self.s(S::Empty {}, loc));
        } else if remap_count > 0 {
            // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a.
            item_refs.shrink_and_free(stmt.items.len() + usize::from(stmt.default_name.is_some()));
        }

        if path.import_tag != bun_ast::ImportRecordTag::None || path.loader.is_some() {
            self.validate_and_set_import_type(&path, &mut stmt)?;
        }

        // Track the items for this namespace
        self.import_items_for_namespace
            .insert(stmt.namespace_ref, item_refs);
        Ok(self.s(stmt, loc))
    }

    // blocked_on: ParsedPath fields; S::Import.items; options::Loader
    #[cold]
    fn validate_and_set_import_type(
        &mut self,
        path: &ParsedPath,
        stmt: &mut S::Import,
    ) -> Result<(), bun_core::Error> {
        if let Some(loader) = path.loader {
            self.import_records.items_mut()[stmt.import_record_index as usize].loader =
                Some(loader);

            if loader == options::Loader::Sqlite || loader == options::Loader::SqliteEmbedded {
                // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a.
                for item in stmt.items.iter() {
                    // `ClauseItem.alias` is an arena-owned `StoreStr` valid for 'a.
                    let alias: &[u8] = item.alias.slice();
                    if !(alias == b"default" || alias == b"db") {
                        self.log().add_error(
                            Some(self.source),
                            item.name.loc,
                            b"sqlite imports only support the \"default\" or \"db\" imports",
                        );
                        break;
                    }
                }
            } else if loader == options::Loader::File || loader == options::Loader::Text {
                // arena-owned `StoreSlice<ClauseItem>` valid for parser 'a.
                for item in stmt.items.iter() {
                    // `ClauseItem.alias` is an arena-owned `StoreStr` valid for 'a.
                    if item.alias.slice() != b"default" {
                        self.log().add_error(
                            Some(self.source),
                            item.name.loc,
                            b"This loader type only supports the \"default\" import",
                        );
                        break;
                    }
                }
            }
        } else if path.import_tag == bun_ast::ImportRecordTag::BakeResolveToSsrGraph {
            self.import_records.items_mut()[stmt.import_record_index as usize].tag =
                path.import_tag;
        }
        Ok(())
    }

    pub fn create_default_name(
        &mut self,
        loc: bun_ast::Loc,
    ) -> Result<js_ast::LocRef, bun_core::Error> {
        // PORT NOTE: Zig `try p.source.path.name.nonUniqueNameString(arena)` allocates the
        // sanitized identifier, then `allocPrint` formats `{s}_default`. bun_paths::fs::PathName<'static>
        // exposes the same sanitizer as a Display formatter (`fmt_identifier()`), so format once
        // and copy into the bump arena.
        let identifier: &'a [u8] = {
            let s = format!("{}_default", self.source.path.name.fmt_identifier());
            self.arena.alloc_slice_copy(s.as_bytes())
        };

        let name = js_ast::LocRef {
            loc,
            ref_: Some(self.new_symbol(js_ast::symbol::Kind::Other, identifier)?),
        };

        VecExt::append(
            &mut self.current_scope_mut().generated,
            name.ref_.expect("infallible: ref bound"),
        );

        Ok(name)
    }

    pub fn new_symbol(
        &mut self,
        kind: js_ast::symbol::Kind,
        identifier: &'a [u8],
    ) -> Result<Ref, bun_core::Error> {
        // TODO(port): narrow error set
        let inner_index = self.symbols.len() as js_ast::base::RefInt; // @truncate
        self.symbols.push(Symbol {
            kind,
            original_name: js_ast::StoreStr::new(identifier),
            ..Default::default()
        });

        if TYPESCRIPT {
            self.ts_use_counts.push(0);
        }

        Ok(Ref::new(
            inner_index,
            self.source.index.0 as js_ast::base::RefInt,
            js_ast::base::RefTag::Symbol,
        ))
    }

    pub fn default_name_for_expr(&mut self, expr: Expr, loc: bun_ast::Loc) -> LocRef {
        match &expr.data {
            js_ast::ExprData::EFunction(func_container) => {
                if let Some(_name) = &func_container.func.name {
                    if let Some(r#ref) = _name.ref_ {
                        return LocRef {
                            loc,
                            ref_: Some(r#ref),
                        };
                    }
                }
            }
            js_ast::ExprData::EIdentifier(ident) => {
                return LocRef {
                    loc,
                    ref_: Some(ident.ref_),
                };
            }
            js_ast::ExprData::EImportIdentifier(ident) => {
                if !Self::ALLOW_MACROS
                    || (Self::ALLOW_MACROS && !self.macro_.refs.contains(&ident.ref_))
                {
                    return LocRef {
                        loc,
                        ref_: Some(ident.ref_),
                    };
                }
            }
            js_ast::ExprData::EClass(class) => {
                if let Some(_name) = &class.class_name {
                    if let Some(r#ref) = _name.ref_ {
                        return LocRef {
                            loc,
                            ref_: Some(r#ref),
                        };
                    }
                }
            }
            _ => {}
        }

        self.create_default_name(loc).expect("unreachable")
    }

    pub fn discard_scopes_up_to(&mut self, scope_index: usize) {
        // Remove any direct children from their parent. `StoreRef` is `Copy` and
        // does not borrow `self`, so the immutable iter over `scopes_in_order`
        // can run while `children` is held `&mut` through the handle.
        let mut cur = self.current_scope_ref();
        let current_scope_ptr: *mut js_ast::Scope = cur.as_ptr();
        let children = &mut cur.children;
        // PORT NOTE: Zig copied `var children = scope.children` + `defer scope.children = children`.
        // Vec isn't Copy in Rust; mutate the field in place via the handle instead.

        for _child in &self.scopes_in_order[scope_index..] {
            let Some(child) = _child else { continue };

            let parent = child.scope_ref().parent;
            if parent.map(|p| p.as_ptr()) == Some(current_scope_ptr) {
                let mut i: usize = (children.len_u32() - 1) as usize;
                loop {
                    if children.mut_(i).as_ptr() == child.scope {
                        let _ = children.ordered_remove(i);
                        break;
                    }
                    if i == 0 {
                        break;
                    }
                    i -= 1;
                }
            }
        }

        // Truncate the scope order where we started to pretend we never saw this scope
        self.scopes_in_order.truncate(scope_index);
    }

    // TypeScript namespace lowering — never reached when transpiling plain JS
    // (e.g. node_modules), so keep it out of the hot parse/visit icache window.
    #[cold]
    #[inline(never)]
    pub fn define_exported_namespace_binding(
        &mut self,
        exported_members: &mut js_ast::TSNamespaceMemberMap,
        binding: Binding,
    ) -> Result<(), bun_core::Error> {
        match binding.data {
            js_ast::b::B::BMissing(_) => {}
            js_ast::b::B::BIdentifier(id) => {
                let id = id.get();
                // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                let name = self.symbols[id.r#ref.inner_index() as usize]
                    .original_name
                    .slice();
                exported_members.put(
                    name,
                    js_ast::TSNamespaceMember {
                        loc: binding.loc,
                        data: js_ast::ts::Data::Property,
                    },
                )?;
                // ref_to_ts_namespace_member derefs to std HashMap; Zig `put(arena, k, v)` → insert.
                self.ref_to_ts_namespace_member
                    .insert(id.r#ref, js_ast::ts::Data::Property);
            }
            js_ast::b::B::BObject(obj) => {
                for prop in obj.properties.slice() {
                    self.define_exported_namespace_binding(exported_members, prop.value)?;
                }
            }
            js_ast::b::B::BArray(obj) => {
                for prop in obj.items.slice() {
                    self.define_exported_namespace_binding(exported_members, prop.binding)?;
                }
            }
        }
        Ok(())
    }

    pub fn forbid_initializers(
        &mut self,
        decls: &[G::Decl],
        loop_type: &'static str,
        is_var: bool,
    ) -> Result<(), bun_core::Error> {
        match decls.len() {
            0 => {}
            1 => {
                if let Some(value) = &decls[0].value {
                    if is_var {
                        // This is a weird special case. Initializers are allowed in "var"
                        // statements with identifier bindings.
                        return Ok(());
                    }
                    // PERF(port): was comptimePrint — runtime format here is fine for error path
                    self.log().add_error_fmt(
                        Some(self.source),
                        value.loc,
                        format_args!(
                            "for-{} loop variables cannot have an initializer",
                            loop_type
                        ),
                    );
                }
            }
            _ => {
                self.log().add_error_fmt(
                    Some(self.source),
                    decls[0].binding.loc,
                    format_args!("for-{} loops must have a single declaration", loop_type),
                );
            }
        }
        Ok(())
    }

    #[allow(non_snake_case)]
    pub fn require_initializers(
        &mut self,
        KIND: js_ast::s::Kind,
        decls: &[G::Decl],
    ) -> Result<(), bun_core::Error> {
        let what = match KIND {
            js_ast::s::Kind::KAwaitUsing | js_ast::s::Kind::KUsing => "declaration",
            js_ast::s::Kind::KConst => "constant",
            _ => unreachable!(), // @compileError("unreachable") in Zig
        };

        for decl in decls {
            if decl.value.is_none() {
                match &decl.binding.data {
                    js_ast::b::B::BIdentifier(ident) => {
                        let r = js_lexer::range_of_identifier(self.source, decl.binding.loc);
                        let ident_ref = ident.r#ref;
                        // SAFETY: original_name is an arena-owned slice valid for 'a.
                        let name = self.symbols[ident_ref.inner_index() as usize]
                            .original_name
                            .slice();
                        self.log().add_range_error_fmt(
                            Some(self.source),
                            r,
                            format_args!(
                                "The {} \"{}\" must be initialized",
                                what,
                                bstr::BStr::new(name)
                            ),
                        );
                        // return;/
                    }
                    _ => {
                        self.log().add_error_fmt(
                            Some(self.source),
                            decl.binding.loc,
                            format_args!("This {} must be initialized", what),
                        );
                    }
                }
            }
        }
        Ok(())
    }

    // Generate a TypeScript namespace object for this namespace's scope. If this
    // namespace is another block that is to be merged with an existing namespace,
    // use that earlier namespace's object instead.
    #[cold]
    #[inline(never)]
    pub fn get_or_create_exported_namespace_members(
        &mut self,
        name: &[u8],
        is_export: bool,
        is_enum_scope: bool,
    ) -> js_ast::StoreRef<js_ast::TSNamespaceScope> {
        let map: Option<js_ast::StoreRef<js_ast::TSNamespaceMemberMap>> = 'brk: {
            // Merge with a sibling namespace from the same scope
            if let Some(existing_member) = self.current_scope().members.get(name) {
                if let Some(member_data) =
                    self.ref_to_ts_namespace_member.get(&existing_member.ref_)
                {
                    if let js_ast::ts::Data::Namespace(ns) = *member_data {
                        break 'brk Some(ns);
                    }
                }
            }

            // Merge with a sibling namespace from a different scope
            if is_export {
                if let Some(ns) = self.current_scope().ts_namespace {
                    let exported: &js_ast::TSNamespaceMemberMap = &ns.exported_members;
                    if let Some(member) = exported.get(name) {
                        if let js_ast::ts::Data::Namespace(m) = member.data {
                            break 'brk Some(m);
                        }
                    }
                }
            }

            None
        };

        if let Some(existing) = map {
            return js_ast::StoreRef::from_bump(self.arena.alloc(js_ast::TSNamespaceScope {
                exported_members: existing,
                is_enum_scope,
                arg_ref: Ref::NONE,
                property_accesses: Default::default(),
            }));
        }

        // Otherwise, generate a new namespace object.
        // PORT NOTE: Zig batched map+scope into one alloc and patched
        // `exported_members` post-init. `StoreRef` is non-null so the field
        // can't be null-then-patch; two bump allocs from the same arena is the
        // same locality and avoids the self-referential init.
        let map = js_ast::StoreRef::from_bump(self.arena.alloc(Default::default()));
        js_ast::StoreRef::from_bump(self.arena.alloc(js_ast::TSNamespaceScope {
            exported_members: map,
            is_enum_scope,
            arg_ref: Ref::NONE,
            property_accesses: Default::default(),
        }))
    }

    // TODO:
    pub fn check_for_non_bmp_code_point(&mut self, _: bun_ast::Loc, _: &[u8]) {}

    pub fn mark_strict_mode_feature(
        &mut self,
        feature: StrictModeFeature,
        r: bun_ast::Range,
        detail: &[u8],
    ) -> Result<(), bun_core::Error> {
        let can_be_transformed = feature == StrictModeFeature::ForInVarInit;
        let text: &'a [u8] = match feature {
            StrictModeFeature::WithStatement => b"With statements",
            StrictModeFeature::DeleteBareName => b"\"delete\" of a bare identifier",
            StrictModeFeature::ForInVarInit => b"Variable initializers within for-in loops",
            StrictModeFeature::EvalOrArguments => bun_alloc::arena_format!(
                in self.arena,
                "Declarations with the name \"{}\"",
                bstr::BStr::new(detail)
            )
            .into_bump_str()
            .as_bytes(),
            StrictModeFeature::ReservedWord => bun_alloc::arena_format!(
                in self.arena,
                "\"{}\" is a reserved word and",
                bstr::BStr::new(detail)
            )
            .into_bump_str()
            .as_bytes(),
            StrictModeFeature::LegacyOctalLiteral => b"Legacy octal literals",
            StrictModeFeature::LegacyOctalEscape => b"Legacy octal escape sequences",
            StrictModeFeature::IfElseFunctionStmt => b"Function declarations inside if statements",
        };

        let scope = self.current_scope();
        if self.is_strict_mode() {
            let mut why: &'a [u8] = b"";
            let mut where_: bun_ast::Range = bun_ast::Range::NONE;
            match scope.strict_mode {
                js_ast::StrictModeKind::ImplicitStrictModeImport => {
                    where_ = self.esm_import_keyword
                }
                js_ast::StrictModeKind::ImplicitStrictModeExport => {
                    where_ = self.esm_export_keyword
                }
                js_ast::StrictModeKind::ImplicitStrictModeTopLevelAwait => {
                    where_ = self.top_level_await_keyword
                }
                js_ast::StrictModeKind::ImplicitStrictModeClass => {
                    why = b"All code inside a class is implicitly in strict mode";
                    where_ = self.enclosing_class_keyword;
                }
                _ => {}
            }
            if why.is_empty() {
                why = bun_alloc::arena_format!(
                    in self.arena,
                    "This file is implicitly in strict mode because of the \"{}\" keyword here",
                    bstr::BStr::new(self.source.text_for_range(where_))
                )
                .into_bump_str()
                .as_bytes();
            }
            // bun_ast::Data is !Copy (Cow) — build the notes Box directly.
            let notes: Box<[bun_ast::Data]> =
                Box::new([bun_ast::range_data(Some(self.source), where_, why.to_vec())]);
            self.log().add_range_error_fmt_with_notes(
                Some(self.source),
                r,
                notes,
                format_args!("{} cannot be used in strict mode", bstr::BStr::new(text)),
            );
        } else if !can_be_transformed && self.is_strict_mode_output_format() {
            self.log().add_range_error_fmt(
                Some(self.source),
                r,
                format_args!(
                    "{} cannot be used with the ESM output format due to strict mode",
                    bstr::BStr::new(text)
                ),
            );
        }
        Ok(())
    }

    #[inline]
    pub fn is_strict_mode(&self) -> bool {
        self.current_scope().strict_mode != js_ast::StrictModeKind::SloppyMode
    }

    #[inline]
    pub fn is_strict_mode_output_format(&self) -> bool {
        self.options.bundle && self.options.output_format.is_esm()
    }

    pub fn declare_common_js_symbol(
        &mut self,
        kind: js_ast::symbol::Kind,
        name: &'static [u8],
    ) -> Result<Ref, bun_core::Error> {
        let name_hash = Scope::get_member_hash(name);
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; shared
        // borrow only (`get_member_with_hash` takes `&self`), so the later
        // re-derivations at L4149/L4160 cannot overlap a stale unique tag.
        let member = self.module_scope().get_member_with_hash(name, name_hash);

        // If the code declared this symbol using "var name", then this is actually
        // not a collision. For example, node will let you do this:
        //
        //   var exports;
        //   module.exports.foo = 123;
        //   console.log(exports.foo);
        //
        // This works because node's implementation of CommonJS wraps the entire
        // source file like this:
        //
        //   (function(require, exports, module, __filename, __dirname) {
        //     var exports;
        //     module.exports.foo = 123;
        //     console.log(exports.foo);
        //   })
        //
        // Both the "exports" argument and "var exports" are hoisted variables, so
        // they don't collide.
        if let Some(_member) = &member {
            if self.symbols[_member.ref_.inner_index() as usize].kind
                == js_ast::symbol::Kind::Hoisted
                && kind == js_ast::symbol::Kind::Hoisted
                && !self.has_es_module_syntax
            {
                return Ok(_member.ref_);
            }
        }

        // Create a new symbol if we didn't merge with an existing one above
        let ref_ = self.new_symbol(kind, name)?;

        if member.is_none() {
            self.module_scope_mut().members.put(
                name,
                js_ast::scope::Member {
                    ref_,
                    loc: bun_ast::Loc::EMPTY,
                },
            )?;
            return Ok(ref_);
        }

        // If the variable was declared, then it shadows this symbol. The code in
        // this module will be unable to reference this symbol. However, we must
        // still add the symbol to the scope so it gets minified (automatically-
        // generated code may still reference the symbol).
        VecExt::append(&mut self.module_scope_mut().generated, ref_);
        Ok(ref_)
    }

    /// Zig: `comptime name: string` — every call site passes a literal, and
    /// `generatedSymbolName` concatenates a comptime hash. Rust can't macro-call
    /// on a runtime param, so callers must pre-hash via `generated_symbol_name!`
    /// and pass the result, OR (non-bundle) we runtime-hash into the bump arena.
    pub fn declare_generated_symbol(
        &mut self,
        kind: js_ast::symbol::Kind,
        name: &'static [u8],
    ) -> Result<Ref, bun_core::Error> {
        // The bundler runs the renamer, so it is ok to not append a hash
        if self.options.bundle {
            return self.declare_symbol_maybe_generated::<true>(kind, bun_ast::Loc::EMPTY, name);
        }
        // Runtime equivalent of `generated_symbol_name!` (Zig comptime concat).
        // Same bytes as the macro produces; arena-owned for symbol lifetime.
        let hash = bun_wyhash::hash(name);
        let hashed: &'a [u8] = bun_alloc::arena_format!(in self.arena, "{}_{}", bstr::BStr::new(name), bun_core::fmt::truncated_hash32(hash)).into_bump_str().as_bytes();
        self.declare_symbol_maybe_generated::<true>(kind, bun_ast::Loc::EMPTY, hashed)
    }

    pub fn declare_symbol(
        &mut self,
        kind: js_ast::symbol::Kind,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> Result<Ref, bun_core::Error> {
        // PERF(port): Zig used @call(bun.callmod_inline, ...) — rely on LLVM inlining
        self.declare_symbol_maybe_generated::<false>(kind, loc, name)
    }

    pub fn declare_symbol_maybe_generated<const IS_GENERATED: bool>(
        &mut self,
        kind: js_ast::symbol::Kind,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> Result<Ref, bun_core::Error> {
        // p.checkForNonBMPCodePoint(loc, name)
        if !IS_GENERATED {
            // Forbid declaring a symbol with a reserved word in strict mode
            if self.is_strict_mode()
                && name.as_ptr() != arguments_str.as_ptr()
                && bun_ast::lexer_tables::is_strict_mode_reserved_word(name)
            {
                self.mark_strict_mode_feature(
                    StrictModeFeature::ReservedWord,
                    js_lexer::range_of_identifier(self.source, loc),
                    name,
                )?;
            }
        }

        // Allocate a new symbol
        let mut ref_ = self.new_symbol(kind, name)?;

        // Single-probe `getOrPut`, matching Zig. The previous two-probe shape
        // (`members.get` then `members.put_borrowed`) existed only because the
        // merge decision read `self.current_scope()` while the entry borrow was
        // live, which under Stacked Borrows invalidated the entry's `&mut`.
        // That coupling is gone: `can_merge_symbol_kinds` is an associated fn
        // taking the scope `Kind` by value, so we copy `scope.kind` out before
        // taking the entry, and every other read inside the match
        // (`self.symbols`, `self.log()`, `self.source`) touches `P` fields
        // disjoint from the arena `Scope` the entry borrows. Copying the
        // `StoreRef` out (instead of going through `current_scope_mut`, which
        // would tie the borrow to `&mut self`) is what lets borrowck see that
        // disjointness — `StoreRef` is `Copy` and does not borrow `self`, so
        // the entry below can coexist with `self.symbols` / `self.log()` reads.
        // SAFETY (key lifetime): `name: &'a [u8]` points into source text or
        // the lexer string-table, both of which outlive the arena-owned
        // `Scope` — see `Scope::get_or_put_member_with_hash`.
        let mut scope: js_ast::StoreRef<js_ast::Scope> = self.current_scope;
        let scope_kind = scope.kind;
        let entry = unsafe { scope.members.get_or_put_borrowed(name) };
        if entry.found_existing {
            let existing: js_ast::scope::Member = *entry.value_ptr;
            let symbol_idx = existing.ref_.inner_index() as usize;

            if !IS_GENERATED {
                use js_ast::scope::SymbolMergeResult as MR;
                let merge = js_ast::Scope::can_merge_symbol_kinds::<TYPESCRIPT>(
                    scope_kind,
                    self.symbols[symbol_idx].kind,
                    kind,
                );
                match merge {
                    MR::Forbidden => {
                        // Entry already holds `existing`; leave it untouched.
                        // SAFETY: original_name is an arena-owned slice valid for 'a.
                        let orig = self.symbols[symbol_idx].original_name.slice();
                        self.log().add_symbol_already_declared_error(
                            self.source,
                            orig,
                            loc,
                            existing.loc,
                        );
                        return Ok(existing.ref_);
                    }
                    MR::KeepExisting => {
                        ref_ = existing.ref_;
                    }
                    MR::ReplaceWithNew => {
                        self.symbols[symbol_idx].link.set(ref_);

                        // If these are both functions, remove the overwritten declaration
                        if kind.is_function() && self.symbols[symbol_idx].kind.is_function() {
                            self.symbols[symbol_idx].remove_overwritten_function_declaration = true;
                        }
                    }
                    MR::BecomePrivateGetSetPair => {
                        ref_ = existing.ref_;
                        self.symbols[symbol_idx].kind = js_ast::symbol::Kind::PrivateGetSetPair;
                    }
                    MR::BecomePrivateStaticGetSetPair => {
                        ref_ = existing.ref_;
                        self.symbols[symbol_idx].kind =
                            js_ast::symbol::Kind::PrivateStaticGetSetPair;
                    }
                    MR::OverwriteWithNew => {}
                }
            } else {
                self.symbols[ref_.inner_index() as usize]
                    .link
                    .set(existing.ref_);
            }
        }
        *entry.value_ptr = js_ast::scope::Member { ref_, loc };
        if IS_GENERATED {
            VecExt::append(&mut self.module_scope_mut().generated, ref_);
        }
        Ok(ref_)
    }

    pub fn validate_function_name(&mut self, func: &G::Fn, kind: FunctionKind) {
        if let Some(name) = &func.name {
            // SAFETY: Symbol.original_name is an arena/source-contents slice valid for 'a.
            let original_name: &[u8] = self.symbols
                [name.ref_.expect("infallible: ref bound").inner_index() as usize]
                .original_name
                .slice();

            if func.flags.contains(Flags::Function::IsAsync) && original_name == b"await" {
                self.log().add_range_error(
                    Some(self.source),
                    js_lexer::range_of_identifier(self.source, name.loc),
                    b"An async function cannot be named \"await\"",
                );
            } else if kind == FunctionKind::Expr
                && func.flags.contains(Flags::Function::IsGenerator)
                && original_name == b"yield"
            {
                self.log().add_range_error(
                    Some(self.source),
                    js_lexer::range_of_identifier(self.source, name.loc),
                    b"An generator function expression cannot be named \"yield\"",
                );
            }
        }
    }

    pub fn declare_binding(
        &mut self,
        kind: js_ast::symbol::Kind,
        binding: &mut BindingNodeIndex,
        opts: &ParseStatementOptions,
    ) -> Result<(), bun_core::Error> {
        match &mut binding.data {
            js_ast::b::B::BMissing(_) => {}
            js_ast::b::B::BIdentifier(bind) => {
                if !opts.is_typescript_declare || (opts.is_namespace_scope && opts.is_export) {
                    bind.r#ref = self.declare_symbol(
                        kind,
                        binding.loc,
                        self.load_name_from_ref(bind.r#ref),
                    )?;
                }
            }
            js_ast::b::B::BArray(bind) => {
                for item in bind.items_mut().iter_mut() {
                    self.declare_binding(kind, &mut item.binding, opts)
                        .expect("unreachable");
                }
            }
            js_ast::b::B::BObject(bind) => {
                for prop in bind.properties_mut().iter_mut() {
                    self.declare_binding(kind, &mut prop.value, opts)
                        .expect("unreachable");
                }
            }
        }
        Ok(())
    }

    pub fn store_name_in_ref(&mut self, name: &'a [u8]) -> Result<Ref, bun_core::Error> {
        if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
            if let Some(uses) = &mut self.parse_pass_symbol_uses {
                if let Some(res) = uses.get_mut(name) {
                    res.used = true;
                }
            }
        }

        let contents_ptr = self.source.contents.as_ptr() as usize;
        let name_ptr = name.as_ptr() as usize;
        if contents_ptr <= name_ptr
            && (name_ptr + name.len()) <= (contents_ptr + self.source.contents.len())
        {
            // Zig: `@intCast` — unchecked in ReleaseFast. Both values are
            // bounded by `source.contents.len()` which the lexer already
            // requires to fit in u32 (Loc is i32). debug_assert preserves the
            // safety check without the per-identifier branch in release.
            let off = name_ptr - contents_ptr;
            debug_assert!(off <= u32::MAX as usize && name.len() <= u32::MAX as usize);
            Ok(Ref::new(
                name.len() as u32,
                off as u32,
                js_ast::base::RefTag::SourceContentsSlice,
            ))
        } else {
            // Zig u31 `@intCast` — allocated_names.len() is bounded by the
            // symbol budget (asserted by Ref::pack's INNER_INDEX_BITS check).
            let inner_index = self.allocated_names.len();
            debug_assert!(inner_index <= u32::MAX as usize);
            self.allocated_names.push(name);
            Ok(Ref::init(inner_index as u32, self.source.index.0, false))
        }
    }

    // load_name_from_ref() lives in the round-C live block above (deduped).

    #[inline]
    pub fn add_import_record(
        &mut self,
        kind: ImportKind,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> u32 {
        self.add_import_record_by_range(kind, self.source.range_of_string(loc), name)
    }

    pub fn add_import_record_by_range(
        &mut self,
        kind: ImportKind,
        range: bun_ast::Range,
        name: &'a [u8],
    ) -> u32 {
        self.add_import_record_by_range_and_path(kind, range, fs::Path::init(name))
    }

    pub fn add_import_record_by_range_and_path(
        &mut self,
        kind: ImportKind,
        range: bun_ast::Range,
        path: fs::Path<'a>,
    ) -> u32 {
        let index = self.import_records.len();
        // Phase-A: `ImportRecord.path` is `fs::Path<'static>` (PORTING.md: no struct
        // lifetime params yet). The parser-supplied path borrows arena-owned 'a bytes
        // which outlive the import_records list (both dropped with the parser arena),
        // so the lifetime extension is sound here. Round-E threads `'a` through
        // `bun_ast::ImportRecord` and removes this erasure.
        // SAFETY: see above — arena 'a outlives every ImportRecord stored in self.import_records.
        let path: fs::Path<'static> = unsafe { path.into_static() };
        // No `impl Default for ImportRecord` (range/path/kind have no Zig defaults) —
        // spell out the optional fields with their Zig field-defaults explicitly.
        self.import_records.push(ImportRecord {
            kind,
            range,
            path,
            tag: bun_ast::ImportRecordTag::None,
            loader: None,
            source_index: bun_ast::Index::INVALID,
            module_id: 0,
            original_path: b"",
            flags: bun_ast::ImportRecordFlags::empty(),
        });
        u32::try_from(index).expect("int cast")
    }

    pub fn pop_scope(&mut self) {
        // `StoreRef` handle is `Copy` and does not borrow `self`, so the loop
        // body can write to `self.symbols` (disjoint allocation) while the
        // scope is read via `Deref`.
        let current_scope = self.current_scope_ref();
        // We cannot rename anything inside a scope containing a direct eval() call
        if current_scope.contains_direct_eval {
            let mut iter = current_scope.members.iter();
            while let Some(member) = iter.next() {
                // Using direct eval when bundling is not a good idea in general because
                // esbuild must assume that it can potentially reach anything in any of
                // the containing scopes. We try to make it work but this isn't possible
                // in some cases.
                //
                // For example, symbols imported using an ESM import are a live binding
                // to the underlying symbol in another file. This is emulated during
                // scope hoisting by erasing the ESM import and just referencing the
                // underlying symbol in the flattened bundle directly. However, that
                // symbol may have a different name which could break uses of direct
                // eval:
                //
                //   // Before bundling
                //   import { foo as bar } from './foo.js'
                //   console.log(eval('bar'))
                //
                //   // After bundling
                //   let foo = 123 // The contents of "foo.js"
                //   console.log(eval('bar'))
                //
                // There really isn't any way to fix this. You can't just rename "foo" to
                // "bar" in the example above because there may be a third bundled file
                // that also contains direct eval and imports the same symbol with a
                // different conflicting import alias. And there is no way to store a
                // live binding to the underlying symbol in a variable with the import's
                // name so that direct eval can access it:
                //
                //   // After bundling
                //   let foo = 123 // The contents of "foo.js"
                //   const bar = /* cannot express a live binding to "foo" here */
                //   console.log(eval('bar'))
                //
                // Technically a "with" statement could potentially make this work (with
                // a big hit to performance), but they are deprecated and are unavailable
                // in strict mode. This is a non-starter since all ESM code is strict mode.
                //
                // So while we still try to obey the requirement that all symbol names are
                // pinned when direct eval is present, we make an exception for top-level
                // symbols in an ESM file when bundling is enabled. We make no guarantee
                // that "eval" will be able to reach these symbols and we allow them to be
                // renamed or removed by tree shaking.
                // if (p.currentScope.parent == null and p.has_es_module_syntax) {
                //     continue;
                // }

                self.symbols[member.1.ref_.inner_index() as usize].must_not_be_renamed = true;
            }
        }

        self.current_scope = current_scope.parent.unwrap_or_else(|| {
            self.panic(
                "Internal error: attempted to call popScope() on the topmost scope",
                format_args!(""),
            )
        });
    }

    pub fn mark_expr_as_parenthesized(&mut self, expr: &mut Expr) {
        match &mut expr.data {
            js_ast::ExprData::EArray(ex) => ex.is_parenthesized = true,
            js_ast::ExprData::EObject(ex) => ex.is_parenthesized = true,
            _ => {}
        }
    }

    #[cold]
    pub fn panic(&mut self, fmt: &'static str, args: core::fmt::Arguments) -> ! {
        // TODO(port): forward to panic_loc once that un-gates (needs log.print(&mut [u8])).
        Output::panic(format_args!("{}\n{}", fmt, args));
    }

    #[cold]
    #[inline(never)]
    pub fn panic_loc(
        &mut self,
        fmt: &'static str,
        args: core::fmt::Arguments,
        loc: Option<bun_ast::Loc>,
    ) -> ! {
        // PORT NOTE: Zig used a fixed `std.Io.Writer` over a 32 KiB stack buffer.
        // Rust's `Log::print` takes `IntoLogWrite` (`fmt::Write`), so write into a
        // bump-backed `String` instead — same single contiguous text output.
        let mut panic_stream = bun_alloc::ArenaString::with_capacity_in(32 * 1024, self.arena);

        // panic during visit pass leaves the lexer at the end, which
        // would make this location absolutely useless.
        let location = loc.unwrap_or_else(|| self.lexer.loc());
        if (location.start as usize) < self.lexer.source.contents.len() && !location.is_empty() {
            let _ = self.log().add_range_error_fmt(
                Some(self.source),
                bun_ast::Range {
                    loc: location,
                    ..Default::default()
                },
                format_args!("panic here"),
            );
        }

        self.log().level = bun_ast::Level::Verbose;
        let _ = self.log().print(&mut panic_stream);

        Output::panic(format_args!("{}\n{}{}", fmt, args, panic_stream.as_str()));
    }

    pub fn jsx_strings_to_member_expression(
        &mut self,
        loc: bun_ast::Loc,
        parts: &[&'a [u8]],
    ) -> Result<Expr, bun_core::Error> {
        let result = self.find_symbol(loc, parts[0])?;

        let value = self.handle_identifier(
            loc,
            E::Identifier::init(result.r#ref)
                .with_must_keep_due_to_with_stmt(result.is_inside_with_scope)
                .with_can_be_removed_if_unused(true),
            Some(parts[0]),
            IdentifierOpts::new().with_was_originally_identifier(true),
        );
        if parts.len() > 1 {
            return Ok(self.member_expression(loc, value, &parts[1..]));
        }

        Ok(value)
    }

    fn member_expression(
        &mut self,
        loc: bun_ast::Loc,
        initial_value: Expr,
        parts: &[&'a [u8]],
    ) -> Expr {
        let mut value = initial_value;

        for part in parts {
            if let Some(rewrote) = self.maybe_rewrite_property_access(
                loc,
                value,
                part,
                loc,
                // Zig: `.{ .is_call_target = false, .assign_target = .none, .is_delete_target = false }`
                // — all defaults on the packed-u8 IdentifierOpts.
                IdentifierOpts::default(),
            ) {
                value = rewrote;
            } else {
                value = self.new_expr(
                    E::Dot {
                        target: value,
                        name: (*part).into(),
                        name_loc: loc,
                        can_be_removed_if_unused: self.options.features.dead_code_elimination,
                        ..Default::default()
                    },
                    loc,
                );
            }
        }

        value
    }

    pub fn will_need_binding_pattern(&self) -> bool {
        match self.lexer.token {
            // "[a] = b;"
            js_lexer::T::TEquals => true,
            // "for ([a] in b) {}"
            js_lexer::T::TIn => !self.allow_in,
            // "for ([a] of b) {}"
            js_lexer::T::TIdentifier => !self.allow_in && self.lexer.is_contextual_keyword(b"of"),
            _ => false,
        }
    }

    pub fn append_part(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
        stmts: &'a mut [Stmt],
    ) -> Result<(), bun_core::Error> {
        // Reuse the memory if possible
        // This is reusable if the last part turned out to be dead
        self.symbol_uses.clear_retaining_capacity();
        self.declared_symbols.clear_retaining_capacity();
        self.scopes_for_current_part.clear();
        self.import_records_for_current_part.clear();
        self.import_symbol_property_uses.clear_retaining_capacity();

        self.had_commonjs_named_exports_this_visit = false;

        let arena = self.arena;
        let mut opts = PrependTempRefsOpts::default();
        let mut part_stmts = bun_alloc::vec_from_iter_in(stmts.iter().copied(), arena);
        // PORT NOTE: Zig used ListManaged.fromOwnedSlice; we copy into a bump vec.

        self.visit_stmts_and_prepend_temp_refs(&mut part_stmts, &mut opts)?;

        // Insert any relocated variable statements now
        if !self.relocated_top_level_vars.is_empty() {
            let mut already_declared = RefMap::default();
            // PERF(port): was stack-fallback alloc — profile in Phase B

            for i in 0..self.relocated_top_level_vars.len() {
                // Follow links because "var" declarations may be merged due to hoisting
                let mut local = self.relocated_top_level_vars[i];
                while let Some(ref_) = local.ref_ {
                    let symbol = &self.symbols[ref_.inner_index() as usize];
                    if !symbol.has_link() {
                        break;
                    }
                    local.ref_ = Some(symbol.link.get());
                }
                self.relocated_top_level_vars[i] = local;
                let Some(ref_) = local.ref_ else { continue };
                let declaration_entry = already_declared.get_or_put(ref_)?;
                if !declaration_entry.found_existing {
                    let mut decls = bun_alloc::AstAlloc::vec();
                    VecExt::append(
                        &mut decls,
                        Decl {
                            binding: self.b(js_ast::b::Identifier { r#ref: ref_ }, local.loc),
                            value: None,
                        },
                    );
                    part_stmts.push(self.s(
                        S::Local {
                            decls,
                            ..Default::default()
                        },
                        local.loc,
                    ));
                    self.declared_symbols.append(DeclaredSymbol {
                        ref_,
                        is_top_level: true,
                    })?;
                }
            }
            self.relocated_top_level_vars.clear();
        }

        if !part_stmts.is_empty() {
            // SAFETY: `into_bump_slice_mut` leaks the BumpVec into the arena and
            // returns the unique `&'a mut [T]` for that allocation. We compute
            // `can_be_removed_if_unused` while the `&mut` is live (reborrowed as
            // shared), then decay it to a raw `*mut` for storage in `Part` so no
            // outstanding `&mut` aliases the stored pointer afterwards.
            let final_stmts = bun_ast::StoreSlice::from_bump(part_stmts);
            let can_be_removed_if_unused = self.stmts_can_be_removed_if_unused(final_stmts.slice());

            parts.push(js_ast::Part {
                stmts: final_stmts,
                symbol_uses: core::mem::take(&mut self.symbol_uses),
                import_symbol_property_uses: core::mem::take(&mut self.import_symbol_property_uses),
                declared_symbols: self.declared_symbols.to_owned_slice(),
                import_record_indices: {
                    let v = core::mem::replace(
                        &mut self.import_records_for_current_part,
                        BumpVec::new_in(self.arena),
                    );
                    v.as_slice().to_vec()
                },
                // SAFETY: fresh bump allocation, uniquely owned by the new Part.
                scopes: bun_ast::StoreSlice::new_mut(
                    core::mem::replace(
                        &mut self.scopes_for_current_part,
                        BumpVec::new_in(self.arena),
                    )
                    .into_bump_slice_mut(),
                ),
                can_be_removed_if_unused,
                tag: if self.had_commonjs_named_exports_this_visit {
                    bun_ast::PartTag::CommonjsNamedExport
                } else {
                    bun_ast::PartTag::None
                },
                ..Default::default()
            });
            // `symbol_uses` / `import_symbol_property_uses` were already reset
            // to empty by `core::mem::take` above; no second assignment needed.
            self.had_commonjs_named_exports_this_visit = false;
        } else if self.declared_symbols.len() > 0 || self.symbol_uses.count() > 0 {
            // if the part is dead, invalidate all the usage counts
            self.clear_symbol_usages_from_dead_part(&js_ast::Part {
                declared_symbols: self.declared_symbols.clone()?,
                symbol_uses: self.symbol_uses.clone()?,
                ..Default::default()
            });
            self.declared_symbols.clear_retaining_capacity();
            self.import_records_for_current_part.clear();
        }
        Ok(())
    }

    // PORT NOTE: Zig p.zig:3719 declares `bindingCanBeRemovedIfUnused` (the
    // DCE-gated wrapper) but never calls it — every caller goes through
    // `stmtsCanBeRemovedIfUnused` which already gates on
    // `dead_code_elimination` and then invokes the `_without_dce_check`
    // recursion below. The wrapper is dead in spec and is dropped here.
    fn binding_can_be_removed_if_unused_without_dce_check(&mut self, binding: Binding) -> bool {
        match binding.data {
            js_ast::b::B::BArray(bi) => {
                for item in bi.items.slice() {
                    if !self.binding_can_be_removed_if_unused_without_dce_check(item.binding) {
                        return false;
                    }
                    if let Some(default) = &item.default_value {
                        if !self.expr_can_be_removed_if_unused_without_dce_check(default) {
                            return false;
                        }
                    }
                }
            }
            js_ast::b::B::BObject(bi) => {
                for property in bi.properties.slice() {
                    if !property.flags.contains(Flags::Property::IsSpread)
                        && !self.expr_can_be_removed_if_unused_without_dce_check(&property.key)
                    {
                        return false;
                    }
                    if !self.binding_can_be_removed_if_unused_without_dce_check(property.value) {
                        return false;
                    }
                    if let Some(default) = &property.default_value {
                        if !self.expr_can_be_removed_if_unused_without_dce_check(default) {
                            return false;
                        }
                    }
                }
            }
            _ => {}
        }
        true
    }

    fn stmts_can_be_removed_if_unused(&mut self, stmts: &[Stmt]) -> bool {
        if !self.options.features.dead_code_elimination {
            return false;
        }
        self.stmts_can_be_removed_if_unused_without_dce_check(stmts)
    }

    fn stmts_can_be_removed_if_unused_without_dce_check(&mut self, stmts: &[Stmt]) -> bool {
        for stmt in stmts {
            match &stmt.data {
                // These never have side effects
                js_ast::StmtData::SFunction(_) | js_ast::StmtData::SEmpty(_) => {}

                // Let these be removed if they are unused. Note that we also need to
                // check if the imported file is marked as "sideEffects: false" before we
                // can remove a SImport statement. Otherwise the import must be kept for
                // its side effects.
                js_ast::StmtData::SImport(_) => {}

                js_ast::StmtData::SClass(st) => {
                    if !self.class_can_be_removed_if_unused(&st.class) {
                        return false;
                    }
                }

                js_ast::StmtData::SExpr(st) => {
                    if st.does_not_affect_tree_shaking {
                        // Expressions marked with this are automatically generated and have
                        // no side effects by construction.
                        continue;
                    }
                    if !self.expr_can_be_removed_if_unused_without_dce_check(&st.value) {
                        return false;
                    }
                }

                js_ast::StmtData::SLocal(st) => {
                    // "await" is a side effect because it affects code timing
                    if st.kind == js_ast::s::Kind::KAwaitUsing {
                        return false;
                    }

                    for decl in st.decls.slice() {
                        if !self.binding_can_be_removed_if_unused_without_dce_check(decl.binding) {
                            return false;
                        }
                        if let Some(decl_value) = &decl.value {
                            if !self.expr_can_be_removed_if_unused_without_dce_check(decl_value) {
                                return false;
                            } else if st.kind == js_ast::s::Kind::KUsing {
                                // "using" declarations are only side-effect free if they are initialized to null or undefined
                                if !matches!(
                                    decl_value.data,
                                    js_ast::ExprData::ENull(_) | js_ast::ExprData::EUndefined(_)
                                ) {
                                    return false;
                                }
                            }
                        }
                    }
                }

                js_ast::StmtData::STry(try_) => {
                    // arena-owned `StoreSlice<Stmt>` valid for parser 'a; no aliasing &mut outstanding
                    if !self.stmts_can_be_removed_if_unused_without_dce_check(try_.body.slice())
                        || (try_.finally.is_some()
                            && !self.stmts_can_be_removed_if_unused_without_dce_check(
                                try_.finally.as_ref().unwrap().stmts.slice(),
                            ))
                    {
                        return false;
                    }
                }

                // Exports are tracked separately, so this isn't necessary
                js_ast::StmtData::SExportClause(_) | js_ast::StmtData::SExportFrom(_) => {}

                js_ast::StmtData::SExportDefault(st) => match &st.value {
                    js_ast::StmtOrExpr::Stmt(s2) => match &s2.data {
                        js_ast::StmtData::SExpr(s_expr) => {
                            if !self.expr_can_be_removed_if_unused_without_dce_check(&s_expr.value)
                            {
                                return false;
                            }
                        }
                        // These never have side effects
                        js_ast::StmtData::SFunction(_) => {}
                        js_ast::StmtData::SClass(sc) => {
                            if !self.class_can_be_removed_if_unused(&sc.class) {
                                return false;
                            }
                        }
                        _ => {
                            // Standard decorator lowering can produce non-class
                            // statements as the export default value; conservatively
                            // assume they have side effects.
                            return false;
                        }
                    },
                    js_ast::StmtOrExpr::Expr(exp) => {
                        if !self.expr_can_be_removed_if_unused_without_dce_check(exp) {
                            return false;
                        }
                    }
                },

                _ => {
                    // Assume that all statements not explicitly special-cased here have side
                    // effects, and cannot be removed even if unused
                    return false;
                }
            }
        }
        true
    }

    pub fn deoptimize_common_js_named_exports(&mut self) {
        // exists for debugging
        self.commonjs_named_exports_deoptimized = true;
    }

    pub fn maybe_keep_expr_symbol_name(
        &mut self,
        expr: Expr,
        original_name: &'a [u8],
        was_anonymous_named_expr: bool,
    ) -> Expr {
        if was_anonymous_named_expr {
            self.keep_expr_symbol_name(expr, original_name)
        } else {
            expr
        }
    }

    pub fn value_for_this(&mut self, loc: bun_ast::Loc) -> Option<Expr> {
        // Substitute "this" if we're inside a static class property initializer
        if self
            .fn_only_data_visit
            .should_replace_this_with_class_name_ref
        {
            // class_name_ref is `Option<&'a Cell<Ref>>` (arena slot owned by the enclosing
            // `visit_class` frame); copy the Ref out so the field borrow is released before
            // record_usage/new_expr.
            if let Some(r) = self.fn_only_data_visit.class_name_ref.map(|c| c.get()) {
                self.record_usage(r);
                return Some(self.new_expr(
                    E::Identifier {
                        ref_: r,
                        ..Default::default()
                    },
                    loc,
                ));
            }
        }

        // oroigianlly was !=- modepassthrough
        if !self.fn_only_data_visit.is_this_nested {
            if self.has_es_module_syntax && self.commonjs_named_exports.count() == 0 {
                // In an ES6 module, "this" is supposed to be undefined. Instead of
                // doing this at runtime using "fn.call(undefined)", we do it at
                // compile time using expression substitution here.
                return Some(Expr {
                    loc,
                    data: null_value_expr(),
                });
            } else {
                // In a CommonJS module, "this" is supposed to be the same as "exports".
                // Instead of doing this at runtime using "fn.call(module.exports)", we
                // do it at compile time using expression substitution here.
                let exports_ref = self.exports_ref;
                self.record_usage(exports_ref);
                self.deoptimize_common_js_named_exports();
                return Some(self.new_expr(
                    E::Identifier {
                        ref_: exports_ref,
                        ..Default::default()
                    },
                    loc,
                ));
            }
        }

        None
    }

    // PERF(port): takes `&Expr` — the Zig original passes `Expr` by value (cheap there:
    // `Expr` is `{ *Data, Loc }` = 16B), but Rust's `Expr` inlines `ExprData` so a by-value
    // pass copies the full union. The only caller (`visit_expr_in_out`) already holds `&mut Expr`.
    pub fn is_valid_assignment_target(&self, expr: &Expr) -> bool {
        match &expr.data {
            js_ast::ExprData::EIdentifier(ident) => {
                !is_eval_or_arguments(self.load_name_from_ref(ident.ref_))
            }
            js_ast::ExprData::EDot(e) => e.optional_chain.is_none(),
            js_ast::ExprData::EIndex(e) => e.optional_chain.is_none(),
            js_ast::ExprData::EArray(e) => !e.is_parenthesized,
            js_ast::ExprData::EObject(e) => !e.is_parenthesized,
            _ => false,
        }
    }

    /// This is only allowed to be called if allow_runtime is true
    /// If --target=bun, this does nothing.
    pub fn record_usage_of_runtime_require(&mut self) {
        // target bun does not have __require
        if self.options.features.auto_polyfill_require {
            debug_assert!(self.options.features.allow_runtime);
            self.ensure_require_symbol();
            let r = self.runtime_identifier_ref(bun_ast::Loc::EMPTY, b"__require");
            self.record_usage(r);
        }
    }

    pub fn ignore_usage_of_runtime_require(&mut self) {
        if self.options.features.auto_polyfill_require {
            debug_assert!(self.runtime_imports.__require.is_some());
            let r = self.runtime_identifier_ref(bun_ast::Loc::EMPTY, b"__require");
            self.ignore_usage(r);
            self.symbols[self.require_ref.inner_index() as usize].use_count_estimate = self.symbols
                [self.require_ref.inner_index() as usize]
                .use_count_estimate
                .saturating_sub(1);
        }
    }

    #[inline]
    pub fn value_for_require(&self, loc: bun_ast::Loc) -> Expr {
        debug_assert!(!self.is_source_runtime());
        Expr {
            data: js_ast::ExprData::ERequireCallTarget,
            loc,
        }
    }

    #[inline]
    pub fn value_for_import_meta_main(&mut self, inverted: bool, loc: bun_ast::Loc) -> Expr {
        if let Some(known) = self.options.import_meta_main_value {
            return Expr {
                loc,
                data: js_ast::ExprData::EBoolean(E::Boolean {
                    value: if inverted { !known } else { known },
                }),
            };
        }
        // Node.js does not have import.meta.main, so we end up lowering
        // this to `require.main === module`, but with the ESM format,
        // both `require` and `module` are not present, so the code
        // generation we need is:
        //
        //     import { createRequire } from "node:module";
        //     var __require = createRequire(import.meta.url);
        //     var import_meta_main = __require.main === __require.module;
        //
        // The printer can handle this for us, but we need to reference
        // a handle to the `__require` function.
        if self.options.lower_import_meta_main_for_node_js {
            self.record_usage_of_runtime_require();
        }
        Expr {
            loc,
            data: js_ast::ExprData::EImportMetaMain(E::ImportMetaMain { inverted }),
        }
    }

    pub fn keep_expr_symbol_name(&mut self, _value: Expr, _name: &[u8]) -> Expr {
        _value
        // var start = p.expr_list.items.len;
        // p.expr_list.ensureUnusedCapacity(2) catch unreachable;
        // p.expr_list.appendAssumeCapacity(_value);
        // p.expr_list.appendAssumeCapacity(p.newExpr(E.String{
        //     .utf8 = name,
        // }, _value.loc));

        // var value = p.callRuntime(_value.loc, "ℹ", p.expr_list.items[start..p.expr_list.items.len]);
        // // Make sure tree shaking removes this if the function is never used
        // value.getCall().can_be_unwrapped_if_unused = true;
        // return value;
    }

    pub fn is_simple_parameter_list(args: &[G::Arg], has_rest_arg: bool) -> bool {
        if has_rest_arg {
            return false;
        }
        for arg in args {
            if !matches!(arg.binding.data, js_ast::b::B::BIdentifier(_)) || arg.default.is_some() {
                return false;
            }
        }
        true
    }

    // This one is never called in places that haven't already checked if DCE is enabled.
    pub fn class_can_be_removed_if_unused(&mut self, class: &G::Class) -> bool {
        if let Some(extends) = &class.extends {
            if !self.expr_can_be_removed_if_unused_without_dce_check(extends) {
                return false;
            }
        }

        // arena-owned `StoreSlice<Property>` valid for parser 'a; no aliasing &mut outstanding
        for property in class.properties.iter() {
            if property.kind == js_ast::g::PropertyKind::ClassStaticBlock {
                let csb = property.class_static_block_ref().unwrap();
                if !self.stmts_can_be_removed_if_unused_without_dce_check(csb.stmts.slice()) {
                    return false;
                }
                continue;
            }

            if !self.expr_can_be_removed_if_unused_without_dce_check(
                property.key.as_ref().expect("unreachable"),
            ) {
                return false;
            }

            if let Some(val) = &property.value {
                if !self.expr_can_be_removed_if_unused_without_dce_check(val) {
                    return false;
                }
            }

            if let Some(val) = &property.initializer {
                if !self.expr_can_be_removed_if_unused_without_dce_check(val) {
                    return false;
                }
            }
        }

        true
    }

    // TODO:
    // When React Fast Refresh is enabled, anything that's a JSX component should not be removable
    // This is to improve the reliability of fast refresh between page loads.
    pub fn expr_can_be_removed_if_unused(&mut self, expr: &Expr) -> bool {
        if !self.options.features.dead_code_elimination {
            return false;
        }
        self.expr_can_be_removed_if_unused_without_dce_check(expr)
    }

    fn expr_can_be_removed_if_unused_without_dce_check(&mut self, expr: &Expr) -> bool {
        match &expr.data {
            js_ast::ExprData::ENull(_)
            | js_ast::ExprData::EUndefined(_)
            | js_ast::ExprData::EMissing(_)
            | js_ast::ExprData::EBoolean(_)
            | js_ast::ExprData::EBranchBoolean(_)
            | js_ast::ExprData::ENumber(_)
            | js_ast::ExprData::EBigInt(_)
            | js_ast::ExprData::EString(_)
            | js_ast::ExprData::EThis(_)
            | js_ast::ExprData::ERegExp(_)
            | js_ast::ExprData::EFunction(_)
            | js_ast::ExprData::EArrow(_)
            | js_ast::ExprData::EImportMeta(_) => return true,

            js_ast::ExprData::EInlinedEnum(e) => {
                return self.expr_can_be_removed_if_unused_without_dce_check(&e.value);
            }

            js_ast::ExprData::EDot(ex) => return ex.can_be_removed_if_unused,
            js_ast::ExprData::EClass(ex) => return self.class_can_be_removed_if_unused(&**ex),
            js_ast::ExprData::EIdentifier(ex) => {
                debug_assert!(!ex.ref_.is_source_contents_slice()); // was not visited

                if ex.must_keep_due_to_with_stmt() {
                    return false;
                }

                // Unbound identifiers cannot be removed because they can have side effects.
                // One possible side effect is throwing a ReferenceError if they don't exist.
                // Another one is a getter with side effects on the global object:
                //
                //   Object.defineProperty(globalThis, 'x', {
                //     get() {
                //       sideEffect();
                //     },
                //   });
                //
                // Be very careful about this possibility. It's tempting to treat all
                // identifier expressions as not having side effects but that's wrong. We
                // must make sure they have been declared by the code we are currently
                // compiling before we can tell that they have no side effects.
                //
                // Note that we currently ignore ReferenceErrors due to TDZ access. This is
                // incorrect but proper TDZ analysis is very complicated and would have to
                // be very conservative, which would inhibit a lot of optimizations of code
                // inside closures. This may need to be revisited if it proves problematic.
                if ex.can_be_removed_if_unused()
                    || self.symbols[ex.ref_.inner_index() as usize].kind
                        != js_ast::symbol::Kind::Unbound
                {
                    return true;
                }
            }
            js_ast::ExprData::ECommonjsExportIdentifier(_)
            | js_ast::ExprData::EImportIdentifier(_) => {
                // References to an ES6 import item are always side-effect free in an
                // ECMAScript environment.
                //
                // They could technically have side effects if the imported module is a
                // CommonJS module and the import item was translated to a property access
                // (which esbuild's bundler does) and the property has a getter with side
                // effects.
                //
                // But this is very unlikely and respecting this edge case would mean
                // disabling tree shaking of all code that references an export from a
                // CommonJS module. It would also likely violate the expectations of some
                // developers because the code *looks* like it should be able to be tree
                // shaken.
                //
                // So we deliberately ignore this edge case and always treat import item
                // references as being side-effect free.
                return true;
            }
            js_ast::ExprData::EIf(ex) => {
                return self.expr_can_be_removed_if_unused_without_dce_check(&ex.test_)
                    && (self.is_side_effect_free_unbound_identifier_ref(ex.yes, ex.test_, true)
                        || self.expr_can_be_removed_if_unused_without_dce_check(&ex.yes))
                    && (self.is_side_effect_free_unbound_identifier_ref(ex.no, ex.test_, false)
                        || self.expr_can_be_removed_if_unused_without_dce_check(&ex.no));
            }
            js_ast::ExprData::EArray(ex) => {
                for item in ex.items.slice() {
                    if !self.expr_can_be_removed_if_unused_without_dce_check(item) {
                        return false;
                    }
                }
                return true;
            }
            js_ast::ExprData::EObject(ex) => {
                for property in ex.properties.slice() {
                    // The key must still be evaluated if it's computed or a spread
                    if property.kind == js_ast::g::PropertyKind::Spread
                        || (property.flags.contains(Flags::Property::IsComputed)
                            && !property
                                .key
                                .as_ref()
                                .map(Expr::is_primitive_literal)
                                .unwrap_or(false))
                        || property.flags.contains(Flags::Property::IsSpread)
                    {
                        return false;
                    }
                    if let Some(val) = &property.value {
                        if !self.expr_can_be_removed_if_unused_without_dce_check(val) {
                            return false;
                        }
                    }
                }
                return true;
            }
            js_ast::ExprData::ECall(ex) => {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if ex.can_be_unwrapped_if_unused != js_ast::CanBeUnwrapped::Never {
                    for arg in ex.args.slice() {
                        if !(self.expr_can_be_removed_if_unused_without_dce_check(arg)
                            || (ex.can_be_unwrapped_if_unused
                                == js_ast::CanBeUnwrapped::IfUnusedAndToStringSafe
                                && arg.data.is_safe_to_string()))
                        {
                            return false;
                        }
                    }
                    return true;
                }
            }
            js_ast::ExprData::ENew(ex) => {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if ex.can_be_unwrapped_if_unused != js_ast::CanBeUnwrapped::Never {
                    for arg in ex.args.slice() {
                        if !(self.expr_can_be_removed_if_unused_without_dce_check(arg)
                            || (ex.can_be_unwrapped_if_unused
                                == js_ast::CanBeUnwrapped::IfUnusedAndToStringSafe
                                && arg.data.is_safe_to_string()))
                        {
                            return false;
                        }
                    }
                    return true;
                }
            }
            js_ast::ExprData::EUnary(ex) => match ex.op {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                js_ast::op::Code::UnVoid | js_ast::op::Code::UnNot => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.value);
                }

                // The "typeof" operator doesn't do any type conversions so it can be removed
                // if the result is unused and the operand has no side effects. However, it
                // has a special case where if the operand is an identifier expression such
                // as "typeof x" and "x" doesn't exist, no reference error is thrown so the
                // operation has no side effects.
                //
                // Note that there *is* actually a case where "typeof x" can throw an error:
                // when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
                // checks are not yet handled correctly by bun or esbuild, so this possibility is
                // currently ignored.
                js_ast::op::Code::UnTypeof => {
                    if matches!(ex.value.data, js_ast::ExprData::EIdentifier(_))
                        && ex
                            .flags
                            .contains(E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER)
                    {
                        return true;
                    }
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.value);
                }
                _ => {}
            },
            js_ast::ExprData::EBinary(ex) => match ex.op {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                js_ast::op::Code::BinStrictEq
                | js_ast::op::Code::BinStrictNe
                | js_ast::op::Code::BinComma
                | js_ast::op::Code::BinNullishCoalescing => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && self.expr_can_be_removed_if_unused_without_dce_check(&ex.right);
                }
                // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
                js_ast::op::Code::BinLogicalOr => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && (self
                            .is_side_effect_free_unbound_identifier_ref(ex.right, ex.left, false)
                            || self.expr_can_be_removed_if_unused_without_dce_check(&ex.right));
                }
                // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
                js_ast::op::Code::BinLogicalAnd => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && (self
                            .is_side_effect_free_unbound_identifier_ref(ex.right, ex.left, true)
                            || self.expr_can_be_removed_if_unused_without_dce_check(&ex.right));
                }
                // For "==" and "!=", pretend the operator was actually "===" or "!==". If
                // we know that we can convert it to "==" or "!=", then we can consider the
                // operator itself to have no side effects. This matters because our mangle
                // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
                // and since "typeof x === 'object'" is considered to be side-effect free,
                // we must also consider "typeof x == 'object'" to be side-effect free.
                js_ast::op::Code::BinLooseEq | js_ast::op::Code::BinLooseNe => {
                    return crate::scan::scan_side_effects::SideEffects::can_change_strict_to_loose(
                        &ex.left.data,
                        &ex.right.data,
                    ) && self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && self.expr_can_be_removed_if_unused_without_dce_check(&ex.right);
                }
                // Special-case "<" and ">" with string, number, or bigint arguments
                js_ast::op::Code::BinLt
                | js_ast::op::Code::BinGt
                | js_ast::op::Code::BinLe
                | js_ast::op::Code::BinGe => {
                    let left = ex.left.data.known_primitive();
                    let right = ex.right.data.known_primitive();
                    match left {
                        js_ast::KnownPrimitive::String
                        | js_ast::KnownPrimitive::Number
                        | js_ast::KnownPrimitive::Bigint => {
                            return right == left
                                && self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                                && self.expr_can_be_removed_if_unused_without_dce_check(&ex.right);
                        }
                        _ => {}
                    }
                }
                _ => {}
            },
            js_ast::ExprData::ETemplate(templ) => {
                if templ.tag.is_none() {
                    for part in templ.parts().iter() {
                        if !self.expr_can_be_removed_if_unused_without_dce_check(&part.value)
                            || part.value.data.known_primitive() == js_ast::KnownPrimitive::Unknown
                        {
                            return false;
                        }
                    }
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    // (Zig commented-out `exprCanBeHoistedForJSX` omitted — was already dead code.)

    fn is_side_effect_free_unbound_identifier_ref(
        &mut self,
        value: Expr,
        guard_condition: Expr,
        is_yes_branch_: bool,
    ) -> bool {
        let js_ast::ExprData::EIdentifier(id) = value.data else {
            return false;
        };
        if self.symbols[id.ref_.inner_index() as usize].kind != js_ast::symbol::Kind::Unbound {
            return false;
        }
        let js_ast::ExprData::EBinary(binary) = guard_condition.data else {
            return false;
        };
        let mut is_yes_branch = is_yes_branch_;

        match binary.op {
            js_ast::op::Code::BinStrictEq
            | js_ast::op::Code::BinStrictNe
            | js_ast::op::Code::BinLooseEq
            | js_ast::op::Code::BinLooseNe => {
                // typeof x !== 'undefined'
                let mut typeof_: js_ast::ExprData = binary.left.data;
                let mut compare: js_ast::ExprData = binary.right.data;
                // typeof 'undefined' !== x
                if matches!(typeof_, js_ast::ExprData::EString(_)) {
                    typeof_ = binary.right.data;
                    compare = binary.left.data;
                }

                // this order because Expr.Data Tag is not a pointer
                // so it should be slightly faster to compare
                let js_ast::ExprData::EString(compare_str) = compare else {
                    return false;
                };
                let js_ast::ExprData::EUnary(unary) = typeof_ else {
                    return false;
                };

                if unary.op != js_ast::op::Code::UnTypeof {
                    return false;
                }
                let js_ast::ExprData::EIdentifier(id2) = unary.value.data else {
                    return false;
                };

                ((compare_str.eql_comptime(b"undefined") == is_yes_branch)
                    == (binary.op == js_ast::op::Code::BinStrictNe
                        || binary.op == js_ast::op::Code::BinLooseNe))
                    && id.ref_.eql(id2.ref_)
            }
            js_ast::op::Code::BinLt
            | js_ast::op::Code::BinGt
            | js_ast::op::Code::BinLe
            | js_ast::op::Code::BinGe => {
                // Pattern match for "typeof x < <string>"
                let mut typeof_: js_ast::ExprData = binary.left.data;
                let mut str_: js_ast::ExprData = binary.right.data;

                // Check if order is flipped: 'u' >= typeof x
                if matches!(typeof_, js_ast::ExprData::EString(_)) {
                    typeof_ = binary.right.data;
                    str_ = binary.left.data;
                    is_yes_branch = !is_yes_branch;
                }

                if let (js_ast::ExprData::EUnary(unary), js_ast::ExprData::EString(s)) =
                    (typeof_, str_)
                {
                    if unary.op == js_ast::op::Code::UnTypeof
                        && unary
                            .flags
                            .contains(E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER)
                        && s.eql_comptime(b"u")
                    {
                        if let js_ast::ExprData::EIdentifier(id2) = unary.value.data {
                            // In "typeof x < 'u' ? x : null", the reference to "x" is side-effect free
                            // In "typeof x > 'u' ? x : null", the reference to "x" is side-effect free
                            if is_yes_branch
                                == (binary.op == js_ast::op::Code::BinLt
                                    || binary.op == js_ast::op::Code::BinLe)
                                && id.ref_.eql(id2.ref_)
                            {
                                return true;
                            }
                        }
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn jsx_import_automatic(&mut self, loc: bun_ast::Loc, is_static: bool) -> Expr {
        self.jsx_import(
            if is_static
                && !self.options.jsx.development
                && bun_core::feature_flags::SUPPORT_JSXS_IN_JSX_TRANSFORM
            {
                JSXImport::Jsxs
            } else if self.options.jsx.development {
                JSXImport::JsxDEV
            } else {
                JSXImport::Jsx
            },
            loc,
        )
    }

    pub fn jsx_import(&mut self, kind: JSXImport, loc: bun_ast::Loc) -> Expr {
        // TODO(port): Zig used `switch (kind) { inline else => |field| ... @tagName(field) }`.
        // We replicate via tag_name() helper on the enum.
        let ref_: Ref = match self.jsx_imports.get_with_tag(kind) {
            Some(existing) => existing,
            None => {
                let symbol_name = kind.tag_name();
                let new_ref = self
                    .declare_generated_symbol(js_ast::symbol::Kind::Other, symbol_name)
                    .expect("unreachable");
                let loc_ref = LocRef {
                    loc,
                    ref_: Some(new_ref),
                };
                VecExt::append(&mut self.module_scope_mut().generated, new_ref);
                self.is_import_item.insert(new_ref, ());
                self.jsx_imports.set(kind, loc_ref);
                new_ref
            }
        };

        self.record_usage(ref_);
        self.handle_identifier(
            loc,
            E::Identifier::init(ref_)
                .with_can_be_removed_if_unused(true)
                .with_call_can_be_unwrapped_if_unused(true),
            None,
            IdentifierOpts::new().with_was_originally_identifier(true),
        )
    }

    pub fn select_local_kind(&self, kind: js_ast::s::Kind) -> js_ast::s::Kind {
        // Use "var" instead of "let" and "const" if the variable declaration may
        // need to be separated from the initializer. This allows us to safely move
        // this declaration into a nested scope.
        if (self.options.bundle || self.will_wrap_module_in_try_catch_for_using)
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            && self.current_scope().parent.is_none()
            && !kind.is_using()
        {
            return js_ast::s::Kind::KVar;
        }

        // Optimization: use "let" instead of "const" because it's shorter. This is
        // only done when bundling because assigning to "const" is only an error when bundling.
        if self.options.bundle
            && kind == js_ast::s::Kind::KConst
            && self.options.features.minify_syntax
        {
            return js_ast::s::Kind::KLet;
        }

        kind
    }

    pub fn ignore_usage(&mut self, r#ref: Ref) {
        if !self.is_control_flow_dead && !self.is_revisit_for_substitution {
            debug_assert!((r#ref.inner_index() as usize) < self.symbols.len());
            self.symbols[r#ref.inner_index() as usize].use_count_estimate = self.symbols
                [r#ref.inner_index() as usize]
                .use_count_estimate
                .saturating_sub(1);
            let Some(mut use_) = self.symbol_uses.get(&r#ref).copied() else {
                return;
            };
            use_.count_estimate = use_.count_estimate.saturating_sub(1);
            if use_.count_estimate == 0 {
                let _ = self.symbol_uses.swap_remove(&r#ref);
            } else {
                self.symbol_uses.put_assume_capacity(r#ref, use_);
            }
        }

        // Don't roll back the "tsUseCounts" increment. This must be counted even if
        // the value is ignored because that's what the TypeScript compiler does.
    }

    pub fn ignore_usage_of_identifier_in_dot_chain(&mut self, expr: Expr) {
        let mut current = expr;
        loop {
            match &current.data {
                js_ast::ExprData::EIdentifier(id) => {
                    self.ignore_usage(id.ref_);
                }
                js_ast::ExprData::EDot(dot) => {
                    current = dot.target;
                    continue;
                }
                js_ast::ExprData::EIndex(index) => {
                    if index.index.is_string() {
                        current = index.target;
                        continue;
                    }
                }
                _ => return,
            }
            return;
        }
    }

    // blocked_on: options.features.replace_exports type (currently bool placeholder)
    pub fn is_export_to_eliminate(&self, r#ref: Ref) -> bool {
        let symbol_name = self.load_name_from_ref(r#ref);
        self.options.features.replace_exports.contains(symbol_name)
    }

    pub fn inject_replacement_export(
        &mut self,
        stmts: &mut crate::parser::StmtList<'a>,
        name_ref: Ref,
        loc: bun_ast::Loc,
        replacement: &crate::parser::Runtime::ReplaceableExport,
    ) -> bool {
        match replacement {
            crate::parser::Runtime::ReplaceableExport::Delete => false,
            crate::parser::Runtime::ReplaceableExport::Replace(value) => {
                let count = stmts.len();
                let decls = js_ast::g::DeclList::from_slice(&[G::Decl {
                    binding: self.b(B::Identifier { r#ref: name_ref }, loc),
                    value: Some(*value),
                }]);
                let mut local = self.s(
                    S::Local {
                        is_export: true,
                        decls,
                        ..Default::default()
                    },
                    loc,
                );
                self.visit_and_append_stmt(stmts, &mut local)
                    .expect("unreachable");
                count != stmts.len()
            }
            crate::parser::Runtime::ReplaceableExport::Inject { name, value } => {
                let count = stmts.len();
                // PORT NOTE: Zig kept `with.name` as an arena slice; the Rust
                // `ReplaceableExport::Inject` boxes it, so copy into the bump
                // arena to satisfy `declare_symbol`'s `&'a [u8]`.
                let name: &'a [u8] = self.arena.alloc_slice_copy(name);
                let inject_ref = self
                    .declare_symbol(js_ast::symbol::Kind::Other, loc, name)
                    .expect("unreachable");
                let decls = js_ast::g::DeclList::from_slice(&[G::Decl {
                    binding: self.b(B::Identifier { r#ref: inject_ref }, loc),
                    value: Some(*value),
                }]);
                let mut local = self.s(
                    S::Local {
                        is_export: true,
                        decls,
                        ..Default::default()
                    },
                    loc,
                );
                self.visit_and_append_stmt(stmts, &mut local)
                    .expect("unreachable");
                count != stmts.len()
            }
        }
    }

    pub fn replace_decl_and_possibly_remove(
        &mut self,
        decl: &mut G::Decl,
        replacement: &crate::parser::Runtime::ReplaceableExport,
    ) -> bool {
        use crate::parser::Runtime::ReplaceableExport;
        match replacement {
            ReplaceableExport::Delete => false,
            ReplaceableExport::Replace(value) => {
                let mut v = *value;
                self.visit_expr(&mut v);
                decl.value = Some(v);
                true
            }
            ReplaceableExport::Inject { name, value } => {
                let bind_loc = decl.binding.loc;
                let val_loc = decl.value.map(|v| v.loc).unwrap_or(bind_loc);
                // declare_symbol stores the name in the symbol table for the parser lifetime;
                // arena-copy the boxed `name` so it lives for `'a`.
                let name: &'a [u8] = self.arena.alloc_slice_copy(name);
                let r#ref = self
                    .declare_symbol(js_ast::symbol::Kind::Other, bind_loc, name)
                    .expect("unreachable");
                // Preserve pre-refactor evaluation order: original by-value form built the
                // G::Decl struct literal field-order (binding via self.b() first, then
                // visit_expr for value). P::b is a pure arena alloc so the order is not
                // observable today, but keep it mechanical so the &mut refactor stays a
                // semantics-neutral rewrite.
                let binding = self.b(B::Identifier { r#ref }, bind_loc);
                let mut v = Expr {
                    data: value.data,
                    loc: val_loc,
                };
                self.visit_expr(&mut v);
                *decl = G::Decl {
                    binding,
                    value: Some(v),
                };
                true
            }
        }
    }

    #[cold]
    #[inline(never)]
    pub fn mark_exported_decls_inside_namespace(&mut self, ns_ref: Ref, decls: &[G::Decl]) {
        for decl in decls {
            self.mark_exported_binding_inside_namespace(ns_ref, decl.binding);
        }
    }

    pub fn append_if_body_preserving_scope(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        body: Stmt,
    ) -> Result<(), bun_core::Error> {
        if let js_ast::StmtData::SBlock(block) = &body.data {
            // `S::Block.stmts` is `StoreSlice<Stmt>` arena-owned for parser 'a; no aliasing &mut.
            let block_stmts: &[Stmt] = block.stmts.slice();
            let mut keep_block = false;
            for stmt in block_stmts {
                if statement_cares_about_scope(stmt) {
                    keep_block = true;
                    break;
                }
            }
            if !keep_block && !block_stmts.is_empty() {
                stmts.extend_from_slice(block_stmts);
                return Ok(());
            }
        }

        if statement_cares_about_scope(&body) {
            let block_stmts = self.arena.alloc_slice_copy(&[body]);
            stmts.push(self.s(
                S::Block {
                    stmts: block_stmts.into(),
                    close_brace_loc: bun_ast::Loc::EMPTY,
                },
                body.loc,
            ));
            return Ok(());
        }

        stmts.push(body);
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn mark_exported_binding_inside_namespace(&mut self, r#ref: Ref, binding: BindingNodeIndex) {
        match binding.data {
            js_ast::b::B::BMissing(_) => {}
            js_ast::b::B::BIdentifier(ident) => {
                // RefRefMap derefs to std::collections::HashMap; Zig `put(arena, k, v)` → insert.
                self.is_exported_inside_namespace.insert(ident.r#ref, r#ref);
            }
            js_ast::b::B::BArray(array) => {
                for item in array.items.slice() {
                    self.mark_exported_binding_inside_namespace(r#ref, item.binding);
                }
            }
            js_ast::b::B::BObject(obj) => {
                for item in obj.properties.slice() {
                    self.mark_exported_binding_inside_namespace(r#ref, item.value);
                }
            }
        }
    }

    // blocked_on: b(); G::Decl::List; E::Arrow.args slice type; S::SExpr/Return; emitted_namespace_vars.put_no_clobber
    // Large TS namespace/enum lowering body — cold for already-transpiled JS.
    #[cold]
    #[inline(never)]
    pub fn generate_closure_for_type_script_namespace_or_enum(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        stmt_loc: bun_ast::Loc,
        is_export: bool,
        name_loc: bun_ast::Loc,
        original_name_ref: Ref,
        arg_ref: Ref,
        stmts_inside_closure: &'a mut [Stmt],
        all_values_are_pure: bool,
    ) -> Result<(), bun_core::Error> {
        let mut name_ref = original_name_ref;

        // Follow the link chain in case symbols were merged
        let mut symbol = &self.symbols[name_ref.inner_index() as usize];
        while symbol.has_link() {
            let link = symbol.link.get();
            name_ref = link;
            symbol = &self.symbols[name_ref.inner_index() as usize];
        }
        let symbol_kind = symbol.kind;
        let _ = symbol;
        let arena = self.arena;

        // Make sure to only emit a variable once for a given namespace, since there
        // can be multiple namespace blocks for the same namespace
        if (symbol_kind == js_ast::symbol::Kind::TsNamespace
            || symbol_kind == js_ast::symbol::Kind::TsEnum)
            && !self.emitted_namespace_vars.contains_key(&name_ref)
        {
            self.emitted_namespace_vars
                .put_no_clobber(name_ref, ())
                .expect("oom");

            let decls = js_ast::g::DeclList::from_slice(&[G::Decl {
                binding: self.b(B::Identifier { r#ref: name_ref }, name_loc),
                value: None,
            }]);
            let _ = arena;

            if self.enclosing_namespace_arg_ref.is_none() {
                // Top-level namespace: "var"
                stmts.push(self.s(
                    S::Local {
                        kind: js_ast::s::Kind::KVar,
                        decls,
                        is_export,
                        ..Default::default()
                    },
                    stmt_loc,
                ));
            } else {
                // Nested namespace: "let"
                stmts.push(self.s(
                    S::Local {
                        kind: js_ast::s::Kind::KLet,
                        decls,
                        ..Default::default()
                    },
                    stmt_loc,
                ));
            }
        }

        let arg_expr: Expr = 'arg_expr: {
            // TODO: unsupportedJSFeatures.has(.logical_assignment)
            // If the "||=" operator is supported, our minified output can be slightly smaller
            if is_export {
                if let Some(namespace) = self.enclosing_namespace_arg_ref {
                    let name = self.symbols[name_ref.inner_index() as usize].original_name;

                    // "name = (enclosing.name ||= {})"
                    self.record_usage(namespace);
                    self.record_usage(name_ref);
                    let left = self.new_expr(
                        E::Dot {
                            target: Expr::init_identifier(namespace, name_loc),
                            // `Symbol.original_name` is already `StoreStr` (= `E::Str`); plain copy.
                            name,
                            name_loc,
                            ..Default::default()
                        },
                        name_loc,
                    );
                    let right = self.new_expr(E::Object::default(), name_loc);
                    break 'arg_expr Expr::assign(
                        Expr::init_identifier(name_ref, name_loc),
                        self.new_expr(
                            E::Binary {
                                op: js_ast::op::Code::BinLogicalOrAssign,
                                left,
                                right,
                            },
                            name_loc,
                        ),
                    );
                }
            }

            // "name ||= {}"
            self.record_usage(name_ref);
            let right = self.new_expr(E::Object::default(), name_loc);
            self.new_expr(
                E::Binary {
                    op: js_ast::op::Code::BinLogicalOrAssign,
                    left: Expr::init_identifier(name_ref, name_loc),
                    right,
                },
                name_loc,
            )
        };

        // PORT NOTE: `G::Arg` is not `Copy` (contains `Vec<Decorator>`); use
        // `alloc_slice_fill_iter` instead of `alloc_slice_copy`.
        let func_args = bun_ast::StoreSlice::new_mut(arena.alloc_slice_fill_iter([G::Arg {
            binding: self.b(B::Identifier { r#ref: arg_ref }, name_loc),
            ..Default::default()
        }]));

        let args_list = ExprNodeList::init_one(arg_expr);

        let target = 'target: {
            // "(() => { foo() })()" => "(() => foo())()"
            if self.options.features.minify_syntax && stmts_inside_closure.len() == 1 {
                if let js_ast::StmtData::SExpr(se) = &stmts_inside_closure[0].data {
                    let val = se.value;
                    let l = stmts_inside_closure[0].loc;
                    stmts_inside_closure[0] = self.s(S::Return { value: Some(val) }, l);
                }
            }

            break 'target self.new_expr(
                E::Arrow {
                    args: func_args,
                    body: G::FnBody {
                        loc: stmt_loc,
                        stmts: arena.alloc_slice_copy(stmts_inside_closure).into(),
                    },
                    prefer_expr: true,
                    ..Default::default()
                },
                stmt_loc,
            );
        };

        // Call the closure with the name object
        let call = self.new_expr(
            E::Call {
                target,
                args: args_list,
                // TODO: make these fully tree-shakable. this annotation
                // as-is is incorrect.  This would be done by changing all
                // enum wrappers into `var Enum = ...` instead of two
                // separate statements. This way, the @__PURE__ annotation
                // is attached to the variable binding.
                //
                // can_be_unwrapped_if_unused: all_values_are_pure,
                ..Default::default()
            },
            stmt_loc,
        );

        let closure = self.s(
            S::SExpr {
                value: call,
                does_not_affect_tree_shaking: all_values_are_pure,
            },
            stmt_loc,
        );

        stmts.push(closure);
        Ok(())
    }

    // ─── round-G: helpers extracted from the gated round-D/E impl block ───
    // These are leaf utilities (no parse_*/visit_* deps) that block
    // handle_identifier / jsx_import / record_usage_of_runtime_require.

    #[cold]
    #[inline(never)]
    pub fn wrap_inlined_enum(&mut self, value: Expr, comment: &'a [u8]) -> Expr {
        if strings::contains(comment, b"*/") {
            // Don't wrap with a comment
            return value;
        }
        // Wrap with a comment
        let loc = value.loc;
        self.new_expr(
            E::InlinedEnum {
                value,
                comment: comment.into(),
            },
            loc,
        )
    }

    pub fn runtime_identifier_ref(&mut self, _loc: bun_ast::Loc, name: &'static [u8]) -> Ref {
        self.has_called_runtime = true;

        if !self.runtime_imports.contains(name) {
            if !self.options.bundle {
                let generated_symbol = self
                    .declare_generated_symbol(js_ast::symbol::Kind::Other, name)
                    .expect("unreachable");
                self.runtime_imports.put(name, generated_symbol);
                generated_symbol
            } else {
                let ref_ = self
                    .new_symbol(js_ast::symbol::Kind::Other, name)
                    .expect("unreachable");
                self.runtime_imports.put(name, ref_);
                VecExt::append(&mut self.module_scope_mut().generated, ref_);
                ref_
            }
        } else {
            self.runtime_imports.at(name).unwrap()
        }
    }

    pub fn runtime_identifier(&mut self, loc: bun_ast::Loc, name: &'static [u8]) -> Expr {
        let ref_ = self.runtime_identifier_ref(loc, name);
        self.record_usage(ref_);
        self.new_expr(E::ImportIdentifier::new(ref_, false), loc)
    }

    pub fn call_runtime(
        &mut self,
        loc: bun_ast::Loc,
        name: &'static [u8],
        args: ExprNodeList,
    ) -> Expr {
        let target = self.runtime_identifier(loc, name);
        self.new_expr(
            E::Call {
                target,
                args,
                ..Default::default()
            },
            loc,
        )
    }

    pub fn value_for_define(
        &mut self,
        loc: bun_ast::Loc,
        assign_target: js_ast::AssignTarget,
        is_delete_target: bool,
        define_data: &DefineData,
    ) -> Expr {
        // Callers gate on `!valueless()` before reaching here, so `value` is a
        // real Expr.Data by contract (Zig: `define_data.value`).
        let value = define_data.value;
        match value {
            js_ast::ExprData::EIdentifier(id) => {
                // Spec P.zig:5510: `define_data.original_name().?` — identifier
                // defines always carry a name; `.?` panics on null. Match the
                // contract so `handle_identifier`'s trailing `find_symbol`
                // rebind runs against the *resolved* scope ref, not the
                // define-time ref silently passed through with `None`.
                let original_name: &[u8] = define_data
                    .original_name()
                    .expect("identifier define must have original_name");
                // SAFETY: `define_data` borrows `p.define: &'a Define`; the
                // backing `original_name` bytes live for `'a`. Erase the local
                // borrow lifetime to satisfy `handle_identifier`'s
                // `Option<&'a [u8]>` param.
                let original_name: &'a [u8] =
                    unsafe { bun_collections::detach_lifetime(original_name) };
                return self.handle_identifier(
                    loc,
                    id,
                    Some(original_name),
                    IdentifierOpts::new()
                        .with_assign_target(assign_target)
                        .with_is_delete_target(is_delete_target)
                        .with_was_originally_identifier(true),
                );
            }
            js_ast::ExprData::EString(str_) => {
                return self.new_expr(&*str_, loc);
            }
            _ => {}
        }
        Expr { data: value, loc }
    }

    // `parts` is `&[Box<[u8]>]` to match the active round-C `DotDefine.parts:
    // Vec<Box<[u8]>>` shape (auto-derefs at call sites). The full draft uses
    // `StoreSlice<StoreStr>`; both index to a `[u8]` so the body is unchanged.
    pub fn is_dot_define_match(&mut self, expr: Expr, parts: &[Box<[u8]>]) -> bool {
        match expr.data {
            js_ast::ExprData::EDot(ex) => {
                if parts.len() > 1 {
                    if ex.optional_chain.is_some() {
                        return false;
                    }
                    // Intermediates must be dot expressions
                    let last = parts.len() - 1;
                    let is_tail_match = strings::eql(&parts[last], &ex.name);
                    return is_tail_match && self.is_dot_define_match(ex.target, &parts[..last]);
                }
            }
            js_ast::ExprData::EImportMeta(_) => {
                return parts.len() == 2 && &*parts[0] == b"import" && &*parts[1] == b"meta";
            }
            // Note: this behavior differs from esbuild
            // esbuild does not try to match index accessors
            // we do, but only if it's a UTF8 string
            // the intent is to handle people using this form instead of E.Dot. So we really only want to do this if the accessor can also be an identifier
            js_ast::ExprData::EIndex(index) => {
                if parts.len() > 1 {
                    if let js_ast::ExprData::EString(mut s) = index.index.data {
                        if s.is_utf8() {
                            if index.optional_chain.is_some() {
                                return false;
                            }
                            let last = parts.len() - 1;
                            let is_tail_match = strings::eql(&parts[last], s.slice(self.arena));
                            return is_tail_match
                                && self.is_dot_define_match(index.target, &parts[..last]);
                        }
                    }
                }
            }
            js_ast::ExprData::EIdentifier(ex) => {
                // The last expression must be an identifier
                if parts.len() == 1 {
                    let name = self.load_name_from_ref(ex.ref_);
                    if !strings::eql(name, &parts[0]) {
                        return false;
                    }

                    let Ok(result) = self.find_symbol_with_record_usage::<false>(expr.loc, name)
                    else {
                        return false;
                    };

                    // We must not be in a "with" statement scope
                    if result.is_inside_with_scope {
                        return false;
                    }

                    // when there's actually no symbol by that name, we return Ref.None
                    // If a symbol had already existed by that name, we return .unbound
                    return result.r#ref.is_empty()
                        || self.symbols[result.r#ref.inner_index() as usize].kind
                            == js_ast::symbol::Kind::Unbound;
                }
            }
            _ => {}
        }
        false
    }
}

// Free fn: Zig `fs.Path.packageName`. `bun_paths::fs::Path` lacks this method
// (it lives on the resolver `Path`, which `bun_js_parser` cannot depend on), so
// the slice logic is inlined here. Mirrors `src/resolver/fs.rs::Path::packageName`.
fn path_package_name<'a>(path: &fs::Path<'a>) -> Option<&'a [u8]> {
    let mut name_to_use = path.pretty;
    if let Some(node_modules) = strings::last_index_of(path.text, bun_paths::NODE_MODULES_NEEDLE) {
        name_to_use = &path.text[node_modules + bun_paths::NODE_MODULES_NEEDLE.len()..];
    }

    // Zig: `bun.options.JSX.Pragma.parsePackageName` — pure slice helper.
    let pkgname = {
        let str = name_to_use;
        'brk: {
            if str.is_empty() {
                break 'brk str;
            }
            if str[0] == b'@' {
                if let Some(first_slash) = strings::index_of_char(&str[1..], b'/') {
                    let first_slash = first_slash as usize;
                    let remainder = &str[1 + first_slash + 1..];
                    if let Some(last_slash) = strings::index_of_char(remainder, b'/') {
                        let last_slash = last_slash as usize;
                        break 'brk &str[0..first_slash + 1 + last_slash + 1];
                    }
                }
            }
            if let Some(first_slash) = strings::index_of_char(str, b'/') {
                break 'brk &str[0..first_slash as usize];
            }
            str
        }
    };
    if pkgname.is_empty() || !pkgname[0].is_ascii_alphanumeric() {
        return None;
    }
    Some(pkgname)
}

// ═══════════════════════════════════════════════════════════════════════════
// Round-D/E heavy method bodies (lower_class / to_ast / react_refresh / etc.).
// lower_class + emit_decorator_metadata_for_prop + serialize_metadata are
// un-gated and compile against the full bun_ast::ts::Metadata variant set.
// Remaining individually-gated methods carry their own `blocked_on:` tags.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn lower_class(&mut self, stmtorexpr: js_ast::StmtOrExpr) -> &'a mut [Stmt] {
        use js_ast::g::PropertyKind;
        match stmtorexpr {
            js_ast::StmtOrExpr::Stmt(stmt) => {
                // Every call site is the visitStmt s_class branch. `StoreRef` gives us
                // safe `Deref`/`DerefMut` into the arena-owned `S::Class`; each access
                // below materialises a fresh short-lived borrow, so the `&mut self`
                // helper calls in between never overlap an outstanding `&mut G::Class`.
                let mut s_class: bun_ast::StoreRef<S::Class> = stmt.data.s_class().unwrap();

                // Standard decorator lowering path (for both JS and TS files)
                if s_class.class.should_lower_standard_decorators {
                    // PORT NOTE: Zig `lowerStandardDecoratorsStmt` returns `[]Stmt`; the
                    // round-E Rust stub takes an out-param Vec instead. Wrap to keep
                    // this function's `[]Stmt` contract.
                    let mut out = BumpVec::<Stmt>::new_in(self.arena);
                    self.lower_standard_decorators_stmt(stmt, &mut out);
                    return out.into_bump_slice_mut();
                }

                if !TYPESCRIPT {
                    if !s_class.class.has_decorators {
                        return self.arena.alloc_slice_copy(&[stmt]);
                    }
                }
                let mut constructor_function: Option<bun_ast::StoreRef<E::Function>> = None;

                let mut static_decorators = BumpVec::<Stmt>::new_in(self.arena);
                let mut instance_decorators = BumpVec::<Stmt>::new_in(self.arena);
                let mut instance_members = BumpVec::<Stmt>::new_in(self.arena);
                let mut static_members = BumpVec::<Stmt>::new_in(self.arena);
                let mut class_properties = BumpVec::<G::Property>::new_in(self.arena);

                for prop in s_class.class.properties.slice_mut().iter_mut() {
                    // merge parameter decorators with method decorators
                    if prop.flags.contains(Flags::Property::IsMethod) {
                        if let Some(prop_value) = prop.value {
                            match prop_value.data {
                                js_ast::ExprData::EFunction(func) => {
                                    let is_constructor = matches!(prop.key, Some(k) if matches!(k.data, js_ast::ExprData::EString(s) if s.eql_comptime(b"constructor")));

                                    if is_constructor {
                                        constructor_function = Some(func);
                                    }

                                    // arena-owned `StoreSlice<Arg>` valid for parser 'a.
                                    for (i, arg) in func.func.args.iter().enumerate() {
                                        for arg_decorator in arg.ts_decorators.slice() {
                                            let arg0 = self.new_expr(
                                                E::Number { value: i as f64 },
                                                arg_decorator.loc,
                                            );
                                            let args = self
                                                .arena
                                                .alloc_slice_copy(&[arg0, *arg_decorator]);
                                            let args = ExprNodeList::from_arena_slice(args);
                                            let call = self.call_runtime(
                                                arg_decorator.loc,
                                                b"__legacyDecorateParamTS",
                                                args,
                                            );
                                            let decorators = if is_constructor {
                                                // `prop` borrows the (separate) properties arena
                                                // slice, not the `S::Class` allocation, so this
                                                // fresh `DerefMut` does not alias it.
                                                &mut s_class.class.ts_decorators
                                            } else {
                                                &mut prop.ts_decorators
                                            };
                                            decorators.push(call);
                                        }
                                    }
                                }
                                _ => unreachable!(),
                            }
                        }
                    }

                    // TODO: prop.kind == .declare and prop.value == null

                    if prop.ts_decorators.len_u32() > 0 {
                        let descriptor_key = prop.key.expect("infallible: prop has key");
                        let loc = descriptor_key.loc;

                        // TODO: when we have the `accessor` modifier, add `and !prop.flags.contains(.has_accessor_modifier)` to
                        // the if statement.
                        let descriptor_kind: Expr =
                            if !prop.flags.contains(Flags::Property::IsMethod) {
                                self.new_expr(E::Undefined {}, loc)
                            } else {
                                self.new_expr(E::Null {}, loc)
                            };

                        let class_name = s_class.class.class_name.unwrap();
                        let class_ref = class_name.ref_.expect("infallible: ref bound");
                        let target: Expr;
                        if prop.flags.contains(Flags::Property::IsStatic) {
                            self.record_usage(class_ref);
                            target = self.new_expr(E::Identifier::init(class_ref), class_name.loc);
                        } else {
                            let inner =
                                self.new_expr(E::Identifier::init(class_ref), class_name.loc);
                            target = self.new_expr(
                                E::Dot {
                                    target: inner,
                                    name: b"prototype".into(),
                                    name_loc: loc,
                                    ..Default::default()
                                },
                                loc,
                            );
                        }

                        let mut array = BumpVec::<Expr>::new_in(self.arena);

                        if self.options.features.emit_decorator_metadata {
                            // TODO(port): full design:type / design:paramtypes / design:returntype
                            // metadata emission ported below in condensed form.
                            self.emit_decorator_metadata_for_prop(prop, &mut array, loc);
                        }

                        // PORT NOTE: reshaped — Zig insertSlice(0, ...) prepends; we prepend then push args.
                        let mut full = BumpVec::<Expr>::with_capacity_in(
                            prop.ts_decorators.len_u32() as usize + array.len(),
                            self.arena,
                        );
                        full.extend_from_slice(prop.ts_decorators.slice());
                        full.extend_from_slice(&array);
                        let full_items = ExprNodeList::from_bump_vec(full);
                        let array_expr = self.new_expr(
                            E::Array {
                                items: full_items,
                                ..Default::default()
                            },
                            loc,
                        );
                        let args_slice = self.arena.alloc_slice_copy(&[
                            array_expr,
                            target,
                            descriptor_key,
                            descriptor_kind,
                        ]);
                        let args = ExprNodeList::from_arena_slice(args_slice);

                        let decorator = self.call_runtime(
                            prop.key.expect("infallible: prop has key").loc,
                            b"__legacyDecorateClassTS",
                            args,
                        );
                        let decorator_stmt = self.s(
                            S::SExpr {
                                value: decorator,
                                ..Default::default()
                            },
                            decorator.loc,
                        );

                        if prop.flags.contains(Flags::Property::IsStatic) {
                            static_decorators.push(decorator_stmt);
                        } else {
                            instance_decorators.push(decorator_stmt);
                        }
                    }

                    if prop.kind != PropertyKind::ClassStaticBlock
                        && !prop.flags.contains(Flags::Property::IsMethod)
                        && !matches!(
                            prop.key.map(|k| k.data),
                            Some(js_ast::ExprData::EPrivateIdentifier(_))
                        )
                        && prop.ts_decorators.len_u32() > 0
                    {
                        // remove decorated fields without initializers to avoid assigning undefined.
                        let Some(initializer) = prop.initializer else {
                            continue;
                        };

                        let mut target: Expr;
                        if prop.flags.contains(Flags::Property::IsStatic) {
                            let class_name = s_class.class.class_name.unwrap();
                            let class_ref = class_name.ref_.expect("infallible: ref bound");
                            self.record_usage(class_ref);
                            target = self.new_expr(E::Identifier::init(class_ref), class_name.loc);
                        } else {
                            target = self.new_expr(
                                E::This {},
                                prop.key.expect("infallible: prop has key").loc,
                            );
                        }

                        if prop.flags.contains(Flags::Property::IsComputed)
                            || matches!(
                                prop.key.expect("infallible: prop has key").data,
                                js_ast::ExprData::ENumber(_)
                            )
                        {
                            target = self.new_expr(
                                E::Index {
                                    target,
                                    index: prop.key.expect("infallible: prop has key"),
                                    optional_chain: None,
                                },
                                prop.key.expect("infallible: prop has key").loc,
                            );
                        } else {
                            target = self.new_expr(
                                E::Dot {
                                    target,
                                    name: prop
                                        .key
                                        .expect("infallible: prop has key")
                                        .data
                                        .e_string()
                                        .expect("infallible: variant checked")
                                        .data,
                                    name_loc: prop.key.expect("infallible: prop has key").loc,
                                    ..Default::default()
                                },
                                prop.key.expect("infallible: prop has key").loc,
                            );
                        }

                        // remove fields with decorators from class body. Move static members outside of class.
                        if prop.flags.contains(Flags::Property::IsStatic) {
                            static_members.push(Stmt::assign(target, initializer));
                        } else {
                            instance_members.push(Stmt::assign(target, initializer));
                        }
                        continue;
                    }

                    // PORT NOTE: Zig copies `prop.*` by value into the new list; the old
                    // backing slice is overwritten right after this loop, so `take` is
                    // semantically equivalent (Property: Default).
                    class_properties.push(core::mem::take(prop));
                }

                s_class.class.properties =
                    bun_ast::StoreSlice::new_mut(class_properties.into_bump_slice_mut());

                if !instance_members.is_empty() {
                    if constructor_function.is_none() {
                        // PORT NOTE: Zig `Property.List.fromList(class.properties)` re-wraps the
                        // freshly-installed slice and inserts at index 0. We rebuild instead
                        // (Property is not Clone in Rust).
                        let old_props: bun_ast::StoreSlice<G::Property> = s_class.class.properties;
                        let old_len = old_props.len();
                        let mut properties =
                            BumpVec::<G::Property>::with_capacity_in(old_len + 1, self.arena);
                        let mut constructor_stmts = BumpVec::<Stmt>::new_in(self.arena);

                        if s_class.class.extends.is_some() {
                            let target = self.new_expr(E::Super {}, stmt.loc);
                            let arguments_ref = self
                                .new_symbol(js_ast::symbol::Kind::Unbound, arguments_str)
                                .expect("unreachable");
                            VecExt::append(&mut self.current_scope_mut().generated, arguments_ref);

                            let spread_inner =
                                self.new_expr(E::Identifier::init(arguments_ref), stmt.loc);
                            let super_ = self.new_expr(
                                E::Spread {
                                    value: spread_inner,
                                },
                                stmt.loc,
                            );
                            let args = ExprNodeList::init_one(super_);

                            let call_value = self.new_expr(
                                E::Call {
                                    target,
                                    args,
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                            constructor_stmts.push(self.s(
                                S::SExpr {
                                    value: call_value,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                        }

                        constructor_stmts.extend_from_slice(&instance_members);

                        let key_expr =
                            self.new_expr(E::EString::from_static(b"constructor"), stmt.loc);
                        let value_expr = self.new_expr(
                            E::Function {
                                func: G::Fn {
                                    name: None,
                                    open_parens_loc: bun_ast::Loc::EMPTY,
                                    args: bun_ast::StoreSlice::EMPTY,
                                    body: G::FnBody {
                                        loc: stmt.loc,
                                        stmts: bun_ast::StoreSlice::new_mut(
                                            constructor_stmts.into_bump_slice_mut(),
                                        ),
                                    },
                                    flags: Flags::FUNCTION_NONE,
                                    ..Default::default()
                                },
                            },
                            stmt.loc,
                        );
                        properties.push(G::Property {
                            flags: Flags::Property::IsMethod.into(),
                            key: Some(key_expr),
                            value: Some(value_expr),
                            ..Default::default()
                        });
                        for old in old_props.slice_mut().iter_mut() {
                            properties.push(core::mem::take(old));
                        }

                        s_class.class.properties =
                            bun_ast::StoreSlice::new_mut(properties.into_bump_slice_mut());
                    } else {
                        let mut cf = constructor_function.unwrap();
                        // `body.stmts` is an arena-owned `StoreSlice<Stmt>`.
                        let old_stmts: &[Stmt] = cf.func.body.stmts.slice();
                        let mut constructor_stmts = BumpVec::<Stmt>::with_capacity_in(
                            old_stmts.len() + instance_members.len(),
                            self.arena,
                        );
                        constructor_stmts.extend_from_slice(old_stmts);
                        // statements coming from class body inserted after super call or beginning of constructor.
                        let mut super_index: Option<usize> = None;
                        for (index, item) in constructor_stmts.iter().enumerate() {
                            if !matches!(item.data, js_ast::StmtData::SExpr(se) if matches!(se.value.data, js_ast::ExprData::ECall(c) if matches!(c.target.data, js_ast::ExprData::ESuper(_))))
                            {
                                continue;
                            }
                            super_index = Some(index);
                            break;
                        }

                        let i = super_index.map(|j| j + 1).unwrap_or(0);
                        // TODO(port): bumpalo Vec lacks insert_slice; emulate via per-item insert.
                        for (off, m) in instance_members.iter().enumerate() {
                            constructor_stmts.insert(i + off, *m);
                        }

                        cf.func.body.stmts =
                            bun_ast::StoreSlice::new_mut(constructor_stmts.into_bump_slice_mut());
                    }

                    // TODO: make sure "super()" comes before instance field initializers
                    // https://github.com/evanw/esbuild/blob/e9413cc4f7ab87263ea244a999c6fa1f1e34dc65/internal/js_parser/js_parser_lower.go#L2742
                }

                let mut stmts_count: usize =
                    1 + static_members.len() + instance_decorators.len() + static_decorators.len();
                if s_class.class.ts_decorators.len_u32() > 0 {
                    stmts_count += 1;
                }
                let mut stmts = BumpVec::<Stmt>::with_capacity_in(stmts_count, self.arena);
                stmts.push(stmt); // PERF(port): was assume_capacity
                stmts.extend_from_slice(&static_members);
                stmts.extend_from_slice(&instance_decorators);
                stmts.extend_from_slice(&static_decorators);
                if s_class.class.ts_decorators.len_u32() > 0 {
                    let mut array: Vec<Expr> = s_class.class.ts_decorators.move_to_list_managed();

                    if self.options.features.emit_decorator_metadata {
                        if let Some(cf) = constructor_function {
                            // design:paramtypes
                            let constructor_args: &[G::Arg] = cf.func.args.slice();
                            let args1 = if !constructor_args.is_empty() {
                                let param_array = self
                                    .arena
                                    .alloc_slice_fill_default::<Expr>(constructor_args.len());
                                for (i, ca) in constructor_args.iter().enumerate() {
                                    param_array[i] = self
                                        .serialize_metadata(ca.ts_metadata.clone())
                                        .expect("unreachable");
                                }
                                let items = ExprNodeList::from_arena_slice(param_array);
                                self.new_expr(
                                    E::Array {
                                        items,
                                        ..Default::default()
                                    },
                                    bun_ast::Loc::EMPTY,
                                )
                            } else {
                                self.new_expr(
                                    E::Array {
                                        items: bun_alloc::AstAlloc::vec(),
                                        ..Default::default()
                                    },
                                    bun_ast::Loc::EMPTY,
                                )
                            };
                            let label = self.new_expr(
                                E::EString::from_static(b"design:paramtypes"),
                                bun_ast::Loc::EMPTY,
                            );
                            let args_slice = self.arena.alloc_slice_copy(&[label, args1]);
                            let args = ExprNodeList::from_arena_slice(args_slice);
                            array.push(self.call_runtime(stmt.loc, b"__legacyMetadataTS", args));
                        }
                    }

                    let class_name = s_class.class.class_name.unwrap();
                    let class_ref = class_name.ref_.expect("infallible: ref bound");
                    let array_items = ExprNodeList::move_from_list(array);
                    let array_expr = self.new_expr(
                        E::Array {
                            items: array_items,
                            ..Default::default()
                        },
                        stmt.loc,
                    );
                    let class_ident = self.new_expr(E::Identifier::init(class_ref), class_name.loc);
                    let args_slice = self.arena.alloc_slice_copy(&[array_expr, class_ident]);
                    let args = ExprNodeList::from_arena_slice(args_slice);

                    let lhs = self.new_expr(E::Identifier::init(class_ref), class_name.loc);
                    let rhs = self.call_runtime(stmt.loc, b"__legacyDecorateClassTS", args);
                    stmts.push(Stmt::assign(lhs, rhs));

                    self.record_usage(class_ref);
                    self.record_usage(class_ref);
                }
                stmts.into_bump_slice_mut()
            }
            js_ast::StmtOrExpr::Expr(expr) => self.arena.alloc_slice_copy(&[self.s(
                S::SExpr {
                    value: expr,
                    ..Default::default()
                },
                expr.loc,
            )]),
        }
    }

    // Helper extracted from lower_class to keep that fn readable.
    // TODO(port): this condenses the Zig per-kind metadata switch (lines 5024-5105).
    // Phase B should diff against Zig to verify exact arg ordering for get/set.
    #[cold]
    #[inline(never)]
    fn emit_decorator_metadata_for_prop(
        &mut self,
        prop: &G::Property,
        array: &mut BumpVec<'a, Expr>,
        loc: bun_ast::Loc,
    ) {
        use js_ast::g::PropertyKind;

        // Local helper: bump-alloc an arg pair and call __legacyMetadataTS.
        // PORT NOTE: pulled out of the per-arm code to cut a ~3x repetition vs Zig.
        macro_rules! push_metadata {
            ($label:expr, $value:expr) => {{
                let label = self.new_expr(E::EString::from_static($label), bun_ast::Loc::EMPTY);
                let value = $value;
                let args = self.arena.alloc_slice_copy(&[label, value]);
                let args = ExprNodeList::from_arena_slice(args);
                array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
            }};
        }

        match prop.kind {
            PropertyKind::Normal | PropertyKind::Abstract => {
                {
                    // design:type
                    let v = self
                        .serialize_metadata(prop.ts_metadata.clone())
                        .expect("unreachable");
                    push_metadata!(b"design:type", v);
                }
                // design:paramtypes and design:returntype if method
                if prop.flags.contains(Flags::Property::IsMethod) {
                    if let Some(prop_value) = prop.value {
                        let func = prop_value
                            .data
                            .e_function()
                            .expect("infallible: variant checked");
                        // arena-owned `StoreSlice<Arg>` valid for parser 'a.
                        let method_args: &[G::Arg] = func.func.args.slice();
                        {
                            let args_array = self
                                .arena
                                .alloc_slice_fill_default::<Expr>(method_args.len());
                            for (entry, method_arg) in args_array.iter_mut().zip(method_args) {
                                *entry = self
                                    .serialize_metadata(method_arg.ts_metadata.clone())
                                    .expect("unreachable");
                            }
                            let items = ExprNodeList::from_arena_slice(args_array);
                            let arr = self.new_expr(
                                E::Array {
                                    items,
                                    ..Default::default()
                                },
                                bun_ast::Loc::EMPTY,
                            );
                            push_metadata!(b"design:paramtypes", arr);
                        }
                        {
                            let v = self
                                .serialize_metadata(func.func.return_ts_metadata.clone())
                                .expect("unreachable");
                            push_metadata!(b"design:returntype", v);
                        }
                    }
                }
            }
            PropertyKind::Get => {
                if prop.flags.contains(Flags::Property::IsMethod) {
                    // typescript sets design:type to the return value & design:paramtypes to [].
                    if let Some(prop_value) = prop.value {
                        let func = prop_value
                            .data
                            .e_function()
                            .expect("infallible: variant checked");
                        {
                            let v = self
                                .serialize_metadata(func.func.return_ts_metadata.clone())
                                .expect("unreachable");
                            push_metadata!(b"design:type", v);
                        }
                        {
                            let arr = self.new_expr(
                                E::Array {
                                    items: bun_alloc::AstAlloc::vec(),
                                    ..Default::default()
                                },
                                bun_ast::Loc::EMPTY,
                            );
                            push_metadata!(b"design:paramtypes", arr);
                        }
                    }
                }
            }
            PropertyKind::Set => {
                if prop.flags.contains(Flags::Property::IsMethod) {
                    // typescript sets design:type to the return value & design:paramtypes to [arg].
                    // note that typescript does not allow you to put a decorator on both the getter and the setter.
                    // if you do anyway, bun will set design:type and design:paramtypes twice, so it's fine.
                    if let Some(prop_value) = prop.value {
                        let func = prop_value
                            .data
                            .e_function()
                            .expect("infallible: variant checked");
                        // arena-owned `StoreSlice<Arg>` valid for parser 'a.
                        let method_args: &[G::Arg] = func.func.args.slice();
                        {
                            let args_array = self
                                .arena
                                .alloc_slice_fill_default::<Expr>(method_args.len());
                            for (entry, method_arg) in args_array.iter_mut().zip(method_args) {
                                *entry = self
                                    .serialize_metadata(method_arg.ts_metadata.clone())
                                    .expect("unreachable");
                            }
                            let items = ExprNodeList::from_arena_slice(args_array);
                            let arr = self.new_expr(
                                E::Array {
                                    items,
                                    ..Default::default()
                                },
                                bun_ast::Loc::EMPTY,
                            );
                            push_metadata!(b"design:paramtypes", arr);
                        }
                        if !method_args.is_empty() {
                            let v = self
                                .serialize_metadata(method_args[0].ts_metadata.clone())
                                .expect("unreachable");
                            push_metadata!(b"design:type", v);
                        }
                    }
                }
            }
            PropertyKind::Spread | PropertyKind::Declare | PropertyKind::AutoAccessor => {} // not allowed in a class (auto_accessor is standard decorators only)
            PropertyKind::ClassStaticBlock => {} // not allowed to decorate this
        }
    }

    fn serialize_metadata(
        &mut self,
        ts_metadata: bun_ast::ts::Metadata,
    ) -> Result<Expr, bun_core::Error> {
        use bun_ast::ts::Metadata as M;
        // Local: `find_symbol` for a builtin name as an E::Identifier expr.
        macro_rules! ident {
            ($name:expr) => {{
                let r = self
                    .find_symbol(bun_ast::Loc::EMPTY, $name)
                    .expect("unreachable")
                    .r#ref;
                self.new_expr(E::Identifier::init(r), bun_ast::Loc::EMPTY)
            }};
        }
        Ok(match ts_metadata {
            M::MNone | M::MAny | M::MUnknown | M::MObject => ident!(b"Object"),
            M::MNever | M::MUndefined | M::MNull | M::MVoid => {
                self.new_expr(E::Undefined {}, bun_ast::Loc::EMPTY)
            }
            M::MString => ident!(b"String"),
            M::MNumber => ident!(b"Number"),
            M::MFunction => ident!(b"Function"),
            M::MBoolean => ident!(b"Boolean"),
            M::MArray => ident!(b"Array"),
            M::MBigint => {
                let e = ident!(b"BigInt");
                self.maybe_defined_helper(e)?
            }
            M::MSymbol => {
                let e = ident!(b"Symbol");
                self.maybe_defined_helper(e)?
            }
            M::MPromise => ident!(b"Promise"),
            M::MIdentifier(ref_) => {
                self.record_usage(ref_);
                let e = if self.is_import_item.contains_key(&ref_) {
                    self.new_expr(
                        E::ImportIdentifier {
                            ref_,
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    )
                } else {
                    self.new_expr(E::Identifier::init(ref_), bun_ast::Loc::EMPTY)
                };
                return self.maybe_defined_helper(e);
            }
            M::MDot(refs) => {
                debug_assert!(refs.len() >= 2);
                // (refs.deinit(p.arena) — arena-backed; nothing to free in Rust)

                macro_rules! ref_name {
                    ($r:expr) => {
                        E::Str::new(self.load_name_from_ref($r))
                    };
                }

                let mut dots = self.new_expr(
                    E::Dot {
                        name: ref_name!(refs[refs.len() - 1]),
                        name_loc: bun_ast::Loc::EMPTY,
                        target: Expr::default(), // patched below
                        ..Default::default()
                    },
                    bun_ast::Loc::EMPTY,
                );

                // `StoreRef<Expr>` (safe `Deref`/`DerefMut`) tracks the arena slot
                // being patched, so the chain walk stays in safe code per hop.
                let mut current_expr = js_ast::StoreRef::from_bump(
                    &mut dots
                        .data
                        .e_dot_mut()
                        .expect("infallible: variant checked")
                        .target,
                );
                let mut i: usize = refs.len() - 2;
                while i > 0 {
                    *current_expr = self.new_expr(
                        E::Dot {
                            name: ref_name!(refs[i]),
                            name_loc: bun_ast::Loc::EMPTY,
                            target: Expr::default(),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    );
                    let next = js_ast::StoreRef::from_bump(
                        &mut current_expr
                            .data
                            .e_dot_mut()
                            .expect("infallible: variant checked")
                            .target,
                    );
                    current_expr = next;
                    i -= 1;
                }

                if self.is_import_item.contains_key(&refs[0]) {
                    *current_expr = self.new_expr(
                        E::ImportIdentifier {
                            ref_: refs[0],
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    );
                } else {
                    *current_expr =
                        self.new_expr(E::Identifier::init(refs[0]), bun_ast::Loc::EMPTY);
                }

                let dot_identifier = *current_expr;
                let mut current_dot = dots;

                let right0 = self.check_if_defined_helper(current_dot)?;
                let mut maybe_defined_dots = self.new_expr(
                    E::Binary {
                        op: js_ast::OpCode::BinLogicalOr,
                        right: right0,
                        left: Expr::default(), // patched below
                    },
                    bun_ast::Loc::EMPTY,
                );

                if i < refs.len() - 2 {
                    current_dot = current_dot
                        .data
                        .e_dot()
                        .expect("infallible: variant checked")
                        .target;
                }
                current_expr = js_ast::StoreRef::from_bump(
                    &mut maybe_defined_dots
                        .data
                        .e_binary_mut()
                        .expect("infallible: variant checked")
                        .left,
                );

                while i < refs.len() - 2 {
                    let right_n = self.check_if_defined_helper(current_dot)?;
                    *current_expr = self.new_expr(
                        E::Binary {
                            op: js_ast::OpCode::BinLogicalOr,
                            right: right_n,
                            left: Expr::default(),
                        },
                        bun_ast::Loc::EMPTY,
                    );
                    let next = js_ast::StoreRef::from_bump(
                        &mut current_expr
                            .data
                            .e_binary_mut()
                            .expect("infallible: variant checked")
                            .left,
                    );
                    current_expr = next;
                    i += 1;
                    if i < refs.len() - 2 {
                        current_dot = current_dot
                            .data
                            .e_dot()
                            .expect("infallible: variant checked")
                            .target;
                    }
                }

                *current_expr = self.check_if_defined_helper(dot_identifier)?;

                let yes = ident!(b"Object");
                let root = self.new_expr(
                    E::If {
                        yes,
                        no: dots,
                        test_: maybe_defined_dots,
                    },
                    bun_ast::Loc::EMPTY,
                );

                return Ok(root);
            }
        })
    }

    #[cold]
    #[inline(never)]
    pub fn wrap_identifier_namespace(&mut self, loc: bun_ast::Loc, r#ref: Ref) -> Expr {
        let enclosing_ref = self
            .enclosing_namespace_arg_ref
            .expect("infallible: in namespace");
        self.record_usage(enclosing_ref);

        // TODO(port): E::Dot.name is `&'static [u8]` pending crate-wide 'bump
        // threading. Symbol.original_name is an arena-owned `StoreStr` (lives for
        // parser 'a, which outlives every Expr). Erase the lifetime to fit the
        // placeholder field type.
        // SAFETY: arena-owned slice valid for the AST lifetime.
        let name: &'static [u8] = self.symbols[r#ref.inner_index() as usize]
            .original_name
            .slice();

        self.new_expr(
            E::Dot {
                target: Expr::init_identifier(enclosing_ref, loc),
                name: name.into(),
                name_loc: loc,
                ..Default::default()
            },
            loc,
        )
    }

    pub fn wrap_identifier_hoisting(&mut self, loc: bun_ast::Loc, r#ref: Ref) -> Expr {
        // There was a Zig stage1 bug here we had to copy `ref` into a local
        // const variable or else the result would be wrong
        // I remember that bug in particular took hours, possibly days to uncover.

        self.relocated_top_level_vars.push(LocRef {
            loc,
            ref_: Some(r#ref),
        });
        self.record_usage(r#ref);
        Expr::init_identifier(r#ref, loc)
    }

    // wrap_inlined_enum: moved to ungated impl (round-G).

    // value_for_define / is_dot_define_match: moved to ungated impl (round-G).

    // One statement could potentially expand to several statements
    pub fn stmts_to_single_stmt(&mut self, loc: bun_ast::Loc, stmts: &'a mut [Stmt]) -> Stmt {
        if stmts.is_empty() {
            return Stmt {
                data: js_ast::StmtData::SEmpty(S::Empty {}),
                loc,
            };
        }

        if stmts.len() == 1 && !statement_cares_about_scope(&stmts[0]) {
            // "let" and "const" must be put in a block when in a single-statement context
            return stmts[0];
        }

        self.s(
            S::Block {
                stmts: bun_ast::StoreSlice::new_mut(stmts),
                close_brace_loc: bun_ast::Loc::EMPTY,
            },
            loc,
        )
    }

    pub fn find_label_symbol(&mut self, loc: bun_ast::Loc, name: &[u8]) -> FindLabelSymbolResult {
        let mut res = FindLabelSymbolResult {
            r#ref: Ref::NONE,
            is_loop: false,
            found: false,
        };

        // `StoreRef<Scope>` is a `Copy` arena handle with safe `Deref`, so the
        // parent-chain walk needs no raw-pointer `unsafe` and does not borrow
        // `self` (allowing `record_usage(&mut self)` inside the loop).
        let mut _scope: Option<js_ast::StoreRef<Scope>> = Some(self.current_scope_ref());

        while let Some(scope) = _scope {
            if scope.kind_stops_hoisting() {
                break;
            }
            if let Some(label_ref) = scope.label_ref {
                if scope.kind == js_ast::scope::Kind::Label
                    // `Symbol.original_name` is an arena-owned `StoreStr` valid for 'a.
                    && strings::eql(name, self.symbols[label_ref.inner_index() as usize].original_name.slice())
                {
                    // Track how many times we've referenced this symbol
                    self.record_usage(label_ref);
                    res.r#ref = label_ref;
                    res.is_loop = scope.label_stmt_is_loop;
                    res.found = true;
                    return res;
                }
            }
            _scope = scope.parent;
        }

        let r = js_lexer::range_of_identifier(self.source, loc);
        self.log().add_range_error_fmt(
            Some(self.source),
            r,
            format_args!(
                "There is no containing label named \"{}\"",
                bstr::BStr::new(name)
            ),
        );

        // Allocate an "unbound" symbol
        let r#ref = self
            .new_symbol(
                js_ast::symbol::Kind::Unbound,
                self.arena.alloc_slice_copy(name),
            )
            .expect("unreachable");

        // Track how many times we've referenced this symbol
        self.record_usage(r#ref);

        res
    }

    // Zig: `@compileError("not implemented")` — the body is a compile-time error
    // there, i.e. provably uncalled (Zig would refuse to build if any caller
    // existed). Port as `unreachable!()` per the @compileError convention used
    // elsewhere in this file (see `wrap_identifier` arm).
    #[allow(unused)]
    fn keep_stmt_symbol_name(&mut self, _loc: bun_ast::Loc, _ref: Ref, _name: &[u8]) -> Stmt {
        unreachable!("not implemented")
    }

    // runtime_identifier_ref / runtime_identifier / call_runtime: moved to ungated impl (round-G).

    pub fn extract_decls_for_binding(
        binding: Binding,
        decls: &mut ListManaged<'a, G::Decl>,
    ) -> Result<(), bun_core::Error> {
        match binding.data {
            js_ast::b::B::BMissing(_) => {}
            js_ast::b::B::BIdentifier(_) => {
                decls.push(G::Decl {
                    binding,
                    value: None,
                });
            }
            js_ast::b::B::BArray(arr) => {
                for item in arr.items().iter() {
                    Self::extract_decls_for_binding(item.binding, decls).expect("unreachable");
                }
            }
            js_ast::b::B::BObject(obj) => {
                for prop in obj.properties().iter() {
                    Self::extract_decls_for_binding(prop.value, decls).expect("unreachable");
                }
            }
        }
        Ok(())
    }

    #[inline]
    pub fn module_exports(&mut self, loc: bun_ast::Loc) -> Expr {
        let target = self.new_expr(
            E::Identifier {
                ref_: self.module_ref,
                ..Default::default()
            },
            loc,
        );
        self.new_expr(
            E::Dot {
                name: exports_string_name.into(),
                name_loc: loc,
                target,
                ..Default::default()
            },
            loc,
        )
    }

    // This code is tricky.
    // - Doing it incorrectly will cause segfaults.
    // - Doing it correctly drastically affects runtime performance while parsing larger files
    // The key is in how we remove scopes from the list
    // If we do an orderedRemove, it gets very slow.
    // swapRemove is fast. But a little more dangerous.
    // Instead, we just tombstone it.
    pub fn pop_and_flatten_scope(&mut self, scope_index: usize) {
        // Move up to the parent scope. `StoreRef` handles are `Copy` and carry
        // safe `Deref`/`DerefMut`, so the parent-chain walk needs no open-coded
        // raw-pointer derefs. `to_flatten` and `parent` are distinct arena
        // allocations (a scope is never its own parent), so the shared read of
        // `to_flatten.children` below does not alias the `&mut parent.children`
        // writes.
        let to_flatten = self.current_scope_ref();
        let mut parent = to_flatten.parent.unwrap();
        self.current_scope = parent;

        // Erase this scope from the order. This will shift over the indices of all
        // the scopes that were created after us. However, we shouldn't have to
        // worry about other code with outstanding scope indices for these scopes.
        // These scopes were all created in between this scope's push and pop
        // operations, so they should all be child scopes and should all be popped
        // by the time we get here.
        self.scopes_in_order[scope_index] = None;
        // Decrement the length so that in code with lots of scopes, we use
        // less memory and do less work
        if self.scopes_in_order.len() == scope_index + 1 {
            self.scopes_in_order.truncate(scope_index);
        }

        // Remove the last child from the parent scope
        let last = parent.children.len_u32() - 1;
        debug_assert!(parent.children.slice()[last as usize] == to_flatten);
        parent.children.truncate(last as usize);

        for item in to_flatten.children.slice() {
            let mut item = *item;
            item.parent = Some(parent);
            VecExt::append(&mut parent.children, item);
        }
    }

    /// When not transpiling we dont use the renamer, so our solution is to generate really
    /// hard to collide with variables, instead of actually making things collision free
    pub fn generate_temp_ref(&mut self, default_name: Option<&'a [u8]>) -> Ref {
        self.generate_temp_ref_with_scope(default_name, self.current_scope)
    }

    pub fn generate_temp_ref_with_scope(
        &mut self,
        default_name: Option<&'a [u8]>,
        mut scope: js_ast::StoreRef<Scope>,
    ) -> Ref {
        let name: &'a [u8] = if self.will_use_renamer() && default_name.is_some() {
            default_name.unwrap()
        } else {
            self.temp_ref_count += 1;
            bun_alloc::arena_format!(in self.arena, "__bun_temp_ref_{:x}$", self.temp_ref_count)
                .into_bump_str()
                .as_bytes()
        };
        let r#ref = self
            .new_symbol(js_ast::symbol::Kind::Other, name)
            .expect("oom");

        self.temp_refs_to_declare.push(TempRef {
            r#ref,
            ..Default::default()
        });

        VecExt::append(&mut scope.generated, r#ref);

        r#ref
    }

    // compute_ts_enums_map() lives in the round-G `to_ast` impl block below
    // (deduped — earlier draft body removed once both un-gated).

    pub fn should_lower_using_declarations(&self, stmts: &[Stmt]) -> bool {
        // TODO: We do not support lowering await, but when we do this needs to point to that var
        let lower_await = false;

        // Check feature flags first, then iterate statements.
        if !self.options.features.lower_using && !lower_await {
            return false;
        }

        for stmt in stmts {
            if let js_ast::StmtData::SLocal(local) = &stmt.data {
                // Need to re-check lower_using for the k_using case in case lower_await is true
                if (local.kind == js_ast::s::Kind::KUsing && self.options.features.lower_using)
                    || local.kind == js_ast::s::Kind::KAwaitUsing
                {
                    return true;
                }
            }
        }

        false
    }

    const IMPORT_META_HOT_ACCEPT_ERR: &'static [u8] =
        b"Dependencies to `import.meta.hot.accept` must be statically analyzable module specifiers matching direct imports.";

    /// The signatures for `import.meta.hot.accept` are:
    /// `accept()`                   - self accept
    /// `accept(Function)`           - self accept
    /// `accept(string, Function)`   - accepting another module
    /// `accept(string[], Function)` - accepting multiple modules
    ///
    /// The strings that can be passed in the first argument must be module
    /// specifiers that were imported. We enforce that they line up exactly
    /// with ones that were imported, so that it can share an import record.
    ///
    /// This function replaces all specifier strings with `e_special.resolved_specifier_string`
    // blocked_on: rewrite_import_meta_hot_accept_string; Log::add_error wants &[u8] (IMPORT_META_HOT_ACCEPT_ERR is &str)
    pub fn handle_import_meta_hot_accept_call(&mut self, call: &mut E::Call) {
        if call.args.len_u32() == 0 {
            return;
        }
        // PORT NOTE: match `data` by value (it is `Copy`) so the `StoreRef<_>`
        // payloads bind owned + `mut`, letting `to_utf8` mutate the EString in
        // place and `arr.items.slice_mut()` write through `DerefMut` — same
        // arena slots Zig's `*E.String` / `*E.Array` captures wrote to.
        match call.args.at(0).data {
            js_ast::ExprData::EString(mut str_) => {
                let loc = call.args.at(0).loc;
                let Some(d) = self.rewrite_import_meta_hot_accept_string(&mut str_, loc) else {
                    return;
                };
                call.args.mut_(0).data = d;
            }
            js_ast::ExprData::EArray(mut arr) => {
                for item in arr.items.slice_mut() {
                    let js_ast::ExprData::EString(mut s) = item.data else {
                        let _ = self.log().add_error(
                            Some(self.source),
                            item.loc,
                            Self::IMPORT_META_HOT_ACCEPT_ERR,
                        );
                        continue;
                    };
                    let Some(d) = self.rewrite_import_meta_hot_accept_string(&mut s, item.loc)
                    else {
                        return;
                    };
                    item.data = d;
                }
            }
            _ => return,
        }

        call.target.data = js_ast::ExprData::ESpecial(E::Special::HotAcceptVisited);
    }

    // blocked_on: EString::to_utf8 arena arg; ImportRecordList::items() accessor; E::Special::ResolvedSpecifierString takes u32 directly (drop ResolvedSpecifierStringIndex::init)
    fn rewrite_import_meta_hot_accept_string(
        &mut self,
        str_: &mut E::String,
        loc: bun_ast::Loc,
    ) -> Option<js_ast::ExprData> {
        let _ = str_.to_utf8(self.arena);
        let specifier = str_.data;

        let import_record_index = 'found: {
            for (i, import_record) in self.import_records.items().iter().enumerate() {
                if strings::eql(&specifier, import_record.path.text) {
                    break 'found i;
                }
            }
            let _ = self
                .log()
                .add_error(Some(self.source), loc, Self::IMPORT_META_HOT_ACCEPT_ERR);
            return None;
        };

        Some(js_ast::ExprData::ESpecial(
            E::Special::ResolvedSpecifierString(
                u32::try_from(import_record_index).expect("int cast"),
            ),
        ))
    }

    pub fn handle_react_refresh_register(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        original_name: &'a [u8],
        r#ref: Ref,
        export_kind: ReactRefreshExportKind,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(self.options.features.react_fast_refresh);
        debug_assert!(self.current_scope == self.module_scope);

        if ReactRefresh::is_componentish_name(original_name) {
            self.emit_react_refresh_register(stmts, original_name, r#ref, export_kind)?;
        }
        Ok(())
    }

    pub fn emit_react_refresh_register(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        original_name: &'a [u8],
        r#ref: Ref,
        export_kind: ReactRefreshExportKind,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(self.options.features.react_fast_refresh);
        debug_assert!(self.current_scope == self.module_scope);

        // $RefreshReg$(component, "file.ts:Original Name")
        let loc = bun_ast::Loc::EMPTY;
        let label: &'a [u8] = self.arena.alloc_slice_copy(&strings::concat(&[
            self.source.path.pretty,
            b":",
            match export_kind {
                ReactRefreshExportKind::Named => original_name,
                ReactRefreshExportKind::Default => b"default",
            },
        ]));
        let label_expr = self.new_expr(E::String::init(label), loc);
        let call = self.new_expr(
            E::Call {
                target: Expr::init_identifier(self.react_refresh.register_ref, loc),
                args: ExprNodeList::from_slice(&[Expr::init_identifier(r#ref, loc), label_expr]),
                ..Default::default()
            },
            loc,
        );
        stmts.push(self.s(
            S::SExpr {
                value: call,
                ..Default::default()
            },
            loc,
        ));

        self.record_usage(r#ref);
        self.react_refresh.register_used = true;
        Ok(())
    }

    pub fn wrap_value_for_server_component_reference(
        &mut self,
        val: Expr,
        original_name: &'a [u8],
    ) -> Expr {
        debug_assert!(self.options.features.server_components.wraps_exports());
        debug_assert!(self.current_scope == self.module_scope);

        if self.options.features.server_components
            == options::ServerComponents::WrapExportsForServerReference
        {
            bun_core::todo_panic!("registerServerReference");
        }

        let module_path = self.new_expr(
            E::String::init(if self.options.jsx.development {
                self.source.path.pretty
            } else {
                bun_core::todo_panic!("unique_key here")
            }),
            bun_ast::Loc::EMPTY,
        );

        // registerClientReference(
        //   Comp,
        //   "src/filepath.tsx",
        //   "Comp"
        // );
        let name_expr = self.new_expr(E::String::init(original_name), bun_ast::Loc::EMPTY);
        self.new_expr(
            E::Call {
                target: Expr::init_identifier(self.server_components_wrap_ref, bun_ast::Loc::EMPTY),
                args: ExprNodeList::from_slice(&[val, module_path, name_expr]),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        )
    }

    pub fn handle_react_refresh_hook_call(
        &mut self,
        hook_call: &mut E::Call,
        original_name: &[u8],
    ) {
        debug_assert!(self.options.features.react_fast_refresh);
        debug_assert!(ReactRefresh::is_hook_name(original_name));
        // PORT NOTE: Zig stores `?*?HookContext` (raw pointer to stack storage in
        // the visiting fn frame). `ReactRefresh::hook_ctx_mut` centralises the
        // raw-pointer deref and returns a borrow detached from `self` (the
        // storage is on a caller stack frame), so we can call other `&mut self`
        // methods (generate_temp_ref_with_scope, declared_symbols.append) while
        // holding it — exactly mirroring the Zig pointer flow.
        let Some(ctx_storage) = self.react_refresh.hook_ctx_mut() else {
            return; // not in a function, ignore this hook call.
        };

        // if this function has no hooks recorded, initialize a hook context
        // every function visit provides stack storage, which it will inspect at visit finish.
        if ctx_storage.is_none() {
            self.react_refresh.signature_used = true;

            // `StoreRef<Scope>` (Copy + safe `Deref`) lets the parent-chain
            // walk run without raw-pointer `unsafe` and without borrowing
            // `self`.
            let mut scope = self.current_scope_ref();
            loop {
                if scope.kind == js_ast::scope::Kind::FunctionBody
                    || scope.kind == js_ast::scope::Kind::Block
                    || scope.kind == js_ast::scope::Kind::Entry
                {
                    break;
                }
                let Some(p) = scope.parent else { break };
                scope = p;
            }

            let signature_cb = self.generate_temp_ref_with_scope(Some(b"_s"), scope);
            *ctx_storage = Some(crate::HookContext {
                hasher: Wyhash::init(0),
                signature_cb,
                user_hooks: Default::default(),
            });

            // TODO(paperclover): fix the renamer bug. this bug
            // theoretically affects all usages of temp refs, but i cannot
            // find another example of it breaking (like with `using`)
            self.declared_symbols
                .append(DeclaredSymbol {
                    is_top_level: true,
                    ref_: signature_cb,
                })
                .expect("oom");
        }
        let ctx: &mut crate::HookContext = ctx_storage.as_mut().unwrap();

        ctx.hasher.update(original_name);

        if let Some(built_in_hook) = crate::BuiltInHook::from_bytes(original_name) {
            'hash_arg: {
                let arg_index: usize = match built_in_hook {
                    // useState first argument is initial state.
                    crate::BuiltInHook::useState => 0,
                    // useReducer second argument is initial state.
                    crate::BuiltInHook::useReducer => 1,
                    _ => break 'hash_arg,
                };
                if (hook_call.args.len_u32() as usize) <= arg_index {
                    break 'hash_arg;
                }
                let arg = hook_call.args.slice()[arg_index];
                arg.data
                    .write_to_hasher(&mut ctx.hasher, self.symbols.as_mut_slice());
            }
        } else {
            // TODO(port): Zig used `inline .e_identifier, .e_import_identifier, .e_commonjs_export_identifier => |id, tag|`
            // with @unionInit. We expand the three arms.
            match &hook_call.target.data {
                js_ast::ExprData::EIdentifier(id) => {
                    let gop = ctx.user_hooks.get_or_put(id.ref_).expect("oom");
                    if !gop.found_existing {
                        *gop.value_ptr = Expr {
                            data: js_ast::ExprData::EIdentifier(*id),
                            loc: bun_ast::Loc::EMPTY,
                        };
                    }
                }
                js_ast::ExprData::EImportIdentifier(id) => {
                    let gop = ctx.user_hooks.get_or_put(id.ref_).expect("oom");
                    if !gop.found_existing {
                        *gop.value_ptr = Expr {
                            data: js_ast::ExprData::EImportIdentifier(*id),
                            loc: bun_ast::Loc::EMPTY,
                        };
                    }
                }
                js_ast::ExprData::ECommonjsExportIdentifier(id) => {
                    let gop = ctx.user_hooks.get_or_put(id.ref_).expect("oom");
                    if !gop.found_existing {
                        *gop.value_ptr = Expr {
                            data: js_ast::ExprData::ECommonjsExportIdentifier(*id),
                            loc: bun_ast::Loc::EMPTY,
                        };
                    }
                }
                _ => {}
            }
        }

        ctx.hasher.update(b"\x00");
    }

    pub fn handle_react_refresh_post_visit_function_body(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        hook: &crate::HookContext,
    ) {
        debug_assert!(self.options.features.react_fast_refresh);

        // We need to prepend `_s();` as a statement.
        if stmts.len() == stmts.capacity() {
            // If the ArrayList does not have enough capacity, it is
            // re-allocated entirely to fit. Only one slot of new capacity
            // is used since we know this statement list is not going to be
            // appended to afterwards; This function is a post-visit handler.
            let mut new_stmts = BumpVec::with_capacity_in(stmts.len() + 1, self.arena);
            new_stmts.push(Stmt::empty()); // placeholder, overwritten below
            new_stmts.extend_from_slice(stmts.as_slice());
            *stmts = new_stmts;
        } else {
            // The array has enough capacity, so there is no possibility of
            // allocation failure. We just move all of the statements over
            // by one, and increase the length using `addOneAssumeCapacity`
            stmts.push(Stmt::empty()); // PERF(port): was assume_capacity
            let len = stmts.len();
            stmts.copy_within(0..len - 1, 1);
        }

        let loc = bun_ast::Loc::EMPTY;
        let value = self.new_expr(
            E::Call {
                target: Expr::init_identifier(hook.signature_cb, loc),
                ..Default::default()
            },
            loc,
        );
        let prepended_stmt = self.s(
            S::SExpr {
                value,
                ..Default::default()
            },
            loc,
        );
        stmts[0] = prepended_stmt;
    }

    pub fn get_react_refresh_hook_signal_decl(&mut self, signal_cb_ref: Ref) -> Stmt {
        let loc = bun_ast::Loc::EMPTY;
        self.react_refresh.latest_signature_ref = signal_cb_ref;
        // var s_ = $RefreshSig$();
        let binding = self.b(
            B::Identifier {
                r#ref: signal_cb_ref,
            },
            loc,
        );
        let value = Some(self.new_expr(
            E::Call {
                target: Expr::init_identifier(self.react_refresh.create_signature_ref, loc),
                ..Default::default()
            },
            loc,
        ));
        self.s(
            S::Local {
                decls: G::DeclList::init_one(G::Decl { binding, value }),
                ..Default::default()
            },
            loc,
        )
    }

    pub fn get_react_refresh_hook_signal_init(
        &mut self,
        ctx: &mut crate::HookContext,
        function_with_hook_calls: Expr,
    ) -> Expr {
        let loc = bun_ast::Loc::EMPTY;

        let final_ = ctx.hasher.final_();
        let hash_data =
            self.arena
                .alloc_slice_fill_default::<u8>(bun_base64::encode_len_from_size(
                    core::mem::size_of_val(&final_),
                ));
        // Zig: `&std.mem.toBytes(final)`
        let _written = bun_base64::encode(hash_data, &final_.to_ne_bytes());
        debug_assert!(_written == hash_data.len());

        let have_custom_hooks = ctx.user_hooks.count() > 0;
        let have_force_arg = have_custom_hooks || self.react_refresh.force_reset;

        let n_args = 2 + usize::from(have_force_arg) + usize::from(have_custom_hooks);
        let mut args = BumpVec::with_capacity_in(n_args, self.arena);

        args.push(function_with_hook_calls);
        args.push(self.new_expr(E::String::init(hash_data), loc));

        if have_force_arg {
            args.push(self.new_expr(
                E::Boolean {
                    value: self.react_refresh.force_reset,
                },
                loc,
            ));
        }

        if have_custom_hooks {
            // () => [useCustom1, useCustom2]
            let array = self.new_expr(
                E::Array {
                    items: ExprNodeList::from_slice(ctx.user_hooks.values()),
                    ..Default::default()
                },
                loc,
            );
            let ret = self.s(S::Return { value: Some(array) }, loc);
            args.push(self.new_expr(
                E::Arrow {
                    body: G::FnBody {
                        stmts: bun_ast::StoreSlice::new_mut(self.arena.alloc_slice_copy(&[ret])),
                        loc,
                    },
                    prefer_expr: true,
                    ..Default::default()
                },
                loc,
            ));
        }

        // _s(func, "<hash>", force, () => [useCustom])
        self.new_expr(
            E::Call {
                target: Expr::init_identifier(ctx.signature_cb, loc),
                args: ExprNodeList::from_slice(args.as_slice()),
                ..Default::default()
            },
            loc,
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Round-G un-gate: P::to_ast — final assembly P→Ast.
// Split out of the round-D/E gated block above so the parser entry point
// (`Parser::parse` → `to_ast`) typechecks. Heavy sub-calls that are still
// round-E (`ImportScanner::scan`, `ConvertESMExportsForHmr`,
// `apply_repl_transforms`) are wired to their real signatures and un-gated in
// their own rounds. `compute_character_frequency` is fully un-gated
// (lexer.all_comments + CharFreq.scan live).
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn to_ast(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
        exports_kind: js_ast::ExportsKind,
        wrap_mode: WrapMode,
        hashbang: &'a [u8],
    ) -> Result<Box<js_ast::Ast>, bun_core::Error> {
        use crate::lower::lower_esm_exports_hmr::ConvertESMExportsForHmr;
        use crate::scan::scan_imports::ImportScanner;

        let arena = self.arena;

        // if (p.options.tree_shaking and p.options.features.trim_unused_imports) {
        //     p.treeShake(&parts, false);
        // }

        let bundling = self.options.bundle;
        let mut parts_end: usize = usize::from(bundling);

        // When bundling with HMR, we need every module to be just a
        // single part, as we later wrap each module into a function,
        // which requires a single part. Otherwise, you'll end up with
        // multiple instances of a module, each with different parts of
        // the file. That is also why tree-shaking is disabled.
        if self.options.features.hot_module_reloading {
            debug_assert!(!self.options.tree_shaking);
            debug_assert!(self.options.features.hot_module_reloading);

            // PORT NOTE: Zig held `&mut parts[last]` inside `hmr_transform_ctx`
            // while iterating `parts` — Rust borrowck rejects that aliasing.
            // Reshaped via `split_last_mut` so the head slice and tail part are
            // disjoint borrows; `finalize()` takes only the head prefix so the
            // two `&mut` regions stay disjoint (Stacked-Borrows-clean).
            let (last_part, head_parts) = parts
                .split_last_mut()
                .expect("hot_module_reloading parse always has at least one part");
            let mut hmr_transform_ctx = ConvertESMExportsForHmr {
                last_part,
                // Spec P.zig:6390: `p.source.path.isNodeModule()`.
                // Round-G fix: `bun_paths::fs::Path::is_node_module` is now real
                // (checks `name.dir` for `<sep>node_modules<sep>` with the
                // platform separator); the former inline copy mis-handled the
                // Windows separator via a cross-crate `const_format` const.
                is_in_node_modules: self.source.path.is_node_module(),
                imports_seen: Default::default(),
                export_star_props: Vec::new(),
                export_props: Vec::new(),
                stmts: Vec::new(),
            };
            hmr_transform_ctx.stmts.reserve({
                // get a estimate on how many statements there are going to be
                let mut count: usize = 0;
                for part in head_parts.iter() {
                    count += part.stmts.len();
                }
                count += hmr_transform_ctx.last_part.stmts.len();
                count + 2
            });

            for part in head_parts.iter() {
                // Bake does not care about 'import =', as it handles it on it's own
                let _ = ImportScanner::scan::<TYPESCRIPT, SCAN_ONLY, true>(
                    self,
                    part.stmts.slice_mut(),
                    wrap_mode != WrapMode::None,
                    Some(&mut hmr_transform_ctx),
                )?;
            }
            // Re-run for the last part (Zig iterated all `parts.items` including last).
            {
                let last_stmts = hmr_transform_ctx.last_part.stmts;
                let _ = ImportScanner::scan::<TYPESCRIPT, SCAN_ONLY, true>(
                    self,
                    last_stmts.slice_mut(),
                    wrap_mode != WrapMode::None,
                    Some(&mut hmr_transform_ctx),
                )?;
            }

            hmr_transform_ctx.finalize(self, head_parts)?;
        } else {
            // Handle import paths after the whole file has been visited because we need
            // symbol usage counts to be able to remove unused type-only imports in
            // TypeScript code.
            loop {
                let mut kept_import_equals = false;
                let mut removed_import_equals = false;

                let begin = parts_end;
                // Potentially remove some statements, then filter out parts to remove any
                // with no statements
                for idx in begin..parts.len() {
                    // PORT NOTE: Zig `var part = part_;` is a *shallow bitwise copy*
                    // that leaves `parts.items[idx]` intact so the outer multi-pass
                    // loop (which restarts at `begin = parts_end`) re-scans real data
                    // on the next iteration. `mem::take` would zero the slot and
                    // degrade this to a single pass. Match Zig with `ptr::read`; the
                    // duplicate is non-owning (paired with `ptr::write`/`forget`
                    // below to avoid double-drop of arena-backed Vec fields).
                    // SAFETY: idx < parts.len(); Part fields are arena/bump-backed
                    // (Borrowed-origin BabyLists, raw stmt slices) — bitwise copy
                    // matches Zig struct-assignment semantics.
                    let mut part = unsafe { core::ptr::read(&raw const parts[idx]) };
                    self.import_records_for_current_part.clear();
                    self.declared_symbols.clear_retaining_capacity();

                    let result = match ImportScanner::scan::<TYPESCRIPT, SCAN_ONLY, false>(
                        self,
                        part.stmts.slice_mut(),
                        wrap_mode != WrapMode::None,
                        None,
                    ) {
                        Ok(r) => r,
                        Err(e) => {
                            // `part` is a bitwise duplicate of `parts[idx]`;
                            // discard without dropping so the source slot keeps
                            // sole ownership.
                            core::mem::forget(part);
                            return Err(e);
                        }
                    };
                    kept_import_equals = kept_import_equals || result.kept_import_equals;
                    removed_import_equals = removed_import_equals || result.removed_import_equals;

                    part.stmts = bun_ast::StoreSlice::new_mut(result.stmts);
                    if !part.stmts.is_empty() {
                        if self.module_scope().contains_direct_eval
                            && part.declared_symbols.len() > 0
                        {
                            // If this file contains a direct call to "eval()", all parts that
                            // declare top-level symbols must be kept since the eval'd code may
                            // reference those symbols.
                            part.can_be_removed_if_unused = false;
                        }
                        if part.declared_symbols.len() == 0 {
                            // `part` is a bitwise duplicate of `parts[idx]` (via
                            // `ptr::read` above); the old `declared_symbols` is
                            // still owned by that slot. Overwrite without running
                            // Drop to match Zig's plain field assignment.
                            core::mem::forget(core::mem::replace(
                                &mut part.declared_symbols,
                                self.declared_symbols.clone().expect("unreachable"),
                            ));
                        } else {
                            part.declared_symbols
                                .append_list(self.declared_symbols.clone().expect("unreachable"))
                                .expect("unreachable");
                        }

                        if part.import_record_indices.is_empty() {
                            // Bump-arena slice; Vec::from_bump_slice marks origin
                            // Borrowed so Drop is a no-op (matches Zig's
                            // `ImportRecord.List.init(dupe(...))` arena ownership).
                            // The *old* value is a bitwise duplicate of
                            // `parts[idx].import_record_indices` and may be Owned —
                            // overwrite without running Drop to mirror Zig's plain
                            // field assignment.
                            core::mem::forget(core::mem::replace(
                                &mut part.import_record_indices,
                                // SAFETY: `alloc_slice_copy` returns a leaked
                                // bump-arena slice; `u32: Copy` so the bitwise
                                // move is a plain copy (safe `from_arena_slice`).
                                Vec::from_arena_slice(arena.alloc_slice_copy(
                                    self.import_records_for_current_part.as_slice(),
                                )),
                            ));
                        } else {
                            part.import_record_indices
                                .append_slice(self.import_records_for_current_part.as_slice());
                        }

                        // SAFETY: bitwise overwrite matching Zig
                        // `parts.items[parts_end] = part;` — old slot value is not
                        // dropped (arena-owned; Zig never deinit'd it either).
                        unsafe { core::ptr::write(parts.as_mut_ptr().add(parts_end), part) };
                        parts_end += 1;
                    } else {
                        // Drop path: `parts[idx]` still owns this data; discard the
                        // bitwise duplicate without running Drop.
                        core::mem::forget(part);
                    }
                }

                // We need to iterate multiple times if an import-equals statement was
                // removed and there are more import-equals statements that may be removed
                if !kept_import_equals || !removed_import_equals {
                    break;
                }
            }

            // leave the first part in there for namespace export when bundling
            // PORT NOTE: Zig `parts.items.len = parts_end` does not drop the tail.
            // `truncate` would drop slots that may alias kept parts (the loop
            // above did `ptr::read` without clearing the source), so use
            // `set_len` to match Zig's no-destructor semantics.
            // SAFETY: `parts_end <= parts.len()`; tail slots are abandoned
            // (arena-/process-lifetime, same as Zig).
            unsafe { parts.set_len(parts_end) };

            // Do a second pass for exported items now that imported items are filled out.
            // This isn't done for HMR because it already deletes all `.s_export_clause`s
            for part in parts.iter() {
                for stmt in part.stmts.iter() {
                    if let js_ast::StmtData::SExportClause(clause) = &stmt.data {
                        for item in clause.items.iter() {
                            if let Some(import) = self
                                .named_imports
                                .get_ptr_mut(&item.name.ref_.expect("infallible: ref bound"))
                            {
                                import.is_exported = true;
                            }
                        }
                    }
                }
            }
        }

        if wrap_mode == WrapMode::BunCommonjs && !self.options.features.remove_cjs_module_wrapper {
            // This transforms the user's code into.
            //
            //   (function (exports, require, module, __filename, __dirname) {
            //      ...
            //   })
            //
            //  which is then called in `evaluateCommonJSModuleOnce`
            let args = arena.alloc_slice_fill_default::<Arg>(5 + usize::from(self.has_import_meta));
            args[0] = Arg {
                binding: self.b(
                    B::Identifier {
                        r#ref: self.exports_ref,
                    },
                    bun_ast::Loc::EMPTY,
                ),
                ..Default::default()
            };
            args[1] = Arg {
                binding: self.b(
                    B::Identifier {
                        r#ref: self.require_ref,
                    },
                    bun_ast::Loc::EMPTY,
                ),
                ..Default::default()
            };
            args[2] = Arg {
                binding: self.b(
                    B::Identifier {
                        r#ref: self.module_ref,
                    },
                    bun_ast::Loc::EMPTY,
                ),
                ..Default::default()
            };
            args[3] = Arg {
                binding: self.b(
                    B::Identifier {
                        r#ref: self.filename_ref,
                    },
                    bun_ast::Loc::EMPTY,
                ),
                ..Default::default()
            };
            args[4] = Arg {
                binding: self.b(
                    B::Identifier {
                        r#ref: self.dirname_ref,
                    },
                    bun_ast::Loc::EMPTY,
                ),
                ..Default::default()
            };
            if self.has_import_meta {
                self.import_meta_ref = self
                    .new_symbol(js_ast::symbol::Kind::Other, b"$Bun_import_meta")
                    .expect("oom");
                args[5] = Arg {
                    binding: self.b(
                        B::Identifier {
                            r#ref: self.import_meta_ref,
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    ..Default::default()
                };
            }

            let mut total_stmts_count: usize = 0;
            for part in parts.iter() {
                total_stmts_count += part.stmts.len();
            }

            let preserve_strict_mode = self.module_scope().strict_mode
                == js_ast::StrictModeKind::ExplicitStrictMode
                && !(parts.len() > 0
                    && parts[0].stmts.len() > 0
                    && matches!(parts[0].stmts[0].data, js_ast::StmtData::SDirective(_)));

            total_stmts_count += usize::from(preserve_strict_mode);

            // PORT NOTE: Stmt is not Default; fill with `Stmt::empty()`.
            let stmts_to_copy = arena.alloc_slice_fill_with(total_stmts_count, |_| Stmt::empty());
            {
                let mut remaining_stmts = &mut stmts_to_copy[..];
                if preserve_strict_mode {
                    remaining_stmts[0] = self.s(
                        S::Directive {
                            value: b"use strict".into(),
                        },
                        self.module_scope_directive_loc,
                    );
                    remaining_stmts = &mut remaining_stmts[1..];
                }

                for part in parts.iter() {
                    let src = part.stmts.slice();
                    remaining_stmts[..src.len()].copy_from_slice(src);
                    remaining_stmts = &mut remaining_stmts[src.len()..];
                }
                let _ = remaining_stmts;
            }

            let wrapper = self.new_expr(
                E::Function {
                    func: G::Fn {
                        name: None,
                        open_parens_loc: bun_ast::Loc::EMPTY,
                        args: bun_ast::StoreSlice::new_mut(args),
                        body: G::FnBody {
                            loc: bun_ast::Loc::EMPTY,
                            stmts: bun_ast::StoreSlice::new_mut(stmts_to_copy),
                        },
                        // PORT NOTE: Zig `Flags.Function.init(.{ .is_export = false })` →
                        // empty FunctionSet (no flags set).
                        flags: Flags::FUNCTION_NONE,
                        ..Default::default()
                    },
                },
                bun_ast::Loc::EMPTY,
            );

            let top_level_stmts = arena.alloc_slice_copy(&[self.s(
                S::SExpr {
                    value: wrapper,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            )]);

            // PORT NOTE: reshaped — Zig wrote `parts.items.len = 1` directly.
            // BumpVec has no `set_len`-on-grow path; ensure at least one slot then truncate.
            if parts.is_empty() {
                parts.push(js_ast::Part::default());
            }
            parts.truncate(1);
            parts[0].stmts = bun_ast::StoreSlice::new_mut(top_level_stmts);
        }

        // REPL mode transforms
        if self.options.repl_mode {
            // PORT NOTE: Zig `ReplTransforms(@This()).apply` → inherent `apply_repl_transforms`
            // (declared in ast::repl_transforms as an `impl P` mixin).
            self.apply_repl_transforms(parts, arena)?;
        }

        let mut top_level_symbols_to_parts = bun_ast::ast_result::TopLevelSymbolToParts::default();

        if self.options.bundle {
            // Each part tracks the other parts it depends on within this file
            // PORT NOTE: closure captures (top_level, symbols) via the `ctx` arg of
            // `for_each_top_level_symbol`, since the iterator borrows `parts` while the
            // closure mutates `top_level_symbols_to_parts` (disjoint from `self.symbols`).
            struct Ctx<'s> {
                top_level: &'s mut bun_ast::ast_result::TopLevelSymbolToParts,
                symbols: &'s [Symbol],
                part_index: u32,
            }
            for (part_index, part) in parts.iter_mut().enumerate() {
                let mut ctx = Ctx {
                    top_level: &mut top_level_symbols_to_parts,
                    symbols: self.symbols.as_slice(),
                    part_index: part_index as u32,
                };
                DeclaredSymbol::for_each_top_level_symbol(
                    &mut part.declared_symbols,
                    &mut ctx,
                    |ctx: &mut Ctx<'_>, input: Ref| {
                        // If this symbol was merged, use the symbol at the end of the
                        // linked list in the map. This is the case for multiple "var"
                        // declarations with the same name, for example.
                        let mut r#ref = input;
                        let mut symbol_ref = &ctx.symbols[r#ref.inner_index() as usize];
                        while symbol_ref.has_link() {
                            r#ref = symbol_ref.link.get();
                            symbol_ref = &ctx.symbols[r#ref.inner_index() as usize];
                        }

                        let entry = ctx.top_level.get_or_put(r#ref).expect("unreachable");
                        if !entry.found_existing {
                            *entry.value_ptr = Default::default();
                        }
                        entry.value_ptr.push(ctx.part_index);
                    },
                );
            }

            // Pulling in the exports of this module always pulls in the export part
            {
                let entry = top_level_symbols_to_parts
                    .get_or_put(self.exports_ref)
                    .expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = Default::default();
                }
                entry.value_ptr.push(js_ast::NAMESPACE_EXPORT_PART_INDEX);
            }
        }

        let wrapper_ref: Ref = 'brk: {
            if self.options.features.hot_module_reloading {
                break 'brk self.hmr_api_ref;
            }

            // When code splitting is enabled, always create wrapper_ref to match esbuild behavior.
            // Otherwise, use needsWrapperRef() to optimize away unnecessary wrappers.
            if self.options.bundle
                && (self.options.code_splitting || self.needs_wrapper_ref(parts.as_slice()))
            {
                use core::fmt::Write as _;
                let mut buf = bun_alloc::ArenaString::new_in(arena);
                let _ = write!(&mut buf, "require_{}", self.source.fmt_identifier());
                break 'brk self
                    .new_symbol(js_ast::symbol::Kind::Other, buf.into_bump_str().as_bytes())
                    .expect("oom");
            }

            Ref::NONE
        };

        // ── Precompute fields whose initializers borrow `self` mutably so the
        //    Ast struct literal below has no overlapping borrows ──
        // Assign slots to symbols in nested scopes. This is some precomputation for
        // the symbol renaming pass that will happen later in the linker. It's done
        // now in the parser because we want it to be done in parallel per file and
        // we're already executing code in parallel here
        let nested_scope_slot_counts = if self.options.features.minify_identifiers {
            // `StoreRef` handle does not borrow `self`, so the `&mut self.symbols`
            // below does not conflict with the scope read.
            let module_scope = self.module_scope_ref();
            renamer::assign_nested_scope_slots(
                arena,
                module_scope.get(),
                self.symbols.as_mut_slice(),
            )
        } else {
            js_ast::SlotCounts::default()
        };

        let ts_enums = self.compute_ts_enums_map(arena)?;

        // Spec P.zig:6658: `.char_freq = p.computeCharacterFrequency()`.
        let char_freq: Option<js_ast::CharFreq> = self.compute_character_frequency();

        let module_scope_strict = self.module_scope().strict_mode;
        // PORT NOTE: Zig shallow-copies `p.module_scope.*` into Ast; Scope is not
        // `Clone` in Rust (Vec/HashMap members), so move it out and leave
        // a default in `*self.module_scope`. `to_ast` is terminal — the parser
        // does not touch `module_scope` afterwards.
        let module_scope = core::mem::take(self.module_scope_mut());

        let uses_module_ref =
            self.symbols[self.module_ref.inner_index() as usize].use_count_estimate > 0;
        let uses_exports_ref =
            self.symbols[self.exports_ref.inner_index() as usize].use_count_estimate > 0;
        let uses_require_ref = if self.options.bundle {
            self.runtime_imports.__require.is_some()
                && self.symbols[self.runtime_imports.__require.unwrap().inner_index() as usize]
                    .use_count_estimate
                    > 0
        } else {
            self.symbols[self.require_ref.inner_index() as usize].use_count_estimate > 0
        };

        // Spec P.zig:6645: `.runtime_imports = p.runtime_imports` — move the
        // parser's accumulated runtime-helper refs into the Ast so the linker /
        // printer can emit `__require`, `__toESM`, etc. Precompute `require_ref`
        // first since it reads `__require` from the same struct we're taking.
        let require_ref = self.runtime_imports.__require.unwrap_or(self.require_ref);
        let runtime_imports = core::mem::take(&mut self.runtime_imports);

        // PORT NOTE: BumpVec<'a, T> can't be moved into a global-arena Vec;
        // wrap the bump-backed storage as a Borrowed Vec (Drop is no-op).
        // Spec P.zig:6695-6696 uses `moveFromList`, which transfers storage and
        // *zeroes the source*. Mirror that move-and-zero with
        // `mem::replace(.., new_in)` + `into_bump_slice_mut()` so the leftover
        // BumpVec is empty when `P`/the caller's `parts` drops — `Part` carries
        // owning fields (`symbol_uses`, `declared_symbols`,
        // `import_record_indices`) and aliasing the live BumpVec slice (the old
        // `as_mut_slice()` shape) double-dropped them once the parser fell out
        // of scope. Same fix `ImportRecordList::move_to_baby_list` applies.
        let symbols = js_ast::symbol::List::from_bump_vec(core::mem::replace(
            &mut self.symbols,
            BumpVec::new_in(arena),
        ));
        let parts_list =
            Vec::<js_ast::Part>::from_bump_vec(core::mem::replace(parts, BumpVec::new_in(arena)));
        // Spec P.zig:6697: `ImportRecord.List.moveFromList(&p.import_records)`.
        // Round-G fix: use the dedicated adapter so the parser-side list is
        // left empty (Zig move-and-zero) and the BumpVec is leaked into the
        // arena rather than dropped — downstream (printer, linker) resolves
        // every `S.Import`/`E.RequireString`/`E.Import` by index against this.
        let import_records: Vec<ImportRecord> = self.import_records.move_to_baby_list(arena);

        // PERF: box at the construction site so the ~1 KB `Ast` is written
        // straight into the heap allocation and only the thin `Box` pointer is
        // returned up the `_parse → parse → cache → transpiler` chain (see
        // `js_parser::Result` PERF NOTE).
        Ok(Box::new(js_ast::Ast {
            // Spec P.zig:6644: `.runtime_imports = p.runtime_imports`.
            // Round-G: `Ast.runtime_imports` is now the real
            // `parser::Runtime::Imports`; moved out above (P is terminal after
            // `to_ast`).
            runtime_imports,
            module_scope,
            exports_ref: self.exports_ref,
            wrapper_ref,
            module_ref: self.module_ref,
            export_star_import_records: self
                .export_star_import_records
                .as_slice()
                .to_vec()
                .into_boxed_slice(),
            approximate_newline_count: self.lexer.approximate_newline_count,
            exports_kind,
            named_imports: core::mem::take(&mut *self.named_imports),
            named_exports: core::mem::take(&mut self.named_exports),
            import_keyword: self.esm_import_keyword,
            export_keyword: self.esm_export_keyword,
            top_level_symbols_to_parts,
            char_freq,
            directive: if module_scope_strict == js_ast::StrictModeKind::ExplicitStrictMode {
                Some(bun_ast::StoreStr::new(b"use strict"))
            } else {
                None
            },
            nested_scope_slot_counts,

            require_ref,

            force_cjs_to_esm: self.unwrap_all_requires
                || exports_kind == js_ast::ExportsKind::EsmWithDynamicFallbackFromCjs,
            uses_module_ref,
            uses_exports_ref,
            uses_require_ref,
            commonjs_module_exports_assigned_deoptimized: self
                .commonjs_module_exports_assigned_deoptimized,
            top_level_await_keyword: self.top_level_await_keyword,
            commonjs_named_exports: core::mem::take(&mut self.commonjs_named_exports),
            has_commonjs_export_names: self.has_commonjs_export_names,
            has_import_meta: self.has_import_meta,

            // Spec P.zig:6689: `.hashbang = hashbang`.
            hashbang: hashbang.into(),
            // TODO: cross-module constant inlining
            // const_values: self.const_values,
            ts_enums,
            import_meta_ref: self.import_meta_ref,

            symbols,
            parts: parts_list,
            import_records,

            // ── Remaining fields spelled out (their Zig struct-literal
            //    defaults). Previously `..Default::default()` constructed a
            //    full temporary `Ast` — including a `Scope::default()` for
            //    `module_scope` and empty `Vec`/map headers for
            //    `parts`/`symbols`/`import_records`/`named_*` — only to drop
            //    every one of those (all are explicitly set above). Spelling
            //    the six actually-defaulted scalars avoids that temporary's
            //    construct/drop entirely. ──
            has_lazy_export: false,
            runtime_import_record_id: None,
            needs_runtime: false,
            has_top_level_return: false,
            redirect_import_record_index: None,
            target: js_ast::Target::Browser,
        }))
    }

    #[cold]
    #[inline(never)]
    pub fn compute_ts_enums_map(
        &self,
        _arena: &'a Bump,
    ) -> Result<bun_ast::ast_result::TsEnumsMap, bun_core::Error> {
        // When hot module reloading is enabled, we disable enum inlining
        // to avoid making the HMR graph more complicated.
        if self.options.features.hot_module_reloading {
            return Ok(Default::default());
        }

        use bun_ast::{InlinedEnumValue, InlinedEnumValueDecoded};
        let mut map = bun_ast::ast_result::TsEnumsMap::default();
        map.ensure_total_capacity(self.top_level_enums.len())?;
        for r#ref in self.top_level_enums.iter() {
            let Some(js_ast::ts::Data::Namespace(namespace)) =
                self.ref_to_ts_namespace_member.get(r#ref)
            else {
                // Zig `.?` — must be present and a namespace for top-level enums.
                unreachable!("top_level_enums entry missing namespace member data");
            };
            let ns: &js_ast::TSNamespaceMemberMap = namespace;
            let mut inner_map = StringHashMap::<InlinedEnumValue>::default();
            inner_map.ensure_total_capacity(ns.count())?;
            for i in 0..ns.count() {
                let key = &ns.keys()[i];
                let val = &ns.values()[i];
                match val.data {
                    js_ast::ts::Data::EnumNumber(num) => {
                        inner_map.put_assume_capacity(
                            key,
                            InlinedEnumValue::encode(InlinedEnumValueDecoded::Number(num)),
                        );
                    }
                    js_ast::ts::Data::EnumString(str_) => {
                        inner_map.put_assume_capacity(
                            key,
                            InlinedEnumValue::encode(InlinedEnumValueDecoded::String(
                                str_.as_ptr(),
                            )),
                        );
                    }
                    _ => continue,
                }
            }
            map.put_assume_capacity(*r#ref, inner_map);
        }
        Ok(map)
    }

    /// The bundler will generate wrappers to contain top-level side effects using
    /// the '__esm' helper. Example:
    ///
    ///     var init_foo = __esm(() => {
    ///         someExport = Math.random();
    ///     });
    ///
    /// This wrapper can be removed if all of the constructs get moved
    /// outside of the file. Due to paralleization, we can't retroactively
    /// delete the `init_foo` symbol, but instead it must be known far in
    /// advance if the symbol is needed or not.
    ///
    /// The logic in this function must be in sync with the hoisting
    /// logic in `LinkerContext.generateCodeForFileInChunkJS`
    fn needs_wrapper_ref(&self, parts: &[js_ast::Part]) -> bool {
        debug_assert!(self.options.bundle);
        for part in parts {
            // Part.stmts is an arena-owned slice valid for 'a.
            for stmt in part.stmts.iter() {
                match &stmt.data {
                    js_ast::StmtData::SFunction(_) => {}
                    js_ast::StmtData::SClass(class) => {
                        if !class.class.can_be_moved() {
                            return true;
                        }
                    }
                    js_ast::StmtData::SLocal(local) => {
                        if local.was_commonjs_export || self.commonjs_named_exports.count() == 0 {
                            for decl in local.decls.slice() {
                                if let Some(value) = &decl.value {
                                    if !matches!(value.data, js_ast::ExprData::EMissing(_))
                                        && !value.can_be_moved()
                                    {
                                        return true;
                                    }
                                }
                            }
                            continue;
                        }
                        return true;
                    }
                    js_ast::StmtData::SExportDefault(ed) => {
                        if !ed.can_be_moved() {
                            return true;
                        }
                    }
                    js_ast::StmtData::SExportEquals(e) => {
                        if !e.value.can_be_moved() {
                            return true;
                        }
                    }
                    _ => return true,
                }
            }
        }
        false
    }
}

// `P::init` — UN-GATED. Body compiles standalone (verified `cargo check`):
// the Binding2ExprWrapper / ExpressionTransposer self-referential helpers were
// the only blockers and are now seeded with arena-unit placeholders inside the
// struct literal (Phase B wires the real `*P` back-pointer). `Parser::_parse`
// is blocked on this being callable — DO NOT re-gate.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Construct a `P` in place at `out` (matching Zig's `init(..., this: *P) !void`).
    ///
    /// PERF(port): the previous shape returned `Result<Self, _>` by value. `P`
    /// is ~5 KiB; the by-value return forced a stack temp inside `init` (5176-B
    /// frame, ASM-verified) plus a move at the caller's `?` (`_scan_imports`
    /// 14168-B frame, 5× `memcpy`). Zig's `var p: P = undefined; try P.init(..,
    /// &p)` writes the struct exactly once at its final address. This restores
    /// that: every pre-computable post-init mutation is hoisted above the
    /// single `out.write(Self { .. })` so there is no stack temporary `Self`
    /// to relocate.
    ///
    /// On `Ok(())`, `*out` is fully initialized and the caller owns dropping
    /// it (e.g. via `assume_init`); on `Err`, `*out` is left untouched.
    /// Taking `&mut MaybeUninit<Self>` (vs the previous `*mut Self`) makes the
    /// alignment/writability precondition a type guarantee, so this fn is safe.
    pub fn init(
        out: &mut core::mem::MaybeUninit<Self>,
        arena: &'a Bump,
        log: core::ptr::NonNull<bun_ast::Log>,
        source: &'a bun_ast::Source,
        define: &'a Define,
        mut lexer: js_lexer::Lexer<'a>,
        mut opts: ParserOptions<'a>,
    ) -> Result<(), bun_core::Error> {
        // Pre-size the parser's per-file name/ref-keyed symbol maps so the
        // common case never re-hashes while it grows. Upstream Zig grows these
        // incrementally too, but profiling the runtime transpiler showed
        // `hashbrown` `make_hash` / `reserve_rehash` churn from the module
        // scope's member map and the visit-pass `symbol_uses` map being created
        // at zero capacity and reserved one identifier reference at a time. A
        // `source.len() / 16` hint (≈ one symbol per 16 source bytes) covers
        // the vast majority of real files in a single allocation.
        let estimated_symbol_count = source.contents.len() / 16;

        let mut scope_order = ScopeOrderList::with_capacity_in(1, arena);
        let scope_obj = arena.alloc(Scope {
            members: Default::default(),
            children: bun_alloc::AstAlloc::vec(),
            generated: bun_alloc::AstAlloc::vec(),
            kind: js_ast::scope::Kind::Entry,
            label_ref: None,
            parent: None,
            ..Default::default()
        });
        let _ = scope_obj.members.ensure_total_capacity(estimated_symbol_count);
        let scope = js_ast::StoreRef::from_bump(scope_obj);

        scope_order.push(Some(ScopeOrder::new(loc_module_scope, scope.as_ptr())));
        // PERF(port): was assume_capacity

        // Only enable during bundling, when not bundling CJS
        let commonjs_named_exports_deoptimized = if opts.bundle {
            opts.output_format == options::Format::Cjs
        } else {
            true
        };

        // ─── Hoisted post-init mutations (were `this.* = ...` after the
        // literal in the by-value-return shape; now precomputed so the
        // literal below is the *only* write to `*out`). ───
        lexer.track_comments = opts.features.minify_identifiers;

        if !TYPESCRIPT {
            // This is so it doesn't impact runtime transpiler caching when not in use
            opts.features.emit_decorator_metadata = false;
        }

        let unwrap_all_requires = 'brk: {
            if opts.bundle && opts.output_format != options::Format::Cjs {
                // Zig: `source.path.packageName()` — `bun_paths::fs::Path<'static>` is the
                // crate-local minimal stub (no `pretty`, no `package_name()`),
                // so reuse the free `path_package_name` body via a borrowed
                // `bun_paths::fs::Path` view over the same `text`. `pretty`
                // is irrelevant once `node_modules/` is found in `text`; when
                // it isn't, the result won't match any `unwrap_commonjs_packages`
                // entry anyway. // TODO(b2-blocked): unify bun_paths::fs::Path<'static> → bun_paths::fs::Path
                let path_view = fs::Path {
                    text: source.path.text,
                    pretty: source.path.text,
                    ..Default::default()
                };
                if let Some(pkg) = path_package_name(&path_view) {
                    if opts.features.should_unwrap_require(pkg) {
                        if pkg == b"react" || pkg == b"react-dom" {
                            let version = opts.package_version;
                            if version.len() > 2
                                && (version[0] == b'0' || (version[0] == b'1' && version[1] < b'8'))
                            {
                                break 'brk false;
                            }
                        }
                        break 'brk true;
                    }
                }
            }
            false
        };

        let mut fn_or_arrow_data_parse = FnOrArrowDataParse::default();
        if opts.features.top_level_await || SCAN_ONLY {
            fn_or_arrow_data_parse.allow_await = crate::AwaitOrYield::AllowExpr;
            fn_or_arrow_data_parse.is_top_level = true;
        }

        let mut symbol_uses = SymbolUseMap::default();
        let _ = symbol_uses.ensure_total_capacity(estimated_symbol_count);

        // JSX transform mode — was the `<J: JsxT>` const-generic parameter,
        // now a runtime field (matches `Parser::parse`'s own `if jsx.parse`
        // dispatch). Computed before the literal so it can still read `opts`.
        let jsx_transform = JSXTransformType::from_parse_flag(opts.jsx.parse);

        // Single placement write — no separate stack temp for `Self`.
        // `MaybeUninit::write` is safe; it overwrites without dropping.
        out.write(Self {
            legacy_cjs_import_stmts: BumpVec::new_in(arena),
            // This must default to true or else parsing "in" won't work right.
            // It will fail for the case in the "in-keyword.js" file
            allow_in: true,

            call_target: null_expr_data(),
            delete_target: null_expr_data(),
            stmt_expr_value: null_expr_data(),
            loop_body: null_stmt_data(),
            define,
            import_records: ImportRecordList::Owned(BumpVec::new_in(arena)), // overwritten below for !SCAN_ONLY
            named_imports: NamedImportsType::Owned(Default::default()), // overwritten below for !SCAN_ONLY
            named_exports: Default::default(),
            log,
            stack_check: bun_core::StackCheck::init(),
            parse_stmt_depth: 0,
            arena,
            then_catch_chain: ThenCatchChain {
                next_target: null_expr_data(),
                has_multiple_args: false,
                has_catch: false,
            },
            // Zig: `Binding2ExprWrapper.{Namespace,Hoisted}.init(this)` at the
            // tail of `init`; deferred to `prepare_for_visit_pass` for the same
            // reason as the transposers (self moves on return).
            to_expr_wrapper_namespace: bun_ast::binding::ToExprWrapper::dangling(),
            to_expr_wrapper_hoisted: bun_ast::binding::ToExprWrapper::dangling(),
            // Zig's ExpressionTransposer captures `*P`; in Rust the recursion
            // lives as inherent `P::maybe_transpose_if_*` methods (no aliased
            // `&mut`). These ZST fields exist only to keep field-shape parity.
            import_transposer: ImportTransposer::dangling(),
            require_transposer: RequireTransposer::dangling(),
            require_resolve_transposer: RequireResolveTransposer::dangling(),
            source,
            // Zig: `MacroState.init(arena)` leaves `prepend_stmts = undefined`;
            // Rust cannot leave a `&'a mut Vec<Stmt>` uninitialized, so allocate
            // an empty placeholder in the arena (real list is wired by the visit
            // pass before any macro expansion runs).
            macro_: MacroState::init(arena.alloc(Vec::new())),
            current_scope: scope,
            module_scope: scope,
            scopes_in_order: scope_order,
            needs_jsx_import: false, // Zig: `if (scan_only) false else void` — NeedsJSXType collapsed to `bool`
            lexer,

            commonjs_named_exports_deoptimized,

            // ─── all remaining fields default ───
            allow_private_identifiers: false,
            has_top_level_return: false,
            latest_return_had_semicolon: false,
            has_import_meta: false,
            has_es_module_syntax: false,
            top_level_await_keyword: bun_ast::Range::NONE,
            fn_or_arrow_data_parse,
            fn_or_arrow_data_visit: FnOrArrowDataVisit::default(),
            fn_only_data_visit: FnOnlyDataVisit::default(),
            allocated_names: BumpVec::new_in(arena),
            latest_arrow_arg_loc: bun_ast::Loc::EMPTY,
            forbid_suffix_after_as_loc: bun_ast::Loc::EMPTY,
            scopes_for_current_part: BumpVec::new_in(arena),
            symbols: BumpVec::new_in(arena),
            ts_use_counts: BumpVec::new_in(arena),
            exports_ref: Ref::NONE,
            require_ref: Ref::NONE,
            module_ref: Ref::NONE,
            filename_ref: Ref::NONE,
            dirname_ref: Ref::NONE,
            import_meta_ref: Ref::NONE,
            hmr_api_ref: Ref::NONE,
            response_ref: Ref::NONE,
            bun_app_namespace_ref: Ref::NONE,
            bundler_feature_flag_ref: Ref::NONE,
            in_branch_condition: false,
            scopes_in_order_visitor_index: 0,
            has_classic_runtime_warned: false,
            macro_call_count: 0,
            hoisted_ref_for_sloppy_mode_block_fn: Default::default(),
            has_export_default: false,
            has_export_keyword: false,
            has_with_scope: false,
            is_file_considered_to_have_esm_exports: false,
            has_called_runtime: false,
            injected_define_symbols: BumpVec::new_in(arena),
            symbol_uses,
            declared_symbols: Default::default(),
            declared_symbols_for_reuse: Default::default(),
            runtime_imports: RuntimeImports::default(),
            imports_to_convert_from_require: BumpVec::new_in(arena),
            unwrap_all_requires,
            commonjs_named_exports: Default::default(),
            commonjs_module_exports_assigned_deoptimized: false,
            commonjs_named_exports_needs_conversion: u32::MAX,
            had_commonjs_named_exports_this_visit: false,
            commonjs_replacement_stmts: js_ast::StmtNodeList::EMPTY,
            parse_pass_symbol_uses: None,
            has_commonjs_export_names: false,
            should_fold_typescript_constant_expressions: false,
            emitted_namespace_vars: RefMap::default(),
            is_exported_inside_namespace: Default::default(),
            local_type_names: StringBoolMap::default(),
            enclosing_namespace_arg_ref: None,
            jsx_imports: crate::JSXImportSymbols::default(),
            react_refresh: ReactRefresh::default(),
            server_components_wrap_ref: Ref::NONE,
            jest: Jest::default(),
            import_records_for_current_part: BumpVec::new_in(arena),
            export_star_import_records: BumpVec::new_in(arena),
            import_symbol_property_uses: Default::default(),
            esm_import_keyword: bun_ast::Range::NONE,
            esm_export_keyword: bun_ast::Range::NONE,
            enclosing_class_keyword: bun_ast::Range::NONE,
            import_items_for_namespace: Default::default(),
            is_import_item: Default::default(),
            import_namespace_cc_map: Default::default(),
            scope_order_to_visit: &[],
            module_scope_directive_loc: bun_ast::Loc::default(),
            is_control_flow_dead: false,
            is_revisit_for_substitution: false,
            method_call_must_be_replaced_with_undefined: false,
            has_non_local_export_declare_inside_namespace: false,
            await_target: None,
            temp_refs_to_declare: BumpVec::new_in(arena),
            temp_ref_count: 0,
            relocated_top_level_vars: BumpVec::new_in(arena),
            after_arrow_body_loc: bun_ast::Loc::EMPTY,
            const_values: Default::default(),
            binary_expression_stack: BumpVec::new_in(arena),
            binary_expression_simplify_stack: BumpVec::new_in(arena),
            ref_to_ts_namespace_member: Default::default(),
            ts_namespace: RecentlyVisitedTSNamespace {
                expr: null_expr_data(),
                map: None,
            },
            top_level_enums: BumpVec::new_in(arena),
            scopes_in_order_for_enum: Default::default(),
            will_wrap_module_in_try_catch_for_using: false,
            nearest_stmt_list: None,
            decorator_class_name: None,

            jsx_transform,

            // Moved-in last so the field expressions above can still read `opts.*`.
            options: opts,
        });

        // PORT NOTE: Zig wires `ImportTransposer.init(this)` etc. here. In Rust
        // the recursion lives as inherent `P::maybe_transpose_if_*` methods
        // called directly (no stored `*mut P`), and `Binding2ExprWrapper`
        // receives its `*mut P` per-call from the live `&mut P` at the call
        // site — `prepare_for_visit_pass` only wires the arena/trampoline.
        //
        // For SCAN_ONLY, the caller (Parser) assigns the borrowed
        // `import_records` / `named_imports` variants after construction; for
        // !SCAN_ONLY the literal's `Owned(..)` defaults are already correct
        // (the previous post-init `if !SCAN_ONLY { .. }` rewrites were
        // redundant with the literal and have been dropped).

        Ok(())
    }
}

// ─── LowerUsingDeclarationsContext (Zig: nested `pub const ... = struct { ... }`) ───
pub struct LowerUsingDeclarationsContext {
    pub first_using_loc: bun_ast::Loc,
    pub stack_ref: Ref,
    pub has_await_using: bool,
}

// Round-H un-gate: `generate_temp_ref` / `call_runtime` are now real (5516/6407),
// so the only blockers were API-shape divergences. Reshaped:
//   • `call_runtime` takes `ExprNodeList` → wrap bump slices via `from_bump_slice`
//   • `DeclaredSymbol.ref_` / `LocRef.ref_` (not `r#ref`)
//   • `DeclaredSymbolList`/`Vec` API has no arena param in this port
//   • `G::Decl::List` → `G::DeclList` (free alias; inherent assoc type not used)
// reconciler-6 re-gate removed: those API divergences are fixed inline below;
// `generate_temp_ref` is real (round-G, see ~6407). DO NOT re-gate — `visit.rs`
// calls these via `should_lower_using_declarations` path.
impl LowerUsingDeclarationsContext {
    pub fn init<'a, const T: bool, const S_: bool>(
        p: &mut P<'a, T, S_>,
    ) -> Result<Self, bun_core::Error> {
        Ok(Self {
            first_using_loc: bun_ast::Loc::EMPTY,
            stack_ref: p.generate_temp_ref(Some(b"__stack")),
            has_await_using: false,
        })
    }

    pub fn scan_stmts<'a, const T: bool, const S_: bool>(
        &mut self,
        p: &mut P<'a, T, S_>,
        stmts: &mut [Stmt],
    ) {
        for stmt in stmts.iter_mut() {
            // PORT NOTE: Zig `switch (stmt.data) { .s_local => |local| ... }` —
            // `local` is a `*S.Local`. Match the `StoreRef` by value (Copy ptr)
            // so DerefMut writes through to the arena slot.
            let stmt_loc = stmt.loc;
            let js_ast::StmtData::SLocal(mut local) = stmt.data else {
                continue;
            };
            if !local.kind.is_using() {
                continue;
            }

            if self.first_using_loc.is_empty() {
                self.first_using_loc = stmt_loc;
            }
            if local.kind == js_ast::s::Kind::KAwaitUsing {
                self.has_await_using = true;
            }
            let local_kind = local.kind;
            for decl in local.decls.slice_mut() {
                if let Some(decl_value) = &mut decl.value {
                    let value_loc = decl_value.loc;
                    p.record_usage(self.stack_ref);
                    let args = p.arena.alloc_slice_copy(&[
                        p.new_expr(
                            E::Identifier {
                                ref_: self.stack_ref,
                                ..Default::default()
                            },
                            stmt_loc,
                        ),
                        *decl_value,
                        // 1. always pass this param for hopefully better jit performance
                        // 2. pass 1 or 0 to be shorter than `true` or `false`
                        p.new_expr(
                            E::Number {
                                value: if local_kind == js_ast::s::Kind::KAwaitUsing {
                                    1.0
                                } else {
                                    0.0
                                },
                            },
                            stmt_loc,
                        ),
                    ]);
                    decl.value = Some(p.call_runtime(
                        value_loc,
                        b"__using",
                        ExprNodeList::from_arena_slice(args),
                    ));
                }
            }
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            if p.will_wrap_module_in_try_catch_for_using
                && p.current_scope().kind == js_ast::scope::Kind::Entry
            {
                local.kind = js_ast::s::Kind::KVar;
            } else {
                local.kind = js_ast::s::Kind::KConst;
            }
        }
    }

    pub fn finalize<'a, const T: bool, const S_: bool>(
        &mut self,
        p: &mut P<'a, T, S_>,
        stmts: &'a mut [Stmt],
        should_hoist_fns: bool,
    ) -> ListManaged<'a, Stmt> {
        let mut result = BumpVec::new_in(p.arena);
        let mut exports = BumpVec::<js_ast::ClauseItem>::new_in(p.arena);
        let mut end: u32 = 0;
        for i in 0..stmts.len() {
            let stmt = stmts[i];
            match stmt.data {
                js_ast::StmtData::SDirective(_)
                | js_ast::StmtData::SImport(_)
                | js_ast::StmtData::SExportFrom(_)
                | js_ast::StmtData::SExportStar(_) => {
                    // These can't go in a try/catch block
                    result.push(stmt);
                    continue;
                }
                js_ast::StmtData::SClass(c) => {
                    if c.is_export {
                        // can't go in try/catch; hoist out
                        result.push(stmt);
                        continue;
                    }
                }
                js_ast::StmtData::SExportDefault(_) => {
                    continue; // this prevents re-exporting default since we already have it as an .s_export_clause
                }
                js_ast::StmtData::SExportClause(data) => {
                    // Merge export clauses together.
                    // PORT NOTE: ClauseItem isn't `Clone` (POD-only fields, no derive);
                    // shallow-copy via ptr::read to mirror Zig `appendSlice`.
                    // arena-owned `StoreSlice<ClauseItem>` valid for 'a; the source
                    // slot is never read again (this whole stmt is dropped via the
                    // `continue` below) — safe to `ptr::read` each item.
                    let items = data.items.slice();
                    exports.reserve(items.len());
                    for item in items {
                        exports.push(unsafe { core::ptr::read(item) });
                    }
                    continue;
                }
                js_ast::StmtData::SFunction(_) => {
                    if should_hoist_fns {
                        // Hoist function declarations for cross-file ESM references
                        result.push(stmt);
                        continue;
                    }
                }
                js_ast::StmtData::SLocal(mut local) => {
                    // If any of these are exported, turn it into a "var" and add export clauses
                    if local.is_export {
                        local.is_export = false;
                        // PORT NOTE: Zig wrote `local.kind = .k_var` inside the
                        // decls loop; borrowck rejects that aliasing through
                        // StoreRef DerefMut. Hoist the kind write below.
                        let mut any_ident = false;
                        for decl in local.decls.slice() {
                            if let js_ast::b::B::BIdentifier(identifier) = decl.binding.data {
                                let id_ref = identifier.r#ref;
                                exports.push(js_ast::ClauseItem {
                                    name: LocRef {
                                        loc: decl.binding.loc,
                                        ref_: Some(id_ref),
                                    },
                                    alias: p.symbols[id_ref.inner_index() as usize].original_name,
                                    alias_loc: decl.binding.loc,
                                    ..Default::default()
                                });
                                any_ident = true;
                            }
                        }
                        if any_ident {
                            local.kind = js_ast::s::Kind::KVar;
                        }
                    }
                }
                _ => {}
            }

            stmts[end as usize] = stmt;
            end += 1;
        }

        let non_exported_statements = bun_ast::StoreSlice::new_mut(&mut stmts[..end as usize]);

        let caught_ref = p.generate_temp_ref(Some(b"_catch"));
        let err_ref = p.generate_temp_ref(Some(b"_err"));
        let has_err_ref = p.generate_temp_ref(Some(b"_hasErr"));

        // `StoreRef<Scope>` (Copy + safe `Deref`/`DerefMut`) lets the
        // parent-chain walk and the `.generated` writes below run without
        // raw-pointer `unsafe`, and does not borrow `p`.
        let mut scope: js_ast::StoreRef<Scope> = p.current_scope_ref();
        while !scope.kind_stops_hoisting() {
            scope = scope.parent.unwrap();
        }

        let is_top_level = scope == p.module_scope;
        scope
            .generated
            .append_slice(&[self.stack_ref, caught_ref, err_ref, has_err_ref]);
        p.declared_symbols
            .ensure_unused_capacity(
                // 5 to include the _promise decl later on:
                if self.has_await_using { 5 } else { 4 },
            )
            .expect("oom");
        p.declared_symbols.append_assume_capacity(DeclaredSymbol {
            is_top_level,
            ref_: self.stack_ref,
        });
        p.declared_symbols.append_assume_capacity(DeclaredSymbol {
            is_top_level,
            ref_: caught_ref,
        });
        p.declared_symbols.append_assume_capacity(DeclaredSymbol {
            is_top_level,
            ref_: err_ref,
        });
        p.declared_symbols.append_assume_capacity(DeclaredSymbol {
            is_top_level,
            ref_: has_err_ref,
        });

        let loc = self.first_using_loc;
        let call_dispose = {
            p.record_usage(self.stack_ref);
            p.record_usage(err_ref);
            p.record_usage(has_err_ref);
            let args = p.arena.alloc_slice_copy(&[
                p.new_expr(
                    E::Identifier {
                        ref_: self.stack_ref,
                        ..Default::default()
                    },
                    loc,
                ),
                p.new_expr(
                    E::Identifier {
                        ref_: err_ref,
                        ..Default::default()
                    },
                    loc,
                ),
                p.new_expr(
                    E::Identifier {
                        ref_: has_err_ref,
                        ..Default::default()
                    },
                    loc,
                ),
            ]);
            p.call_runtime(loc, b"__callDispose", ExprNodeList::from_arena_slice(args))
        };

        let finally_stmts: &'a mut [Stmt] = if self.has_await_using {
            let promise_ref = p.generate_temp_ref(Some(b"_promise"));
            VecExt::append(&mut scope.generated, promise_ref);
            p.declared_symbols.append_assume_capacity(DeclaredSymbol {
                is_top_level,
                ref_: promise_ref,
            });

            let promise_ref_expr = p.new_expr(
                E::Identifier {
                    ref_: promise_ref,
                    ..Default::default()
                },
                loc,
            );

            let await_expr = p.new_expr(
                E::Await {
                    value: promise_ref_expr,
                },
                loc,
            );
            p.record_usage(promise_ref);

            // var promise = __callDispose(stack, error, hasError);
            let promise_binding = p.b(B::Identifier { r#ref: promise_ref }, loc);
            let stmt0 = p.s(
                S::Local {
                    decls: G::DeclList::init_one(Decl {
                        binding: promise_binding,
                        value: Some(call_dispose),
                    }),
                    ..Default::default()
                },
                loc,
            );

            // The "await" must not happen if an error was thrown before the
            // "await using", so we conditionally await here:
            //
            //   var promise = __callDispose(stack, error, hasError);
            //   promise && await promise;
            //
            let cond_await = p.new_expr(
                E::Binary {
                    op: js_ast::op::Code::BinLogicalAnd,
                    left: promise_ref_expr,
                    right: await_expr,
                },
                loc,
            );
            let stmt1 = p.s(
                S::SExpr {
                    value: cond_await,
                    ..Default::default()
                },
                loc,
            );

            p.arena.alloc_slice_copy(&[stmt0, stmt1])
        } else {
            let call_dispose_loc = call_dispose.loc;
            p.arena.alloc_slice_copy(&[p.s(
                S::SExpr {
                    value: call_dispose,
                    ..Default::default()
                },
                call_dispose_loc,
            )])
        };

        // Wrap everything in a try/catch/finally block
        p.record_usage(caught_ref);
        result.reserve(2 + usize::from(!exports.is_empty()));
        let stack_binding = p.b(
            B::Identifier {
                r#ref: self.stack_ref,
            },
            loc,
        );
        let stack_init = p.new_expr(E::Array::default(), loc);
        result.push(p.s(
            S::Local {
                decls: G::DeclList::init_one(Decl {
                    binding: stack_binding,
                    value: Some(stack_init),
                }),
                kind: js_ast::s::Kind::KLet,
                ..Default::default()
            },
            loc,
        ));
        // PERF(port): was assume_capacity
        let catch_binding = p.b(B::Identifier { r#ref: caught_ref }, loc);
        let catch_body: js_ast::StmtNodeList = {
            let err_binding = p.b(B::Identifier { r#ref: err_ref }, loc);
            let err_value = p.new_expr(
                E::Identifier {
                    ref_: caught_ref,
                    ..Default::default()
                },
                loc,
            );
            let has_err_binding = p.b(B::Identifier { r#ref: has_err_ref }, loc);
            let has_err_value = p.new_expr(E::Number { value: 1.0 }, loc);
            let mut decls = bun_alloc::AstAlloc::vec();
            VecExt::append(
                &mut decls,
                Decl {
                    binding: err_binding,
                    value: Some(err_value),
                },
            );
            VecExt::append(
                &mut decls,
                Decl {
                    binding: has_err_binding,
                    value: Some(has_err_value),
                },
            );
            let stmt0 = p.s(
                S::Local {
                    decls,
                    ..Default::default()
                },
                loc,
            );
            bun_ast::StoreSlice::new_mut(p.arena.alloc_slice_copy(&[stmt0]))
        };
        result.push(p.s(
            S::Try {
                body: non_exported_statements,
                body_loc: loc,
                catch_: Some(js_ast::Catch {
                    binding: Some(catch_binding),
                    body: catch_body,
                    body_loc: loc,
                    loc,
                }),
                finally: Some(js_ast::Finally {
                    loc,
                    stmts: bun_ast::StoreSlice::new_mut(finally_stmts),
                }),
            },
            loc,
        ));

        if !exports.is_empty() {
            result.push(p.s(
                S::ExportClause {
                    items: bun_ast::StoreSlice::new_mut(exports.into_bump_slice_mut()),
                    is_single_line: false,
                },
                loc,
            ));
        }

        result
    }
}

// ─── Helper trait for generate_import_stmt's `symbols: anytype` param ───
// TODO(port): two call shapes exist (RuntimeImports and a string→Ref map). Phase B
// should impl this for both and verify the alias_name() RuntimeImports special case.
pub trait GenerateImportSymbols {
    type Key;
    fn get(&self, key: &Self::Key) -> Option<Ref>;
    fn alias_name(&self, key: &Self::Key) -> &'static [u8];
}

// ─── Module-level statics (Zig: `var ... = ...;` at file scope) ───
// In Zig these were mutable file-level vars used as canonical singletons; in Rust we
// expose constructor fns since `js_ast::ExprData` has interior pointers and isn't `const`.
#[inline]
pub fn null_expr_data() -> js_ast::ExprData {
    js_ast::ExprData::EMissing(E::Missing {})
}
#[inline]
pub fn null_stmt_data() -> js_ast::StmtData {
    js_ast::StmtData::SEmpty(S::Empty {})
}
#[inline]
pub fn key_expr_data() -> js_ast::ExprData {
    // PORT NOTE: Zig's `&Prefill.String.Key` was a `*E.String` to a static.
    // `ExprData::EString` now wraps a `StoreRef<EString>`; allocate a fresh
    // store node from the prefill constant on each call (callers are JSX-only
    // and infrequent — see js_ast::expr::IntoExprData for `EString`).
    use js_ast::expr::IntoExprData as _;
    E::String::init(b"key").into_data_store()
}
#[inline]
pub fn null_value_expr() -> js_ast::ExprData {
    js_ast::ExprData::ENull(E::Null {})
}
#[inline]
pub fn false_value_expr() -> js_ast::ExprData {
    js_ast::ExprData::EBoolean(E::Boolean { value: false })
}

// ported from: src/js_parser/ast/P.zig
