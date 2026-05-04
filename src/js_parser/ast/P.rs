// Port of src/js_parser/ast/P.zig
//
// This file defines the `P` parser struct (generic over typescript/jsx/scan_only
// const params) and its core methods. The Zig original uses
// `fn NewParser_(comptime ...) type { return struct {...} }` which becomes a
// generic struct + impl in Rust.

use core::ptr::NonNull;
use std::io::Write as _;

use bumpalo::Bump;

use bun_alloc::Arena;
use bun_collections::{BabyList, HashMap, ArrayHashMap, StringHashMap};
use bun_core::{Environment, FeatureFlags, Output};
use bun_logger as logger;
use bun_options_types::{ImportRecord, ImportKind};
use bun_str::strings;
use bun_wyhash as wyhash;

use crate::js_lexer;
use crate::ast as js_ast;
use crate::ast::{
    B, Binding, BindingNodeIndex, DeclaredSymbol, E, Expr, ExprNodeIndex, ExprNodeList, Flags,
    LocRef, S, Scope, Stmt, StmtNodeIndex, StmtNodeList, Symbol,
    G, SlotCounts,
};
use crate::ast::G::{Arg, Decl, Property};
use crate::ast::Part::{SymbolPropertyUseMap, SymbolUseMap};
use crate::{
    ConvertESMExportsForHmr, DeferredArrowArgErrors, DeferredErrors, DeferredImportNamespace,
    ExprBindingTuple, ExpressionTransposer, FindLabelSymbolResult, FnOnlyDataVisit,
    FnOrArrowDataParse, FnOrArrowDataVisit, FunctionKind, IdentifierOpts,
    ImportItemForNamespaceMap, ImportNamespaceCallOrConstruct, ImportScanner, InvalidLoc,
    JSXImport, JSXTransformType, Jest, LocList, MacroState, ParseStatementOptions, ParsedPath,
    Parser, Prefill, PrependTempRefsOpts, ReactRefresh, Ref, RefMap, RefRefMap, RuntimeFeatures,
    RuntimeImports, ScanPassResult, ScopeOrder, ScopeOrderList, SideEffects, StmtList,
    StrictModeFeature, StringBoolMap, Substitution, TempRef, ThenCatchChain, TransposeState,
    TypeScript, WrapMode, arguments_str, exports_string_name, fs, generated_symbol_name,
    is_eval_or_arguments, loc_module_scope, options, renamer, statement_cares_about_scope,
};
use crate::repl_transforms;
use bun_bundler::defines::{Define, DefineData};

// Type aliases matching the Zig `const List = std.ArrayListUnmanaged;` etc.
// In this AST crate, lists are arena-backed.
type BumpVec<'a, T> = bumpalo::collections::Vec<'a, T>;
type List<'a, T> = BumpVec<'a, T>;
type ListManaged<'a, T> = BumpVec<'a, T>;
type Map<K, V> = HashMap<K, V>;

#[derive(Default, Clone, Copy)]
pub struct ParserFeatures {
    pub typescript: bool,
    pub jsx: JSXTransformType,
    pub scan_only: bool,
}

// workaround for https://github.com/ziglang/zig/issues/10903 — not needed in Rust;
// `NewParser` is just an alias for the generic struct.
pub type NewParser<const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> =
    P<'static, TYPESCRIPT, JSX, SCAN_ONLY>;
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
}

pub enum NamedImportsType<'a> {
    Owned(js_ast::Ast::NamedImports),
    Borrowed(&'a mut js_ast::Ast::NamedImports),
}
impl<'a> core::ops::Deref for NamedImportsType<'a> {
    type Target = js_ast::Ast::NamedImports;
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
pub type ParsePassSymbolUsageType<'a> = Option<&'a mut ScanPassResult::ParsePassSymbolUsageMap>;
// In Zig: `if (allow_macros) u32 else u0`.
pub type MacroCallCountType = u32;

// ─── Re-exports of sibling-module impls (Zig: `pub const X = mod.X;`) ───
// In Rust these are inherent methods on `P` defined in sibling files via separate
// `impl<...> P<...>` blocks. We re-export the modules so call sites resolve.
pub use super::skip_typescript::*;
pub use super::parse::*;
pub use super::visit::*;
pub use super::visit_binary_expression::BinaryExpressionVisitor;
pub use super::maybe::*;
pub use super::symbols::*;
pub use super::lower_decorators::*;

#[derive(Default)]
pub struct RecentlyVisitedTSNamespace {
    pub expr: Expr::Data,
    pub map: Option<*const js_ast::TSNamespaceMemberMap>,
}

// Unused in Zig (per LIFETIMES.tsv evidence).
pub enum RecentlyVisitedTSNamespaceExpressionData {
    Ref(Ref),
    Ptr(*const E::Dot),
}

#[derive(Clone, Copy)]
pub struct ReactRefreshImportClause {
    pub name: &'static [u8],
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
pub struct P<'a, const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> {
    pub macro_: MacroState,
    pub allocator: &'a Bump,
    pub options: Parser::Options,
    pub log: &'a mut logger::Log,
    pub define: &'a Define,
    pub source: &'a logger::Source,
    pub lexer: js_lexer::Lexer,
    pub allow_in: bool,
    pub allow_private_identifiers: bool,

    pub has_top_level_return: bool,
    pub latest_return_had_semicolon: bool,
    pub has_import_meta: bool,
    pub has_es_module_syntax: bool,
    pub top_level_await_keyword: logger::Range,
    pub fn_or_arrow_data_parse: FnOrArrowDataParse,
    pub fn_or_arrow_data_visit: FnOrArrowDataVisit,
    pub fn_only_data_visit: FnOnlyDataVisit,
    pub allocated_names: List<'a, &'a [u8]>,
    // allocated_names: ListManaged(string) = ListManaged(string).init(bun.default_allocator),
    // allocated_names_pool: ?*AllocatedNamesPool.Node = null,
    pub latest_arrow_arg_loc: logger::Loc,
    pub forbid_suffix_after_as_loc: logger::Loc,
    pub current_scope: *mut js_ast::Scope,
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
    pub declared_symbols: DeclaredSymbol::List,
    pub declared_symbols_for_reuse: DeclaredSymbol::List,
    pub runtime_imports: RuntimeImports,

    /// Used with unwrap_commonjs_packages
    pub imports_to_convert_from_require: List<'a, DeferredImportNamespace>,
    pub unwrap_all_requires: bool,

    pub commonjs_named_exports: js_ast::Ast::CommonJSNamedExports,
    pub commonjs_named_exports_deoptimized: bool,
    pub commonjs_module_exports_assigned_deoptimized: bool,
    pub commonjs_named_exports_needs_conversion: u32,
    pub had_commonjs_named_exports_this_visit: bool,
    pub commonjs_replacement_stmts: StmtNodeList,

    pub parse_pass_symbol_uses: ParsePassSymbolUsageType<'a>,

    /// Used by commonjs_at_runtime
    pub has_commonjs_export_names: bool,

    pub stack_check: bun_core::StackCheck,

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

    pub jsx_imports: JSXImport::Symbols,

    /// only applicable when `.options.features.react_fast_refresh` is set.
    /// populated before visit pass starts.
    pub react_refresh: ReactRefresh,

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
    pub esm_import_keyword: logger::Range,
    pub esm_export_keyword: logger::Range,
    pub enclosing_class_keyword: logger::Range,
    pub import_items_for_namespace: HashMap<Ref, ImportItemForNamespaceMap>,
    pub is_import_item: RefMap,
    pub named_imports: NamedImportsType<'a>,
    pub named_exports: js_ast::Ast::NamedExports,
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
    pub scopes_in_order: ScopeOrderList,
    pub scope_order_to_visit: &'a mut [ScopeOrder],

    // These properties are for the visit pass, which runs after the parse pass.
    // The visit pass binds identifiers to declared symbols, does constant
    // folding, substitutes compile-time variable definitions, and lowers certain
    // syntactic constructs as appropriate.
    pub stmt_expr_value: Expr::Data,
    pub call_target: Expr::Data,
    pub delete_target: Expr::Data,
    pub loop_body: Stmt::Data,
    pub module_scope: *mut js_ast::Scope,
    pub module_scope_directive_loc: logger::Loc,
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
    pub await_target: Option<js_ast::Expr::Data>,

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
    pub after_arrow_body_loc: logger::Loc,
    pub import_transposer: ImportTransposer,
    pub require_transposer: RequireTransposer,
    pub require_resolve_transposer: RequireResolveTransposer,

    pub const_values: js_ast::Ast::ConstValuesMap,

    // These are backed by stack fallback allocators in _parse, and are uninitialized until then.
    // PERF(port): was stack-fallback alloc — profile in Phase B
    pub binary_expression_stack: ListManaged<'a, BinaryExpressionVisitor>,
    pub binary_expression_simplify_stack: ListManaged<'a, SideEffects::BinaryExpressionSimplifyVisitor>,

    /// We build up enough information about the TypeScript namespace hierarchy to
    /// be able to resolve scope lookups and property accesses for TypeScript enum
    /// and namespace features. Each JavaScript scope object inside a namespace
    /// has a reference to a map of exported namespace members from sibling scopes.
    ///
    /// In addition, there is a map from each relevant symbol reference to the data
    /// associated with that namespace or namespace member: "ref_to_ts_namespace_member".
    /// This gives enough info to be able to resolve queries into the namespace.
    pub ref_to_ts_namespace_member: HashMap<Ref, js_ast::TSNamespaceMember::Data>,
    /// When visiting expressions, namespace metadata is associated with the most
    /// recently visited node. If namespace metadata is present, "tsNamespaceTarget"
    /// will be set to the most recently visited node (as a way to mark that this
    /// node has metadata) and "tsNamespaceMemberData" will be set to the metadata.
    pub ts_namespace: RecentlyVisitedTSNamespace,
    pub top_level_enums: List<'a, Ref>,

    pub scopes_in_order_for_enum: ArrayHashMap<logger::Loc, &'a mut [ScopeOrder]>,

    // If this is true, then all top-level statements are wrapped in a try/catch
    pub will_wrap_module_in_try_catch_for_using: bool,

    /// Used for react refresh, it must be able to insert `const _s = $RefreshSig$();`
    pub nearest_stmt_list: Option<NonNull<ListManaged<'a, Stmt>>>,
    // TODO(port): lifetime — points at a stack local saved/restored across calls

    /// Name from assignment context for anonymous decorated class expressions.
    /// Set before visitExpr, consumed by lowerStandardDecoratorsImpl.
    pub decorator_class_name: Option<&'a [u8]>,
}

// Transposer type aliases (Zig: `const ImportTransposer = ExpressionTransposer(P, ..., P.transposeImport);`)
// TODO(port): ExpressionTransposer is a comptime fn-returning-type in Zig; in Rust it
// becomes a generic struct parameterized by a callback. Phase B wires the exact shape.
pub type ImportTransposer = ExpressionTransposer<TransposeState>;
pub type RequireTransposer = ExpressionTransposer<TransposeState>;
pub type RequireResolveTransposer = ExpressionTransposer<Expr>;

// Zig: `const Binding2ExprWrapper = struct { pub const Namespace = Binding.ToExpr(P, P.wrapIdentifierNamespace); ... }`
pub type Binding2ExprWrapperNamespace = Binding::ToExpr;
pub type Binding2ExprWrapperHoisted = Binding::ToExpr;
// TODO(port): Binding.ToExpr(P, fn) is a comptime type-generator; needs a Rust trait/closure in Phase B.

impl<'a, const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool>
    P<'a, TYPESCRIPT, JSX, SCAN_ONLY>
{
    pub const IS_TYPESCRIPT_ENABLED: bool = TYPESCRIPT;
    pub const IS_JSX_ENABLED: bool = !matches!(JSX, JSXTransformType::None);
    pub const ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT: bool = SCAN_ONLY;
    pub const TRACK_SYMBOL_USAGE_DURING_PARSE_PASS: bool = SCAN_ONLY && TYPESCRIPT;
    pub const PARSER_FEATURES: ParserFeatures = ParserFeatures {
        typescript: TYPESCRIPT,
        jsx: JSX,
        scan_only: SCAN_ONLY,
    };
    pub const JSX_TRANSFORM_TYPE: JSXTransformType = JSX;
    pub const ALLOW_MACROS: bool = FeatureFlags::IS_MACRO_ENABLED;

    /// use this instead of checking p.source.index
    /// because when not bundling, p.source.index is `0`
    #[inline]
    pub fn is_source_runtime(&self) -> bool {
        self.options.bundle && self.source.index.is_runtime()
    }

    /// Extracts a matchable "shape" from a dynamic import argument.
    /// Template literals: static parts joined by \x00 placeholders.
    /// Everything else: empty string.
    fn extract_dynamic_specifier_shape(
        &mut self,
        arg: Expr,
        buf: &mut BumpVec<'a, u8>,
    ) -> Result<&'a [u8], bun_core::Error> {
        if let Some(tmpl) = arg.data.as_e_template() {
            if tmpl.tag.is_some() {
                return Ok(b""); // tagged template — opaque
            }
            match &tmpl.head {
                E::Template::Head::Cooked(head) => {
                    buf.extend_from_slice(head.slice(self.allocator));
                }
                E::Template::Head::Raw => return Ok(b""), // shouldn't happen post-visit but be safe
            }
            for part in tmpl.parts.iter() {
                buf.push(0); // \x00 placeholder per interpolation
                match &part.tail {
                    E::Template::Head::Cooked(tail) => {
                        buf.extend_from_slice(tail.slice(self.allocator));
                    }
                    E::Template::Head::Raw => return Ok(b""), // raw tail — treat as opaque
                }
            }
            return Ok(buf.as_slice());
            // TODO(port): lifetime — Zig returned buf.items which borrows buf
        }
        Ok(b"")
    }

    pub fn check_dynamic_specifier(
        &mut self,
        arg: Expr,
        loc: logger::Loc,
        kind: &'static str,
    ) -> Result<(), bun_core::Error> {
        if !self.options.bundle || *self.options.allow_unresolved == options::AllowUnresolved::All {
            return Ok(());
        }

        let mut shape_buf = BumpVec::new_in(self.allocator);
        let shape = self.extract_dynamic_specifier_shape(arg, &mut shape_buf)?;
        if !self.options.allow_unresolved.allows(shape) {
            let r = js_lexer::range_of_identifier(self.source, loc);
            if !shape.is_empty() {
                // Print a human-readable shape: replace \x00 with *
                let display = self.allocator.alloc_slice_copy(shape);
                for c in display.iter_mut() {
                    if *c == 0 {
                        *c = b'*';
                    }
                }
                self.log.add_range_error_fmt_with_note(
                    self.source,
                    r,
                    self.allocator,
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
                )?;
            } else {
                self.log.add_range_error_fmt_with_note(
                    self.source,
                    r,
                    self.allocator,
                    format_args!(
                        "This {} expression will not be bundled because the argument is not a string literal",
                        kind
                    ),
                    format_args!(
                        "To allow opaque dynamic specifiers, use Bun.build({{ allowUnresolved: [\"\"] }}) or pass --allow-unresolved with an empty-string pattern"
                    ),
                    r,
                )?;
            }
        }
        Ok(())
    }

    pub fn transpose_import(&mut self, arg: Expr, state: &TransposeState) -> Expr {
        // The argument must be a string
        if let Some(str_) = arg.data.as_e_string() {
            // Ignore calls to import() if the control flow is provably dead here.
            // We don't want to spend time scanning the required files if they will
            // never be used.
            if self.is_control_flow_dead {
                return self.new_expr(E::Null {}, arg.loc);
            }

            let import_record_index = self.add_import_record(ImportKind::Dynamic, arg.loc, str_.slice(self.allocator));

            if let Some(tag) = state.import_record_tag {
                self.import_records.items_mut()[import_record_index as usize].tag = tag;
            }

            if let Some(loader) = state.import_loader {
                self.import_records.items_mut()[import_record_index as usize].loader = loader;
            }

            self.import_records.items_mut()[import_record_index as usize].flags.handles_import_errors =
                (state.is_await_target && self.fn_or_arrow_data_visit.try_body_count != 0)
                    || state.is_then_catch_target;
            self.import_records_for_current_part.push(import_record_index);

            return self.new_expr(
                E::Import {
                    expr: arg,
                    import_record_index: u32::try_from(import_record_index).unwrap(),
                    options: state.import_options,
                },
                state.loc,
            );
        }

        if self.options.warn_about_unbundled_modules {
            // Use a debug log so people can see this if they want to
            let r = js_lexer::range_of_identifier(self.source, state.loc);
            self.log
                .add_range_debug(
                    self.source,
                    r,
                    "This \"import\" expression cannot be bundled because the argument is not a string literal",
                )
                .expect("unreachable");
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
        if matches!(arg.data, Expr::Data::EString(_)) {
            return self.transpose_require_resolve_known_string(arg);
        }

        if self.options.warn_about_unbundled_modules {
            // Use a debug log so people can see this if they want to
            let r = js_lexer::range_of_identifier(self.source, arg.loc);
            self.log
                .add_range_debug(
                    self.source,
                    r,
                    "This \"require.resolve\" expression cannot be bundled because the argument is not a string literal",
                )
                .expect("unreachable");
        }

        let _ = self.check_dynamic_specifier(arg, arg.loc, "require.resolve()");

        let args = self.allocator.alloc_slice_copy(&[arg]);

        self.new_expr(
            E::Call {
                target: require_resolve_ref,
                args: ExprNodeList::from_owned_slice(args),
                ..Default::default()
            },
            arg.loc,
        )
    }

    #[inline]
    pub fn transpose_require_resolve_known_string(&mut self, arg: Expr) -> Expr {
        debug_assert!(matches!(arg.data, Expr::Data::EString(_)));

        // Ignore calls to import() if the control flow is provably dead here.
        // We don't want to spend time scanning the required files if they will
        // never be used.
        if self.is_control_flow_dead {
            return self.new_expr(E::Null {}, arg.loc);
        }

        let import_record_index = self.add_import_record(
            ImportKind::RequireResolve,
            arg.loc,
            arg.data.e_string().string(self.allocator).expect("unreachable"),
        );
        self.import_records.items_mut()[import_record_index as usize]
            .flags
            .handles_import_errors = self.fn_or_arrow_data_visit.try_body_count != 0;
        self.import_records_for_current_part.push(import_record_index);

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
            let args = self.allocator.alloc_slice_copy(&[arg]);
            return self.new_expr(
                E::Call {
                    target: self.value_for_require(arg.loc),
                    args: ExprNodeList::from_owned_slice(args),
                    ..Default::default()
                },
                arg.loc,
            );
        }

        match &arg.data {
            Expr::Data::EString(str_) => {
                // Ignore calls to require() if the control flow is provably dead here.
                // We don't want to spend time scanning the required files if they will
                // never be used.
                if self.is_control_flow_dead {
                    return Expr { data: null_expr_data(), loc: arg.loc };
                }

                str_.resolve_rope_if_needed(self.allocator);
                let pathname = str_.string(self.allocator).expect("unreachable");
                let path = fs::Path::init(pathname);

                let handles_import_errors = self.fn_or_arrow_data_visit.try_body_count != 0;

                // For unwrapping CommonJS into ESM to fully work
                // we must also unwrap requires into imports.
                let should_unwrap_require = self.options.features.unwrap_commonjs_to_esm
                    && (self.unwrap_all_requires
                        || path
                            .package_name()
                            .map(|pkg| self.options.features.should_unwrap_require(pkg))
                            .unwrap_or(false))
                    // We cannot unwrap a require wrapped in a try/catch because
                    // import statements cannot be wrapped in a try/catch and
                    // require cannot return a promise.
                    && !handles_import_errors;

                if should_unwrap_require {
                    let import_record_index =
                        self.add_import_record_by_range_and_path(ImportKind::Stmt, self.source.range_of_string(arg.loc), path);
                    self.import_records.items_mut()[import_record_index as usize]
                        .flags
                        .handles_import_errors = handles_import_errors;

                    // Note that this symbol may be completely removed later.
                    let mut path_name = fs::PathName::init(path.text);
                    let name = path_name.non_unique_name_string(self.allocator);
                    let namespace_ref = self.new_symbol(Symbol::Kind::Other, name).expect("oom");

                    self.imports_to_convert_from_require.push(DeferredImportNamespace {
                        namespace: LocRef { r#ref: Some(namespace_ref), loc: arg.loc },
                        import_record_id: import_record_index,
                    });
                    self.import_items_for_namespace
                        .insert(namespace_ref, ImportItemForNamespaceMap::new_in(self.allocator));
                    self.record_usage(namespace_ref);

                    if !state.is_require_immediately_assigned_to_decl {
                        return self.new_expr(E::Identifier { r#ref: namespace_ref, ..Default::default() }, arg.loc);
                    }

                    return self.new_expr(
                        E::RequireString {
                            import_record_index,
                            unwrapped_id: u32::try_from(self.imports_to_convert_from_require.len() - 1).unwrap(),
                        },
                        arg.loc,
                    );
                }

                let import_record_index =
                    self.add_import_record_by_range_and_path(ImportKind::Require, self.source.range_of_string(arg.loc), path);
                self.import_records.items_mut()[import_record_index as usize]
                    .flags
                    .handles_import_errors = handles_import_errors;
                self.import_records_for_current_part.push(import_record_index);

                self.new_expr(E::RequireString { import_record_index, ..Default::default() }, arg.loc)
            }
            _ => {
                let _ = self.check_dynamic_specifier(arg, arg.loc, "require()");
                self.record_usage_of_runtime_require();
                let args = self.allocator.alloc_slice_copy(&[arg]);
                self.new_expr(
                    E::Call {
                        target: self.value_for_require(arg.loc),
                        args: ExprNodeList::from_owned_slice(args),
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

    fn is_binding_used(&mut self, binding: Binding, default_export_ref: Ref) -> bool {
        match binding.data {
            Binding::Data::BIdentifier(ident) => {
                if default_export_ref.eql(ident.r#ref) {
                    return true;
                }
                if self.named_imports.contains(&ident.r#ref) {
                    return true;
                }

                for named_export in self.named_exports.values() {
                    if named_export.r#ref.eql(ident.r#ref) {
                        return true;
                    }
                }

                let symbol: &Symbol = &self.symbols[ident.r#ref.inner_index() as usize];
                symbol.use_count_estimate > 0
            }
            Binding::Data::BArray(array) => {
                for item in array.items.iter() {
                    if self.is_binding_used(item.binding, default_export_ref) {
                        return true;
                    }
                }
                false
            }
            Binding::Data::BObject(obj) => {
                for prop in obj.properties.iter() {
                    if self.is_binding_used(prop.value, default_export_ref) {
                        return true;
                    }
                }
                false
            }
            Binding::Data::BMissing(_) => false,
        }
    }

    pub fn tree_shake(&mut self, parts: &mut &'a mut [js_ast::Part], merge: bool) {
        let mut parts_ = core::mem::take(parts);
        // PORT NOTE: Zig used `defer` to merge parts after the loop. We replicate by
        // running the merge logic explicitly after the while-loop below.

        let default_export_ref = self
            .named_exports
            .get(b"default" as &[u8])
            .map(|d| d.r#ref)
            .unwrap_or(Ref::NONE);

        while parts_.len() > 1 {
            let mut parts_end: usize = 0;
            let last_end = parts_.len();

            for i in 0..parts_.len() {
                let part = parts_[i].clone();
                let is_dead = part.can_be_removed_if_unused && 'can_remove_part: {
                    for stmt in part.stmts.iter() {
                        match &stmt.data {
                            Stmt::Data::SLocal(local) => {
                                if local.is_export {
                                    break 'can_remove_part false;
                                }
                                for decl in local.decls.slice() {
                                    if self.is_binding_used(decl.binding, default_export_ref) {
                                        break 'can_remove_part false;
                                    }
                                }
                            }
                            Stmt::Data::SIf(if_statement) => {
                                let result = SideEffects::to_boolean(self, if_statement.test_.data);
                                if !(result.ok && result.side_effects == SideEffects::NoSideEffects && !result.value) {
                                    break 'can_remove_part false;
                                }
                            }
                            Stmt::Data::SWhile(while_statement) => {
                                let result = SideEffects::to_boolean(self, while_statement.test_.data);
                                if !(result.ok && result.side_effects == SideEffects::NoSideEffects && !result.value) {
                                    break 'can_remove_part false;
                                }
                            }
                            Stmt::Data::SFor(for_statement) => {
                                if let Some(expr) = &for_statement.test_ {
                                    let result = SideEffects::to_boolean(self, expr.data);
                                    if !(result.ok && result.side_effects == SideEffects::NoSideEffects && !result.value) {
                                        break 'can_remove_part false;
                                    }
                                }
                            }
                            Stmt::Data::SFunction(func) => {
                                if func.func.flags.contains(Flags::Function::IsExport) {
                                    break 'can_remove_part false;
                                }
                                if let Some(name) = &func.func.name {
                                    let name_ref = name.r#ref.unwrap();
                                    let symbol: &Symbol = &self.symbols[name_ref.inner_index() as usize];

                                    if name_ref.eql(default_export_ref)
                                        || symbol.use_count_estimate > 0
                                        || self.named_exports.contains_key(symbol.original_name)
                                        || self.named_imports.contains(&name_ref)
                                        || self.is_import_item.get(&name_ref).is_some()
                                    {
                                        break 'can_remove_part false;
                                    }
                                }
                            }
                            Stmt::Data::SImport(_)
                            | Stmt::Data::SExportClause(_)
                            | Stmt::Data::SExportFrom(_)
                            | Stmt::Data::SExportDefault(_) => break 'can_remove_part false,

                            Stmt::Data::SClass(class) => {
                                if class.is_export {
                                    break 'can_remove_part false;
                                }
                                if let Some(name) = &class.class.class_name {
                                    let name_ref = name.r#ref.unwrap();
                                    let symbol: &Symbol = &self.symbols[name_ref.inner_index() as usize];

                                    if name_ref.eql(default_export_ref)
                                        || symbol.use_count_estimate > 0
                                        || self.named_exports.contains_key(symbol.original_name)
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
                    self.clear_symbol_usages_from_dead_part(&part);
                    continue;
                }

                parts_[parts_end] = part;
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
                if part.tag == js_ast::Part::Tag::None {
                    stmts_count += part.stmts.len();
                    first_none_part = i.min(first_none_part);
                }
            }

            if first_none_part < parts_.len() {
                let stmts_list = self
                    .allocator
                    .alloc_slice_fill_default::<Stmt>(stmts_count);
                let mut stmts_remain = &mut stmts_list[..];

                for part in parts_.iter() {
                    if part.tag == js_ast::Part::Tag::None {
                        stmts_remain[..part.stmts.len()].copy_from_slice(part.stmts);
                        stmts_remain = &mut stmts_remain[part.stmts.len()..];
                    }
                }

                parts_[first_none_part].stmts = stmts_list;
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
            symbols[r#ref.inner_index() as usize].use_count_estimate =
                symbols[r#ref.inner_index() as usize]
                    .use_count_estimate
                    .saturating_sub(prev.count_estimate);
        }
        let declared_refs = part.declared_symbols.refs();
        for declared in declared_refs {
            symbols[declared.inner_index() as usize].use_count_estimate = 0;
        }
    }

    pub fn s<T>(&self, t: T, loc: logger::Loc) -> Stmt
    where
        T: js_ast::StmtPayload,
    {
        // TODO(port): Zig used @typeInfo to detect *T vs T and pick Stmt.init vs Stmt.alloc.
        // In Rust we expose this via a `StmtPayload` trait that knows how to construct itself.
        // The `only_scan_imports_and_do_not_visit` ExportFrom branch was a no-op (commented out).
        Stmt::alloc(t, loc)
    }

    fn compute_character_frequency(&mut self) -> Option<js_ast::CharFreq> {
        if !self.options.features.minify_identifiers || self.is_source_runtime() {
            return None;
        }

        // Add everything in the file to the histogram
        let mut freq = js_ast::CharFreq { freqs: [0i32; 64] };

        freq.scan(self.source.contents, 1);

        // Subtract out all comments
        for comment_range in self.lexer.all_comments.iter() {
            freq.scan(self.source.text_for_range(*comment_range), -1);
        }

        // Subtract out all import paths
        for record in self.import_records.items() {
            freq.scan(record.path.text, -1);
        }

        fn visit(symbols: &[js_ast::Symbol], char_freq: &mut js_ast::CharFreq, scope: &js_ast::Scope) {
            let mut iter = scope.members.iter();
            while let Some(entry) = iter.next() {
                let symbol: &Symbol = &symbols[entry.value().r#ref.inner_index() as usize];
                if symbol.slot_namespace() != Symbol::SlotNamespace::MustNotBeRenamed {
                    char_freq.scan(symbol.original_name, -(i32::try_from(symbol.use_count_estimate).unwrap()));
                }
            }

            if let Some(r#ref) = scope.label_ref {
                let symbol = &symbols[r#ref.inner_index() as usize];
                if symbol.slot_namespace() != Symbol::SlotNamespace::MustNotBeRenamed {
                    char_freq.scan(symbol.original_name, -(i32::try_from(symbol.use_count_estimate).unwrap()) - 1);
                }
            }

            for child in scope.children.slice() {
                visit(symbols, char_freq, unsafe { &**child });
                // SAFETY: scope.children stores arena-owned *mut Scope; tree is acyclic
            }
        }
        // SAFETY: module_scope is arena-owned and valid for the parser lifetime
        visit(self.symbols.as_slice(), &mut freq, unsafe { &*self.module_scope });

        // TODO: mangledProps

        Some(freq)
    }

    pub fn new_expr<T>(&mut self, t: T, loc: logger::Loc) -> Expr
    where
        T: js_ast::ExprPayload,
    {
        // TODO(port): Zig branched on @typeInfo(Type) == .pointer and on
        // `only_scan_imports_and_do_not_visit` to scan E.Call for require("..").
        // The pointer/value distinction collapses in Rust (Expr::init handles both).
        if SCAN_ONLY {
            if let Some(call) = t.as_e_call() {
                if let Expr::Data::EIdentifier(ident) = call.target.data {
                    // is this a require("something")
                    if self.load_name_from_ref(ident.r#ref) == b"require"
                        && call.args.len == 1
                        && matches!(call.args.at(0).data, Expr::Data::EString(_))
                    {
                        let _ = self.add_import_record(
                            ImportKind::Require,
                            loc,
                            call.args.at(0).data.e_string().string(self.allocator).expect("unreachable"),
                        );
                    }
                }
            }
        }
        Expr::init(t, loc)
    }

    pub fn b<T>(&mut self, t: T, loc: logger::Loc) -> Binding
    where
        T: js_ast::BindingPayload,
    {
        // TODO(port): Zig branched on pointer-ness; Rust unifies via trait.
        Binding::alloc(self.allocator, t, loc)
    }

    pub fn record_exported_binding(&mut self, binding: Binding) {
        match binding.data {
            Binding::Data::BMissing(_) => {}
            Binding::Data::BIdentifier(ident) => {
                let name = self.symbols[ident.r#ref.inner_index() as usize].original_name;
                self.record_export(binding.loc, name, ident.r#ref).expect("unreachable");
            }
            Binding::Data::BArray(array) => {
                for prop in array.items.iter() {
                    self.record_exported_binding(prop.binding);
                }
            }
            Binding::Data::BObject(obj) => {
                for prop in obj.properties.iter() {
                    self.record_exported_binding(prop.value);
                }
            }
        }
    }

    pub fn record_export(
        &mut self,
        loc: logger::Loc,
        alias: &'a [u8],
        r#ref: Ref,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(name) = self.named_exports.get(alias) {
            // Duplicate exports are an error
            let notes = self.allocator.alloc_slice_copy(&[logger::Data {
                text: {
                    let mut v = BumpVec::new_in(self.allocator);
                    let _ = write!(&mut v, "\"{}\" was originally exported here", bstr::BStr::new(alias));
                    v.into_bump_slice()
                },
                location: logger::Location::init_or_null(
                    self.source,
                    js_lexer::range_of_identifier(self.source, name.alias_loc),
                ),
                ..Default::default()
            }]);
            self.log.add_range_error_fmt_with_notes(
                self.source,
                js_lexer::range_of_identifier(self.source, loc),
                self.allocator,
                notes,
                format_args!(
                    "Multiple exports with the same name \"{}\"",
                    bstr::BStr::new(bun_str::strings::trim(alias, b"\"'"))
                ),
            )?;
        } else if !self.is_deoptimized_common_js() {
            self.named_exports
                .put(self.allocator, alias, js_ast::NamedExport { alias_loc: loc, r#ref })?;
        }
        Ok(())
    }

    pub fn is_deoptimized_common_js(&self) -> bool {
        self.commonjs_named_exports_deoptimized && self.commonjs_named_exports.count() > 0
    }

    pub fn record_usage(&mut self, r#ref: Ref) {
        if self.is_revisit_for_substitution {
            return;
        }
        // The use count stored in the symbol is used for generating symbol names
        // during minification. These counts shouldn't include references inside dead
        // code regions since those will be culled.
        if !self.is_control_flow_dead {
            if cfg!(debug_assertions) {
                debug_assert!(self.symbols.len() > r#ref.inner_index() as usize);
            }
            self.symbols[r#ref.inner_index() as usize].use_count_estimate += 1;
            let result = self.symbol_uses.get_or_put(self.allocator, r#ref).expect("unreachable");
            if !result.found_existing {
                *result.value_ptr = Symbol::Use { count_estimate: 1 };
            } else {
                result.value_ptr.count_estimate += 1;
            }
        }

        // The correctness of TypeScript-to-JavaScript conversion relies on accurate
        // symbol use counts for the whole file, including dead code regions. This is
        // tracked separately in a parser-only data structure.
        if TYPESCRIPT {
            self.ts_use_counts[r#ref.inner_index() as usize] += 1;
        }
    }

    pub fn log_arrow_arg_errors(&mut self, errors: &mut DeferredArrowArgErrors) {
        if errors.invalid_expr_await.len > 0 {
            let r = errors.invalid_expr_await;
            self.log
                .add_range_error(self.source, r, "Cannot use an \"await\" expression here")
                .expect("unreachable");
        }

        if errors.invalid_expr_yield.len > 0 {
            let r = errors.invalid_expr_yield;
            self.log
                .add_range_error(self.source, r, "Cannot use a \"yield\" expression here")
                .expect("unreachable");
        }
    }

    pub fn key_name_for_error(&mut self, key: &js_ast::Expr) -> &'a [u8] {
        match &key.data {
            Expr::Data::EString(s) => s.string(self.allocator).expect("unreachable"),
            Expr::Data::EPrivateIdentifier(private) => self.load_name_from_ref(private.r#ref),
            _ => b"property",
        }
    }

    /// This function is very very hot.
    pub fn handle_identifier(
        &mut self,
        loc: logger::Loc,
        ident: E::Identifier,
        original_name: Option<&'a [u8]>,
        opts: IdentifierOpts,
    ) -> Expr {
        let r#ref = ident.r#ref;

        if self.options.features.inlining {
            if let Some(replacement) = self.const_values.get(&r#ref) {
                let replacement = *replacement;
                self.ignore_usage(r#ref);
                return replacement;
            }
        }

        // Create an error for assigning to an import namespace
        if (opts.assign_target != js_ast::AssignTarget::None || opts.is_delete_target)
            && self.symbols[r#ref.inner_index() as usize].kind == Symbol::Kind::Import
        {
            let r = js_lexer::range_of_identifier(self.source, loc);
            self.log
                .add_range_error_fmt(
                    self.source,
                    r,
                    self.allocator,
                    format_args!(
                        "Cannot assign to import \"{}\"",
                        bstr::BStr::new(self.symbols[r#ref.inner_index() as usize].original_name)
                    ),
                )
                .expect("unreachable");
        }

        // Substitute an EImportIdentifier now if this has a namespace alias
        if opts.assign_target == js_ast::AssignTarget::None && !opts.is_delete_target {
            let symbol = &self.symbols[r#ref.inner_index() as usize];
            if let Some(ns_alias) = &symbol.namespace_alias {
                let ns_alias = ns_alias.clone();
                if let Some(ts_member_data) = self.ref_to_ts_namespace_member.get(&ns_alias.namespace_ref) {
                    if let js_ast::TSNamespaceMember::Data::Namespace(ns) = ts_member_data {
                        // SAFETY: arena-owned TSNamespaceMemberMap valid for parser 'a lifetime
                        if let Some(member) = unsafe { &**ns }.get(ns_alias.alias) {
                            match &member.data {
                                js_ast::TSNamespaceMember::Data::EnumNumber(num) => {
                                    let name = self.symbols[r#ref.inner_index() as usize].original_name;
                                    return self.wrap_inlined_enum(
                                        Expr { loc, data: Expr::Data::ENumber(E::Number { value: *num }) },
                                        name,
                                    );
                                }
                                js_ast::TSNamespaceMember::Data::EnumString(str_) => {
                                    let name = self.symbols[r#ref.inner_index() as usize].original_name;
                                    return self.wrap_inlined_enum(
                                        Expr { loc, data: Expr::Data::EString(*str_) },
                                        name,
                                    );
                                }
                                js_ast::TSNamespaceMember::Data::Namespace(map) => {
                                    let map = *map;
                                    let expr = self.new_expr(
                                        E::Dot {
                                            target: self.new_expr(E::Identifier::init(ns_alias.namespace_ref), loc),
                                            name: ns_alias.alias,
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
                }

                return self.new_expr(
                    E::ImportIdentifier { r#ref: ident.r#ref, was_originally_identifier: true },
                    loc,
                );
            }
        }

        // Substitute an EImportIdentifier now if this is an import item
        if self.is_import_item.contains(&r#ref) {
            return self.new_expr(
                E::ImportIdentifier { r#ref, was_originally_identifier: opts.was_originally_identifier },
                loc,
            );
        }

        if TYPESCRIPT {
            if let Some(member_data) = self.ref_to_ts_namespace_member.get(&r#ref).cloned() {
                match member_data {
                    js_ast::TSNamespaceMember::Data::EnumNumber(num) => {
                        let name = self.symbols[r#ref.inner_index() as usize].original_name;
                        return self.wrap_inlined_enum(
                            Expr { loc, data: Expr::Data::ENumber(E::Number { value: num }) },
                            name,
                        );
                    }
                    js_ast::TSNamespaceMember::Data::EnumString(str_) => {
                        let name = self.symbols[r#ref.inner_index() as usize].original_name;
                        return self.wrap_inlined_enum(
                            Expr { loc, data: Expr::Data::EString(str_) },
                            name,
                        );
                    }
                    js_ast::TSNamespaceMember::Data::Namespace(map) => {
                        let expr = Expr { data: Expr::Data::EIdentifier(ident), loc };
                        self.ts_namespace = RecentlyVisitedTSNamespace { expr: expr.data, map: Some(map) };
                        return expr;
                    }
                    _ => {}
                }
            }

            // Substitute a namespace export reference now if appropriate
            if let Some(ns_ref) = self.is_exported_inside_namespace.get(&r#ref).copied() {
                let name = self.symbols[r#ref.inner_index() as usize].original_name;

                self.record_usage(ns_ref);
                let prop = self.new_expr(
                    E::Dot {
                        target: self.new_expr(E::Identifier::init(ns_ref), loc),
                        name,
                        name_loc: loc,
                        ..Default::default()
                    },
                    loc,
                );

                if matches!(self.ts_namespace.expr, Expr::Data::EIdentifier(e) if e.r#ref.eql(ident.r#ref)) {
                    self.ts_namespace.expr = prop.data;
                }

                return prop;
            }
        }

        if let Some(name) = original_name {
            let result = self.find_symbol(loc, name).expect("unreachable");
            let mut id_clone = ident;
            id_clone.r#ref = result.r#ref;
            return self.new_expr(id_clone, loc);
        }

        Expr { data: Expr::Data::EIdentifier(ident), loc }
    }

    pub fn generate_import_stmt_for_bake_response(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(!self.response_ref.is_null());
        debug_assert!(!self.bun_app_namespace_ref.is_null());
        let allocator = self.allocator;

        let import_path: &'static [u8] = b"bun:app";

        let import_record_i = self.add_import_record_by_range(ImportKind::Stmt, logger::Range::NONE, import_path);

        let mut declared_symbols = DeclaredSymbol::List::default();
        declared_symbols.ensure_total_capacity(allocator, 2)?;

        let stmts = allocator.alloc_slice_fill_default::<Stmt>(1);

        declared_symbols.push(DeclaredSymbol { r#ref: self.bun_app_namespace_ref, is_top_level: true });
        // PERF(port): was assume_capacity
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *self.module_scope }.generated.push(allocator, self.bun_app_namespace_ref)?;

        let clause_items = allocator.alloc_slice_copy(&[js_ast::ClauseItem {
            alias: b"Response",
            original_name: b"Response",
            alias_loc: logger::Loc::default(),
            name: LocRef { r#ref: Some(self.response_ref), loc: logger::Loc::default() },
        }]);

        declared_symbols.push(DeclaredSymbol { r#ref: self.response_ref, is_top_level: true });
        // PERF(port): was assume_capacity

        // ensure every e_import_identifier holds the namespace
        if self.options.features.hot_module_reloading {
            let symbol = &mut self.symbols[self.response_ref.inner_index() as usize];
            debug_assert!(symbol.namespace_alias.is_some());
            symbol.namespace_alias.as_mut().unwrap().import_record_index = import_record_i;
        }

        self.is_import_item.put(allocator, self.response_ref, ())?;
        self.named_imports.put(
            allocator,
            self.response_ref,
            js_ast::NamedImport {
                alias: b"Response",
                alias_loc: logger::Loc::default(),
                namespace_ref: self.bun_app_namespace_ref,
                import_record_index: import_record_i,
                ..Default::default()
            },
        )?;

        stmts[0] = self.s(
            S::Import {
                namespace_ref: self.bun_app_namespace_ref,
                items: clause_items,
                import_record_index: import_record_i,
                is_single_line: true,
                ..Default::default()
            },
            logger::Loc::default(),
        );

        let import_records = allocator.alloc_slice_copy(&[import_record_i]);

        // This import is placed in a part before the main code, however
        // the bundler ends up re-ordering this to be after... The order
        // does not matter as ESM imports are always hoisted.
        parts.push(js_ast::Part {
            stmts,
            declared_symbols,
            import_record_indices: BabyList::<u32>::from_owned_slice(import_records),
            tag: js_ast::Part::Tag::Runtime,
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
        let allocator = self.allocator;
        let imports = imports.as_ref();
        let import_record_i = self.add_import_record_by_range(ImportKind::Stmt, logger::Range::NONE, import_path);
        {
            let import_record = &mut self.import_records.items_mut()[import_record_i as usize];
            if is_internal {
                import_record.path.namespace = b"runtime";
            }
            import_record.flags.is_internal = is_internal;
        }
        let import_path_identifier = self.import_records.items()[import_record_i as usize]
            .path
            .name
            .non_unique_name_string(allocator)?;
        let mut namespace_identifier =
            BumpVec::with_capacity_in(import_path_identifier.len() + prefix.len(), allocator);
        namespace_identifier.extend_from_slice(prefix);
        namespace_identifier.extend_from_slice(import_path_identifier);
        let namespace_identifier = namespace_identifier.into_bump_slice();

        let clause_items = allocator.alloc_slice_fill_default::<js_ast::ClauseItem>(imports.len());
        let stmts = allocator.alloc_slice_fill_default::<Stmt>(1 + usize::from(additional_stmt.is_some()));
        let mut declared_symbols = DeclaredSymbol::List::default();
        declared_symbols.ensure_total_capacity(allocator, imports.len() + 1)?;

        let namespace_ref = self.new_symbol(Symbol::Kind::Other, namespace_identifier)?;
        declared_symbols.push(DeclaredSymbol { r#ref: namespace_ref, is_top_level: true });
        // PERF(port): was assume_capacity
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *self.module_scope }.generated.push(allocator, namespace_ref)?;
        for (alias, clause_item) in imports.iter().zip(clause_items.iter_mut()) {
            let r#ref = symbols.get(alias).expect("unreachable");
            let alias_name = symbols.alias_name(alias);
            *clause_item = js_ast::ClauseItem {
                alias: alias_name,
                original_name: alias_name,
                alias_loc: logger::Loc::default(),
                name: LocRef { r#ref: Some(r#ref), loc: logger::Loc::default() },
            };
            declared_symbols.push(DeclaredSymbol { r#ref, is_top_level: true });
            // PERF(port): was assume_capacity

            // ensure every e_import_identifier holds the namespace
            if self.options.features.hot_module_reloading {
                let symbol = &mut self.symbols[r#ref.inner_index() as usize];
                if symbol.namespace_alias.is_none() {
                    symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                        namespace_ref,
                        alias: alias_name,
                        import_record_index: import_record_i,
                    });
                }
            }

            self.is_import_item.put(allocator, r#ref, ())?;
            self.named_imports.put(
                allocator,
                r#ref,
                js_ast::NamedImport {
                    alias: alias_name,
                    alias_loc: logger::Loc::default(),
                    namespace_ref,
                    import_record_index: import_record_i,
                    ..Default::default()
                },
            )?;
        }

        stmts[0] = self.s(
            S::Import {
                namespace_ref,
                items: clause_items,
                import_record_index: import_record_i,
                is_single_line: true,
                ..Default::default()
            },
            logger::Loc::default(),
        );
        if let Some(add) = additional_stmt {
            stmts[1] = add;
        }

        let import_records = allocator.alloc_slice_copy(&[import_record_i]);

        // This import is placed in a part before the main code, however
        // the bundler ends up re-ordering this to be after... The order
        // does not matter as ESM imports are always hoisted.
        parts.push(js_ast::Part {
            stmts,
            declared_symbols,
            import_record_indices: BabyList::<u32>::from_owned_slice(import_records),
            tag: js_ast::Part::Tag::Runtime,
            ..Default::default()
        });
        Ok(())
    }

    pub fn generate_react_refresh_import(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
        import_path: &'a [u8],
        clauses: &[ReactRefreshImportClause],
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
        clauses: &[ReactRefreshImportClause],
    ) -> Result<(), bun_core::Error> {
        // If `hot_module_reloading`, we are going to generate a require call:
        //
        //     const { $RefreshSig$, $RefreshReg$ } = require("react-refresh/runtime")`
        //
        // Otherwise we are going to settle on an import statement. Using
        // require is fine in HMR bundling because `react-refresh` itself is
        // already a CommonJS module, and it will actually be more efficient
        // at runtime this way.
        let allocator = self.allocator;
        let import_record_index =
            self.add_import_record_by_range(ImportKind::Stmt, logger::Range::NONE, import_path);

        // TODO(port): Zig used `if (hot_module_reloading) B.Object.Property else js_ast.ClauseItem`
        // as the item type. We split into two vecs and pick at the end.
        let len = 1
            + usize::from(self.react_refresh.register_used)
            + usize::from(self.react_refresh.signature_used);
        let mut items_hmr = BumpVec::<B::Object::Property>::with_capacity_in(len, allocator);
        let mut items_import = BumpVec::<js_ast::ClauseItem>::with_capacity_in(len, allocator);

        let stmts = allocator.alloc_slice_fill_default::<Stmt>(1);
        let mut declared_symbols = DeclaredSymbol::List::default();
        declared_symbols.ensure_total_capacity(allocator, len)?;

        let namespace_ref = self.new_symbol(Symbol::Kind::Other, b"RefreshRuntime")?;
        declared_symbols.push(DeclaredSymbol { r#ref: namespace_ref, is_top_level: true });
        // PERF(port): was assume_capacity
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *self.module_scope }.generated.push(allocator, namespace_ref)?;

        for entry in clauses {
            if entry.enabled {
                if HOT_MODULE_RELOADING {
                    items_hmr.push(B::Object::Property {
                        key: self.new_expr(E::String { data: entry.name }, logger::Loc::EMPTY),
                        value: self.b(B::Identifier { r#ref: entry.r#ref }, logger::Loc::EMPTY),
                        ..Default::default()
                    });
                } else {
                    items_import.push(js_ast::ClauseItem {
                        alias: entry.name,
                        original_name: entry.name,
                        alias_loc: logger::Loc::default(),
                        name: LocRef { r#ref: Some(entry.r#ref), loc: logger::Loc::default() },
                    });
                }
                // PERF(port): was assume_capacity
                declared_symbols.push(DeclaredSymbol { r#ref: entry.r#ref, is_top_level: true });
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                unsafe { &mut *self.module_scope }.generated.push(allocator, entry.r#ref)?;
                self.is_import_item.put(allocator, entry.r#ref, ())?;
                self.named_imports.put(
                    allocator,
                    entry.r#ref,
                    js_ast::NamedImport {
                        alias: entry.name,
                        alias_loc: logger::Loc::EMPTY,
                        namespace_ref,
                        import_record_index,
                        ..Default::default()
                    },
                )?;
            }
        }

        stmts[0] = if HOT_MODULE_RELOADING {
            self.s(
                S::Local {
                    kind: S::Local::Kind::KConst,
                    decls: Decl::List::from_slice(
                        self.allocator,
                        &[Decl {
                            binding: self.b(B::Object { properties: items_hmr.into_bump_slice(), ..Default::default() }, logger::Loc::EMPTY),
                            value: Some(self.new_expr(E::RequireString { import_record_index, ..Default::default() }, logger::Loc::EMPTY)),
                        }],
                    )?,
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            )
        } else {
            self.s(
                S::Import {
                    namespace_ref,
                    items: items_import.into_bump_slice(),
                    import_record_index,
                    is_single_line: false,
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            )
        };

        parts.push(js_ast::Part {
            stmts,
            declared_symbols,
            import_record_indices: BabyList::<u32>::from_slice(allocator, &[import_record_index])?,
            tag: js_ast::Part::Tag::Runtime,
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
        let expr: *mut Expr = 'brk: {
            match &stmt.data {
                Stmt::Data::SExpr(exp) => break 'brk &mut exp.value as *const _ as *mut _,
                Stmt::Data::SThrow(throw) => break 'brk &mut throw.value as *const _ as *mut _,
                Stmt::Data::SReturn(ret) => {
                    if let Some(value) = &ret.value {
                        break 'brk value as *const _ as *mut _;
                    }
                }
                Stmt::Data::SIf(if_stmt) => break 'brk &mut if_stmt.test_ as *const _ as *mut _,
                Stmt::Data::SSwitch(switch_stmt) => break 'brk &mut switch_stmt.test_ as *const _ as *mut _,
                Stmt::Data::SLocal(local) => {
                    if local.decls.len > 0 {
                        let first = &mut local.decls.ptr_mut()[0];
                        if let Some(value) = &mut first.value {
                            if matches!(first.binding.data, Binding::Data::BIdentifier(_)) {
                                break 'brk value as *mut _;
                            }
                        }
                    }
                }
                _ => {}
            }
            return false;
        };
        // TODO(port): the above takes raw *mut Expr because Stmt::Data variants store
        // arena-backed boxed payloads with interior mutability in Zig. Phase B should
        // re-type these as `&'a mut` once Stmt::Data is finalized.
        // SAFETY: raw *mut Expr into arena-owned tree; parser holds exclusive access during visit
        let expr = unsafe { &mut *expr };

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
        match self.substitute_single_use_symbol_in_expr(*expr, r#ref, replacement, replacement_can_be_removed) {
            Substitution::Success(result) => {
                if matches!(result.data, Expr::Data::EBinary(_) | Expr::Data::EUnary(_) | Expr::Data::EIf(_)) {
                    let prev_substituting = self.is_revisit_for_substitution;
                    self.is_revisit_for_substitution = true;
                    // O(n^2) and we will need to think more carefully about
                    // this once we implement syntax compression
                    *expr = self.visit_expr(result);
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
        'outer: {
            match &expr.data {
                Expr::Data::EIdentifier(ident) => {
                    if ident.r#ref.eql(r#ref)
                        || self.symbols[ident.r#ref.inner_index() as usize].link.eql(r#ref)
                    {
                        self.ignore_usage(r#ref);
                        return Substitution::Success(replacement);
                    }
                }
                Expr::Data::ENew(new) => {
                    match self.substitute_single_use_symbol_in_expr(new.target, r#ref, replacement, replacement_can_be_removed) {
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
                            match self.substitute_single_use_symbol_in_expr(*arg, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::ESpread(spread) => {
                    match self.substitute_single_use_symbol_in_expr(spread.value, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EAwait(await_expr) => {
                    match self.substitute_single_use_symbol_in_expr(await_expr.value, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EYield(yield_) => {
                    let value = yield_.value.unwrap_or(Expr {
                        data: Expr::Data::EMissing(E::Missing {}),
                        loc: expr.loc,
                    });
                    match self.substitute_single_use_symbol_in_expr(value, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EImport(import) => {
                    match self.substitute_single_use_symbol_in_expr(import.expr, r#ref, replacement, replacement_can_be_removed) {
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

                    if replacement_can_be_removed && self.expr_can_be_removed_if_unused(&import.expr) {
                        return Substitution::Continue(expr);
                    }
                }
                Expr::Data::EUnary(e) => {
                    use js_ast::Op;
                    match e.op {
                        Op::UnPreInc | Op::UnPostInc | Op::UnPreDec | Op::UnPostDec | Op::UnDelete => {
                            // Do not substitute into an assignment position
                        }
                        _ => match self.substitute_single_use_symbol_in_expr(e.value, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EDot(e) => {
                    match self.substitute_single_use_symbol_in_expr(e.target, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EBinary(e) => {
                    // Do not substitute into an assignment position
                    if e.op.binary_assign_target() == js_ast::AssignTarget::None {
                        match self.substitute_single_use_symbol_in_expr(e.left, r#ref, replacement, replacement_can_be_removed) {
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
                    } else if e.op.binary_assign_target() == js_ast::AssignTarget::Update && !replacement_can_be_removed {
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
                    match self.substitute_single_use_symbol_in_expr(e.right, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EIf(e) => {
                    match self.substitute_single_use_symbol_in_expr(e.test_, r#ref, replacement, replacement_can_be_removed) {
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

                        let yes = self.substitute_single_use_symbol_in_expr(e.yes, r#ref, replacement, replacement_can_be_removed);
                        if let Substitution::Success(r) = yes {
                            e.yes = r;
                            return Substitution::Success(expr);
                        }

                        let no = self.substitute_single_use_symbol_in_expr(e.no, r#ref, replacement, replacement_can_be_removed);
                        if let Substitution::Success(r) = no {
                            e.no = r;
                            return Substitution::Success(expr);
                        }

                        // Side effects in either branch should stop us from continuing to try to
                        // substitute the replacement after the control flow branches merge again.
                        if !matches!(yes, Substitution::Continue(_)) || !matches!(no, Substitution::Continue(_)) {
                            return Substitution::Failure(expr);
                        }
                    }
                }
                Expr::Data::EIndex(index) => {
                    match self.substitute_single_use_symbol_in_expr(index.target, r#ref, replacement, replacement_can_be_removed) {
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
                        match self.substitute_single_use_symbol_in_expr(index.index, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::ECall(e) => {
                    // Don't substitute something into a call target that could change "this"
                    match replacement.data {
                        Expr::Data::EDot(_) | Expr::Data::EIndex(_) => {
                            if matches!(e.target.data, Expr::Data::EIdentifier(id) if id.r#ref.eql(r#ref)) {
                                break 'outer;
                            }
                        }
                        _ => {}
                    }

                    match self.substitute_single_use_symbol_in_expr(e.target, r#ref, replacement, replacement_can_be_removed) {
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
                            match self.substitute_single_use_symbol_in_expr(*arg, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EArray(e) => {
                    for item in e.items.slice_mut() {
                        match self.substitute_single_use_symbol_in_expr(*item, r#ref, replacement, replacement_can_be_removed) {
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
                Expr::Data::EObject(e) => {
                    for property in e.properties.slice_mut() {
                        // Check the key
                        if property.flags.contains(Flags::Property::IsComputed) {
                            match self.substitute_single_use_symbol_in_expr(property.key.unwrap(), r#ref, replacement, replacement_can_be_removed) {
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
                            match self.substitute_single_use_symbol_in_expr(value, r#ref, replacement, replacement_can_be_removed) {
                                Substitution::Continue(_) => {}
                                Substitution::Success(result) => {
                                    property.value = if matches!(result.data, Expr::Data::EMissing(_)) { None } else { Some(result) };
                                    return Substitution::Success(expr);
                                }
                                Substitution::Failure(result) => {
                                    property.value = if matches!(result.data, Expr::Data::EMissing(_)) { None } else { Some(result) };
                                    return Substitution::Failure(expr);
                                }
                            }
                        }
                    }
                }
                Expr::Data::ETemplate(e) => {
                    if let Some(tag) = &mut e.tag {
                        match self.substitute_single_use_symbol_in_expr(*tag, r#ref, replacement, replacement_can_be_removed) {
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

                    for part in e.parts.iter_mut() {
                        match self.substitute_single_use_symbol_in_expr(part.value, r#ref, replacement, replacement_can_be_removed) {
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

        let tag: Expr::Tag = expr.data.tag();

        // We can always reorder past primitive values
        if tag.is_primitive_literal() {
            return Substitution::Continue(expr);
        }

        // Otherwise we should stop trying to substitute past this point
        Substitution::Failure(expr)
    }

    pub fn prepare_for_visit_pass(&mut self) -> Result<(), bun_core::Error> {
        {
            let mut i: usize = 0;
            let buf = self.allocator.alloc_slice_fill_default::<ScopeOrder>(self.scopes_in_order.len());
            for item in self.scopes_in_order.iter() {
                if let Some(item_) = item {
                    buf[i] = *item_;
                    i += 1;
                }
            }
            self.scope_order_to_visit = &mut buf[..i];
        }

        self.is_file_considered_to_have_esm_exports = !self.top_level_await_keyword.is_empty()
            || !self.esm_export_keyword.is_empty()
            || self.options.module_type == options::ModuleType::Esm;

        self.push_scope_for_visit_pass(js_ast::Scope::Kind::Entry, loc_module_scope())?;
        self.fn_or_arrow_data_visit.is_outside_fn_or_arrow = true;
        self.module_scope = self.current_scope;
        self.has_es_module_syntax = self.has_es_module_syntax
            || self.esm_import_keyword.len > 0
            || self.esm_export_keyword.len > 0
            || self.top_level_await_keyword.len > 0;

        if let Some(factory) = self.lexer.jsx_pragma.jsx() {
            self.options.jsx.factory =
                options::JSX::Pragma::member_list_to_components_if_different(self.allocator, self.options.jsx.factory, factory.text)
                    .expect("unreachable");
        }

        if let Some(fragment) = self.lexer.jsx_pragma.jsx_frag() {
            self.options.jsx.fragment =
                options::JSX::Pragma::member_list_to_components_if_different(self.allocator, self.options.jsx.fragment, fragment.text)
                    .expect("unreachable");
        }

        if let Some(import_source) = self.lexer.jsx_pragma.jsx_import_source() {
            self.options.jsx.classic_import_source = import_source.text;
            self.options.jsx.package_name = self.options.jsx.classic_import_source;
            self.options.jsx.set_import_source(self.allocator);
        }

        if let Some(runtime) = self.lexer.jsx_pragma.jsx_runtime() {
            if let Some(jsx_runtime) = options::JSX::RUNTIME_MAP.get(runtime.text) {
                self.options.jsx.runtime = jsx_runtime.runtime;
                if let Some(dev) = jsx_runtime.development {
                    self.options.jsx.development = dev;
                }
            } else {
                // make this a warning instead of an error because we don't support "preserve" right now
                self.log.add_range_warning_fmt(
                    self.source,
                    runtime.range,
                    self.allocator,
                    format_args!("Unsupported JSX runtime: \"{}\"", bstr::BStr::new(runtime.text)),
                )?;
            }
        }

        // ECMAScript modules are always interpreted as strict mode. This has to be
        // done before "hoistSymbols" because strict mode can alter hoisting (!).
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let module_scope = unsafe { &mut *self.module_scope };
        if self.esm_import_keyword.len > 0 {
            module_scope.recursive_set_strict_mode(js_ast::StrictModeKind::ImplicitStrictModeImport);
        } else if self.esm_export_keyword.len > 0 {
            module_scope.recursive_set_strict_mode(js_ast::StrictModeKind::ImplicitStrictModeExport);
        } else if self.top_level_await_keyword.len > 0 {
            module_scope.recursive_set_strict_mode(js_ast::StrictModeKind::ImplicitStrictModeTopLevelAwait);
        }

        self.hoist_symbols(self.module_scope);

        let mut generated_symbols_count: u32 = 3;

        if self.options.features.react_fast_refresh {
            generated_symbols_count += 3;
        }

        if Self::IS_JSX_ENABLED {
            generated_symbols_count += 7;
            if self.options.jsx.development {
                generated_symbols_count += 1;
            }
        }

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let module_scope = unsafe { &mut *self.module_scope };
        module_scope.generated.ensure_unused_capacity(self.allocator, generated_symbols_count as usize * 3)?;
        module_scope.members.ensure_unused_capacity(
            self.allocator,
            generated_symbols_count as usize * 3 + module_scope.members.count(),
        )?;

        self.exports_ref = self.declare_common_js_symbol(Symbol::Kind::Hoisted, b"exports")?;
        self.module_ref = self.declare_common_js_symbol(Symbol::Kind::Hoisted, b"module")?;

        self.require_ref = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"require")?;
        self.dirname_ref = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"__dirname")?;
        self.filename_ref = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"__filename")?;

        if self.options.features.inject_jest_globals {
            self.jest.test = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"test")?;
            self.jest.it = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"it")?;
            self.jest.describe = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"describe")?;
            self.jest.expect = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"expect")?;
            self.jest.expect_type_of = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"expectTypeOf")?;
            self.jest.before_all = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"beforeAll")?;
            self.jest.before_each = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"beforeEach")?;
            self.jest.after_each = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"afterEach")?;
            self.jest.after_all = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"afterAll")?;
            self.jest.jest = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"jest")?;
            self.jest.vi = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"vi")?;
            self.jest.xit = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"xit")?;
            self.jest.xtest = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"xtest")?;
            self.jest.xdescribe = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"xdescribe")?;
        }

        if self.options.features.react_fast_refresh {
            self.react_refresh.create_signature_ref = self.declare_generated_symbol(Symbol::Kind::Other, b"$RefreshSig$")?;
            self.react_refresh.register_ref = self.declare_generated_symbol(Symbol::Kind::Other, b"$RefreshReg$")?;
        }

        match self.options.features.server_components {
            options::ServerComponents::None | options::ServerComponents::ClientSide => {}
            options::ServerComponents::WrapExportsForClientReference => {
                self.server_components_wrap_ref =
                    self.declare_generated_symbol(Symbol::Kind::Other, b"registerClientReference")?;
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
                self.response_ref = self.declare_generated_symbol(Symbol::Kind::Import, b"Response")?;
                self.bun_app_namespace_ref = self.new_symbol(Symbol::Kind::Other, b"import_bun_app")?;
                let symbol = &mut self.symbols[self.response_ref.inner_index() as usize];
                symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                    namespace_ref: self.bun_app_namespace_ref,
                    alias: b"Response",
                    import_record_index: u32::MAX,
                });
            }
        }

        if self.options.features.hot_module_reloading {
            self.hmr_api_ref = self.declare_common_js_symbol(Symbol::Kind::Unbound, b"hmr")?;
        }
        Ok(())
    }

    fn ensure_require_symbol(&mut self) {
        if self.runtime_imports.__require.is_some() {
            return;
        }
        let static_symbol = generated_symbol_name(b"__require");
        self.runtime_imports.__require =
            Some(self.declare_symbol_maybe_generated::<true>(Symbol::Kind::Other, logger::Loc::EMPTY, static_symbol).expect("oom"));
        self.runtime_imports.put(b"__require", self.runtime_imports.__require.unwrap());
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

    fn hoist_symbols(&mut self, scope: *mut js_ast::Scope) {
        // SAFETY: scope is arena-owned and valid for parser lifetime
        let scope_ref = unsafe { &mut *scope };
        if !scope_ref.kind_stops_hoisting() {
            let allocator = self.allocator;
            // PORT NOTE: Zig captured `var symbols = p.symbols.items;` and asserted it
            // wasn't resized; we re-borrow `self.symbols` after each `new_symbol` call.

            // Check for collisions that would prevent to hoisting "var" symbols up to the enclosing function scope
            if let Some(parent_scope) = scope_ref.parent {
                // SAFETY: arena-owned pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                let parent_scope = unsafe { &mut *parent_scope };
                let mut iter = scope_ref.members.iter_mut();
                'next_member: while let Some(res) = iter.next() {
                    let mut value = *res.value();
                    let mut symbol_idx = value.r#ref.inner_index() as usize;

                    let name = self.symbols[symbol_idx].original_name;
                    let mut hash: Option<u64> = None;

                    if parent_scope.kind == Scope::Kind::CatchBinding
                        && self.symbols[symbol_idx].kind != Symbol::Kind::Hoisted
                    {
                        hash = Some(Scope::get_member_hash(name));
                        if let Some(existing_member) = parent_scope.get_member_with_hash(name, hash.unwrap()) {
                            self.log
                                .add_symbol_already_declared_error(
                                    self.allocator,
                                    self.source,
                                    self.symbols[symbol_idx].original_name,
                                    value.loc,
                                    existing_member.loc,
                                )
                                .expect("unreachable");
                            continue;
                        }
                    }

                    if !self.symbols[symbol_idx].is_hoisted() {
                        continue;
                    }

                    let mut __scope = scope_ref.parent;
                    debug_assert!(__scope.is_some());

                    let mut is_sloppy_mode_block_level_fn_stmt = false;
                    let original_member_ref = value.r#ref;

                    if self.will_use_renamer() && self.symbols[symbol_idx].kind == Symbol::Kind::HoistedFunction {
                        // Block-level function declarations behave like "let" in strict mode
                        if scope_ref.strict_mode != js_ast::StrictModeKind::SloppyMode {
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
                        let original_name = self.symbols[symbol_idx].original_name;
                        let hoisted_ref = self.new_symbol(Symbol::Kind::Hoisted, original_name).expect("unreachable");
                        scope_ref.generated.push(self.allocator, hoisted_ref).expect("oom");
                        self.hoisted_ref_for_sloppy_mode_block_fn
                            .put(self.allocator, value.r#ref, hoisted_ref)
                            .expect("unreachable");
                        value.r#ref = hoisted_ref;
                        symbol_idx = hoisted_ref.inner_index() as usize;
                        is_sloppy_mode_block_level_fn_stmt = true;
                    }

                    if hash.is_none() {
                        hash = Some(Scope::get_member_hash(name));
                    }

                    while let Some(_scope_ptr) = __scope {
                        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                        let _scope = unsafe { &mut *_scope_ptr };
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
                        if scope_kind == Scope::Kind::With {
                            self.symbols[symbol_idx].must_not_be_renamed = true;
                        }

                        if let Some(member_in_scope) = _scope.get_member_with_hash(name, hash.unwrap()) {
                            let member_in_scope = *member_in_scope;
                            let existing_idx = member_in_scope.r#ref.inner_index() as usize;
                            let existing_kind = self.symbols[existing_idx].kind;

                            // We can hoist the symbol from the child scope into the symbol in
                            // this scope if:
                            //
                            //   - The symbol is unbound (i.e. a global variable access)
                            //   - The symbol is also another hoisted variable
                            //   - The symbol is a function of any kind and we're in a function or module scope
                            //
                            // Is this unbound (i.e. a global access) or also hoisted?
                            if existing_kind == Symbol::Kind::Unbound
                                || existing_kind == Symbol::Kind::Hoisted
                                || (Symbol::is_kind_function(existing_kind)
                                    && (scope_kind == Scope::Kind::Entry || scope_kind == Scope::Kind::FunctionBody))
                            {
                                // Silently merge this symbol into the existing symbol
                                self.symbols[symbol_idx].link = member_in_scope.r#ref;
                                let entry = _scope
                                    .get_or_put_member_with_hash(self.allocator, name, hash.unwrap())
                                    .expect("unreachable");
                                *entry.value_ptr = member_in_scope;
                                *entry.key_ptr = name;
                                continue 'next_member;
                            }

                            // Otherwise if this isn't a catch identifier, it's a collision
                            if existing_kind != Symbol::Kind::CatchIdentifier && existing_kind != Symbol::Kind::Arguments {
                                // An identifier binding from a catch statement and a function
                                // declaration can both silently shadow another hoisted symbol
                                if self.symbols[symbol_idx].kind != Symbol::Kind::CatchIdentifier
                                    && self.symbols[symbol_idx].kind != Symbol::Kind::HoistedFunction
                                {
                                    if !is_sloppy_mode_block_level_fn_stmt {
                                        let r = js_lexer::range_of_identifier(self.source, value.loc);
                                        let mut msg = BumpVec::new_in(allocator);
                                        let _ = write!(&mut msg, "{} was originally declared here", bstr::BStr::new(name));
                                        let notes = allocator.alloc_slice_copy(&[logger::range_data(self.source, r, msg.into_bump_slice())]);
                                        self.log
                                            .add_range_error_fmt_with_notes(
                                                self.source,
                                                js_lexer::range_of_identifier(self.source, member_in_scope.loc),
                                                allocator,
                                                notes,
                                                format_args!("{} has already been declared", bstr::BStr::new(name)),
                                            )
                                            .expect("unreachable");
                                    } else if _scope_ptr == scope_ref.parent.unwrap() {
                                        // Never mind about this, turns out it's not needed after all
                                        let _ = self.hoisted_ref_for_sloppy_mode_block_fn.remove(&original_member_ref);
                                    }
                                }
                                continue 'next_member;
                            }

                            // If this is a catch identifier, silently merge the existing symbol
                            // into this symbol but continue hoisting past this catch scope
                            self.symbols[existing_idx].link = value.r#ref;
                            let entry = _scope
                                .get_or_put_member_with_hash(self.allocator, name, hash.unwrap())
                                .expect("unreachable");
                            *entry.value_ptr = value;
                            *entry.key_ptr = name;
                        }

                        if _scope.kind_stops_hoisting() {
                            let entry = _scope
                                .get_or_put_member_with_hash(allocator, name, hash.unwrap())
                                .expect("unreachable");
                            *entry.value_ptr = value;
                            *entry.key_ptr = name;
                            break;
                        }

                        __scope = _scope.parent;
                    }
                }
            }
        }

        {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            let children = unsafe { &*scope }.children.slice();
            for child in children {
                self.hoist_symbols(*child);
            }
        }
    }

    #[inline]
    fn next_scope_in_order_for_visit_pass(&mut self) -> ScopeOrder {
        let head = self.scope_order_to_visit[0];
        let len = self.scope_order_to_visit.len();
        // PORT NOTE: reshaped for borrowck — Zig sliced [1..len]
        self.scope_order_to_visit = &mut core::mem::take(&mut self.scope_order_to_visit)[1..len];
        head
    }

    pub fn push_scope_for_visit_pass(
        &mut self,
        kind: js_ast::Scope::Kind,
        loc: logger::Loc,
    ) -> Result<(), bun_core::Error> {
        let order = self.next_scope_in_order_for_visit_pass();

        // Sanity-check that the scopes generated by the first and second passes match
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        if cfg!(debug_assertions) && (order.loc.start != loc.start || unsafe { &*order.scope }.kind != kind) {
            self.log.level = logger::Level::Verbose;
            let _ = self.log.add_debug_fmt(
                self.source,
                loc,
                self.allocator,
                format_args!("Expected this scope (.{})", <&'static str>::from(kind)),
            );
            let _ = self.log.add_debug_fmt(
                self.source,
                order.loc,
                self.allocator,
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                format_args!("Found this scope (.{})", <&'static str>::from(unsafe { &*order.scope }.kind)),
            );
            self.panic("Scope mismatch while visiting", format_args!(""));
        }

        self.current_scope = order.scope;
        self.scopes_for_current_part.push(order.scope);
        Ok(())
    }

    pub fn push_scope_for_parse_pass<const KIND: js_ast::Scope::Kind>(
        &mut self,
        loc: logger::Loc,
    ) -> Result<usize, bun_core::Error> {
        // TODO(port): Zig took `comptime kind`; modeled as const generic for branch elision.
        let parent: *mut Scope = self.current_scope;
        let allocator = self.allocator;
        let scope = allocator.alloc(Scope {
            kind: KIND,
            label_ref: None,
            parent: Some(parent),
            generated: Default::default(),
            ..Default::default()
        });

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *parent }.children.push(allocator, scope as *mut _)?;
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        scope.strict_mode = unsafe { &*parent }.strict_mode;

        self.current_scope = scope;

        if KIND == Scope::Kind::With {
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

                if let Some(prev_scope) = &self.scopes_in_order[last_i] {
                    if prev_scope.loc.start >= loc.start {
                        self.log.level = logger::Level::Verbose;
                        let _ = self.log.add_debug_fmt(self.source, prev_scope.loc, self.allocator, format_args!("Previous Scope"));
                        let _ = self.log.add_debug_fmt(self.source, loc, self.allocator, format_args!("Next Scope"));
                        self.panic(
                            "Scope location must be greater than previous",
                            format_args!("{} must be greater than {}", loc.start, prev_scope.loc.start),
                        );
                    }
                }
            }
        }

        // Copy down function arguments into the function body scope. That way we get
        // errors if a statement in the function body tries to re-declare any of the
        // arguments.
        if KIND == js_ast::Scope::Kind::FunctionBody {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            debug_assert!(unsafe { &*parent }.kind == js_ast::Scope::Kind::FunctionArgs);

            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            let parent_ref = unsafe { &mut *(scope.parent.unwrap()) };
            let mut iter = parent_ref.members.iter();
            while let Some(entry) = iter.next() {
                // Don't copy down the optional function expression name. Re-declaring
                // the name of a function expression is allowed.
                let value = *entry.value();
                let adjacent_kind = self.symbols[value.r#ref.inner_index() as usize].kind;
                if adjacent_kind != Symbol::Kind::HoistedFunction {
                    scope.members.put(allocator, *entry.key(), value)?;
                }
            }
        }

        // Remember the length in case we call popAndDiscardScope() later
        let scope_index = self.scopes_in_order.len();
        self.scopes_in_order.push(allocator, Some(ScopeOrder { loc, scope }))?;
        // Output.print("\nLoc: {d}\n", .{loc.start});
        Ok(scope_index)
    }

    // Note: do not write to "p.log" in this function. Any errors due to conversion
    // from expression to binding should be written to "invalidLog" instead. That
    // way we can potentially keep this as an expression if it turns out it's not
    // needed as a binding after all.
    fn convert_expr_to_binding(&mut self, expr: ExprNodeIndex, invalid_loc: &mut LocList) -> Option<Binding> {
        match expr.data {
            Expr::Data::EMissing(_) => return None,
            Expr::Data::EIdentifier(ex) => {
                return Some(self.b(B::Identifier { r#ref: ex.r#ref }, expr.loc));
            }
            Expr::Data::EArray(ex) => {
                if let Some(spread) = ex.comma_after_spread {
                    invalid_loc.push(InvalidLoc { loc: spread, kind: InvalidLoc::Tag::Spread });
                }

                if ex.is_parenthesized {
                    invalid_loc.push(InvalidLoc {
                        loc: self.source.range_of_operator_before(expr.loc, b"(").loc,
                        kind: InvalidLoc::Tag::Parentheses,
                    });
                }

                // p.markSyntaxFeature(Destructing)
                let mut items = BumpVec::with_capacity_in(ex.items.len as usize, self.allocator);
                let mut is_spread = false;
                for i in 0..ex.items.len as usize {
                    let mut item = ex.items.ptr()[i];
                    if matches!(item.data, Expr::Data::ESpread(_)) {
                        is_spread = true;
                        item = item.data.e_spread().value;
                    }
                    let res = self.convert_expr_to_binding_and_initializer(&mut item, invalid_loc, is_spread);

                    items.push(js_ast::ArrayBinding {
                        // It's valid for it to be missing
                        // An example:
                        //      Promise.all(promises).then(([, len]) => true);
                        //                                   ^ Binding is missing there
                        binding: res.binding.unwrap_or_else(|| self.b(B::Missing {}, item.loc)),
                        default_value: res.expr,
                    });
                    // PERF(port): was assume_capacity
                }

                return Some(self.b(
                    B::Array { items: items.into_bump_slice(), has_spread: is_spread, is_single_line: ex.is_single_line },
                    expr.loc,
                ));
            }
            Expr::Data::EObject(ex) => {
                if let Some(sp) = ex.comma_after_spread {
                    invalid_loc.push(InvalidLoc { loc: sp, kind: InvalidLoc::Tag::Spread });
                }

                if ex.is_parenthesized {
                    invalid_loc.push(InvalidLoc {
                        loc: self.source.range_of_operator_before(expr.loc, b"(").loc,
                        kind: InvalidLoc::Tag::Parentheses,
                    });
                }
                // p.markSyntaxFeature(compat.Destructuring, p.source.RangeOfOperatorAfter(expr.Loc, "{"))

                let mut properties = BumpVec::with_capacity_in(ex.properties.len as usize, self.allocator);
                for item in ex.properties.slice_mut() {
                    if item.flags.contains(Flags::Property::IsMethod)
                        || item.kind == Property::Kind::Get
                        || item.kind == Property::Kind::Set
                    {
                        invalid_loc.push(InvalidLoc {
                            loc: item.key.unwrap().loc,
                            kind: if item.flags.contains(Flags::Property::IsMethod) {
                                InvalidLoc::Tag::Method
                            } else if item.kind == Property::Kind::Get {
                                InvalidLoc::Tag::Getter
                            } else {
                                InvalidLoc::Tag::Setter
                            },
                        });
                        continue;
                    }
                    let value = item.value.as_mut().unwrap();
                    let tup = self.convert_expr_to_binding_and_initializer(value, invalid_loc, false);
                    let initializer = tup.expr.or(item.initializer);
                    let is_spread = item.kind == Property::Kind::Spread || item.flags.contains(Flags::Property::IsSpread);
                    properties.push(B::Property {
                        flags: Flags::Property::init(Flags::PropertyInit { is_spread, is_computed: item.flags.contains(Flags::Property::IsComputed), ..Default::default() }),
                        key: item.key.unwrap_or_else(|| self.new_expr(E::Missing {}, expr.loc)),
                        value: tup.binding.unwrap_or_else(|| self.b(B::Missing {}, expr.loc)),
                        default_value: initializer,
                    });
                    // PERF(port): was assume_capacity
                }

                return Some(self.b(
                    B::Object { properties: properties.into_bump_slice(), is_single_line: ex.is_single_line },
                    expr.loc,
                ));
            }
            _ => {
                invalid_loc.push(InvalidLoc { loc: expr.loc, kind: InvalidLoc::Tag::Unknown });
                return None;
            }
        }
        #[allow(unreachable_code)]
        None
    }

    pub fn convert_expr_to_binding_and_initializer(
        &mut self,
        _expr: &mut ExprNodeIndex,
        invalid_log: &mut LocList,
        is_spread: bool,
    ) -> ExprBindingTuple {
        let mut initializer: Option<ExprNodeIndex> = None;
        let mut expr = _expr;
        // zig syntax is sometimes painful
        if let Expr::Data::EBinary(bin) = &mut expr.data {
            if bin.op == js_ast::Op::BinAssign {
                initializer = Some(bin.right);
                expr = &mut bin.left;
            }
        }

        let bind = self.convert_expr_to_binding(*expr, invalid_log);
        if let Some(initial) = initializer {
            let equals_range = self.source.range_of_operator_before(initial.loc, b"=");
            if is_spread {
                self.log
                    .add_range_error(self.source, equals_range, "A rest argument cannot have a default initializer")
                    .expect("unreachable");
            } else {
                // p.markSyntaxFeature();
            }
        }
        ExprBindingTuple { binding: bind, expr: initializer }
    }

    pub fn forbid_lexical_decl(&self, loc: logger::Loc) -> Result<(), bun_core::Error> {
        self.log.add_error(self.source, loc, "Cannot use a declaration in a single-statement context")
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
            self.log.add_range_error(self.source, r, "Unexpected \"=\"").expect("unreachable");
        }

        if let Some(r) = errors.invalid_expr_after_question {
            self.log
                .add_range_error_fmt(
                    self.source,
                    r,
                    self.allocator,
                    format_args!("Unexpected {}", bstr::BStr::new(&self.source.contents[r.loc.i()..r.end_i()])),
                )
                .expect("unreachable");
        }

        // if (errors.array_spread_feature) |err| {
        //     p.markSyntaxFeature(compat.ArraySpread, errors.arraySpreadFeature)
        // }
    }

    pub fn pop_and_discard_scope(&mut self, scope_index: usize) {
        // Move up to the parent scope
        let to_discard = self.current_scope;
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let parent = unsafe { &*to_discard }.parent.expect("unreachable");

        self.current_scope = parent;

        // Truncate the scope order where we started to pretend we never saw this scope
        self.scopes_in_order.truncate(scope_index);

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let children = &mut unsafe { &mut *parent }.children;
        // Remove the last child from the parent scope
        let last = children.len - 1;
        if children.slice()[last as usize] != to_discard {
            self.panic("Internal error", format_args!(""));
        }

        let _ = children.pop();
    }

    pub fn process_import_statement(
        &mut self,
        stmt_: S::Import,
        path: ParsedPath,
        loc: logger::Loc,
        was_originally_bare_import: bool,
    ) -> Result<Stmt, bun_core::Error> {
        let is_macro = FeatureFlags::IS_MACRO_ENABLED && (path.is_macro || js_ast::Macro::is_macro_path(path.text));
        let mut stmt = stmt_;
        if is_macro {
            let id = self.add_import_record(ImportKind::Stmt, path.loc, path.text);
            self.import_records.items_mut()[id as usize].path.namespace = js_ast::Macro::NAMESPACE;
            self.import_records.items_mut()[id as usize].flags.is_unused = true;

            if let Some(name_loc) = stmt.default_name {
                let name = self.load_name_from_ref(name_loc.r#ref.unwrap());
                let r#ref = self.declare_symbol(Symbol::Kind::Other, name_loc.loc, name)?;
                self.is_import_item.put(self.allocator, r#ref, ())?;
                self.macro_.refs.put(r#ref, MacroState::RefData { import_record_id: id, name: b"default" })?;
            }

            if let Some(star) = stmt.star_name_loc {
                let name = self.load_name_from_ref(stmt.namespace_ref);
                let r#ref = self.declare_symbol(Symbol::Kind::Other, star, name)?;
                stmt.namespace_ref = r#ref;
                self.macro_.refs.put(r#ref, MacroState::RefData { import_record_id: id, ..Default::default() })?;
            }

            for item in stmt.items.iter() {
                let name = self.load_name_from_ref(item.name.r#ref.unwrap());
                let r#ref = self.declare_symbol(Symbol::Kind::Other, item.name.loc, name)?;
                self.is_import_item.put(self.allocator, r#ref, ())?;
                self.macro_.refs.put(r#ref, MacroState::RefData { import_record_id: id, name: item.alias })?;
            }

            return Ok(self.s(S::Empty {}, loc));
        }

        // Handle `import { feature } from "bun:bundle"` - this is a special import
        // that provides static feature flag checking at bundle time.
        // We handle it here at parse time (similar to macros) rather than at visit time.
        if path.text == b"bun:bundle" {
            // Look for the "feature" import and validate specifiers
            for item in stmt.items.iter_mut() {
                // In ClauseItem from parseImportClause:
                // - alias is the name from the source module ("feature")
                // - original_name is the local binding name
                // - name.ref is the ref for the local binding
                if item.alias == b"feature" {
                    // Check for duplicate imports of feature
                    if self.bundler_feature_flag_ref.is_valid() {
                        self.log.add_error(self.source, item.alias_loc, "`feature` from \"bun:bundle\" may only be imported once")?;
                        continue;
                    }
                    // Declare the symbol and store the ref
                    let name = self.load_name_from_ref(item.name.r#ref.unwrap());
                    let r#ref = self.declare_symbol(Symbol::Kind::Other, item.name.loc, name)?;
                    self.bundler_feature_flag_ref = r#ref;
                } else {
                    self.log.add_error_fmt(
                        self.source,
                        item.alias_loc,
                        self.allocator,
                        format_args!("\"bun:bundle\" has no export named \"{}\"", bstr::BStr::new(item.alias)),
                    )?;
                }
            }
            // Return empty statement - the import is completely removed
            return Ok(self.s(S::Empty {}, loc));
        }

        let macro_remap = if Self::ALLOW_MACROS {
            self.options.macro_context.get_remap(path.text)
        } else {
            None
        };

        stmt.import_record_index = self.add_import_record(ImportKind::Stmt, path.loc, path.text);
        self.import_records.items_mut()[stmt.import_record_index as usize]
            .flags
            .was_originally_bare_import = was_originally_bare_import;

        if let Some(star) = stmt.star_name_loc {
            let name = self.load_name_from_ref(stmt.namespace_ref);
            stmt.namespace_ref = self.declare_symbol(Symbol::Kind::Import, star, name)?;

            if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                if let Some(uses) = &mut self.parse_pass_symbol_uses {
                    uses.put(name, ScanPassResult::ParsePassSymbolUse {
                        r#ref: stmt.namespace_ref,
                        import_record_index: stmt.import_record_index,
                        ..Default::default()
                    })
                    .expect("unreachable");
                }
            }

            // TODO: not sure how to handle macro remappings for namespace imports
        } else {
            let mut path_name = fs::PathName::init(path.text);
            let name = strings::append(self.allocator, b"import_", path_name.non_unique_name_string(self.allocator)?)?;
            stmt.namespace_ref = self.new_symbol(Symbol::Kind::Other, name)?;
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            let scope = unsafe { &mut *self.current_scope };
            scope.generated.push(self.allocator, stmt.namespace_ref)?;
        }

        let mut item_refs = ImportItemForNamespaceMap::new_in(self.allocator);
        let count_excluding_namespace =
            u16::try_from(stmt.items.len()).unwrap() + u16::from(stmt.default_name.is_some());

        item_refs.ensure_unused_capacity(count_excluding_namespace as usize)?;
        // Even though we allocate ahead of time here
        // we cannot use putAssumeCapacity because a symbol can have existing links
        // those may write to this hash table, so this estimate may be innaccurate
        self.is_import_item.ensure_unused_capacity(self.allocator, count_excluding_namespace as usize)?;
        let mut remap_count: u32 = 0;
        // Link the default item to the namespace
        if let Some(name_loc) = &mut stmt.default_name {
            'outer: {
                let name = self.load_name_from_ref(name_loc.r#ref.unwrap());
                let r#ref = self.declare_symbol(Symbol::Kind::Import, name_loc.loc, name)?;
                name_loc.r#ref = Some(r#ref);
                self.is_import_item.put(self.allocator, r#ref, ())?;

                // ensure every e_import_identifier holds the namespace
                if self.options.features.hot_module_reloading {
                    let symbol = &mut self.symbols[r#ref.inner_index() as usize];
                    if symbol.namespace_alias.is_none() {
                        symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                            namespace_ref: stmt.namespace_ref,
                            alias: b"default",
                            import_record_index: stmt.import_record_index,
                        });
                    }
                }

                if let Some(remap) = &macro_remap {
                    if let Some(remapped_path) = remap.get(b"default" as &[u8]) {
                        let new_import_id = self.add_import_record(ImportKind::Stmt, path.loc, remapped_path);
                        self.macro_.refs.put(r#ref, MacroState::RefData { import_record_id: new_import_id, name: b"default" })?;

                        self.import_records.items_mut()[new_import_id as usize].path.namespace = js_ast::Macro::NAMESPACE;
                        self.import_records.items_mut()[new_import_id as usize].flags.is_unused = true;
                        if SCAN_ONLY {
                            self.import_records.items_mut()[new_import_id as usize].flags.is_internal = true;
                            self.import_records.items_mut()[new_import_id as usize].path.is_disabled = true;
                        }
                        stmt.default_name = None;
                        remap_count += 1;
                        break 'outer;
                    }
                }

                if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                    if let Some(uses) = &mut self.parse_pass_symbol_uses {
                        uses.put(name, ScanPassResult::ParsePassSymbolUse {
                            r#ref,
                            import_record_index: stmt.import_record_index,
                            ..Default::default()
                        })
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

        for i in 0..stmt.items.len() {
            let mut item = stmt.items[i];
            let name = self.load_name_from_ref(item.name.r#ref.expect("unreachable"));
            let r#ref = self.declare_symbol(Symbol::Kind::Import, item.name.loc, name)?;
            item.name.r#ref = Some(r#ref);

            self.is_import_item.put(self.allocator, r#ref, ())?;
            self.check_for_non_bmp_code_point(item.alias_loc, item.alias);

            // ensure every e_import_identifier holds the namespace
            if self.options.features.hot_module_reloading {
                let symbol = &mut self.symbols[r#ref.inner_index() as usize];
                if symbol.namespace_alias.is_none() {
                    symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                        namespace_ref: stmt.namespace_ref,
                        alias: item.alias,
                        import_record_index: stmt.import_record_index,
                    });
                }
            }

            if let Some(remap) = &macro_remap {
                if let Some(remapped_path) = remap.get(item.alias) {
                    let new_import_id = self.add_import_record(ImportKind::Stmt, path.loc, remapped_path);
                    self.macro_.refs.put(r#ref, MacroState::RefData { import_record_id: new_import_id, name: item.alias })?;

                    self.import_records.items_mut()[new_import_id as usize].path.namespace = js_ast::Macro::NAMESPACE;
                    self.import_records.items_mut()[new_import_id as usize].flags.is_unused = true;
                    if SCAN_ONLY {
                        self.import_records.items_mut()[new_import_id as usize].flags.is_internal = true;
                        self.import_records.items_mut()[new_import_id as usize].path.is_disabled = true;
                    }
                    remap_count += 1;
                    continue;
                }
            }

            if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                if let Some(uses) = &mut self.parse_pass_symbol_uses {
                    uses.put(name, ScanPassResult::ParsePassSymbolUse {
                        r#ref,
                        import_record_index: stmt.import_record_index,
                        ..Default::default()
                    })
                    .expect("unreachable");
                }
            }

            item_refs.put_assume_capacity(item.alias, item.name);
            stmt.items[end] = item;
            end += 1;
        }
        stmt.items = &mut stmt.items[..end];

        // If we remapped the entire import away
        // i.e. import {graphql} "react-relay"

        if remap_count > 0 && stmt.items.is_empty() && stmt.default_name.is_none() {
            self.import_records.items_mut()[stmt.import_record_index as usize].path.namespace = js_ast::Macro::NAMESPACE;
            self.import_records.items_mut()[stmt.import_record_index as usize].flags.is_unused = true;

            if SCAN_ONLY {
                self.import_records.items_mut()[stmt.import_record_index as usize].path.is_disabled = true;
                self.import_records.items_mut()[stmt.import_record_index as usize].flags.is_internal = true;
            }

            return Ok(self.s(S::Empty {}, loc));
        } else if remap_count > 0 {
            item_refs.shrink_and_free(stmt.items.len() + usize::from(stmt.default_name.is_some()));
        }

        if path.import_tag != ParsedPath::ImportTag::None || path.loader.is_some() {
            self.validate_and_set_import_type(&path, &mut stmt)?;
        }

        // Track the items for this namespace
        self.import_items_for_namespace.put(self.allocator, stmt.namespace_ref, item_refs)?;
        Ok(self.s(stmt, loc))
    }

    #[cold]
    fn validate_and_set_import_type(&mut self, path: &ParsedPath, stmt: &mut S::Import) -> Result<(), bun_core::Error> {
        if let Some(loader) = path.loader {
            self.import_records.items_mut()[stmt.import_record_index as usize].loader = loader;

            if loader == options::Loader::Sqlite || loader == options::Loader::SqliteEmbedded {
                for item in stmt.items.iter() {
                    if !(item.alias == b"default" || item.alias == b"db") {
                        self.log.add_error(
                            self.source,
                            item.name.loc,
                            "sqlite imports only support the \"default\" or \"db\" imports",
                        )?;
                        break;
                    }
                }
            } else if loader == options::Loader::File || loader == options::Loader::Text {
                for item in stmt.items.iter() {
                    if item.alias != b"default" {
                        self.log.add_error(
                            self.source,
                            item.name.loc,
                            "This loader type only supports the \"default\" import",
                        )?;
                        break;
                    }
                }
            }
        } else if path.import_tag == ParsedPath::ImportTag::BakeResolveToSsrGraph {
            self.import_records.items_mut()[stmt.import_record_index as usize].tag = path.import_tag;
        }
        Ok(())
    }

    pub fn create_default_name(&mut self, loc: logger::Loc) -> Result<js_ast::LocRef, bun_core::Error> {
        let mut buf = BumpVec::new_in(self.allocator);
        let _ = write!(
            &mut buf,
            "{}_default",
            bstr::BStr::new(self.source.path.name.non_unique_name_string(self.allocator)?)
        );
        let identifier = buf.into_bump_slice();

        let name = js_ast::LocRef { loc, r#ref: Some(self.new_symbol(Symbol::Kind::Other, identifier)?) };

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let scope = unsafe { &mut *self.current_scope };
        scope.generated.push(self.allocator, name.r#ref.unwrap())?;

        Ok(name)
    }

    pub fn new_symbol(&mut self, kind: Symbol::Kind, identifier: &'a [u8]) -> Result<Ref, bun_core::Error> {
        // TODO(port): narrow error set
        let inner_index = self.symbols.len() as Ref::Int; // @truncate
        self.symbols.push(Symbol { kind, original_name: identifier, ..Default::default() });

        if TYPESCRIPT {
            self.ts_use_counts.push(0);
        }

        Ok(Ref {
            inner_index,
            source_index: u32::try_from(self.source.index.get()).unwrap(),
            tag: Ref::Tag::Symbol,
        })
    }

    pub fn default_name_for_expr(&mut self, expr: Expr, loc: logger::Loc) -> LocRef {
        match &expr.data {
            Expr::Data::EFunction(func_container) => {
                if let Some(_name) = &func_container.func.name {
                    if let Some(r#ref) = _name.r#ref {
                        return LocRef { loc, r#ref: Some(r#ref) };
                    }
                }
            }
            Expr::Data::EIdentifier(ident) => {
                return LocRef { loc, r#ref: Some(ident.r#ref) };
            }
            Expr::Data::EImportIdentifier(ident) => {
                if !Self::ALLOW_MACROS || (Self::ALLOW_MACROS && !self.macro_.refs.contains(&ident.r#ref)) {
                    return LocRef { loc, r#ref: Some(ident.r#ref) };
                }
            }
            Expr::Data::EClass(class) => {
                if let Some(_name) = &class.class_name {
                    if let Some(r#ref) = _name.r#ref {
                        return LocRef { loc, r#ref: Some(r#ref) };
                    }
                }
            }
            _ => {}
        }

        self.create_default_name(loc).expect("unreachable")
    }

    pub fn discard_scopes_up_to(&mut self, scope_index: usize) {
        // Remove any direct children from their parent
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let scope = unsafe { &mut *self.current_scope };
        let mut children = scope.children;
        // PORT NOTE: Zig used `defer scope.children = children;` — we write back at end.

        for _child in &self.scopes_in_order[scope_index..] {
            let Some(child) = _child else { continue };

            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            if unsafe { &*child.scope }.parent == Some(self.current_scope) {
                let mut i: usize = (children.len - 1) as usize;
                loop {
                    if children.mut_(i) == &child.scope {
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

        scope.children = children;

        // Truncate the scope order where we started to pretend we never saw this scope
        self.scopes_in_order.truncate(scope_index);
    }

    pub fn define_exported_namespace_binding(
        &mut self,
        exported_members: &mut js_ast::TSNamespaceMemberMap,
        binding: Binding,
    ) -> Result<(), bun_core::Error> {
        match binding.data {
            Binding::Data::BMissing(_) => {}
            Binding::Data::BIdentifier(id) => {
                let name = self.symbols[id.r#ref.inner_index() as usize].original_name;
                exported_members.put(
                    self.allocator,
                    name,
                    js_ast::TSNamespaceMember { loc: binding.loc, data: js_ast::TSNamespaceMember::Data::Property },
                )?;
                self.ref_to_ts_namespace_member.put(self.allocator, id.r#ref, js_ast::TSNamespaceMember::Data::Property)?;
            }
            Binding::Data::BObject(obj) => {
                for prop in obj.properties.iter() {
                    self.define_exported_namespace_binding(exported_members, prop.value)?;
                }
            }
            Binding::Data::BArray(obj) => {
                for prop in obj.items.iter() {
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
                    self.log.add_error_fmt(
                        self.source,
                        value.loc,
                        self.allocator,
                        format_args!("for-{} loop variables cannot have an initializer", loop_type),
                    )?;
                }
            }
            _ => {
                self.log.add_error_fmt(
                    self.source,
                    decls[0].binding.loc,
                    self.allocator,
                    format_args!("for-{} loops must have a single declaration", loop_type),
                )?;
            }
        }
        Ok(())
    }

    pub fn require_initializers<const KIND: S::Local::Kind>(
        &mut self,
        decls: &[G::Decl],
    ) -> Result<(), bun_core::Error> {
        let what = match KIND {
            S::Local::Kind::KAwaitUsing | S::Local::Kind::KUsing => "declaration",
            S::Local::Kind::KConst => "constant",
            _ => unreachable!(), // @compileError("unreachable") in Zig
        };

        for decl in decls {
            if decl.value.is_none() {
                match &decl.binding.data {
                    Binding::Data::BIdentifier(ident) => {
                        let r = js_lexer::range_of_identifier(self.source, decl.binding.loc);
                        self.log.add_range_error_fmt(
                            self.source,
                            r,
                            self.allocator,
                            format_args!(
                                "The {} \"{}\" must be initialized",
                                what,
                                bstr::BStr::new(self.symbols[ident.r#ref.inner_index() as usize].original_name)
                            ),
                        )?;
                        // return;/
                    }
                    _ => {
                        self.log.add_error_fmt(
                            self.source,
                            decl.binding.loc,
                            self.allocator,
                            format_args!("This {} must be initialized", what),
                        )?;
                    }
                }
            }
        }
        Ok(())
    }

    // Generate a TypeScript namespace object for this namespace's scope. If this
    // namespace is another block that is to be merged with an existing namespace,
    // use that earlier namespace's object instead.
    pub fn get_or_create_exported_namespace_members(
        &mut self,
        name: &[u8],
        is_export: bool,
        is_enum_scope: bool,
    ) -> &'a mut js_ast::TSNamespaceScope {
        let map: Option<*mut js_ast::TSNamespaceMemberMap> = 'brk: {
            // Merge with a sibling namespace from the same scope
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            if let Some(existing_member) = unsafe { &*self.current_scope }.members.get(name) {
                if let Some(member_data) = self.ref_to_ts_namespace_member.get(&existing_member.r#ref) {
                    if let js_ast::TSNamespaceMember::Data::Namespace(ns) = member_data {
                        break 'brk Some(*ns as *mut _);
                    }
                }
            }

            // Merge with a sibling namespace from a different scope
            if is_export {
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                if let Some(ns) = unsafe { &*self.current_scope }.ts_namespace {
                    // SAFETY: arena-owned TSNamespaceMemberMap valid for parser 'a lifetime
                    if let Some(member) = unsafe { &*ns }.exported_members.get(name) {
                        if let js_ast::TSNamespaceMember::Data::Namespace(m) = member.data {
                            break 'brk Some(m as *mut _);
                        }
                    }
                }
            }

            None
        };

        if let Some(existing) = map {
            return self.allocator.alloc(js_ast::TSNamespaceScope {
                exported_members: existing,
                is_enum_scope,
                arg_ref: Ref::NONE,
            });
        }

        // Otherwise, generate a new namespace object
        // Batch the allocation of the namespace object and the map into a single allocation.
        struct Pair {
            map: js_ast::TSNamespaceMemberMap,
            scope: js_ast::TSNamespaceScope,
        }

        let pair = self.allocator.alloc(Pair {
            map: Default::default(),
            scope: js_ast::TSNamespaceScope {
                exported_members: core::ptr::null_mut(), // patched below
                is_enum_scope,
                arg_ref: Ref::NONE,
            },
        });
        pair.scope.exported_members = &mut pair.map;
        &mut pair.scope
    }

    // TODO:
    pub fn check_for_non_bmp_code_point(&mut self, _: logger::Loc, _: &[u8]) {}

    pub fn mark_strict_mode_feature(
        &mut self,
        feature: StrictModeFeature,
        r: logger::Range,
        detail: &[u8],
    ) -> Result<(), bun_core::Error> {
        let can_be_transformed = feature == StrictModeFeature::ForInVarInit;
        let text: &'a [u8] = match feature {
            StrictModeFeature::WithStatement => b"With statements",
            StrictModeFeature::DeleteBareName => b"\"delete\" of a bare identifier",
            StrictModeFeature::ForInVarInit => b"Variable initializers within for-in loops",
            StrictModeFeature::EvalOrArguments => {
                let mut v = BumpVec::new_in(self.allocator);
                let _ = write!(&mut v, "Declarations with the name \"{}\"", bstr::BStr::new(detail));
                v.into_bump_slice()
            }
            StrictModeFeature::ReservedWord => {
                let mut v = BumpVec::new_in(self.allocator);
                let _ = write!(&mut v, "\"{}\" is a reserved word and", bstr::BStr::new(detail));
                v.into_bump_slice()
            }
            StrictModeFeature::LegacyOctalLiteral => b"Legacy octal literals",
            StrictModeFeature::LegacyOctalEscape => b"Legacy octal escape sequences",
            StrictModeFeature::IfElseFunctionStmt => b"Function declarations inside if statements",
        };

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let scope = unsafe { &*self.current_scope };
        if self.is_strict_mode() {
            let mut why: &'a [u8] = b"";
            let mut where_: logger::Range = logger::Range::NONE;
            match scope.strict_mode {
                js_ast::StrictModeKind::ImplicitStrictModeImport => where_ = self.esm_import_keyword,
                js_ast::StrictModeKind::ImplicitStrictModeExport => where_ = self.esm_export_keyword,
                js_ast::StrictModeKind::ImplicitStrictModeTopLevelAwait => where_ = self.top_level_await_keyword,
                js_ast::StrictModeKind::ImplicitStrictModeClass => {
                    why = b"All code inside a class is implicitly in strict mode";
                    where_ = self.enclosing_class_keyword;
                }
                _ => {}
            }
            if why.is_empty() {
                let mut v = BumpVec::new_in(self.allocator);
                let _ = write!(
                    &mut v,
                    "This file is implicitly in strict mode because of the \"{}\" keyword here",
                    bstr::BStr::new(self.source.text_for_range(where_))
                );
                why = v.into_bump_slice();
            }
            let notes = self.allocator.alloc_slice_copy(&[logger::range_data(self.source, where_, why)]);
            let mut msg = BumpVec::new_in(self.allocator);
            let _ = write!(&mut msg, "{} cannot be used in strict mode", bstr::BStr::new(text));
            self.log.add_range_error_with_notes(self.source, r, msg.into_bump_slice(), notes)?;
        } else if !can_be_transformed && self.is_strict_mode_output_format() {
            let mut msg = BumpVec::new_in(self.allocator);
            let _ = write!(&mut msg, "{} cannot be used with the ESM output format due to strict mode", bstr::BStr::new(text));
            self.log.add_range_error(self.source, r, msg.into_bump_slice())?;
        }
        Ok(())
    }

    #[inline]
    pub fn is_strict_mode(&self) -> bool {
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &*self.current_scope }.strict_mode != js_ast::StrictModeKind::SloppyMode
    }

    #[inline]
    pub fn is_strict_mode_output_format(&self) -> bool {
        self.options.bundle && self.options.output_format.is_esm()
    }

    pub fn declare_common_js_symbol(
        &mut self,
        kind: Symbol::Kind,
        name: &'static [u8],
    ) -> Result<Ref, bun_core::Error> {
        let name_hash = Scope::get_member_hash(name);
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let module_scope = unsafe { &mut *self.module_scope };
        let member = module_scope.get_member_with_hash(name, name_hash).copied();

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
            if self.symbols[_member.r#ref.inner_index() as usize].kind == Symbol::Kind::Hoisted
                && kind == Symbol::Kind::Hoisted
                && !self.has_es_module_syntax
            {
                return Ok(_member.r#ref);
            }
        }

        // Create a new symbol if we didn't merge with an existing one above
        let r#ref = self.new_symbol(kind, name)?;

        if member.is_none() {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            unsafe { &mut *self.module_scope }
                .members
                .put(self.allocator, name, Scope::Member { r#ref, loc: logger::Loc::EMPTY })?;
            return Ok(r#ref);
        }

        // If the variable was declared, then it shadows this symbol. The code in
        // this module will be unable to reference this symbol. However, we must
        // still add the symbol to the scope so it gets minified (automatically-
        // generated code may still reference the symbol).
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *self.module_scope }.generated.push(self.allocator, r#ref)?;
        Ok(r#ref)
    }

    pub fn declare_generated_symbol(
        &mut self,
        kind: Symbol::Kind,
        name: &'static [u8],
    ) -> Result<Ref, bun_core::Error> {
        // The bundler runs the renamer, so it is ok to not append a hash
        if self.options.bundle {
            return self.declare_symbol_maybe_generated::<true>(kind, logger::Loc::EMPTY, name);
        }
        self.declare_symbol_maybe_generated::<true>(kind, logger::Loc::EMPTY, generated_symbol_name(name))
    }

    pub fn declare_symbol(
        &mut self,
        kind: Symbol::Kind,
        loc: logger::Loc,
        name: &'a [u8],
    ) -> Result<Ref, bun_core::Error> {
        // PERF(port): Zig used @call(bun.callmod_inline, ...) — rely on LLVM inlining
        self.declare_symbol_maybe_generated::<false>(kind, loc, name)
    }

    pub fn declare_symbol_maybe_generated<const IS_GENERATED: bool>(
        &mut self,
        kind: Symbol::Kind,
        loc: logger::Loc,
        name: &'a [u8],
    ) -> Result<Ref, bun_core::Error> {
        // p.checkForNonBMPCodePoint(loc, name)
        if !IS_GENERATED {
            // Forbid declaring a symbol with a reserved word in strict mode
            if self.is_strict_mode()
                && name.as_ptr() != arguments_str().as_ptr()
                && js_lexer::STRICT_MODE_RESERVED_WORDS.has(name)
            {
                self.mark_strict_mode_feature(StrictModeFeature::ReservedWord, js_lexer::range_of_identifier(self.source, loc), name)?;
            }
        }

        // Allocate a new symbol
        let mut r#ref = self.new_symbol(kind, name)?;

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let scope = unsafe { &mut *self.current_scope };
        let entry = scope.members.get_or_put(self.allocator, name)?;
        if entry.found_existing {
            let existing = *entry.value_ptr;
            let symbol_idx = existing.r#ref.inner_index() as usize;

            if !IS_GENERATED {
                match scope.can_merge_symbols(self.symbols[symbol_idx].kind, kind, TYPESCRIPT) {
                    Scope::MergeResult::Forbidden => {
                        self.log.add_symbol_already_declared_error(
                            self.allocator,
                            self.source,
                            self.symbols[symbol_idx].original_name,
                            loc,
                            existing.loc,
                        )?;
                        return Ok(existing.r#ref);
                    }
                    Scope::MergeResult::KeepExisting => {
                        r#ref = existing.r#ref;
                    }
                    Scope::MergeResult::ReplaceWithNew => {
                        self.symbols[symbol_idx].link = r#ref;

                        // If these are both functions, remove the overwritten declaration
                        if kind.is_function() && self.symbols[symbol_idx].kind.is_function() {
                            self.symbols[symbol_idx].remove_overwritten_function_declaration = true;
                        }
                    }
                    Scope::MergeResult::BecomePrivateGetSetPair => {
                        r#ref = existing.r#ref;
                        self.symbols[symbol_idx].kind = Symbol::Kind::PrivateGetSetPair;
                    }
                    Scope::MergeResult::BecomePrivateStaticGetSetPair => {
                        r#ref = existing.r#ref;
                        self.symbols[symbol_idx].kind = Symbol::Kind::PrivateStaticGetSetPair;
                    }
                    Scope::MergeResult::OverwriteWithNew => {}
                }
            } else {
                self.symbols[r#ref.inner_index() as usize].link = existing.r#ref;
            }
        }
        *entry.key_ptr = name;
        *entry.value_ptr = js_ast::Scope::Member { r#ref, loc };
        if IS_GENERATED {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            unsafe { &mut *self.module_scope }.generated.push(self.allocator, r#ref)?;
        }
        Ok(r#ref)
    }

    pub fn validate_function_name(&mut self, func: &G::Fn, kind: FunctionKind) {
        if let Some(name) = &func.name {
            let original_name = self.symbols[name.r#ref.unwrap().inner_index() as usize].original_name;

            if func.flags.contains(Flags::Function::IsAsync) && original_name == b"await" {
                self.log
                    .add_range_error(
                        self.source,
                        js_lexer::range_of_identifier(self.source, name.loc),
                        "An async function cannot be named \"await\"",
                    )
                    .expect("unreachable");
            } else if kind == FunctionKind::Expr
                && func.flags.contains(Flags::Function::IsGenerator)
                && original_name == b"yield"
            {
                self.log
                    .add_range_error(
                        self.source,
                        js_lexer::range_of_identifier(self.source, name.loc),
                        "An generator function expression cannot be named \"yield\"",
                    )
                    .expect("unreachable");
            }
        }
    }

    pub fn declare_binding(
        &mut self,
        kind: Symbol::Kind,
        binding: &mut BindingNodeIndex,
        opts: &ParseStatementOptions,
    ) -> Result<(), bun_core::Error> {
        match &mut binding.data {
            Binding::Data::BMissing(_) => {}
            Binding::Data::BIdentifier(bind) => {
                if !opts.is_typescript_declare || (opts.is_namespace_scope && opts.is_export) {
                    bind.r#ref = self.declare_symbol(kind, binding.loc, self.load_name_from_ref(bind.r#ref))?;
                }
            }
            Binding::Data::BArray(bind) => {
                for item in bind.items.iter_mut() {
                    self.declare_binding(kind, &mut item.binding, opts).expect("unreachable");
                }
            }
            Binding::Data::BObject(bind) => {
                for prop in bind.properties.iter_mut() {
                    self.declare_binding(kind, &mut prop.value, opts).expect("unreachable");
                }
            }
        }
        Ok(())
    }

    pub fn store_name_in_ref(&mut self, name: &'a [u8]) -> Result<Ref, bun_core::Error> {
        if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
            if let Some(uses) = &mut self.parse_pass_symbol_uses {
                if let Some(res) = uses.get_ptr(name) {
                    res.used = true;
                }
            }
        }

        let contents_ptr = self.source.contents.as_ptr() as usize;
        let name_ptr = name.as_ptr() as usize;
        if contents_ptr <= name_ptr && (name_ptr + name.len()) <= (contents_ptr + self.source.contents.len()) {
            Ok(Ref::init_source_end(Ref::InitSourceEnd {
                source_index: u32::try_from(name_ptr - contents_ptr).unwrap(),
                inner_index: u32::try_from(name.len()).unwrap(),
                tag: Ref::Tag::SourceContentsSlice,
            }))
        } else {
            // TODO(port): Zig u31 — Rust has no u31; using u32 and trusting bit-width
            let inner_index = u32::try_from(self.allocated_names.len()).unwrap();
            self.allocated_names.push(name);
            Ok(Ref::init(inner_index, self.source.index.get(), false))
        }
    }

    pub fn load_name_from_ref(&self, r#ref: Ref) -> &'a [u8] {
        match r#ref.tag {
            Ref::Tag::Symbol => self.symbols[r#ref.inner_index() as usize].original_name,
            Ref::Tag::SourceContentsSlice => {
                &self.source.contents[r#ref.source_index() as usize..(r#ref.source_index() + r#ref.inner_index()) as usize]
            }
            Ref::Tag::AllocatedName => self.allocated_names[r#ref.inner_index() as usize],
            _ => panic!("Internal error: JS parser tried to load an invalid name from a Ref"),
        }
    }

    #[inline]
    pub fn add_import_record(&mut self, kind: ImportKind, loc: logger::Loc, name: &'a [u8]) -> u32 {
        self.add_import_record_by_range(kind, self.source.range_of_string(loc), name)
    }

    pub fn add_import_record_by_range(&mut self, kind: ImportKind, range: logger::Range, name: &'a [u8]) -> u32 {
        self.add_import_record_by_range_and_path(kind, range, fs::Path::init(name))
    }

    pub fn add_import_record_by_range_and_path(&mut self, kind: ImportKind, range: logger::Range, path: fs::Path) -> u32 {
        let index = self.import_records.len();
        let record = ImportRecord { kind, range, path, ..Default::default() };
        self.import_records.push(record);
        u32::try_from(index).unwrap()
    }

    pub fn pop_scope(&mut self) {
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let current_scope = unsafe { &mut *self.current_scope };
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

                self.symbols[member.value().r#ref.inner_index() as usize].must_not_be_renamed = true;
            }
        }

        self.current_scope = current_scope
            .parent
            .unwrap_or_else(|| self.panic("Internal error: attempted to call popScope() on the topmost scope", format_args!("")));
    }

    pub fn mark_expr_as_parenthesized(&mut self, expr: &mut Expr) {
        match &mut expr.data {
            Expr::Data::EArray(ex) => ex.is_parenthesized = true,
            Expr::Data::EObject(ex) => ex.is_parenthesized = true,
            _ => {}
        }
    }

    #[cold]
    pub fn panic(&mut self, fmt: &'static str, args: core::fmt::Arguments) -> ! {
        self.panic_loc(fmt, args, None);
    }

    pub fn panic_loc(&mut self, fmt: &'static str, args: core::fmt::Arguments, loc: Option<logger::Loc>) -> ! {
        let panic_buffer = self.allocator.alloc_slice_fill_default::<u8>(32 * 1024);
        // TODO(port): std.Io.Writer.fixed → write into &mut [u8] via std::io::Write
        let mut panic_stream: &mut [u8] = panic_buffer;
        let start_len = panic_stream.len();

        // panic during visit pass leaves the lexer at the end, which
        // would make this location absolutely useless.
        let location = loc.unwrap_or_else(|| self.lexer.loc());
        if (location.start as usize) < self.lexer.source.contents.len() && !location.is_empty() {
            let _ = self.log.add_range_error_fmt(
                self.source,
                logger::Range { loc: location, ..Default::default() },
                self.allocator,
                format_args!("panic here"),
            );
        }

        self.log.level = logger::Level::Verbose;
        let _ = self.log.print(&mut panic_stream);

        let written = start_len - panic_stream.len();
        Output::panic(format_args!("{}\n{}{}", fmt, args, bstr::BStr::new(&panic_buffer[..written])));
    }

    pub fn jsx_strings_to_member_expression(
        &mut self,
        loc: logger::Loc,
        parts: &[&'a [u8]],
    ) -> Result<Expr, bun_core::Error> {
        let result = self.find_symbol(loc, parts[0])?;

        let value = self.handle_identifier(
            loc,
            E::Identifier {
                r#ref: result.r#ref,
                must_keep_due_to_with_stmt: result.is_inside_with_scope,
                can_be_removed_if_unused: true,
                ..Default::default()
            },
            Some(parts[0]),
            IdentifierOpts { was_originally_identifier: true, ..Default::default() },
        );
        if parts.len() > 1 {
            return Ok(self.member_expression(loc, value, &parts[1..]));
        }

        Ok(value)
    }

    fn member_expression(&mut self, loc: logger::Loc, initial_value: Expr, parts: &[&'a [u8]]) -> Expr {
        let mut value = initial_value;

        for part in parts {
            if let Some(rewrote) = self.maybe_rewrite_property_access(
                loc,
                value,
                part,
                loc,
                crate::MaybeRewritePropertyAccessOpts {
                    is_call_target: false,
                    assign_target: js_ast::AssignTarget::None,
                    // is_template_tag: false,
                    is_delete_target: false,
                    ..Default::default()
                },
            ) {
                value = rewrote;
            } else {
                value = self.new_expr(
                    E::Dot {
                        target: value,
                        name: part,
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
            js_lexer::T::Equals => true,
            // "for ([a] in b) {}"
            js_lexer::T::In => !self.allow_in,
            // "for ([a] of b) {}"
            js_lexer::T::Identifier => !self.allow_in && self.lexer.is_contextual_keyword(b"of"),
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
        self.symbol_uses.clear();
        self.declared_symbols.clear();
        self.scopes_for_current_part.clear();
        self.import_records_for_current_part.clear();
        self.import_symbol_property_uses.clear();

        self.had_commonjs_named_exports_this_visit = false;

        let allocator = self.allocator;
        let mut opts = PrependTempRefsOpts::default();
        let mut part_stmts = BumpVec::from_iter_in(stmts.iter().cloned(), allocator);
        // PORT NOTE: Zig used ListManaged.fromOwnedSlice; we copy into a bump vec.

        self.visit_stmts_and_prepend_temp_refs(&mut part_stmts, &mut opts)?;

        // Insert any relocated variable statements now
        if !self.relocated_top_level_vars.is_empty() {
            let mut already_declared = RefMap::default();
            // PERF(port): was stack-fallback alloc — profile in Phase B

            for local in self.relocated_top_level_vars.iter_mut() {
                // Follow links because "var" declarations may be merged due to hoisting
                while let Some(r#ref) = local.r#ref {
                    let symbol = &self.symbols[r#ref.inner_index() as usize];
                    if !symbol.has_link() {
                        break;
                    }
                    local.r#ref = Some(symbol.link);
                }
                let Some(r#ref) = local.r#ref else { continue };
                let declaration_entry = already_declared.get_or_put(allocator, r#ref)?;
                if !declaration_entry.found_existing {
                    let decls = allocator.alloc_slice_copy(&[Decl {
                        binding: self.b(B::Identifier { r#ref }, local.loc),
                        value: None,
                    }]);
                    part_stmts.push(self.s(S::Local { decls: G::Decl::List::from_owned_slice(decls), ..Default::default() }, local.loc));
                    self.declared_symbols.push(self.allocator, DeclaredSymbol { r#ref, is_top_level: true })?;
                }
            }
            self.relocated_top_level_vars.clear();
        }

        if !part_stmts.is_empty() {
            let final_stmts = part_stmts.into_bump_slice();

            parts.push(js_ast::Part {
                stmts: final_stmts,
                symbol_uses: core::mem::take(&mut self.symbol_uses),
                import_symbol_property_uses: core::mem::take(&mut self.import_symbol_property_uses),
                declared_symbols: self.declared_symbols.to_owned_slice(),
                import_record_indices: BabyList::<u32>::from_owned_slice(
                    core::mem::replace(&mut self.import_records_for_current_part, BumpVec::new_in(self.allocator))
                        .into_bump_slice(),
                ),
                scopes: core::mem::replace(&mut self.scopes_for_current_part, BumpVec::new_in(self.allocator)).into_bump_slice(),
                can_be_removed_if_unused: self.stmts_can_be_removed_if_unused(final_stmts),
                tag: if self.had_commonjs_named_exports_this_visit {
                    js_ast::Part::Tag::CommonjsNamedExport
                } else {
                    js_ast::Part::Tag::None
                },
                ..Default::default()
            });
            self.symbol_uses = Default::default();
            self.import_symbol_property_uses = Default::default();
            self.had_commonjs_named_exports_this_visit = false;
        } else if self.declared_symbols.len() > 0 || self.symbol_uses.count() > 0 {
            // if the part is dead, invalidate all the usage counts
            self.clear_symbol_usages_from_dead_part(&js_ast::Part {
                declared_symbols: self.declared_symbols.clone(),
                symbol_uses: self.symbol_uses.clone(),
                ..Default::default()
            });
            self.declared_symbols.clear();
            self.import_records_for_current_part.clear();
        }
        Ok(())
    }

    fn binding_can_be_removed_if_unused(&mut self, binding: Binding) -> bool {
        if !self.options.features.dead_code_elimination {
            return false;
        }
        self.binding_can_be_removed_if_unused_without_dce_check(binding)
    }

    fn binding_can_be_removed_if_unused_without_dce_check(&mut self, binding: Binding) -> bool {
        match &binding.data {
            Binding::Data::BArray(bi) => {
                for item in bi.items.iter() {
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
            Binding::Data::BObject(bi) => {
                for property in bi.properties.iter() {
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
                Stmt::Data::SFunction(_) | Stmt::Data::SEmpty(_) => {}

                // Let these be removed if they are unused. Note that we also need to
                // check if the imported file is marked as "sideEffects: false" before we
                // can remove a SImport statement. Otherwise the import must be kept for
                // its side effects.
                Stmt::Data::SImport(_) => {}

                Stmt::Data::SClass(st) => {
                    if !self.class_can_be_removed_if_unused(&st.class) {
                        return false;
                    }
                }

                Stmt::Data::SExpr(st) => {
                    if st.does_not_affect_tree_shaking {
                        // Expressions marked with this are automatically generated and have
                        // no side effects by construction.
                        continue;
                    }
                    if !self.expr_can_be_removed_if_unused_without_dce_check(&st.value) {
                        return false;
                    }
                }

                Stmt::Data::SLocal(st) => {
                    // "await" is a side effect because it affects code timing
                    if st.kind == S::Local::Kind::KAwaitUsing {
                        return false;
                    }

                    for decl in st.decls.slice() {
                        if !self.binding_can_be_removed_if_unused_without_dce_check(decl.binding) {
                            return false;
                        }
                        if let Some(decl_value) = &decl.value {
                            if !self.expr_can_be_removed_if_unused_without_dce_check(decl_value) {
                                return false;
                            } else if st.kind == S::Local::Kind::KUsing {
                                // "using" declarations are only side-effect free if they are initialized to null or undefined
                                if !matches!(decl_value.data, Expr::Data::ENull(_) | Expr::Data::EUndefined(_)) {
                                    return false;
                                }
                            }
                        }
                    }
                }

                Stmt::Data::STry(try_) => {
                    if !self.stmts_can_be_removed_if_unused_without_dce_check(try_.body)
                        || (try_.finally.is_some()
                            && !self.stmts_can_be_removed_if_unused_without_dce_check(try_.finally.as_ref().unwrap().stmts))
                    {
                        return false;
                    }
                }

                // Exports are tracked separately, so this isn't necessary
                Stmt::Data::SExportClause(_) | Stmt::Data::SExportFrom(_) => {}

                Stmt::Data::SExportDefault(st) => match &st.value {
                    js_ast::StmtOrExpr::Stmt(s2) => match &s2.data {
                        Stmt::Data::SExpr(s_expr) => {
                            if !self.expr_can_be_removed_if_unused_without_dce_check(&s_expr.value) {
                                return false;
                            }
                        }
                        // These never have side effects
                        Stmt::Data::SFunction(_) => {}
                        Stmt::Data::SClass(sc) => {
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

    pub fn maybe_keep_expr_symbol_name(&mut self, expr: Expr, original_name: &'a [u8], was_anonymous_named_expr: bool) -> Expr {
        if was_anonymous_named_expr {
            self.keep_expr_symbol_name(expr, original_name)
        } else {
            expr
        }
    }

    pub fn value_for_this(&mut self, loc: logger::Loc) -> Option<Expr> {
        // Substitute "this" if we're inside a static class property initializer
        if self.fn_only_data_visit.should_replace_this_with_class_name_ref {
            if let Some(r#ref) = self.fn_only_data_visit.class_name_ref {
                // SAFETY: class_name_ref points at stack-owned Ref in enclosing visit frame
                let r = unsafe { *r#ref };
                self.record_usage(r);
                return Some(self.new_expr(E::Identifier { r#ref: r, ..Default::default() }, loc));
            }
        }

        // oroigianlly was !=- modepassthrough
        if !self.fn_only_data_visit.is_this_nested {
            if self.has_es_module_syntax && self.commonjs_named_exports.count() == 0 {
                // In an ES6 module, "this" is supposed to be undefined. Instead of
                // doing this at runtime using "fn.call(undefined)", we do it at
                // compile time using expression substitution here.
                return Some(Expr { loc, data: null_value_expr() });
            } else {
                // In a CommonJS module, "this" is supposed to be the same as "exports".
                // Instead of doing this at runtime using "fn.call(module.exports)", we
                // do it at compile time using expression substitution here.
                self.record_usage(self.exports_ref);
                self.deoptimize_common_js_named_exports();
                return Some(self.new_expr(E::Identifier { r#ref: self.exports_ref, ..Default::default() }, loc));
            }
        }

        None
    }

    pub fn is_valid_assignment_target(&self, expr: Expr) -> bool {
        match &expr.data {
            Expr::Data::EIdentifier(ident) => !is_eval_or_arguments(self.load_name_from_ref(ident.r#ref)),
            Expr::Data::EDot(e) => e.optional_chain.is_none(),
            Expr::Data::EIndex(e) => e.optional_chain.is_none(),
            Expr::Data::EArray(e) => !e.is_parenthesized,
            Expr::Data::EObject(e) => !e.is_parenthesized,
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
            let r = self.runtime_identifier_ref(logger::Loc::EMPTY, b"__require");
            self.record_usage(r);
        }
    }

    pub fn ignore_usage_of_runtime_require(&mut self) {
        if self.options.features.auto_polyfill_require {
            debug_assert!(self.runtime_imports.__require.is_some());
            let r = self.runtime_identifier_ref(logger::Loc::EMPTY, b"__require");
            self.ignore_usage(r);
            self.symbols[self.require_ref.inner_index() as usize].use_count_estimate =
                self.symbols[self.require_ref.inner_index() as usize].use_count_estimate.saturating_sub(1);
        }
    }

    #[inline]
    pub fn value_for_require(&self, loc: logger::Loc) -> Expr {
        debug_assert!(!self.is_source_runtime());
        Expr { data: Expr::Data::ERequireCallTarget(()), loc }
    }

    #[inline]
    pub fn value_for_import_meta_main(&mut self, inverted: bool, loc: logger::Loc) -> Expr {
        if let Some(known) = self.options.import_meta_main_value {
            return Expr {
                loc,
                data: Expr::Data::EBoolean(E::Boolean { value: if inverted { !known } else { known } }),
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
        Expr { loc, data: Expr::Data::EImportMetaMain(E::ImportMetaMain { inverted }) }
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
            if !matches!(arg.binding.data, Binding::Data::BIdentifier(_)) || arg.default.is_some() {
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

        for property in class.properties.iter() {
            if property.kind == Property::Kind::ClassStaticBlock {
                if !self.stmts_can_be_removed_if_unused_without_dce_check(property.class_static_block.as_ref().unwrap().stmts.slice()) {
                    return false;
                }
                continue;
            }

            if !self.expr_can_be_removed_if_unused_without_dce_check(property.key.as_ref().expect("unreachable")) {
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
        use js_ast::Op;
        match &expr.data {
            Expr::Data::ENull(_)
            | Expr::Data::EUndefined(_)
            | Expr::Data::EMissing(_)
            | Expr::Data::EBoolean(_)
            | Expr::Data::EBranchBoolean(_)
            | Expr::Data::ENumber(_)
            | Expr::Data::EBigInt(_)
            | Expr::Data::EString(_)
            | Expr::Data::EThis(_)
            | Expr::Data::ERegExp(_)
            | Expr::Data::EFunction(_)
            | Expr::Data::EArrow(_)
            | Expr::Data::EImportMeta(_) => return true,

            Expr::Data::EInlinedEnum(e) => return self.expr_can_be_removed_if_unused_without_dce_check(&e.value),

            Expr::Data::EDot(ex) => return ex.can_be_removed_if_unused,
            Expr::Data::EClass(ex) => return self.class_can_be_removed_if_unused(ex),
            Expr::Data::EIdentifier(ex) => {
                debug_assert!(!ex.r#ref.is_source_contents_slice()); // was not visited

                if ex.must_keep_due_to_with_stmt {
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
                if ex.can_be_removed_if_unused
                    || self.symbols[ex.r#ref.inner_index() as usize].kind != Symbol::Kind::Unbound
                {
                    return true;
                }
            }
            Expr::Data::ECommonjsExportIdentifier(_) | Expr::Data::EImportIdentifier(_) => {
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
            Expr::Data::EIf(ex) => {
                return self.expr_can_be_removed_if_unused_without_dce_check(&ex.test_)
                    && (self.is_side_effect_free_unbound_identifier_ref(ex.yes, ex.test_, true)
                        || self.expr_can_be_removed_if_unused_without_dce_check(&ex.yes))
                    && (self.is_side_effect_free_unbound_identifier_ref(ex.no, ex.test_, false)
                        || self.expr_can_be_removed_if_unused_without_dce_check(&ex.no));
            }
            Expr::Data::EArray(ex) => {
                for item in ex.items.slice() {
                    if !self.expr_can_be_removed_if_unused_without_dce_check(item) {
                        return false;
                    }
                }
                return true;
            }
            Expr::Data::EObject(ex) => {
                for property in ex.properties.slice() {
                    // The key must still be evaluated if it's computed or a spread
                    if property.kind == Property::Kind::Spread
                        || (property.flags.contains(Flags::Property::IsComputed)
                            && !property.key.unwrap().is_primitive_literal())
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
            Expr::Data::ECall(ex) => {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if ex.can_be_unwrapped_if_unused != E::CanBeUnwrapped::Never {
                    for arg in ex.args.slice() {
                        if !(self.expr_can_be_removed_if_unused_without_dce_check(arg)
                            || (ex.can_be_unwrapped_if_unused == E::CanBeUnwrapped::IfUnusedAndToStringSafe
                                && arg.data.is_safe_to_string()))
                        {
                            return false;
                        }
                    }
                    return true;
                }
            }
            Expr::Data::ENew(ex) => {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if ex.can_be_unwrapped_if_unused != E::CanBeUnwrapped::Never {
                    for arg in ex.args.slice() {
                        if !(self.expr_can_be_removed_if_unused_without_dce_check(arg)
                            || (ex.can_be_unwrapped_if_unused == E::CanBeUnwrapped::IfUnusedAndToStringSafe
                                && arg.data.is_safe_to_string()))
                        {
                            return false;
                        }
                    }
                    return true;
                }
            }
            Expr::Data::EUnary(ex) => match ex.op {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                Op::UnVoid | Op::UnNot => return self.expr_can_be_removed_if_unused_without_dce_check(&ex.value),

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
                Op::UnTypeof => {
                    if matches!(ex.value.data, Expr::Data::EIdentifier(_)) && ex.flags.was_originally_typeof_identifier {
                        return true;
                    }
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.value);
                }
                _ => {}
            },
            Expr::Data::EBinary(ex) => match ex.op {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                Op::BinStrictEq | Op::BinStrictNe | Op::BinComma | Op::BinNullishCoalescing => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && self.expr_can_be_removed_if_unused_without_dce_check(&ex.right);
                }
                // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
                Op::BinLogicalOr => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && (self.is_side_effect_free_unbound_identifier_ref(ex.right, ex.left, false)
                            || self.expr_can_be_removed_if_unused_without_dce_check(&ex.right));
                }
                // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
                Op::BinLogicalAnd => {
                    return self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && (self.is_side_effect_free_unbound_identifier_ref(ex.right, ex.left, true)
                            || self.expr_can_be_removed_if_unused_without_dce_check(&ex.right));
                }
                // For "==" and "!=", pretend the operator was actually "===" or "!==". If
                // we know that we can convert it to "==" or "!=", then we can consider the
                // operator itself to have no side effects. This matters because our mangle
                // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
                // and since "typeof x === 'object'" is considered to be side-effect free,
                // we must also consider "typeof x == 'object'" to be side-effect free.
                Op::BinLooseEq | Op::BinLooseNe => {
                    return SideEffects::can_change_strict_to_loose(ex.left.data, ex.right.data)
                        && self.expr_can_be_removed_if_unused_without_dce_check(&ex.left)
                        && self.expr_can_be_removed_if_unused_without_dce_check(&ex.right);
                }
                // Special-case "<" and ">" with string, number, or bigint arguments
                Op::BinLt | Op::BinGt | Op::BinLe | Op::BinGe => {
                    let left = ex.left.known_primitive();
                    let right = ex.right.known_primitive();
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
            Expr::Data::ETemplate(templ) => {
                if templ.tag.is_none() {
                    for part in templ.parts.iter() {
                        if !self.expr_can_be_removed_if_unused_without_dce_check(&part.value)
                            || part.value.known_primitive() == js_ast::KnownPrimitive::Unknown
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
        use js_ast::Op;
        let Expr::Data::EIdentifier(id) = value.data else { return false };
        if self.symbols[id.r#ref.inner_index() as usize].kind != Symbol::Kind::Unbound {
            return false;
        }
        let Expr::Data::EBinary(binary) = guard_condition.data else { return false };
        let binary = *binary;
        let mut is_yes_branch = is_yes_branch_;

        match binary.op {
            Op::BinStrictEq | Op::BinStrictNe | Op::BinLooseEq | Op::BinLooseNe => {
                // typeof x !== 'undefined'
                let mut typeof_: Expr::Data = binary.left.data;
                let mut compare: Expr::Data = binary.right.data;
                // typeof 'undefined' !== x
                if matches!(typeof_, Expr::Data::EString(_)) {
                    typeof_ = binary.right.data;
                    compare = binary.left.data;
                }

                // this order because Expr.Data Tag is not a pointer
                // so it should be slightly faster to compare
                let Expr::Data::EString(compare_str) = compare else { return false };
                let Expr::Data::EUnary(unary) = typeof_ else { return false };
                let unary = *unary;

                if unary.op != Op::UnTypeof || !matches!(unary.value.data, Expr::Data::EIdentifier(_)) {
                    return false;
                }

                let id2 = unary.value.data.e_identifier().r#ref;
                ((compare_str.eql_comptime(b"undefined") == is_yes_branch)
                    == (binary.op == Op::BinStrictNe || binary.op == Op::BinLooseNe))
                    && id.r#ref.eql(id2)
            }
            Op::BinLt | Op::BinGt | Op::BinLe | Op::BinGe => {
                // Pattern match for "typeof x < <string>"
                let mut typeof_: Expr::Data = binary.left.data;
                let mut str_: Expr::Data = binary.right.data;

                // Check if order is flipped: 'u' >= typeof x
                if matches!(typeof_, Expr::Data::EString(_)) {
                    typeof_ = binary.right.data;
                    str_ = binary.left.data;
                    is_yes_branch = !is_yes_branch;
                }

                if let (Expr::Data::EUnary(unary), Expr::Data::EString(s)) = (typeof_, str_) {
                    let unary = *unary;
                    if unary.op == Op::UnTypeof
                        && matches!(unary.value.data, Expr::Data::EIdentifier(_))
                        && unary.flags.was_originally_typeof_identifier
                        && s.eql_comptime(b"u")
                    {
                        // In "typeof x < 'u' ? x : null", the reference to "x" is side-effect free
                        // In "typeof x > 'u' ? x : null", the reference to "x" is side-effect free
                        if is_yes_branch == (binary.op == Op::BinLt || binary.op == Op::BinLe) {
                            let id2 = unary.value.data.e_identifier().r#ref;
                            if id.r#ref.eql(id2) {
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

    pub fn jsx_import_automatic(&mut self, loc: logger::Loc, is_static: bool) -> Expr {
        self.jsx_import(
            if is_static && !self.options.jsx.development && FeatureFlags::SUPPORT_JSXS_IN_JSX_TRANSFORM {
                JSXImport::Jsxs
            } else if self.options.jsx.development {
                JSXImport::JsxDEV
            } else {
                JSXImport::Jsx
            },
            loc,
        )
    }

    pub fn jsx_import(&mut self, kind: JSXImport, loc: logger::Loc) -> Expr {
        // TODO(port): Zig used `switch (kind) { inline else => |field| ... @tagName(field) }`.
        // We replicate via tag_name() helper on the enum.
        let r#ref: Ref = 'brk: {
            if self.jsx_imports.get_with_tag(kind).is_none() {
                let symbol_name = kind.tag_name();
                let loc_ref = LocRef {
                    loc,
                    r#ref: Some(self.declare_generated_symbol(Symbol::Kind::Other, symbol_name).expect("unreachable")),
                };
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                unsafe { &mut *self.module_scope }
                    .generated
                    .push(self.allocator, loc_ref.r#ref.unwrap())
                    .expect("oom");
                self.is_import_item.put(self.allocator, loc_ref.r#ref.unwrap(), ()).expect("unreachable");
                self.jsx_imports.set(kind, loc_ref);
                break 'brk loc_ref.r#ref.unwrap();
            }
            self.jsx_imports.get_with_tag(kind).unwrap()
        };

        self.record_usage(r#ref);
        self.handle_identifier(
            loc,
            E::Identifier {
                r#ref,
                can_be_removed_if_unused: true,
                call_can_be_unwrapped_if_unused: true,
                ..Default::default()
            },
            None,
            IdentifierOpts { was_originally_identifier: true, ..Default::default() },
        )
    }

    pub fn select_local_kind(&self, kind: S::Local::Kind) -> S::Local::Kind {
        // Use "var" instead of "let" and "const" if the variable declaration may
        // need to be separated from the initializer. This allows us to safely move
        // this declaration into a nested scope.
        if (self.options.bundle || self.will_wrap_module_in_try_catch_for_using)
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            && unsafe { &*self.current_scope }.parent.is_none()
            && !kind.is_using()
        {
            return S::Local::Kind::KVar;
        }

        // Optimization: use "let" instead of "const" because it's shorter. This is
        // only done when bundling because assigning to "const" is only an error when bundling.
        if self.options.bundle && kind == S::Local::Kind::KConst && self.options.features.minify_syntax {
            return S::Local::Kind::KLet;
        }

        kind
    }

    pub fn ignore_usage(&mut self, r#ref: Ref) {
        if !self.is_control_flow_dead && !self.is_revisit_for_substitution {
            debug_assert!((r#ref.inner_index() as usize) < self.symbols.len());
            self.symbols[r#ref.inner_index() as usize].use_count_estimate =
                self.symbols[r#ref.inner_index() as usize].use_count_estimate.saturating_sub(1);
            let Some(mut use_) = self.symbol_uses.get(&r#ref).copied() else { return };
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
                Expr::Data::EIdentifier(id) => {
                    self.ignore_usage(id.r#ref);
                }
                Expr::Data::EDot(dot) => {
                    current = dot.target;
                    continue;
                }
                Expr::Data::EIndex(index) => {
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

    pub fn is_export_to_eliminate(&self, r#ref: Ref) -> bool {
        let symbol_name = self.load_name_from_ref(r#ref);
        self.options.features.replace_exports.contains(symbol_name)
    }

    pub fn inject_replacement_export(
        &mut self,
        stmts: &mut StmtList,
        name_ref: Ref,
        loc: logger::Loc,
        replacement: &RuntimeFeatures::ReplaceableExport,
    ) -> bool {
        match replacement {
            RuntimeFeatures::ReplaceableExport::Delete => false,
            RuntimeFeatures::ReplaceableExport::Replace(value) => {
                let count = stmts.len();
                let decls = self.allocator.alloc_slice_copy(&[G::Decl {
                    binding: self.b(B::Identifier { r#ref: name_ref }, loc),
                    value: Some(*value),
                }]);
                let mut local = self.s(
                    S::Local { is_export: true, decls: Decl::List::from_owned_slice(decls), ..Default::default() },
                    loc,
                );
                self.visit_and_append_stmt(stmts, &mut local).expect("unreachable");
                count != stmts.len()
            }
            RuntimeFeatures::ReplaceableExport::Inject(with) => {
                let count = stmts.len();
                let decls = self.allocator.alloc_slice_copy(&[G::Decl {
                    binding: self.b(
                        B::Identifier { r#ref: self.declare_symbol(Symbol::Kind::Other, loc, with.name).expect("unreachable") },
                        loc,
                    ),
                    value: Some(with.value),
                }]);
                let mut local = self.s(
                    S::Local { is_export: true, decls: Decl::List::from_owned_slice(decls), ..Default::default() },
                    loc,
                );
                self.visit_and_append_stmt(stmts, &mut local).expect("unreachable");
                count != stmts.len()
            }
        }
    }

    pub fn replace_decl_and_possibly_remove(
        &mut self,
        decl: &mut G::Decl,
        replacement: &RuntimeFeatures::ReplaceableExport,
    ) -> bool {
        match replacement {
            RuntimeFeatures::ReplaceableExport::Delete => false,
            RuntimeFeatures::ReplaceableExport::Replace(value) => {
                decl.value = Some(self.visit_expr(*value));
                true
            }
            RuntimeFeatures::ReplaceableExport::Inject(with) => {
                let bind_loc = decl.binding.loc;
                let val_loc = decl.value.map(|v| v.loc).unwrap_or(bind_loc);
                *decl = G::Decl {
                    binding: self.b(
                        B::Identifier { r#ref: self.declare_symbol(Symbol::Kind::Other, bind_loc, with.name).expect("unreachable") },
                        bind_loc,
                    ),
                    value: Some(self.visit_expr(Expr { data: with.value.data, loc: val_loc })),
                };
                true
            }
        }
    }

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
        if let Stmt::Data::SBlock(block) = &body.data {
            let mut keep_block = false;
            for stmt in block.stmts.iter() {
                if statement_cares_about_scope(*stmt) {
                    keep_block = true;
                    break;
                }
            }
            if !keep_block && !block.stmts.is_empty() {
                stmts.extend_from_slice(block.stmts);
                return Ok(());
            }
        }

        if statement_cares_about_scope(body) {
            let block_stmts = self.allocator.alloc_slice_copy(&[body]);
            stmts.push(self.s(S::Block { stmts: block_stmts, ..Default::default() }, body.loc));
            return Ok(());
        }

        stmts.push(body);
        Ok(())
    }

    fn mark_exported_binding_inside_namespace(&mut self, r#ref: Ref, binding: BindingNodeIndex) {
        match binding.data {
            Binding::Data::BMissing(_) => {}
            Binding::Data::BIdentifier(ident) => {
                self.is_exported_inside_namespace.put(self.allocator, ident.r#ref, r#ref).expect("unreachable");
            }
            Binding::Data::BArray(array) => {
                for item in array.items.iter() {
                    self.mark_exported_binding_inside_namespace(r#ref, item.binding);
                }
            }
            Binding::Data::BObject(obj) => {
                for item in obj.properties.iter() {
                    self.mark_exported_binding_inside_namespace(r#ref, item.value);
                }
            }
        }
    }

    pub fn generate_closure_for_type_script_namespace_or_enum(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        stmt_loc: logger::Loc,
        is_export: bool,
        name_loc: logger::Loc,
        original_name_ref: Ref,
        arg_ref: Ref,
        stmts_inside_closure: &'a mut [Stmt],
        all_values_are_pure: bool,
    ) -> Result<(), bun_core::Error> {
        let mut name_ref = original_name_ref;

        // Follow the link chain in case symbols were merged
        let mut symbol = self.symbols[name_ref.inner_index() as usize];
        while symbol.has_link() {
            let link = symbol.link;
            name_ref = link;
            symbol = self.symbols[name_ref.inner_index() as usize];
        }
        let allocator = self.allocator;

        // Make sure to only emit a variable once for a given namespace, since there
        // can be multiple namespace blocks for the same namespace
        if (symbol.kind == Symbol::Kind::TsNamespace || symbol.kind == Symbol::Kind::TsEnum)
            && !self.emitted_namespace_vars.contains(&name_ref)
        {
            self.emitted_namespace_vars.put_no_clobber(allocator, name_ref, ()).expect("oom");

            let decls = allocator.alloc_slice_copy(&[G::Decl {
                binding: self.b(B::Identifier { r#ref: name_ref }, name_loc),
                value: None,
            }]);

            if self.enclosing_namespace_arg_ref.is_none() {
                // Top-level namespace: "var"
                stmts.push(self.s(
                    S::Local { kind: S::Local::Kind::KVar, decls: G::Decl::List::from_owned_slice(decls), is_export, ..Default::default() },
                    stmt_loc,
                ));
            } else {
                // Nested namespace: "let"
                stmts.push(self.s(
                    S::Local { kind: S::Local::Kind::KLet, decls: G::Decl::List::from_owned_slice(decls), ..Default::default() },
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
                    break 'arg_expr Expr::assign(
                        Expr::init_identifier(name_ref, name_loc),
                        self.new_expr(
                            E::Binary {
                                op: js_ast::Op::BinLogicalOrAssign,
                                left: self.new_expr(
                                    E::Dot {
                                        target: Expr::init_identifier(namespace, name_loc),
                                        name,
                                        name_loc,
                                        ..Default::default()
                                    },
                                    name_loc,
                                ),
                                right: self.new_expr(E::Object::default(), name_loc),
                            },
                            name_loc,
                        ),
                    );
                }
            }

            // "name ||= {}"
            self.record_usage(name_ref);
            self.new_expr(
                E::Binary {
                    op: js_ast::Op::BinLogicalOrAssign,
                    left: Expr::init_identifier(name_ref, name_loc),
                    right: self.new_expr(E::Object::default(), name_loc),
                },
                name_loc,
            )
        };

        let func_args = allocator.alloc_slice_copy(&[G::Arg {
            binding: self.b(B::Identifier { r#ref: arg_ref }, name_loc),
            ..Default::default()
        }]);

        let args_list = allocator.alloc_slice_copy(&[arg_expr]);

        let target = 'target: {
            // "(() => { foo() })()" => "(() => foo())()"
            if self.options.features.minify_syntax && stmts_inside_closure.len() == 1 {
                if let Stmt::Data::SExpr(se) = &stmts_inside_closure[0].data {
                    let val = se.value;
                    let l = stmts_inside_closure[0].loc;
                    stmts_inside_closure[0] = self.s(S::Return { value: Some(val) }, l);
                }
            }

            break 'target self.new_expr(
                E::Arrow {
                    args: func_args,
                    body: G::FnBody { loc: stmt_loc, stmts: allocator.alloc_slice_copy(stmts_inside_closure) },
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
                args: ExprNodeList::from_owned_slice(args_list),
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

        let closure = self.s(S::SExpr { value: call, does_not_affect_tree_shaking: all_values_are_pure }, stmt_loc);

        stmts.push(closure);
        Ok(())
    }

    pub fn lower_class(&mut self, stmtorexpr: js_ast::StmtOrExpr) -> &'a mut [Stmt] {
        match stmtorexpr {
            js_ast::StmtOrExpr::Stmt(stmt) => {
                // Standard decorator lowering path (for both JS and TS files)
                if stmt.data.s_class().class.should_lower_standard_decorators {
                    return self.lower_standard_decorators_stmt(stmt);
                }

                if !TYPESCRIPT {
                    if !stmt.data.s_class().class.has_decorators {
                        return self.allocator.alloc_slice_copy(&[stmt]);
                    }
                }
                let class = &mut stmt.data.s_class_mut().class;
                let mut constructor_function: Option<*mut E::Function> = None;

                let mut static_decorators = BumpVec::new_in(self.allocator);
                let mut instance_decorators = BumpVec::new_in(self.allocator);
                let mut instance_members = BumpVec::new_in(self.allocator);
                let mut static_members = BumpVec::new_in(self.allocator);
                let mut class_properties = BumpVec::new_in(self.allocator);

                for prop in class.properties.iter_mut() {
                    // merge parameter decorators with method decorators
                    if prop.flags.contains(Flags::Property::IsMethod) {
                        if let Some(prop_value) = &prop.value {
                            match &prop_value.data {
                                Expr::Data::EFunction(func) => {
                                    let is_constructor = matches!(&prop.key, Some(k) if matches!(&k.data, Expr::Data::EString(s) if s.eql_comptime(b"constructor")));

                                    if is_constructor {
                                        constructor_function = Some(func as *const _ as *mut _);
                                    }

                                    for (i, arg) in func.func.args.iter().enumerate() {
                                        for arg_decorator in arg.ts_decorators.slice() {
                                            let decorators = if is_constructor {
                                                &mut class.ts_decorators
                                            } else {
                                                &mut prop.ts_decorators
                                            };
                                            let args = self.allocator.alloc_slice_copy(&[
                                                self.new_expr(E::Number { value: i as f64 }, arg_decorator.loc),
                                                *arg_decorator,
                                            ]);
                                            decorators
                                                .push(self.allocator, self.call_runtime(arg_decorator.loc, b"__legacyDecorateParamTS", args))
                                                .expect("oom");
                                        }
                                    }
                                }
                                _ => unreachable!(),
                            }
                        }
                    }

                    // TODO: prop.kind == .declare and prop.value == null

                    if prop.ts_decorators.len > 0 {
                        let descriptor_key = prop.key.unwrap();
                        let loc = descriptor_key.loc;

                        // TODO: when we have the `accessor` modifier, add `and !prop.flags.contains(.has_accessor_modifier)` to
                        // the if statement.
                        let descriptor_kind: Expr = if !prop.flags.contains(Flags::Property::IsMethod) {
                            self.new_expr(E::Undefined {}, loc)
                        } else {
                            self.new_expr(E::Null {}, loc)
                        };

                        let target: Expr;
                        if prop.flags.contains(Flags::Property::IsStatic) {
                            self.record_usage(class.class_name.unwrap().r#ref.unwrap());
                            target = self.new_expr(
                                E::Identifier { r#ref: class.class_name.unwrap().r#ref.unwrap(), ..Default::default() },
                                class.class_name.unwrap().loc,
                            );
                        } else {
                            target = self.new_expr(
                                E::Dot {
                                    target: self.new_expr(
                                        E::Identifier { r#ref: class.class_name.unwrap().r#ref.unwrap(), ..Default::default() },
                                        class.class_name.unwrap().loc,
                                    ),
                                    name: b"prototype",
                                    name_loc: loc,
                                    ..Default::default()
                                },
                                loc,
                            );
                        }

                        let mut array = BumpVec::<Expr>::new_in(self.allocator);

                        if self.options.features.emit_decorator_metadata {
                            // TODO(port): full design:type / design:paramtypes / design:returntype
                            // metadata emission ported below in condensed form.
                            self.emit_decorator_metadata_for_prop(prop, &mut array, loc);
                        }

                        // PORT NOTE: reshaped — Zig insertSlice(0, ...) prepends; we prepend then push args.
                        let mut full = BumpVec::with_capacity_in(prop.ts_decorators.len as usize + array.len(), self.allocator);
                        full.extend_from_slice(prop.ts_decorators.slice());
                        full.extend_from_slice(&array);
                        let args = self.allocator.alloc_slice_copy(&[
                            self.new_expr(E::Array { items: ExprNodeList::from_owned_slice(full.into_bump_slice()), ..Default::default() }, loc),
                            target,
                            descriptor_key,
                            descriptor_kind,
                        ]);

                        let decorator = self.call_runtime(prop.key.unwrap().loc, b"__legacyDecorateClassTS", args);
                        let decorator_stmt = self.s(S::SExpr { value: decorator, ..Default::default() }, decorator.loc);

                        if prop.flags.contains(Flags::Property::IsStatic) {
                            static_decorators.push(decorator_stmt);
                        } else {
                            instance_decorators.push(decorator_stmt);
                        }
                    }

                    if prop.kind != Property::Kind::ClassStaticBlock
                        && !prop.flags.contains(Flags::Property::IsMethod)
                        && !matches!(prop.key.as_ref().map(|k| &k.data), Some(Expr::Data::EPrivateIdentifier(_)))
                        && prop.ts_decorators.len > 0
                    {
                        // remove decorated fields without initializers to avoid assigning undefined.
                        let Some(initializer) = prop.initializer else { continue };

                        let mut target: Expr;
                        if prop.flags.contains(Flags::Property::IsStatic) {
                            self.record_usage(class.class_name.unwrap().r#ref.unwrap());
                            target = self.new_expr(
                                E::Identifier { r#ref: class.class_name.unwrap().r#ref.unwrap(), ..Default::default() },
                                class.class_name.unwrap().loc,
                            );
                        } else {
                            target = self.new_expr(E::This {}, prop.key.unwrap().loc);
                        }

                        if prop.flags.contains(Flags::Property::IsComputed)
                            || matches!(prop.key.unwrap().data, Expr::Data::ENumber(_))
                        {
                            target = self.new_expr(E::Index { target, index: prop.key.unwrap(), ..Default::default() }, prop.key.unwrap().loc);
                        } else {
                            target = self.new_expr(
                                E::Dot {
                                    target,
                                    name: prop.key.unwrap().data.e_string().data,
                                    name_loc: prop.key.unwrap().loc,
                                    ..Default::default()
                                },
                                prop.key.unwrap().loc,
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

                    class_properties.push(prop.clone());
                }

                class.properties = class_properties.into_bump_slice();

                if !instance_members.is_empty() {
                    if constructor_function.is_none() {
                        let mut properties = BumpVec::from_iter_in(class.properties.iter().cloned(), self.allocator);
                        let mut constructor_stmts = BumpVec::new_in(self.allocator);

                        if class.extends.is_some() {
                            let target = self.new_expr(E::Super {}, stmt.loc);
                            let arguments_ref = self.new_symbol(Symbol::Kind::Unbound, arguments_str()).expect("unreachable");
                            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                            unsafe { &mut *self.current_scope }.generated.push(self.allocator, arguments_ref).expect("oom");

                            let super_ = self.new_expr(
                                E::Spread { value: self.new_expr(E::Identifier { r#ref: arguments_ref, ..Default::default() }, stmt.loc) },
                                stmt.loc,
                            );
                            let args = ExprNodeList::init_one(self.allocator, super_).expect("oom");

                            constructor_stmts.push(self.s(
                                S::SExpr { value: self.new_expr(E::Call { target, args, ..Default::default() }, stmt.loc), ..Default::default() },
                                stmt.loc,
                            ));
                        }

                        constructor_stmts.extend_from_slice(&instance_members);

                        properties.insert(
                            0,
                            G::Property {
                                flags: Flags::Property::init(Flags::PropertyInit { is_method: true, ..Default::default() }),
                                key: Some(self.new_expr(E::String { data: b"constructor" }, stmt.loc)),
                                value: Some(self.new_expr(
                                    E::Function {
                                        func: G::Fn {
                                            name: None,
                                            open_parens_loc: logger::Loc::EMPTY,
                                            args: &[],
                                            body: G::FnBody { loc: stmt.loc, stmts: constructor_stmts.into_bump_slice() },
                                            flags: Flags::Function::init(Default::default()),
                                            ..Default::default()
                                        },
                                    },
                                    stmt.loc,
                                )),
                                ..Default::default()
                            },
                        );

                        class.properties = properties.into_bump_slice();
                    } else {
                        // SAFETY: arena-owned E.Function node valid for parser 'a lifetime
                        let cf = unsafe { &mut *constructor_function.unwrap() };
                        let mut constructor_stmts =
                            BumpVec::from_iter_in(cf.func.body.stmts.iter().cloned(), self.allocator);
                        // statements coming from class body inserted after super call or beginning of constructor.
                        let mut super_index: Option<usize> = None;
                        for (index, item) in constructor_stmts.iter().enumerate() {
                            if !matches!(&item.data, Stmt::Data::SExpr(se) if matches!(&se.value.data, Expr::Data::ECall(c) if matches!(c.target.data, Expr::Data::ESuper(_))))
                            {
                                continue;
                            }
                            super_index = Some(index);
                            break;
                        }

                        let i = super_index.map(|j| j + 1).unwrap_or(0);
                        // TODO(port): bumpalo Vec lacks insert_slice; emulate via splice
                        for (off, m) in instance_members.iter().enumerate() {
                            constructor_stmts.insert(i + off, m.clone());
                        }

                        cf.func.body.stmts = constructor_stmts.into_bump_slice();
                    }

                    // TODO: make sure "super()" comes before instance field initializers
                    // https://github.com/evanw/esbuild/blob/e9413cc4f7ab87263ea244a999c6fa1f1e34dc65/internal/js_parser/js_parser_lower.go#L2742
                }

                let mut stmts_count: usize =
                    1 + static_members.len() + instance_decorators.len() + static_decorators.len();
                if class.ts_decorators.len > 0 {
                    stmts_count += 1;
                }
                let mut stmts = BumpVec::with_capacity_in(stmts_count, self.allocator);
                stmts.push(stmt); // PERF(port): was assume_capacity
                stmts.extend_from_slice(&static_members);
                stmts.extend_from_slice(&instance_decorators);
                stmts.extend_from_slice(&static_decorators);
                if class.ts_decorators.len > 0 {
                    let mut array = class.ts_decorators.move_to_list_managed(self.allocator);

                    if self.options.features.emit_decorator_metadata {
                        if let Some(cf) = constructor_function {
                            // design:paramtypes
                            // SAFETY: arena-owned E.Function node valid for parser 'a lifetime
                            let constructor_args = unsafe { &*cf }.func.args;
                            let args1 = if !constructor_args.is_empty() {
                                let param_array = self.allocator.alloc_slice_fill_default::<Expr>(constructor_args.len());
                                for (i, ca) in constructor_args.iter().enumerate() {
                                    param_array[i] = self.serialize_metadata(ca.ts_metadata).expect("unreachable");
                                }
                                self.new_expr(E::Array { items: ExprNodeList::from_owned_slice(param_array), ..Default::default() }, logger::Loc::EMPTY)
                            } else {
                                self.new_expr(E::Array { items: ExprNodeList::EMPTY, ..Default::default() }, logger::Loc::EMPTY)
                            };
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:paramtypes" }, logger::Loc::EMPTY),
                                args1,
                            ]);
                            array.push(self.call_runtime(stmt.loc, b"__legacyMetadataTS", args));
                        }
                    }

                    let args = self.allocator.alloc_slice_copy(&[
                        self.new_expr(E::Array { items: ExprNodeList::from_owned_slice(array.into_bump_slice()), ..Default::default() }, stmt.loc),
                        self.new_expr(E::Identifier { r#ref: class.class_name.unwrap().r#ref.unwrap(), ..Default::default() }, class.class_name.unwrap().loc),
                    ]);

                    stmts.push(Stmt::assign(
                        self.new_expr(E::Identifier { r#ref: class.class_name.unwrap().r#ref.unwrap(), ..Default::default() }, class.class_name.unwrap().loc),
                        self.call_runtime(stmt.loc, b"__legacyDecorateClassTS", args),
                    ));

                    self.record_usage(class.class_name.unwrap().r#ref.unwrap());
                    self.record_usage(class.class_name.unwrap().r#ref.unwrap());
                }
                stmts.into_bump_slice()
            }
            js_ast::StmtOrExpr::Expr(expr) => {
                self.allocator.alloc_slice_copy(&[self.s(S::SExpr { value: expr, ..Default::default() }, expr.loc)])
            }
        }
    }

    // Helper extracted from lower_class to keep that fn readable.
    // TODO(port): this condenses the Zig per-kind metadata switch (lines 5024-5105).
    // Phase B should diff against Zig to verify exact arg ordering for get/set.
    fn emit_decorator_metadata_for_prop(
        &mut self,
        prop: &G::Property,
        array: &mut BumpVec<'a, Expr>,
        loc: logger::Loc,
    ) {
        match prop.kind {
            Property::Kind::Normal | Property::Kind::Abstract => {
                {
                    // design:type
                    let args = self.allocator.alloc_slice_copy(&[
                        self.new_expr(E::String { data: b"design:type" }, logger::Loc::EMPTY),
                        self.serialize_metadata(prop.ts_metadata).expect("unreachable"),
                    ]);
                    array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                }
                // design:paramtypes and design:returntype if method
                if prop.flags.contains(Flags::Property::IsMethod) {
                    if let Some(prop_value) = &prop.value {
                        {
                            let method_args = prop_value.data.e_function().func.args;
                            let args_array = self.allocator.alloc_slice_fill_default::<Expr>(method_args.len());
                            for (entry, method_arg) in args_array.iter_mut().zip(method_args) {
                                *entry = self.serialize_metadata(method_arg.ts_metadata).expect("unreachable");
                            }
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:paramtypes" }, logger::Loc::EMPTY),
                                self.new_expr(E::Array { items: ExprNodeList::from_owned_slice(args_array), ..Default::default() }, logger::Loc::EMPTY),
                            ]);
                            array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                        }
                        {
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:returntype" }, logger::Loc::EMPTY),
                                self.serialize_metadata(prop_value.data.e_function().func.return_ts_metadata).expect("unreachable"),
                            ]);
                            array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                        }
                    }
                }
            }
            Property::Kind::Get => {
                if prop.flags.contains(Flags::Property::IsMethod) {
                    // typescript sets design:type to the return value & design:paramtypes to [].
                    if let Some(prop_value) = &prop.value {
                        {
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:type" }, logger::Loc::EMPTY),
                                self.serialize_metadata(prop_value.data.e_function().func.return_ts_metadata).expect("unreachable"),
                            ]);
                            array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                        }
                        {
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:paramtypes" }, logger::Loc::EMPTY),
                                self.new_expr(E::Array { items: ExprNodeList::EMPTY, ..Default::default() }, logger::Loc::EMPTY),
                            ]);
                            array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                        }
                    }
                }
            }
            Property::Kind::Set => {
                if prop.flags.contains(Flags::Property::IsMethod) {
                    // typescript sets design:type to the return value & design:paramtypes to [arg].
                    // note that typescript does not allow you to put a decorator on both the getter and the setter.
                    // if you do anyway, bun will set design:type and design:paramtypes twice, so it's fine.
                    if let Some(prop_value) = &prop.value {
                        let method_args = prop_value.data.e_function().func.args;
                        {
                            let args_array = self.allocator.alloc_slice_fill_default::<Expr>(method_args.len());
                            for (entry, method_arg) in args_array.iter_mut().zip(method_args) {
                                *entry = self.serialize_metadata(method_arg.ts_metadata).expect("unreachable");
                            }
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:paramtypes" }, logger::Loc::EMPTY),
                                self.new_expr(E::Array { items: ExprNodeList::from_owned_slice(args_array), ..Default::default() }, logger::Loc::EMPTY),
                            ]);
                            array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                        }
                        if !method_args.is_empty() {
                            let args = self.allocator.alloc_slice_copy(&[
                                self.new_expr(E::String { data: b"design:type" }, logger::Loc::EMPTY),
                                self.serialize_metadata(method_args[0].ts_metadata).expect("unreachable"),
                            ]);
                            array.push(self.call_runtime(loc, b"__legacyMetadataTS", args));
                        }
                    }
                }
            }
            Property::Kind::Spread | Property::Kind::Declare | Property::Kind::AutoAccessor => {} // not allowed in a class (auto_accessor is standard decorators only)
            Property::Kind::ClassStaticBlock => {} // not allowed to decorate this
        }
    }

    fn serialize_metadata(&mut self, ts_metadata: TypeScript::Metadata) -> Result<Expr, bun_core::Error> {
        use TypeScript::Metadata as M;
        Ok(match ts_metadata {
            M::None | M::Any | M::Unknown | M::Object => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Object").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Never | M::Undefined | M::Null | M::Void => self.new_expr(E::Undefined {}, logger::Loc::EMPTY),
            M::String => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"String").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Number => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Number").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Function => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Function").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Boolean => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Boolean").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Array => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Array").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Bigint => self.maybe_defined_helper(self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"BigInt").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ))?,
            M::Symbol => self.maybe_defined_helper(self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Symbol").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ))?,
            M::Promise => self.new_expr(
                E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Promise").expect("unreachable").r#ref, ..Default::default() },
                logger::Loc::EMPTY,
            ),
            M::Identifier(r#ref) => {
                self.record_usage(r#ref);
                if self.is_import_item.contains(&r#ref) {
                    return self.maybe_defined_helper(
                        self.new_expr(E::ImportIdentifier { r#ref, ..Default::default() }, logger::Loc::EMPTY),
                    );
                }
                return self.maybe_defined_helper(
                    self.new_expr(E::Identifier { r#ref, ..Default::default() }, logger::Loc::EMPTY),
                );
            }
            M::Dot(_refs) => {
                let mut refs = _refs;
                debug_assert!(refs.len() >= 2);
                // (refs.deinit(p.allocator) — arena-backed; nothing to free in Rust)

                let mut dots = self.new_expr(
                    E::Dot {
                        name: self.load_name_from_ref(refs[refs.len() - 1]),
                        name_loc: logger::Loc::EMPTY,
                        target: Expr::default(), // patched below
                        ..Default::default()
                    },
                    logger::Loc::EMPTY,
                );

                let mut current_expr: *mut Expr = &mut dots.data.e_dot_mut().target;
                let mut i: usize = refs.len() - 2;
                while i > 0 {
                    // SAFETY: arena-owned pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                    unsafe {
                        *current_expr = self.new_expr(
                            E::Dot {
                                name: self.load_name_from_ref(refs[i]),
                                name_loc: logger::Loc::EMPTY,
                                target: Expr::default(),
                                ..Default::default()
                            },
                            logger::Loc::EMPTY,
                        );
                        current_expr = &mut (*current_expr).data.e_dot_mut().target;
                    }
                    i -= 1;
                }

                // SAFETY: arena-owned pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                unsafe {
                    if self.is_import_item.contains(&refs[0]) {
                        *current_expr = self.new_expr(E::ImportIdentifier { r#ref: refs[0], ..Default::default() }, logger::Loc::EMPTY);
                    } else {
                        *current_expr = self.new_expr(E::Identifier { r#ref: refs[0], ..Default::default() }, logger::Loc::EMPTY);
                    }
                }

                // SAFETY: raw *mut Expr into arena-owned tree; parser holds exclusive access during visit
                let dot_identifier = unsafe { *current_expr };
                let mut current_dot = dots;

                let mut maybe_defined_dots = self.new_expr(
                    E::Binary {
                        op: js_ast::Op::BinLogicalOr,
                        right: self.check_if_defined_helper(current_dot)?,
                        left: Expr::default(), // patched below
                    },
                    logger::Loc::EMPTY,
                );

                if i < refs.len() - 2 {
                    current_dot = current_dot.data.e_dot().target;
                }
                current_expr = &mut maybe_defined_dots.data.e_binary_mut().left;

                while i < refs.len() - 2 {
                    // SAFETY: arena-owned pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                    unsafe {
                        *current_expr = self.new_expr(
                            E::Binary {
                                op: js_ast::Op::BinLogicalOr,
                                right: self.check_if_defined_helper(current_dot)?,
                                left: Expr::default(),
                            },
                            logger::Loc::EMPTY,
                        );
                        current_expr = &mut (*current_expr).data.e_binary_mut().left;
                    }
                    i += 1;
                    if i < refs.len() - 2 {
                        current_dot = current_dot.data.e_dot().target;
                    }
                }

                // SAFETY: raw *mut Expr into arena-owned tree; parser holds exclusive access during visit
                unsafe { *current_expr = self.check_if_defined_helper(dot_identifier)? };

                let root = self.new_expr(
                    E::If {
                        yes: self.new_expr(
                            E::Identifier { r#ref: self.find_symbol(logger::Loc::EMPTY, b"Object").expect("unreachable").r#ref, ..Default::default() },
                            logger::Loc::EMPTY,
                        ),
                        no: dots,
                        test_: maybe_defined_dots,
                    },
                    logger::Loc::EMPTY,
                );

                return Ok(root);
            }
        })
    }

    fn wrap_identifier_namespace(&mut self, loc: logger::Loc, r#ref: Ref) -> Expr {
        let enclosing_ref = self.enclosing_namespace_arg_ref.unwrap();
        self.record_usage(enclosing_ref);

        self.new_expr(
            E::Dot {
                target: Expr::init_identifier(enclosing_ref, loc),
                name: self.symbols[r#ref.inner_index() as usize].original_name,
                name_loc: loc,
                ..Default::default()
            },
            loc,
        )
    }

    fn wrap_identifier_hoisting(&mut self, loc: logger::Loc, r#ref: Ref) -> Expr {
        // There was a Zig stage1 bug here we had to copy `ref` into a local
        // const variable or else the result would be wrong
        // I remember that bug in particular took hours, possibly days to uncover.

        self.relocated_top_level_vars.push(LocRef { loc, r#ref: Some(r#ref) });
        self.record_usage(r#ref);
        Expr::init_identifier(r#ref, loc)
    }

    pub fn wrap_inlined_enum(&mut self, value: Expr, comment: &'a [u8]) -> Expr {
        if strings::contains(comment, b"*/") {
            // Don't wrap with a comment
            return value;
        }

        // Wrap with a comment
        self.new_expr(E::InlinedEnum { value, comment }, value.loc)
    }

    pub fn value_for_define(
        &mut self,
        loc: logger::Loc,
        assign_target: js_ast::AssignTarget,
        is_delete_target: bool,
        define_data: &DefineData,
    ) -> Expr {
        match &define_data.value {
            Expr::Data::EIdentifier(id) => {
                return self.handle_identifier(
                    loc,
                    *id,
                    define_data.original_name(),
                    IdentifierOpts { assign_target, is_delete_target, was_originally_identifier: true, ..Default::default() },
                );
            }
            Expr::Data::EString(str_) => {
                return self.new_expr(*str_, loc);
            }
            _ => {}
        }
        Expr { data: define_data.value, loc }
    }

    pub fn is_dot_define_match(&mut self, expr: Expr, parts: &[&[u8]]) -> bool {
        match &expr.data {
            Expr::Data::EDot(ex) => {
                if parts.len() > 1 {
                    if ex.optional_chain.is_some() {
                        return false;
                    }
                    // Intermediates must be dot expressions
                    let last = parts.len() - 1;
                    let is_tail_match = strings::eql(parts[last], ex.name);
                    return is_tail_match && self.is_dot_define_match(ex.target, &parts[..last]);
                }
            }
            Expr::Data::EImportMeta(_) => {
                return parts.len() == 2 && parts[0] == b"import" && parts[1] == b"meta";
            }
            // Note: this behavior differs from esbuild
            // esbuild does not try to match index accessors
            // we do, but only if it's a UTF8 string
            // the intent is to handle people using this form instead of E.Dot. So we really only want to do this if the accessor can also be an identifier
            Expr::Data::EIndex(index) => {
                if parts.len() > 1 {
                    if let Expr::Data::EString(s) = &index.index.data {
                        if s.is_utf8() {
                            if index.optional_chain.is_some() {
                                return false;
                            }
                            let last = parts.len() - 1;
                            let is_tail_match = strings::eql(parts[last], s.slice(self.allocator));
                            return is_tail_match && self.is_dot_define_match(index.target, &parts[..last]);
                        }
                    }
                }
            }
            Expr::Data::EIdentifier(ex) => {
                // The last expression must be an identifier
                if parts.len() == 1 {
                    let name = self.load_name_from_ref(ex.r#ref);
                    if !strings::eql(name, parts[0]) {
                        return false;
                    }

                    let Ok(result) = self.find_symbol_with_record_usage(expr.loc, name, false) else {
                        return false;
                    };

                    // We must not be in a "with" statement scope
                    if result.is_inside_with_scope {
                        return false;
                    }

                    // when there's actually no symbol by that name, we return Ref.None
                    // If a symbol had already existed by that name, we return .unbound
                    return result.r#ref.is_null()
                        || self.symbols[result.r#ref.inner_index() as usize].kind == Symbol::Kind::Unbound;
                }
            }
            _ => {}
        }
        false
    }

    // One statement could potentially expand to several statements
    pub fn stmts_to_single_stmt(&mut self, loc: logger::Loc, stmts: &'a mut [Stmt]) -> Stmt {
        if stmts.is_empty() {
            return Stmt { data: Prefill::Data::S_EMPTY, loc };
        }

        if stmts.len() == 1 && !statement_cares_about_scope(stmts[0]) {
            // "let" and "const" must be put in a block when in a single-statement context
            return stmts[0];
        }

        self.s(S::Block { stmts, ..Default::default() }, loc)
    }

    pub fn find_label_symbol(&mut self, loc: logger::Loc, name: &[u8]) -> FindLabelSymbolResult {
        let mut res = FindLabelSymbolResult { r#ref: Ref::NONE, is_loop: false, found: false };

        let mut _scope: Option<*mut Scope> = Some(self.current_scope);

        while let Some(scope_ptr) = _scope {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            let scope = unsafe { &*scope_ptr };
            if scope.kind_stops_hoisting() {
                break;
            }
            if let Some(label_ref) = scope.label_ref {
                if scope.kind == Scope::Kind::Label
                    && strings::eql(name, self.symbols[label_ref.inner_index() as usize].original_name)
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
        self.log
            .add_range_error_fmt(self.source, r, self.allocator, format_args!("There is no containing label named \"{}\"", bstr::BStr::new(name)))
            .expect("unreachable");

        // Allocate an "unbound" symbol
        let r#ref = self.new_symbol(Symbol::Kind::Unbound, self.allocator.alloc_slice_copy(name)).expect("unreachable");

        // Track how many times we've referenced this symbol
        self.record_usage(r#ref);

        res
    }

    // TODO(port): keepStmtSymbolName was @compileError("not implemented") in Zig — keep as todo!()
    #[allow(unused)]
    fn keep_stmt_symbol_name(&mut self, _loc: logger::Loc, _ref: Ref, _name: &[u8]) -> Stmt {
        todo!("not implemented")
    }

    fn runtime_identifier_ref(&mut self, loc: logger::Loc, name: &'static [u8]) -> Ref {
        self.has_called_runtime = true;

        if !self.runtime_imports.contains(name) {
            if !self.options.bundle {
                let generated_symbol = self.declare_generated_symbol(Symbol::Kind::Other, name).expect("unreachable");
                self.runtime_imports.put(name, generated_symbol);
                generated_symbol
            } else {
                let loc_ref = js_ast::LocRef {
                    loc,
                    r#ref: Some(self.new_symbol(Symbol::Kind::Other, name).expect("unreachable")),
                };
                self.runtime_imports.put(name, loc_ref.r#ref.unwrap());
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                unsafe { &mut *self.module_scope }.generated.push(self.allocator, loc_ref.r#ref.unwrap()).expect("oom");
                loc_ref.r#ref.unwrap()
            }
        } else {
            self.runtime_imports.at(name).unwrap()
        }
    }

    fn runtime_identifier(&mut self, loc: logger::Loc, name: &'static [u8]) -> Expr {
        let r#ref = self.runtime_identifier_ref(loc, name);
        self.record_usage(r#ref);
        self.new_expr(E::ImportIdentifier { r#ref, was_originally_identifier: false }, loc)
    }

    pub fn call_runtime(&mut self, loc: logger::Loc, name: &'static [u8], args: &'a mut [Expr]) -> Expr {
        self.new_expr(
            E::Call { target: self.runtime_identifier(loc, name), args: ExprNodeList::from_owned_slice(args), ..Default::default() },
            loc,
        )
    }

    pub fn extract_decls_for_binding(binding: Binding, decls: &mut ListManaged<'a, G::Decl>) -> Result<(), bun_core::Error> {
        match binding.data {
            Binding::Data::BMissing(_) => {}
            Binding::Data::BIdentifier(_) => {
                decls.push(G::Decl { binding, value: None });
            }
            Binding::Data::BArray(arr) => {
                for item in arr.items.iter() {
                    Self::extract_decls_for_binding(item.binding, decls).expect("unreachable");
                }
            }
            Binding::Data::BObject(obj) => {
                for prop in obj.properties.iter() {
                    Self::extract_decls_for_binding(prop.value, decls).expect("unreachable");
                }
            }
        }
        Ok(())
    }

    #[inline]
    pub fn module_exports(&mut self, loc: logger::Loc) -> Expr {
        self.new_expr(
            E::Dot {
                name: exports_string_name(),
                name_loc: loc,
                target: self.new_expr(E::Identifier { r#ref: self.module_ref, ..Default::default() }, loc),
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
        // Move up to the parent scope
        let to_flatten = self.current_scope;
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let parent_ptr = unsafe { &*to_flatten }.parent.unwrap();
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        let parent = unsafe { &mut *parent_ptr };
        self.current_scope = parent_ptr;

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
        let last = parent.children.len - 1;
        debug_assert!(parent.children.ptr()[last as usize] == to_flatten);
        parent.children.len = parent.children.len.saturating_sub(1);

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        for item in unsafe { &*to_flatten }.children.slice() {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            unsafe { &mut **item }.parent = Some(parent_ptr);
            parent.children.push(self.allocator, *item).expect("oom");
        }
    }

    /// When not transpiling we dont use the renamer, so our solution is to generate really
    /// hard to collide with variables, instead of actually making things collision free
    pub fn generate_temp_ref(&mut self, default_name: Option<&'a [u8]>) -> Ref {
        self.generate_temp_ref_with_scope(default_name, self.current_scope)
    }

    pub fn generate_temp_ref_with_scope(&mut self, default_name: Option<&'a [u8]>, scope: *mut Scope) -> Ref {
        let name = (if self.will_use_renamer() { default_name } else { None }).unwrap_or_else(|| {
            self.temp_ref_count += 1;
            let mut v = BumpVec::new_in(self.allocator);
            let _ = write!(&mut v, "__bun_temp_ref_{:x}$", self.temp_ref_count);
            v.into_bump_slice()
        });
        let r#ref = self.new_symbol(Symbol::Kind::Other, name).expect("oom");

        self.temp_refs_to_declare.push(TempRef { r#ref, ..Default::default() });

        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *scope }.generated.push(self.allocator, r#ref).expect("oom");

        r#ref
    }

    pub fn compute_ts_enums_map(&self, allocator: &'a Bump) -> Result<js_ast::Ast::TsEnumsMap, bun_core::Error> {
        // When hot module reloading is enabled, we disable enum inlining
        // to avoid making the HMR graph more complicated.
        if self.options.features.hot_module_reloading {
            return Ok(Default::default());
        }

        use js_ast::InlinedEnumValue;
        let mut map = js_ast::Ast::TsEnumsMap::default();
        map.ensure_total_capacity(allocator, u32::try_from(self.top_level_enums.len()).unwrap() as usize)?;
        for r#ref in self.top_level_enums.iter() {
            let entry = self.ref_to_ts_namespace_member.get_entry(r#ref).unwrap();
            let namespace = entry.value().namespace();
            let mut inner_map = StringHashMap::<InlinedEnumValue>::default();
            // SAFETY: arena-owned TSNamespaceMemberMap valid for parser 'a lifetime
            inner_map.ensure_total_capacity(allocator, u32::try_from(unsafe { &*namespace }.count()).unwrap() as usize)?;
            // SAFETY: arena-owned TSNamespaceMemberMap valid for parser 'a lifetime
            for (key, val) in unsafe { &*namespace }.iter() {
                match &val.data {
                    js_ast::TSNamespaceMember::Data::EnumNumber(num) => {
                        inner_map.put_assume_capacity_no_clobber(key, InlinedEnumValue::encode(InlinedEnumValue::Decoded::Number(*num)));
                    }
                    js_ast::TSNamespaceMember::Data::EnumString(str_) => {
                        inner_map.put_assume_capacity_no_clobber(key, InlinedEnumValue::encode(InlinedEnumValue::Decoded::String(*str_)));
                    }
                    _ => continue,
                }
            }
            map.put_assume_capacity(*entry.key(), inner_map);
        }
        Ok(map)
    }

    pub fn should_lower_using_declarations(&self, stmts: &[Stmt]) -> bool {
        // TODO: We do not support lowering await, but when we do this needs to point to that var
        let lower_await = false;

        // Check feature flags first, then iterate statements.
        if !self.options.features.lower_using && !lower_await {
            return false;
        }

        for stmt in stmts {
            if let Stmt::Data::SLocal(local) = &stmt.data {
                // Need to re-check lower_using for the k_using case in case lower_await is true
                if (local.kind == S::Local::Kind::KUsing && self.options.features.lower_using)
                    || local.kind == S::Local::Kind::KAwaitUsing
                {
                    return true;
                }
            }
        }

        false
    }

    const IMPORT_META_HOT_ACCEPT_ERR: &'static str =
        "Dependencies to `import.meta.hot.accept` must be statically analyzable module specifiers matching direct imports.";

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
    pub fn handle_import_meta_hot_accept_call(&mut self, call: &mut E::Call) {
        if call.args.len == 0 {
            return;
        }
        match &call.args.at(0).data {
            Expr::Data::EString(str_) => {
                let loc = call.args.at(0).loc;
                let Some(d) = self.rewrite_import_meta_hot_accept_string(str_, loc) else { return };
                call.args.mut_(0).data = d;
            }
            Expr::Data::EArray(arr) => {
                for item in arr.items.slice_mut() {
                    let Expr::Data::EString(s) = &item.data else {
                        let _ = self.log.add_error(self.source, item.loc, Self::IMPORT_META_HOT_ACCEPT_ERR);
                        continue;
                    };
                    let Some(d) = self.rewrite_import_meta_hot_accept_string(s, item.loc) else { return };
                    item.data = d;
                }
            }
            _ => return,
        }

        call.target.data = Expr::Data::ESpecial(E::Special::HotAcceptVisited);
    }

    fn rewrite_import_meta_hot_accept_string(&mut self, str_: &E::String, loc: logger::Loc) -> Option<Expr::Data> {
        let _ = str_.to_utf8(self.allocator);
        let specifier = str_.data;

        let import_record_index = 'found: {
            for (i, import_record) in self.import_records.items().iter().enumerate() {
                if strings::eql(specifier, import_record.path.text) {
                    break 'found i;
                }
            }
            let _ = self.log.add_error(self.source, loc, Self::IMPORT_META_HOT_ACCEPT_ERR);
            return None;
        };

        Some(Expr::Data::ESpecial(E::Special::ResolvedSpecifierString(
            E::Special::ResolvedSpecifierStringIndex::init(u32::try_from(import_record_index).unwrap()),
        )))
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
        let loc = logger::Loc::EMPTY;
        let label = strings::concat(
            self.allocator,
            &[
                self.source.path.pretty,
                b":",
                match export_kind {
                    ReactRefreshExportKind::Named => original_name,
                    ReactRefreshExportKind::Default => b"default",
                },
            ],
        )?;
        stmts.push(self.s(
            S::SExpr {
                value: self.new_expr(
                    E::Call {
                        target: Expr::init_identifier(self.react_refresh.register_ref, loc),
                        args: ExprNodeList::from_slice(
                            self.allocator,
                            &[Expr::init_identifier(r#ref, loc), self.new_expr(E::String { data: label }, loc)],
                        )?,
                        ..Default::default()
                    },
                    loc,
                ),
                ..Default::default()
            },
            loc,
        ));

        self.record_usage(r#ref);
        self.react_refresh.register_used = true;
        Ok(())
    }

    pub fn wrap_value_for_server_component_reference(&mut self, val: Expr, original_name: &'a [u8]) -> Expr {
        debug_assert!(self.options.features.server_components.wraps_exports());
        debug_assert!(self.current_scope == self.module_scope);

        if self.options.features.server_components == options::ServerComponents::WrapExportsForServerReference {
            bun_core::todo_panic!("registerServerReference");
        }

        let module_path = self.new_expr(
            E::String {
                data: if self.options.jsx.development {
                    self.source.path.pretty
                } else {
                    bun_core::todo_panic!("TODO: unique_key here")
                },
            },
            logger::Loc::EMPTY,
        );

        // registerClientReference(
        //   Comp,
        //   "src/filepath.tsx",
        //   "Comp"
        // );
        self.new_expr(
            E::Call {
                target: Expr::init_identifier(self.server_components_wrap_ref, logger::Loc::EMPTY),
                args: js_ast::ExprNodeList::from_slice(
                    self.allocator,
                    &[val, module_path, self.new_expr(E::String { data: original_name }, logger::Loc::EMPTY)],
                )
                .expect("oom"),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        )
    }

    pub fn handle_react_refresh_hook_call(&mut self, hook_call: &mut E::Call, original_name: &[u8]) {
        debug_assert!(self.options.features.react_fast_refresh);
        debug_assert!(ReactRefresh::is_hook_name(original_name));
        let Some(ctx_storage) = self.react_refresh.hook_ctx_storage else {
            return; // not in a function, ignore this hook call.
        };
        // SAFETY: hook_ctx_storage points at stack storage in the visiting fn frame
        let ctx_storage = unsafe { &mut *ctx_storage };

        // if this function has no hooks recorded, initialize a hook context
        // every function visit provides stack storage, which it will inspect at visit finish.
        let ctx: &mut ReactRefresh::HookContext = if let Some(ctx) = ctx_storage {
            ctx
        } else {
            self.react_refresh.signature_used = true;

            let mut scope = self.current_scope;
            loop {
                // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                let s = unsafe { &*scope };
                if s.kind == Scope::Kind::FunctionBody || s.kind == Scope::Kind::Block || s.kind == Scope::Kind::Entry {
                    break;
                }
                let Some(p) = s.parent else { break };
                scope = p;
            }

            *ctx_storage = Some(ReactRefresh::HookContext {
                hasher: wyhash::Wyhash::init(0),
                signature_cb: self.generate_temp_ref_with_scope(Some(b"_s"), scope),
                user_hooks: Default::default(),
            });

            // TODO(paperclover): fix the renamer bug. this bug
            // theoretically affects all usages of temp refs, but i cannot
            // find another example of it breaking (like with `using`)
            self.declared_symbols
                .push(self.allocator, DeclaredSymbol { is_top_level: true, r#ref: ctx_storage.as_ref().unwrap().signature_cb })
                .expect("oom");

            ctx_storage.as_mut().unwrap()
        };

        ctx.hasher.update(original_name);

        if let Some(built_in_hook) = ReactRefresh::BUILT_IN_HOOKS.get(original_name) {
            'hash_arg: {
                let arg_index: usize = match built_in_hook {
                    // useState first argument is initial state.
                    ReactRefresh::BuiltInHook::UseState => 0,
                    // useReducer second argument is initial state.
                    ReactRefresh::BuiltInHook::UseReducer => 1,
                    _ => break 'hash_arg,
                };
                if (hook_call.args.len as usize) <= arg_index {
                    break 'hash_arg;
                }
                let arg = hook_call.args.slice()[arg_index];
                arg.data.write_to_hasher(&mut ctx.hasher, self.symbols.as_slice());
            }
        } else {
            // TODO(port): Zig used `inline .e_identifier, .e_import_identifier, .e_commonjs_export_identifier => |id, tag|`
            // with @unionInit. We expand the three arms.
            match &hook_call.target.data {
                Expr::Data::EIdentifier(id) => {
                    let gop = ctx.user_hooks.get_or_put(self.allocator, id.r#ref).expect("oom");
                    if !gop.found_existing {
                        *gop.value_ptr = Expr { data: Expr::Data::EIdentifier(*id), loc: logger::Loc::EMPTY };
                    }
                }
                Expr::Data::EImportIdentifier(id) => {
                    let gop = ctx.user_hooks.get_or_put(self.allocator, id.r#ref).expect("oom");
                    if !gop.found_existing {
                        *gop.value_ptr = Expr { data: Expr::Data::EImportIdentifier(*id), loc: logger::Loc::EMPTY };
                    }
                }
                Expr::Data::ECommonjsExportIdentifier(id) => {
                    let gop = ctx.user_hooks.get_or_put(self.allocator, id.r#ref).expect("oom");
                    if !gop.found_existing {
                        *gop.value_ptr = Expr { data: Expr::Data::ECommonjsExportIdentifier(*id), loc: logger::Loc::EMPTY };
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
        hook: &ReactRefresh::HookContext,
    ) {
        debug_assert!(self.options.features.react_fast_refresh);

        // We need to prepend `_s();` as a statement.
        if stmts.len() == stmts.capacity() {
            // If the ArrayList does not have enough capacity, it is
            // re-allocated entirely to fit. Only one slot of new capacity
            // is used since we know this statement list is not going to be
            // appended to afterwards; This function is a post-visit handler.
            let mut new_stmts = BumpVec::with_capacity_in(stmts.len() + 1, self.allocator);
            new_stmts.push(Stmt::default()); // placeholder, overwritten below
            new_stmts.extend_from_slice(stmts.as_slice());
            *stmts = new_stmts;
        } else {
            // The array has enough capacity, so there is no possibility of
            // allocation failure. We just move all of the statements over
            // by one, and increase the length using `addOneAssumeCapacity`
            stmts.push(Stmt::default()); // PERF(port): was assume_capacity
            let len = stmts.len();
            stmts.copy_within(0..len - 1, 1);
        }

        let loc = logger::Loc::EMPTY;
        let prepended_stmt = self.s(
            S::SExpr {
                value: self.new_expr(E::Call { target: Expr::init_identifier(hook.signature_cb, loc), ..Default::default() }, loc),
                ..Default::default()
            },
            loc,
        );
        stmts[0] = prepended_stmt;
    }

    pub fn get_react_refresh_hook_signal_decl(&mut self, signal_cb_ref: Ref) -> Stmt {
        let loc = logger::Loc::EMPTY;
        self.react_refresh.latest_signature_ref = signal_cb_ref;
        // var s_ = $RefreshSig$();
        self.s(
            S::Local {
                decls: G::Decl::List::from_slice(
                    self.allocator,
                    &[G::Decl {
                        binding: self.b(B::Identifier { r#ref: signal_cb_ref }, loc),
                        value: Some(self.new_expr(
                            E::Call { target: Expr::init_identifier(self.react_refresh.create_signature_ref, loc), ..Default::default() },
                            loc,
                        )),
                    }],
                )
                .expect("oom"),
                ..Default::default()
            },
            loc,
        )
    }

    pub fn get_react_refresh_hook_signal_init(
        &mut self,
        ctx: &mut ReactRefresh::HookContext,
        function_with_hook_calls: Expr,
    ) -> Expr {
        let loc = logger::Loc::EMPTY;

        let final_ = ctx.hasher.final_();
        let hash_data = self
            .allocator
            .alloc_slice_fill_default::<u8>(bun_core::base64::encode_len_from_size(core::mem::size_of_val(&final_)));
        debug_assert!(bun_core::base64::encode(hash_data, bytemuck::bytes_of(&final_)) == hash_data.len());

        let have_custom_hooks = ctx.user_hooks.count() > 0;
        let have_force_arg = have_custom_hooks || self.react_refresh.force_reset;

        let args = self
            .allocator
            .alloc_slice_fill_default::<Expr>(2 + usize::from(have_force_arg) + usize::from(have_custom_hooks));

        args[0] = function_with_hook_calls;
        args[1] = self.new_expr(E::String { data: hash_data }, loc);

        if have_force_arg {
            args[2] = self.new_expr(E::Boolean { value: self.react_refresh.force_reset }, loc);
        }

        if have_custom_hooks {
            // () => [useCustom1, useCustom2]
            args[3] = self.new_expr(
                E::Arrow {
                    body: G::FnBody {
                        stmts: self.allocator.alloc_slice_copy(&[self.s(
                            S::Return {
                                value: Some(self.new_expr(
                                    E::Array { items: ExprNodeList::from_borrowed_slice_dangerous(ctx.user_hooks.values()), ..Default::default() },
                                    loc,
                                )),
                            },
                            loc,
                        )]),
                        loc,
                    },
                    prefer_expr: true,
                    ..Default::default()
                },
                loc,
            );
        }

        // _s(func, "<hash>", force, () => [useCustom])
        self.new_expr(
            E::Call { target: Expr::init_identifier(ctx.signature_cb, loc), args: ExprNodeList::from_owned_slice(args), ..Default::default() },
            loc,
        )
    }

    pub fn to_ast(
        &mut self,
        parts: &mut ListManaged<'a, js_ast::Part>,
        exports_kind: js_ast::ExportsKind,
        wrap_mode: WrapMode,
        hashbang: &'a [u8],
    ) -> Result<js_ast::Ast, bun_core::Error> {
        let allocator = self.allocator;

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

            let last_idx = parts.len() - 1;
            let mut hmr_transform_ctx = ConvertESMExportsForHmr {
                last_part: &mut parts[last_idx],
                is_in_node_modules: self.source.path.is_node_module(),
                ..Default::default()
            };
            hmr_transform_ctx.stmts.reserve({
                // get a estimate on how many statements there are going to be
                let mut count: usize = 0;
                for part in parts.iter() {
                    count += part.stmts.len();
                }
                count + 2
            });

            for part in parts.iter() {
                // Bake does not care about 'import =', as it handles it on it's own
                let _ = ImportScanner::scan(self, part.stmts, wrap_mode != WrapMode::None, true, Some(&mut hmr_transform_ctx))?;
            }

            hmr_transform_ctx.finalize(self, parts.as_mut_slice())?;
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
                    let mut part = parts[idx].clone();
                    self.import_records_for_current_part.clear();
                    self.declared_symbols.clear();

                    let result = ImportScanner::scan(self, part.stmts, wrap_mode != WrapMode::None, false, None)?;
                    kept_import_equals = kept_import_equals || result.kept_import_equals;
                    removed_import_equals = removed_import_equals || result.removed_import_equals;

                    part.stmts = result.stmts;
                    if !part.stmts.is_empty() {
                        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
                        if unsafe { &*self.module_scope }.contains_direct_eval && part.declared_symbols.len() > 0 {
                            // If this file contains a direct call to "eval()", all parts that
                            // declare top-level symbols must be kept since the eval'd code may
                            // reference those symbols.
                            part.can_be_removed_if_unused = false;
                        }
                        if part.declared_symbols.len() == 0 {
                            part.declared_symbols = self.declared_symbols.clone_in(self.allocator).expect("unreachable");
                        } else {
                            part.declared_symbols.append_list(self.allocator, &self.declared_symbols).expect("unreachable");
                        }

                        if part.import_record_indices.len == 0 {
                            part.import_record_indices = BabyList::from_owned_slice(
                                self.allocator.alloc_slice_copy(self.import_records_for_current_part.as_slice()),
                            );
                        } else {
                            part.import_record_indices
                                .append_slice(self.allocator, self.import_records_for_current_part.as_slice())
                                .expect("oom");
                        }

                        parts[parts_end] = part;
                        parts_end += 1;
                    }
                }

                // We need to iterate multiple times if an import-equals statement was
                // removed and there are more import-equals statements that may be removed
                if !kept_import_equals || !removed_import_equals {
                    break;
                }
            }

            // leave the first part in there for namespace export when bundling
            parts.truncate(parts_end);

            // Do a second pass for exported items now that imported items are filled out.
            // This isn't done for HMR because it already deletes all `.s_export_clause`s
            for part in parts.iter() {
                for stmt in part.stmts.iter() {
                    if let Stmt::Data::SExportClause(clause) = &stmt.data {
                        for item in clause.items.iter() {
                            if let Some(_import) = self.named_imports.get_entry(&item.name.r#ref.unwrap()) {
                                _import.value_mut().is_exported = true;
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
            let args = allocator.alloc_slice_fill_default::<Arg>(5 + usize::from(self.has_import_meta));
            args[0] = Arg { binding: self.b(B::Identifier { r#ref: self.exports_ref }, logger::Loc::EMPTY), ..Default::default() };
            args[1] = Arg { binding: self.b(B::Identifier { r#ref: self.require_ref }, logger::Loc::EMPTY), ..Default::default() };
            args[2] = Arg { binding: self.b(B::Identifier { r#ref: self.module_ref }, logger::Loc::EMPTY), ..Default::default() };
            args[3] = Arg { binding: self.b(B::Identifier { r#ref: self.filename_ref }, logger::Loc::EMPTY), ..Default::default() };
            args[4] = Arg { binding: self.b(B::Identifier { r#ref: self.dirname_ref }, logger::Loc::EMPTY), ..Default::default() };
            if self.has_import_meta {
                self.import_meta_ref = self.new_symbol(Symbol::Kind::Other, b"$Bun_import_meta").expect("oom");
                args[5] = Arg { binding: self.b(B::Identifier { r#ref: self.import_meta_ref }, logger::Loc::EMPTY), ..Default::default() };
            }

            let mut total_stmts_count: usize = 0;
            for part in parts.iter() {
                total_stmts_count += part.stmts.len();
            }

            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            let preserve_strict_mode = unsafe { &*self.module_scope }.strict_mode
                == js_ast::StrictModeKind::ExplicitStrictMode
                && !(parts.len() > 0
                    && parts[0].stmts.len() > 0
                    && matches!(parts[0].stmts[0].data, Stmt::Data::SDirective(_)));

            total_stmts_count += usize::from(preserve_strict_mode);

            let stmts_to_copy = allocator.alloc_slice_fill_default::<Stmt>(total_stmts_count);
            {
                let mut remaining_stmts = &mut stmts_to_copy[..];
                if preserve_strict_mode {
                    remaining_stmts[0] = self.s(S::Directive { value: b"use strict" }, self.module_scope_directive_loc);
                    remaining_stmts = &mut remaining_stmts[1..];
                }

                for part in parts.iter() {
                    remaining_stmts[..part.stmts.len()].copy_from_slice(part.stmts);
                    remaining_stmts = &mut remaining_stmts[part.stmts.len()..];
                }
            }

            let wrapper = self.new_expr(
                E::Function {
                    func: G::Fn {
                        name: None,
                        open_parens_loc: logger::Loc::EMPTY,
                        args,
                        body: G::FnBody { loc: logger::Loc::EMPTY, stmts: stmts_to_copy },
                        flags: Flags::Function::init(Flags::FunctionInit { is_export: false, ..Default::default() }),
                        ..Default::default()
                    },
                },
                logger::Loc::EMPTY,
            );

            let top_level_stmts = self.allocator.alloc_slice_copy(&[self.s(S::SExpr { value: wrapper, ..Default::default() }, logger::Loc::EMPTY)]);

            parts.reserve(1);
            parts.truncate(1);
            // PORT NOTE: reshaped — Zig wrote `parts.items.len = 1` directly
            parts[0].stmts = top_level_stmts;
        }

        // REPL mode transforms
        if self.options.repl_mode {
            repl_transforms::ReplTransforms::apply(self, parts, allocator)?;
        }

        let mut top_level_symbols_to_parts = js_ast::Ast::TopLevelSymbolToParts::default();
        let top_level = &mut top_level_symbols_to_parts;

        if self.options.bundle {
            // Each part tracks the other parts it depends on within this file
            for (part_index, part) in parts.iter_mut().enumerate() {
                let decls = &part.declared_symbols;
                let symbols = self.symbols.as_slice();
                let part_index = part_index as u32;

                DeclaredSymbol::for_each_top_level_symbol(decls, |input: Ref| {
                    // If this symbol was merged, use the symbol at the end of the
                    // linked list in the map. This is the case for multiple "var"
                    // declarations with the same name, for example.
                    let mut r#ref = input;
                    let mut symbol_ref = &symbols[r#ref.inner_index() as usize];
                    while symbol_ref.has_link() {
                        r#ref = symbol_ref.link;
                        symbol_ref = &symbols[r#ref.inner_index() as usize];
                    }

                    let entry = top_level.get_or_put(self.allocator, r#ref).expect("unreachable");
                    if !entry.found_existing {
                        *entry.value_ptr = Default::default();
                    }
                    entry.value_ptr.push(self.allocator, part_index).expect("oom");
                });
            }

            // Pulling in the exports of this module always pulls in the export part
            {
                let entry = top_level.get_or_put(self.allocator, self.exports_ref).expect("unreachable");
                if !entry.found_existing {
                    *entry.value_ptr = Default::default();
                }
                entry.value_ptr.push(self.allocator, js_ast::NAMESPACE_EXPORT_PART_INDEX).expect("oom");
            }
        }

        let wrapper_ref: Ref = 'brk: {
            if self.options.features.hot_module_reloading {
                break 'brk self.hmr_api_ref;
            }

            // When code splitting is enabled, always create wrapper_ref to match esbuild behavior.
            // Otherwise, use needsWrapperRef() to optimize away unnecessary wrappers.
            if self.options.bundle && (self.options.code_splitting || self.needs_wrapper_ref(parts.as_slice())) {
                let mut buf = BumpVec::new_in(self.allocator);
                let _ = write!(&mut buf, "require_{}", self.source.fmt_identifier());
                break 'brk self.new_symbol(Symbol::Kind::Other, buf.into_bump_slice()).expect("oom");
            }

            Ref::NONE
        };

        Ok(js_ast::Ast {
            runtime_imports: self.runtime_imports.clone(),
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            module_scope: unsafe { (*self.module_scope).clone() },
            exports_ref: self.exports_ref,
            wrapper_ref,
            module_ref: self.module_ref,
            export_star_import_records: self.export_star_import_records.as_slice(),
            approximate_newline_count: self.lexer.approximate_newline_count,
            exports_kind,
            named_imports: core::mem::take(&mut *self.named_imports),
            named_exports: core::mem::take(&mut self.named_exports),
            import_keyword: self.esm_import_keyword,
            export_keyword: self.esm_export_keyword,
            top_level_symbols_to_parts,
            char_freq: self.compute_character_frequency(),
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            directive: if unsafe { &*self.module_scope }.strict_mode == js_ast::StrictModeKind::ExplicitStrictMode {
                Some(b"use strict" as &[u8])
            } else {
                None
            },

            // Assign slots to symbols in nested scopes. This is some precomputation for
            // the symbol renaming pass that will happen later in the linker. It's done
            // now in the parser because we want it to be done in parallel per file and
            // we're already executing code in parallel here
            nested_scope_slot_counts: if self.options.features.minify_identifiers {
                renamer::assign_nested_scope_slots(self.allocator, self.module_scope, self.symbols.as_slice())
            } else {
                js_ast::SlotCounts::default()
            },

            require_ref: self.runtime_imports.__require.unwrap_or(self.require_ref),

            force_cjs_to_esm: self.unwrap_all_requires
                || exports_kind == js_ast::ExportsKind::EsmWithDynamicFallbackFromCjs,
            uses_module_ref: self.symbols[self.module_ref.inner_index() as usize].use_count_estimate > 0,
            uses_exports_ref: self.symbols[self.exports_ref.inner_index() as usize].use_count_estimate > 0,
            uses_require_ref: if self.options.bundle {
                self.runtime_imports.__require.is_some()
                    && self.symbols[self.runtime_imports.__require.unwrap().inner_index() as usize].use_count_estimate > 0
            } else {
                self.symbols[self.require_ref.inner_index() as usize].use_count_estimate > 0
            },
            commonjs_module_exports_assigned_deoptimized: self.commonjs_module_exports_assigned_deoptimized,
            top_level_await_keyword: self.top_level_await_keyword,
            commonjs_named_exports: core::mem::take(&mut self.commonjs_named_exports),
            has_commonjs_export_names: self.has_commonjs_export_names,
            has_import_meta: self.has_import_meta,

            hashbang,
            // TODO: cross-module constant inlining
            // const_values: self.const_values,
            ts_enums: self.compute_ts_enums_map(allocator)?,
            import_meta_ref: self.import_meta_ref,

            symbols: js_ast::Symbol::List::move_from_list(&mut self.symbols),
            parts: BabyList::<js_ast::Part>::move_from_list(parts),
            import_records: ImportRecord::List::move_from_list(&mut self.import_records),
            // TODO(port): ImportRecordList enum needs a move_from_list adapter
            ..Default::default()
        })
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
            for stmt in part.stmts.iter() {
                match &stmt.data {
                    Stmt::Data::SFunction(_) => {}
                    Stmt::Data::SClass(class) => {
                        if !class.class.can_be_moved() {
                            return true;
                        }
                    }
                    Stmt::Data::SLocal(local) => {
                        if local.was_commonjs_export || self.commonjs_named_exports.count() == 0 {
                            for decl in local.decls.slice() {
                                if let Some(value) = &decl.value {
                                    if !matches!(value.data, Expr::Data::EMissing(_)) && !value.can_be_moved() {
                                        return true;
                                    }
                                }
                            }
                            continue;
                        }
                        return true;
                    }
                    Stmt::Data::SExportDefault(ed) => {
                        if !ed.can_be_moved() {
                            return true;
                        }
                    }
                    Stmt::Data::SExportEquals(e) => {
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

    pub fn init(
        allocator: &'a Bump,
        log: &'a mut logger::Log,
        source: &'a logger::Source,
        define: &'a Define,
        lexer: js_lexer::Lexer,
        opts: Parser::Options,
    ) -> Result<Self, bun_core::Error> {
        // PORT NOTE: out-param constructor reshaped to return Self.
        let mut scope_order = ScopeOrderList::with_capacity_in(1, allocator);
        let scope = allocator.alloc(Scope {
            members: Default::default(),
            children: Default::default(),
            generated: Default::default(),
            kind: Scope::Kind::Entry,
            label_ref: None,
            parent: None,
            ..Default::default()
        });

        scope_order.push(Some(ScopeOrder { loc: loc_module_scope(), scope }));
        // PERF(port): was assume_capacity

        let mut this = Self {
            legacy_cjs_import_stmts: BumpVec::new_in(allocator),
            // This must default to true or else parsing "in" won't work right.
            // It will fail for the case in the "in-keyword.js" file
            allow_in: true,

            call_target: null_expr_data(),
            delete_target: null_expr_data(),
            stmt_expr_value: null_expr_data(),
            loop_body: null_stmt_data(),
            define,
            import_records: ImportRecordList::Owned(BumpVec::new_in(allocator)), // overwritten below for !SCAN_ONLY
            named_imports: NamedImportsType::Owned(Default::default()), // overwritten below for !SCAN_ONLY
            named_exports: Default::default(),
            log,
            stack_check: bun_core::StackCheck::init(),
            allocator,
            options: opts,
            then_catch_chain: ThenCatchChain { next_target: null_expr_data(), ..Default::default() },
            to_expr_wrapper_namespace: Default::default(), // patched below
            to_expr_wrapper_hoisted: Default::default(),   // patched below
            import_transposer: Default::default(),         // patched below
            require_transposer: Default::default(),        // patched below
            require_resolve_transposer: Default::default(),// patched below
            source,
            macro_: MacroState::init(allocator),
            current_scope: scope,
            module_scope: scope,
            scopes_in_order: scope_order,
            needs_jsx_import: if SCAN_ONLY { false } else { false }, // void in non-scan; bool in scan
            lexer,

            // Only enable during bundling, when not bundling CJS
            commonjs_named_exports_deoptimized: if opts.bundle {
                opts.output_format == options::OutputFormat::Cjs
            } else {
                true
            },

            // ─── all remaining fields default ───
            allow_private_identifiers: false,
            has_top_level_return: false,
            latest_return_had_semicolon: false,
            has_import_meta: false,
            has_es_module_syntax: false,
            top_level_await_keyword: logger::Range::NONE,
            fn_or_arrow_data_parse: FnOrArrowDataParse::default(),
            fn_or_arrow_data_visit: FnOrArrowDataVisit::default(),
            fn_only_data_visit: FnOnlyDataVisit::default(),
            allocated_names: BumpVec::new_in(allocator),
            latest_arrow_arg_loc: logger::Loc::EMPTY,
            forbid_suffix_after_as_loc: logger::Loc::EMPTY,
            scopes_for_current_part: BumpVec::new_in(allocator),
            symbols: BumpVec::new_in(allocator),
            ts_use_counts: BumpVec::new_in(allocator),
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
            injected_define_symbols: BumpVec::new_in(allocator),
            symbol_uses: Default::default(),
            declared_symbols: Default::default(),
            declared_symbols_for_reuse: Default::default(),
            runtime_imports: RuntimeImports::default(),
            imports_to_convert_from_require: BumpVec::new_in(allocator),
            unwrap_all_requires: false,
            commonjs_named_exports: Default::default(),
            commonjs_module_exports_assigned_deoptimized: false,
            commonjs_named_exports_needs_conversion: u32::MAX,
            had_commonjs_named_exports_this_visit: false,
            commonjs_replacement_stmts: &mut [],
            parse_pass_symbol_uses: None,
            has_commonjs_export_names: false,
            should_fold_typescript_constant_expressions: false,
            emitted_namespace_vars: RefMap::default(),
            is_exported_inside_namespace: Default::default(),
            local_type_names: StringBoolMap::default(),
            enclosing_namespace_arg_ref: None,
            jsx_imports: JSXImport::Symbols::default(),
            react_refresh: ReactRefresh::default(),
            server_components_wrap_ref: Ref::NONE,
            jest: Jest::default(),
            import_records_for_current_part: BumpVec::new_in(allocator),
            export_star_import_records: BumpVec::new_in(allocator),
            import_symbol_property_uses: Default::default(),
            esm_import_keyword: logger::Range::NONE,
            esm_export_keyword: logger::Range::NONE,
            enclosing_class_keyword: logger::Range::NONE,
            import_items_for_namespace: Default::default(),
            is_import_item: Default::default(),
            import_namespace_cc_map: Default::default(),
            scope_order_to_visit: &mut [],
            module_scope_directive_loc: logger::Loc::default(),
            is_control_flow_dead: false,
            is_revisit_for_substitution: false,
            method_call_must_be_replaced_with_undefined: false,
            has_non_local_export_declare_inside_namespace: false,
            await_target: None,
            temp_refs_to_declare: BumpVec::new_in(allocator),
            temp_ref_count: 0,
            relocated_top_level_vars: BumpVec::new_in(allocator),
            after_arrow_body_loc: logger::Loc::EMPTY,
            const_values: Default::default(),
            binary_expression_stack: BumpVec::new_in(allocator),
            binary_expression_simplify_stack: BumpVec::new_in(allocator),
            ref_to_ts_namespace_member: Default::default(),
            ts_namespace: RecentlyVisitedTSNamespace::default(),
            top_level_enums: BumpVec::new_in(allocator),
            scopes_in_order_for_enum: Default::default(),
            will_wrap_module_in_try_catch_for_using: false,
            nearest_stmt_list: None,
            decorator_class_name: None,
        };
        this.lexer.track_comments = opts.features.minify_identifiers;

        this.unwrap_all_requires = 'brk: {
            if opts.bundle && opts.output_format != options::OutputFormat::Cjs {
                if let Some(pkg) = source.path.package_name() {
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

        this.symbols = BumpVec::new_in(allocator);

        if !SCAN_ONLY {
            this.import_records = ImportRecordList::Owned(BumpVec::new_in(allocator));
            this.named_imports = NamedImportsType::Owned(Default::default());
        }
        // For SCAN_ONLY, the caller (Parser) assigns the borrowed variants after construction.

        // TODO(port): Binding2ExprWrapper / ExpressionTransposer .init(this) — these wrap
        // a back-pointer to `this`; in Rust they need either a lifetime or a raw *mut Self.
        // Phase B wires the actual transposer state machines.
        this.to_expr_wrapper_namespace = Binding2ExprWrapperNamespace::init(&mut this);
        this.to_expr_wrapper_hoisted = Binding2ExprWrapperHoisted::init(&mut this);
        this.import_transposer = ImportTransposer::init(&mut this);
        this.require_transposer = RequireTransposer::init(&mut this);
        this.require_resolve_transposer = RequireResolveTransposer::init(&mut this);

        if opts.features.top_level_await || SCAN_ONLY {
            this.fn_or_arrow_data_parse.allow_await = FnOrArrowDataParse::AllowAwait::AllowExpr;
            this.fn_or_arrow_data_parse.is_top_level = true;
        }

        if !TYPESCRIPT {
            // This is so it doesn't impact runtime transpiler caching when not in use
            this.options.features.emit_decorator_metadata = false;
        }

        Ok(this)
    }
}

// ─── LowerUsingDeclarationsContext (Zig: nested `pub const ... = struct { ... }`) ───
pub struct LowerUsingDeclarationsContext {
    pub first_using_loc: logger::Loc,
    pub stack_ref: Ref,
    pub has_await_using: bool,
}

impl LowerUsingDeclarationsContext {
    pub fn init<'a, const T: bool, const J: JSXTransformType, const S_: bool>(
        p: &mut P<'a, T, J, S_>,
    ) -> Result<Self, bun_core::Error> {
        Ok(Self {
            first_using_loc: logger::Loc::EMPTY,
            stack_ref: p.generate_temp_ref(Some(b"__stack")),
            has_await_using: false,
        })
    }

    pub fn scan_stmts<'a, const T: bool, const J: JSXTransformType, const S_: bool>(
        &mut self,
        p: &mut P<'a, T, J, S_>,
        stmts: &mut [Stmt],
    ) {
        for stmt in stmts.iter_mut() {
            let Stmt::Data::SLocal(local) = &mut stmt.data else { continue };
            if !local.kind.is_using() {
                continue;
            }

            if self.first_using_loc.is_empty() {
                self.first_using_loc = stmt.loc;
            }
            if local.kind == S::Local::Kind::KAwaitUsing {
                self.has_await_using = true;
            }
            for decl in local.decls.slice_mut() {
                if let Some(decl_value) = &mut decl.value {
                    let value_loc = decl_value.loc;
                    p.record_usage(self.stack_ref);
                    let args = p.allocator.alloc_slice_copy(&[
                        Expr { data: Expr::Data::EIdentifier(E::Identifier { r#ref: self.stack_ref, ..Default::default() }), loc: stmt.loc },
                        *decl_value,
                        // 1. always pass this param for hopefully better jit performance
                        // 2. pass 1 or 0 to be shorter than `true` or `false`
                        Expr {
                            data: Expr::Data::ENumber(E::Number {
                                value: if local.kind == S::Local::Kind::KAwaitUsing { 1.0 } else { 0.0 },
                            }),
                            loc: stmt.loc,
                        },
                    ]);
                    decl.value = Some(p.call_runtime(value_loc, b"__using", args));
                }
            }
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            if p.will_wrap_module_in_try_catch_for_using && unsafe { &*p.current_scope }.kind == Scope::Kind::Entry {
                local.kind = S::Local::Kind::KVar;
            } else {
                local.kind = S::Local::Kind::KConst;
            }
        }
    }

    pub fn finalize<'a, const T: bool, const J: JSXTransformType, const S_: bool>(
        &mut self,
        p: &mut P<'a, T, J, S_>,
        stmts: &'a mut [Stmt],
        should_hoist_fns: bool,
    ) -> ListManaged<'a, Stmt> {
        let mut result = BumpVec::new_in(p.allocator);
        let mut exports = BumpVec::<js_ast::ClauseItem>::new_in(p.allocator);
        let mut end: u32 = 0;
        for i in 0..stmts.len() {
            let stmt = stmts[i];
            match &stmt.data {
                Stmt::Data::SDirective(_)
                | Stmt::Data::SImport(_)
                | Stmt::Data::SExportFrom(_)
                | Stmt::Data::SExportStar(_) => {
                    // These can't go in a try/catch block
                    result.push(stmt);
                    continue;
                }
                Stmt::Data::SClass(c) => {
                    if c.is_export {
                        // can't go in try/catch; hoist out
                        result.push(stmt);
                        continue;
                    }
                }
                Stmt::Data::SExportDefault(_) => {
                    continue; // this prevents re-exporting default since we already have it as an .s_export_clause
                }
                Stmt::Data::SExportClause(data) => {
                    // Merge export clauses together
                    exports.extend_from_slice(data.items);
                    continue;
                }
                Stmt::Data::SFunction(_) => {
                    if should_hoist_fns {
                        // Hoist function declarations for cross-file ESM references
                        result.push(stmt);
                        continue;
                    }
                }
                Stmt::Data::SLocal(local) => {
                    // If any of these are exported, turn it into a "var" and add export clauses
                    if local.is_export {
                        local.is_export = false;
                        for decl in local.decls.slice() {
                            if let Binding::Data::BIdentifier(identifier) = decl.binding.data {
                                exports.push(js_ast::ClauseItem {
                                    name: LocRef { loc: decl.binding.loc, r#ref: Some(identifier.r#ref) },
                                    alias: p.symbols[identifier.r#ref.inner_index() as usize].original_name,
                                    alias_loc: decl.binding.loc,
                                    ..Default::default()
                                });
                                local.kind = S::Local::Kind::KVar;
                            }
                        }
                    }
                }
                _ => {}
            }

            stmts[end as usize] = stmt;
            end += 1;
        }

        let non_exported_statements = &mut stmts[..end as usize];

        let caught_ref = p.generate_temp_ref(Some(b"_catch"));
        let err_ref = p.generate_temp_ref(Some(b"_err"));
        let has_err_ref = p.generate_temp_ref(Some(b"_hasErr"));

        let mut scope = p.current_scope;
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        while !unsafe { &*scope }.kind_stops_hoisting() {
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            scope = unsafe { &*scope }.parent.unwrap();
        }

        let is_top_level = scope == p.module_scope;
        // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
        unsafe { &mut *scope }
            .generated
            .append_slice(p.allocator, &[self.stack_ref, caught_ref, err_ref, has_err_ref])
            .expect("oom");
        p.declared_symbols
            .ensure_unused_capacity(
                p.allocator,
                // 5 to include the _promise decl later on:
                if self.has_await_using { 5 } else { 4 },
            )
            .expect("oom");
        p.declared_symbols.push(p.allocator, DeclaredSymbol { is_top_level, r#ref: self.stack_ref }).unwrap();
        p.declared_symbols.push(p.allocator, DeclaredSymbol { is_top_level, r#ref: caught_ref }).unwrap();
        p.declared_symbols.push(p.allocator, DeclaredSymbol { is_top_level, r#ref: err_ref }).unwrap();
        p.declared_symbols.push(p.allocator, DeclaredSymbol { is_top_level, r#ref: has_err_ref }).unwrap();
        // PERF(port): was assume_capacity

        let loc = self.first_using_loc;
        let call_dispose = {
            p.record_usage(self.stack_ref);
            p.record_usage(err_ref);
            p.record_usage(has_err_ref);
            let args = p.allocator.alloc_slice_copy(&[
                Expr { data: Expr::Data::EIdentifier(E::Identifier { r#ref: self.stack_ref, ..Default::default() }), loc },
                Expr { data: Expr::Data::EIdentifier(E::Identifier { r#ref: err_ref, ..Default::default() }), loc },
                Expr { data: Expr::Data::EIdentifier(E::Identifier { r#ref: has_err_ref, ..Default::default() }), loc },
            ]);
            p.call_runtime(loc, b"__callDispose", args)
        };

        let finally_stmts: &'a mut [Stmt] = if self.has_await_using {
            let promise_ref = p.generate_temp_ref(Some(b"_promise"));
            // SAFETY: arena-owned Scope pointer valid for parser 'a lifetime; no aliasing &mut outstanding
            unsafe { &mut *scope }.generated.push(p.allocator, promise_ref).expect("oom");
            p.declared_symbols.push(p.allocator, DeclaredSymbol { is_top_level, r#ref: promise_ref }).unwrap();

            let promise_ref_expr = p.new_expr(E::Identifier { r#ref: promise_ref, ..Default::default() }, loc);

            let await_expr = p.new_expr(E::Await { value: promise_ref_expr }, loc);
            p.record_usage(promise_ref);

            let statements = p.allocator.alloc_slice_fill_default::<Stmt>(2);
            statements[0] = p.s(
                S::Local {
                    decls: {
                        let decls = p.allocator.alloc_slice_copy(&[Decl {
                            binding: p.b(B::Identifier { r#ref: promise_ref }, loc),
                            value: Some(call_dispose),
                        }]);
                        G::Decl::List::from_owned_slice(decls)
                    },
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
            statements[1] = p.s(
                S::SExpr {
                    value: p.new_expr(
                        E::Binary { op: js_ast::Op::BinLogicalAnd, left: promise_ref_expr, right: await_expr },
                        loc,
                    ),
                    ..Default::default()
                },
                loc,
            );

            statements
        } else {
            p.allocator.alloc_slice_copy(&[p.s(S::SExpr { value: call_dispose, ..Default::default() }, call_dispose.loc)])
        };

        // Wrap everything in a try/catch/finally block
        p.record_usage(caught_ref);
        result.reserve(2 + usize::from(!exports.is_empty()));
        result.push(p.s(
            S::Local {
                decls: {
                    let decls = p.allocator.alloc_slice_copy(&[Decl {
                        binding: p.b(B::Identifier { r#ref: self.stack_ref }, loc),
                        value: Some(p.new_expr(E::Array::default(), loc)),
                    }]);
                    G::Decl::List::from_owned_slice(decls)
                },
                kind: S::Local::Kind::KLet,
                ..Default::default()
            },
            loc,
        ));
        // PERF(port): was assume_capacity
        result.push(p.s(
            S::Try {
                body: non_exported_statements,
                body_loc: loc,
                catch_: Some(S::Catch {
                    binding: Some(p.b(B::Identifier { r#ref: caught_ref }, loc)),
                    body: {
                        let statements = p.allocator.alloc_slice_fill_default::<Stmt>(1);
                        statements[0] = p.s(
                            S::Local {
                                decls: {
                                    let decls = p.allocator.alloc_slice_copy(&[
                                        Decl {
                                            binding: p.b(B::Identifier { r#ref: err_ref }, loc),
                                            value: Some(p.new_expr(E::Identifier { r#ref: caught_ref, ..Default::default() }, loc)),
                                        },
                                        Decl {
                                            binding: p.b(B::Identifier { r#ref: has_err_ref }, loc),
                                            value: Some(p.new_expr(E::Number { value: 1.0 }, loc)),
                                        },
                                    ]);
                                    G::Decl::List::from_owned_slice(decls)
                                },
                                ..Default::default()
                            },
                            loc,
                        );
                        statements
                    },
                    body_loc: loc,
                    loc,
                }),
                finally: Some(S::Finally { loc, stmts: finally_stmts }),
            },
            loc,
        ));

        if !exports.is_empty() {
            result.push(p.s(S::ExportClause { items: exports.into_bump_slice(), is_single_line: false }, loc));
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
// expose constructor fns since `Expr::Data` has interior pointers and isn't `const`.
#[inline]
pub fn null_expr_data() -> Expr::Data {
    Expr::Data::EMissing(E::Missing {})
}
#[inline]
pub fn null_stmt_data() -> Stmt::Data {
    Stmt::Data::SEmpty(S::Empty {})
}
#[inline]
pub fn key_expr_data() -> Expr::Data {
    Expr::Data::EString(&Prefill::String::KEY)
}
#[inline]
pub fn null_value_expr() -> Expr::Data {
    Expr::Data::ENull(E::Null {})
}
#[inline]
pub fn false_value_expr() -> Expr::Data {
    Expr::Data::EBoolean(E::Boolean { value: false })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/P.zig (6966 lines)
//   confidence: low
//   todos:      31
//   notes:      Massive comptime type-generator (NewParser_). Const-generic struct + single 'a lifetime for log/define/source/bump. Conditional field types (ImportRecordList/NamedImportsType when scan_only) modeled as enums since Rust const generics cannot select types. Heavy raw *mut Scope per LIFETIMES.tsv ARENA classification. ExpressionTransposer/Binding.ToExpr/generate_import_stmt anytype params need Phase B trait wiring. lower_class metadata emission condensed into helper — diff carefully. Many `.data` payload mutations use raw ptrs pending Expr::Data finalization.
// ──────────────────────────────────────────────────────────────────────────
