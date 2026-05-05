//! ** IMPORTANT **
//! ** When making changes to the JavaScript Parser that impact runtime behavior or fix bugs **
//! ** you must also increment the `expected_version` in RuntimeTranspilerCache **
//! ** IMPORTANT **

use core::ffi::c_void;

use bun_collections::{ArrayHashMap, HashMap, StringArrayHashMap, StringHashMap};
use bun_core::Output;
use bun_logger as logger;
use bun_options_types::import_record::{self, ImportKind, ImportRecord};
use bun_str::strings;
use bun_wyhash::Wyhash;

// Re-exports (mirrors the Zig `pub const X = @import(...)` block at the bottom)
pub use crate::ast::convert_esm_exports_for_hmr as ConvertESMExportsForHmr;
pub use crate::ast::import_scanner as ImportScanner;
pub use crate::ast::type_script as TypeScript;
pub use bun_paths::fs; // TODO(b0): fs arrives from move-in (was bun_resolver::fs → paths)
pub use bun_options_types as options; // TYPE_ONLY: was bun_bundler::options
// TODO(b0): renamer arrives from move-in (was bun_js_printer::renamer → js_parser)
pub use crate::renamer;
pub use crate::ast::known_global::KnownGlobal;
pub use crate::ast::parser::Parser;
pub use crate::ast::side_effects::SideEffects;
pub use crate::ast::fold_string_addition::fold_string_addition;
pub use bun_paths::is_package_path; // TODO(b0): arrives from move-in (was bun_resolver::resolver::is_package_path → paths)

pub use crate::ast::base::Ref;
pub use crate::ast::base::{Index, RefCtx};

pub use import_record as importRecord;

pub use crate::runtime::Runtime;
pub type RuntimeFeatures = Runtime::Features;
pub type RuntimeImports = Runtime::Imports;
pub type RuntimeNames = Runtime::Names;

pub use crate::ast::p::{NewParser, NewParser_};

pub use bun_collections::StringHashMap as StringHashMapRe; // TODO(port): name collision with `StringHashMap` re-export
// NOTE(b0): `pub use bun_js_printer as js_printer;` removed — js_printer is same-tier mutual
// (js_printer depends on js_parser). Downstream callers import bun_js_printer directly.

pub use crate::ast as js_ast;
pub use js_ast::{
    B, Binding, BindingNodeIndex, BindingNodeList, E, Expr, ExprNodeIndex, ExprNodeList, LocRef,
    S, Scope, Stmt, StmtNodeIndex, StmtNodeList, Symbol,
};
use js_ast::G;
use js_ast::G::Decl;

pub use js_ast::Op;
pub use js_ast::Op::Level;

pub use crate::lexer as js_lexer;
pub use js_lexer::T;

// TODO(b0): defines arrives from move-in (was bun_bundler::defines → js_parser)
use crate::defines::Define;
use bun_collections::pool::ObjectPool;

// ──────────────────────────────────────────────────────────────────────────

pub struct ExprListLoc {
    pub list: ExprNodeList,
    pub loc: logger::Loc,
}

pub const LOC_MODULE_SCOPE: logger::Loc = logger::Loc { start: -100 };

pub struct DeferredImportNamespace {
    pub namespace: LocRef,
    pub import_record_id: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SkipTypeParameterResult {
    DidNotSkipAnything,
    CouldBeTypeCast,
    DefinitelyTypeParameters,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct TypeParameterFlag: u8 {
        /// TypeScript 4.7
        const ALLOW_IN_OUT_VARIANCE_ANNOTATIONS = 1 << 0;
        /// TypeScript 5.0
        const ALLOW_CONST_MODIFIER = 1 << 1;
        /// Allow "<>" without any type parameters
        const ALLOW_EMPTY_TYPE_PARAMETERS = 1 << 2;
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum JSXImport {
    #[strum(serialize = "jsx")]
    Jsx,
    #[strum(serialize = "jsxDEV")]
    JsxDEV,
    #[strum(serialize = "jsxs")]
    Jsxs,
    #[strum(serialize = "Fragment")]
    Fragment,
    #[strum(serialize = "createElement")]
    CreateElement,
}

#[derive(Default)]
pub struct JSXImportSymbols {
    pub jsx: Option<LocRef>,
    pub jsx_dev: Option<LocRef>,
    pub jsxs: Option<LocRef>,
    pub fragment: Option<LocRef>,
    pub create_element: Option<LocRef>,
}

impl JSXImportSymbols {
    pub fn get(&self, name: &[u8]) -> Option<Ref> {
        if name == b"jsx" {
            return self.jsx.map(|jsx| jsx.r#ref.unwrap());
        }
        if name == b"jsxDEV" {
            return self.jsx_dev.map(|jsx| jsx.r#ref.unwrap());
        }
        if name == b"jsxs" {
            return self.jsxs.map(|jsxs| jsxs.r#ref.unwrap());
        }
        if name == b"Fragment" {
            return self.fragment.map(|f| f.r#ref.unwrap());
        }
        if name == b"createElement" {
            return self.create_element.map(|c| c.r#ref.unwrap());
        }
        None
    }

    pub fn get_with_tag(&self, tag: JSXImport) -> Option<Ref> {
        match tag {
            JSXImport::Jsx => self.jsx.map(|jsx| jsx.r#ref.unwrap()),
            JSXImport::JsxDEV => self.jsx_dev.map(|jsx| jsx.r#ref.unwrap()),
            JSXImport::Jsxs => self.jsxs.map(|jsxs| jsxs.r#ref.unwrap()),
            JSXImport::Fragment => self.fragment.map(|f| f.r#ref.unwrap()),
            JSXImport::CreateElement => self.create_element.map(|c| c.r#ref.unwrap()),
        }
    }

    pub fn runtime_import_names<'b>(&self, buf: &'b mut [&'static [u8]; 3]) -> &'b [&'static [u8]] {
        let mut i: usize = 0;
        if self.jsx_dev.is_some() {
            debug_assert!(self.jsx.is_none()); // we should never end up with this in the same file
            buf[0] = b"jsxDEV";
            i += 1;
        }

        if self.jsx.is_some() {
            debug_assert!(self.jsx_dev.is_none()); // we should never end up with this in the same file
            buf[0] = b"jsx";
            i += 1;
        }

        if self.jsxs.is_some() {
            buf[i] = b"jsxs";
            i += 1;
        }

        if self.fragment.is_some() {
            buf[i] = b"Fragment";
            i += 1;
        }

        &buf[0..i]
    }

    pub fn source_import_names(&self) -> &'static [&'static [u8]] {
        if self.create_element.is_some() {
            &[b"createElement"]
        } else {
            &[]
        }
    }
}

pub const ARGUMENTS_STR: &[u8] = b"arguments";

// Dear reader,
// There are some things you should know about this file to make it easier for humans to read
// "P" is the internal parts of the parser
// "p.e" allocates a new Expr
// "p.b" allocates a new Binding
// "p.s" allocates a new Stmt
// We do it this way so if we want to refactor how these are allocated in the future, we only have to modify one function to change it everywhere
// Everything in JavaScript is either an Expression, a Binding, or a Statement.
//   Expression:  foo(1)
//    Statement:  let a = 1;
//      Binding:  a
// While the names for Expr, Binding, and Stmt are directly copied from esbuild, those were likely inspired by Go's parser.
// which is another example of a very fast parser.

pub type ScopeOrderList<'bump> = bumpalo::collections::Vec<'bump, Option<ScopeOrder<'bump>>>;

// kept as a static reference
pub const EXPORTS_STRING_NAME: &[u8] = b"exports";

#[derive(Clone, Copy)]
struct MacroRefData<'a> {
    pub import_record_id: u32,
    /// if name is None the macro is imported as a namespace import
    /// import * as macros from "./macros.js" with {type: "macro"};
    pub name: Option<&'a [u8]>,
}

type MacroRefs<'a> = ArrayHashMap<Ref, MacroRefData<'a>>;

pub enum Substitution {
    Success(Expr),
    Failure(Expr),
    Continue(Expr),
}

/// If we are currently in a hoisted child of the module scope, relocate these
/// declarations to the top level and return an equivalent assignment statement.
/// Make sure to check that the declaration kind is "var" before calling this.
/// And make sure to check that the returned statement is not the zero value.
///
/// This is done to make some transformations non-destructive
/// Without relocating vars to the top level, simplifying this:
/// if (false) var foo = 1;
/// to nothing is unsafe
/// Because "foo" was defined. And now it's not.
#[derive(Default)]
pub struct RelocateVars {
    pub stmt: Option<Stmt>,
    pub ok: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RelocateVarsMode {
    Normal,
    ForInOrForOf,
}

#[derive(Default)]
pub struct VisitArgsOpts<'a> {
    pub body: &'a [Stmt],
    pub has_rest_arg: bool,
    /// This is true if the function is an arrow function or a method
    pub is_unique_formal_parameters: bool,
}

/// Generic transposer over `if` expressions.
///
/// `visitor` is a comptime fn pointer in Zig; here we store it as a plain
/// `fn` pointer. // PERF(port): was comptime monomorphization — profile in Phase B
pub struct ExpressionTransposer<'a, Context, State: Copy> {
    pub context: &'a mut Context,
    visitor: fn(&mut Context, Expr, State) -> Expr,
}

impl<'a, Context, State: Copy> ExpressionTransposer<'a, Context, State> {
    pub fn init(
        c: &'a mut Context,
        visitor: fn(&mut Context, Expr, State) -> Expr,
    ) -> Self {
        Self { context: c, visitor }
    }

    pub fn maybe_transpose_if(&mut self, arg: Expr, state: State) -> Expr {
        match arg.data {
            js_ast::ExprData::EIf(ex) => Expr::init(
                E::If {
                    yes: self.maybe_transpose_if(ex.yes, state),
                    no: self.maybe_transpose_if(ex.no, state),
                    test_: ex.test_,
                },
                arg.loc,
            ),
            _ => (self.visitor)(self.context, arg, state),
        }
    }

    pub fn transpose_known_to_be_if(&mut self, arg: Expr, state: State) -> Expr {
        // SAFETY: caller guarantees `arg.data` is `e_if`
        let ex = arg.data.e_if();
        Expr::init(
            E::If {
                yes: self.maybe_transpose_if(ex.yes, state),
                no: self.maybe_transpose_if(ex.no, state),
                test_: ex.test_,
            },
            arg.loc,
        )
    }
}

pub fn loc_after_op(e: &E::Binary) -> logger::Loc {
    if e.left.loc.start < e.right.loc.start {
        e.right.loc
    } else {
        // handle the case when we have transposed the operands
        e.left.loc
    }
}

#[derive(Clone)]
pub struct TransposeState {
    pub is_await_target: bool,
    pub is_then_catch_target: bool,
    pub is_require_immediately_assigned_to_decl: bool,
    pub loc: logger::Loc,
    pub import_record_tag: Option<ImportRecord::Tag>,
    pub import_loader: Option<bun_options_types::Loader>,
    pub import_options: Expr,
}

impl Default for TransposeState {
    fn default() -> Self {
        Self {
            is_await_target: false,
            is_then_catch_target: false,
            is_require_immediately_assigned_to_decl: false,
            loc: logger::Loc::EMPTY,
            import_record_tag: None,
            import_loader: None,
            import_options: Expr::EMPTY,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JSXTagType {
    Fragment,
    Tag,
}

pub enum JSXTagData {
    Fragment(u8),
    Tag(Expr),
}

impl JSXTagData {
    pub fn as_expr(&self) -> Option<ExprNodeIndex> {
        match self {
            JSXTagData::Tag(tag) => Some(*tag),
            _ => None,
        }
    }
}

pub struct JSXTag<'a> {
    pub data: JSXTagData,
    pub range: logger::Range,
    /// Empty string for fragments.
    pub name: &'a [u8],
}

impl<'a> JSXTag<'a> {
    // TODO(port): generic parser trait bound — Zig used `comptime P: type, p: *P`.
    pub fn parse<P>(p: &'a mut P) -> Result<JSXTag<'a>, bun_core::Error>
    where
        P: crate::ast::p::ParserLike, // TODO(port): trait covering lexer/log/allocator/newExpr/storeNameInRef
    {
        let loc = p.lexer().loc();

        // A missing tag is a fragment
        if p.lexer().token == T::TGreaterThan {
            return Ok(JSXTag {
                range: logger::Range { loc, len: 0 },
                data: JSXTagData::Fragment(1),
                name: b"",
            });
        }

        // The tag is an identifier
        let mut name = p.lexer().identifier;
        let mut tag_range = p.lexer().range();
        p.lexer_mut()
            .expect_inside_jsx_element_with_name(T::TIdentifier, b"JSX element name")?;

        // Certain identifiers are strings
        // <div
        // <button
        // <Hello-:Button
        if strings::contains(name, b"-:")
            || (p.lexer().token != T::TDot && name[0] >= b'a' && name[0] <= b'z')
        {
            return Ok(JSXTag {
                data: JSXTagData::Tag(p.new_expr(E::String { data: name }, loc)),
                range: tag_range,
                name,
            });
        }

        // Otherwise, this is an identifier
        // <Button>
        let mut tag = p.new_expr(
            E::Identifier {
                r#ref: p.store_name_in_ref(name)?,
            },
            loc,
        );

        // Parse a member expression chain
        // <Button.Red>
        while p.lexer().token == T::TDot {
            p.lexer_mut().next_inside_jsx_element()?;
            let member_range = p.lexer().range();
            let member = p.lexer().identifier;
            p.lexer_mut().expect_inside_jsx_element(T::TIdentifier)?;

            if let Some(index) = strings::index_of_char(member, b'-') {
                p.log().add_error(
                    p.source(),
                    logger::Loc {
                        start: member_range.loc.start + i32::try_from(index).unwrap(),
                    },
                    b"Unexpected \"-\"",
                )?;
                return Err(bun_core::err!("SyntaxError"));
            }

            // TODO(port): arena allocation — Zig used p.allocator.alloc(u8, ...)
            let new_name = p.arena().alloc_slice_fill_default(name.len() + 1 + member.len());
            new_name[..name.len()].copy_from_slice(name);
            new_name[name.len()] = b'.';
            new_name[name.len() + 1..].copy_from_slice(member);
            name = new_name;
            tag_range.len = member_range.loc.start + member_range.len - tag_range.loc.start;
            tag = p.new_expr(
                E::Dot {
                    target: tag,
                    name: member,
                    name_loc: member_range.loc,
                },
                loc,
            );
        }

        Ok(JSXTag {
            data: JSXTagData::Tag(tag),
            range: tag_range,
            name,
        })
    }
}

/// We must prevent collisions from generated names with user's names.
///
/// When transpiling for the runtime, we want to avoid adding a pass over all
/// the symbols in the file (we do this in the bundler since there is more than
/// one file, and user symbols from different files may collide with each
/// other).
///
/// This makes sure that there's the lowest possible chance of having a generated name
/// collide with a user's name. This is the easiest way to do so
// TODO(port): const-eval wyhash + comptimePrint. Needs a `macro_rules!` or
// build-time codegen so the hash suffix is computed at compile time. The Zig
// version is `comptime { name ++ "_" ++ truncatedHash32(wyhash(0, name)) }`.
#[macro_export]
macro_rules! generated_symbol_name {
    ($name:literal) => {{
        // PERF(port): Zig computes this at comptime; this runtime path must be
        // replaced with a const-evaluable wyhash before Phase B ships.
        const_format::concatcp!(
            $name,
            "_",
            // TODO(port): bun_wyhash::const_hash($name) truncated to 32-bit hex
            "TODO_PORT_HASH"
        )
    }};
}

pub struct ExprOrLetStmt<'a> {
    pub stmt_or_expr: js_ast::StmtOrExpr,
    pub decls: &'a [G::Decl],
}

impl<'a> Default for ExprOrLetStmt<'a> {
    fn default() -> Self {
        Self {
            stmt_or_expr: js_ast::StmtOrExpr::default(),
            decls: &[],
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FunctionKind {
    Stmt,
    Expr,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AsyncPrefixExpression {
    None = 0,
    IsYield = 1,
    IsAsync = 2,
    IsAwait = 3,
}

static ASYNC_PREFIX_MAP: phf::Map<&'static [u8], AsyncPrefixExpression> = phf::phf_map! {
    b"yield" => AsyncPrefixExpression::IsYield,
    b"await" => AsyncPrefixExpression::IsAwait,
    b"async" => AsyncPrefixExpression::IsAsync,
};

impl AsyncPrefixExpression {
    pub fn find(ident: &[u8]) -> AsyncPrefixExpression {
        ASYNC_PREFIX_MAP
            .get(ident)
            .copied()
            .unwrap_or(AsyncPrefixExpression::None)
    }
}

// Zig: `packed struct(u8)` — assign_target:u2, is_delete_target:b1,
// was_originally_identifier:b1, is_call_target:b1, _padding:u3.
// Not all-bool (assign_target is enum(u2)), so per PORTING.md we use a
// transparent u8 with manual shift accessors matching Zig field order (LSB-first).
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct IdentifierOpts(u8);

impl IdentifierOpts {
    const ASSIGN_TARGET_MASK: u8 = 0b0000_0011; // bits 0-1
    const IS_DELETE_TARGET: u8 = 1 << 2;
    const WAS_ORIGINALLY_IDENTIFIER: u8 = 1 << 3;
    const IS_CALL_TARGET: u8 = 1 << 4;

    #[inline]
    pub const fn assign_target(self) -> js_ast::AssignTarget {
        // SAFETY: AssignTarget is #[repr(u2)]-equivalent (#[repr(u8)] with 3 variants);
        // bits 0-1 are always written via set_assign_target from a valid variant.
        unsafe { core::mem::transmute::<u8, js_ast::AssignTarget>(self.0 & Self::ASSIGN_TARGET_MASK) }
    }
    #[inline]
    pub fn set_assign_target(&mut self, v: js_ast::AssignTarget) {
        self.0 = (self.0 & !Self::ASSIGN_TARGET_MASK) | (v as u8 & Self::ASSIGN_TARGET_MASK);
    }
    #[inline]
    pub const fn is_delete_target(self) -> bool { self.0 & Self::IS_DELETE_TARGET != 0 }
    #[inline]
    pub fn set_is_delete_target(&mut self, v: bool) {
        self.0 = (self.0 & !Self::IS_DELETE_TARGET) | ((v as u8) << 2);
    }
    #[inline]
    pub const fn was_originally_identifier(self) -> bool { self.0 & Self::WAS_ORIGINALLY_IDENTIFIER != 0 }
    #[inline]
    pub fn set_was_originally_identifier(&mut self, v: bool) {
        self.0 = (self.0 & !Self::WAS_ORIGINALLY_IDENTIFIER) | ((v as u8) << 3);
    }
    #[inline]
    pub const fn is_call_target(self) -> bool { self.0 & Self::IS_CALL_TARGET != 0 }
    #[inline]
    pub fn set_is_call_target(&mut self, v: bool) {
        self.0 = (self.0 & !Self::IS_CALL_TARGET) | ((v as u8) << 4);
    }
}

pub fn statement_cares_about_scope(stmt: &Stmt) -> bool {
    use js_ast::StmtData::*;
    match stmt.data {
        SBlock(_)
        | SEmpty(_)
        | SDebugger(_)
        | SExpr(_)
        | SIf(_)
        | SFor(_)
        | SForIn(_)
        | SForOf(_)
        | SDoWhile(_)
        | SWhile(_)
        | SWith(_)
        | STry(_)
        | SSwitch(_)
        | SReturn(_)
        | SThrow(_)
        | SBreak(_)
        | SContinue(_)
        | SDirective(_)
        | SLabel(_) => false,

        SLocal(ref local) => local.kind != js_ast::LocalKind::KVar,
        _ => true,
    }
}

#[derive(Clone, Copy, Default)]
pub struct ExprIn {
    /// This tells us if there are optional chain expressions (EDot, EIndex, or
    /// ECall) that are chained on to this expression. Because of the way the AST
    /// works, chaining expressions on to this expression means they are our
    /// parent expressions.
    ///
    /// Some examples:
    ///
    ///   a?.b.c  // EDot
    ///   a?.b[c] // EIndex
    ///   a?.b()  // ECall
    ///
    /// Note that this is false if our parent is a node with a OptionalChain
    /// value of OptionalChainStart. That means it's the start of a new chain, so
    /// it's not considered part of this one.
    ///
    /// Some examples:
    ///
    ///   a?.b?.c   // EDot
    ///   a?.b?.[c] // EIndex
    ///   a?.b?.()  // ECall
    ///
    /// Also note that this is false if our parent is a node with a OptionalChain
    /// value of OptionalChainNone. That means it's outside parentheses, which
    /// means it's no longer part of the chain.
    ///
    /// Some examples:
    ///
    ///   (a?.b).c  // EDot
    ///   (a?.b)[c] // EIndex
    ///   (a?.b)()  // ECall
    pub has_chain_parent: bool,

    /// If our parent is an ECall node with an OptionalChain value of
    /// OptionalChainStart, then we will need to store the value for the "this" of
    /// that call somewhere if the current expression is an optional chain that
    /// ends in a property access. That's because the value for "this" will be
    /// used twice: once for the inner optional chain and once for the outer
    /// optional chain.
    ///
    /// Example:
    ///
    ///   // Original
    ///   a?.b?.();
    ///
    ///   // Lowered
    ///   var _a;
    ///   (_a = a == null ? void 0 : a.b) == null ? void 0 : _a.call(a);
    ///
    /// In the example above we need to store "a" as the value for "this" so we
    /// can substitute it back in when we call "_a" if "_a" is indeed present.
    /// See also "thisArgFunc" and "thisArgWrapFunc" in "exprOut".
    pub store_this_arg_for_parent_optional_chain: bool,

    /// Certain substitutions of identifiers are disallowed for assignment targets.
    /// For example, we shouldn't transform "undefined = 1" into "void 0 = 1". This
    /// isn't something real-world code would do but it matters for conformance
    /// tests.
    pub assign_target: js_ast::AssignTarget,

    /// Currently this is only used when unwrapping a call to `require()`
    /// with `__toESM()`.
    pub is_immediately_assigned_to_decl: bool,

    pub property_access_for_method_call_maybe_should_replace_with_undefined: bool,
}

/// This function exists to tie all of these checks together in one place
/// This can sometimes show up on benchmarks as a small thing.
#[inline]
pub fn is_eval_or_arguments(name: &[u8]) -> bool {
    name == b"eval" || name == b"arguments"
}

#[derive(Clone, Copy, Default)]
pub struct PrependTempRefsOpts {
    pub fn_body_loc: Option<logger::Loc>,
    pub kind: StmtsKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum StmtsKind {
    #[default]
    None,
    LoopBody,
    SwitchStmt,
    FnBody,
}

#[cold]
fn notimpl() -> ! {
    Output::panic("Not implemented yet!!", &[]);
}

#[derive(Default)]
pub struct ExprBindingTuple {
    pub expr: Option<ExprNodeIndex>,
    pub binding: Option<Binding>,
}

pub struct TempRef {
    pub r#ref: Ref,
    pub value: Option<Expr>,
}

impl Default for TempRef {
    fn default() -> Self {
        Self { r#ref: Ref::default(), value: None }
    }
}

#[derive(Clone, Copy)]
pub struct ImportNamespaceCallOrConstruct {
    pub r#ref: Ref,
    pub is_construct: bool,
}

pub struct ThenCatchChain {
    pub next_target: js_ast::ExprData,
    pub has_multiple_args: bool,
    pub has_catch: bool,
}

pub struct ParsedPath<'a> {
    pub loc: logger::Loc,
    pub text: &'a [u8],
    pub is_macro: bool,
    pub import_tag: ImportRecord::Tag,
    pub loader: Option<bun_options_types::Loader>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StrictModeFeature {
    WithStatement,
    DeleteBareName,
    ForInVarInit,
    EvalOrArguments,
    ReservedWord,
    LegacyOctalLiteral,
    LegacyOctalEscape,
    IfElseFunctionStmt,
}

#[derive(Clone, Copy)]
pub struct InvalidLoc {
    pub loc: logger::Loc,
    pub kind: InvalidLocTag,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum InvalidLocTag {
    Spread,
    Parentheses,
    Getter,
    Setter,
    Method,
    #[default]
    Unknown,
}

impl InvalidLoc {
    #[cold]
    pub fn add_error(self, log: &mut logger::Log, source: &logger::Source) {
        let text: &'static [u8] = match self.kind {
            InvalidLocTag::Spread => b"Unexpected trailing comma after rest element",
            InvalidLocTag::Parentheses => b"Unexpected parentheses in binding pattern",
            InvalidLocTag::Getter => b"Unexpected getter in binding pattern",
            InvalidLocTag::Setter => b"Unexpected setter in binding pattern",
            InvalidLocTag::Method => b"Unexpected method in binding pattern",
            InvalidLocTag::Unknown => b"Invalid binding pattern",
        };
        log.add_error(source, self.loc, text).expect("unreachable");
    }
}

pub type LocList<'bump> = bumpalo::collections::Vec<'bump, InvalidLoc>;
pub type StmtList<'bump> = bumpalo::collections::Vec<'bump, Stmt>;

/// This hash table is used every time we parse function args
/// Rather than allocating a new hash table each time, we can just reuse the previous allocation
pub struct StringVoidMap {
    map: StringHashMap<()>,
}

impl StringVoidMap {
    /// Returns true if the map already contained the given key.
    pub fn get_or_put_contains(&mut self, key: &[u8]) -> bool {
        // TODO(port): StringHashMap key ownership — Zig stored borrowed source slices.
        let entry = self.map.get_or_put(key).expect("unreachable");
        entry.found_existing
    }

    pub fn contains(&self, key: &[u8]) -> bool {
        self.map.contains(key)
    }

    fn init() -> Result<StringVoidMap, bun_core::Error> {
        Ok(StringVoidMap {
            map: StringHashMap::default(),
        })
    }

    pub fn reset(&mut self) {
        // We must reset or the hash table will contain invalid pointers
        self.map.clear();
    }

    /// Returns an RAII guard that derefs to `&mut StringVoidMap` and is
    /// returned to the pool on `Drop` (replaces Zig's `get` + `defer release`).
    #[inline]
    pub fn get() -> bun_collections::pool::PoolGuard<'static, StringVoidMap> {
        StringVoidMapPool::get()
    }
}

// TODO(port): ObjectPool<StringVoidMap, init, true, 32> — `true` is thread-local,
// `32` is preheated capacity. bun_collections::pool::ObjectPool needs equivalent params.
pub type StringVoidMapPool = ObjectPool<StringVoidMap, 32>;

pub type StringBoolMap = StringHashMap<bool>;
pub type RefMap = HashMap<Ref, ()>; // TODO(port): RefCtx hasher + 80% load factor
pub type RefRefMap = HashMap<Ref, Ref>; // TODO(port): RefCtx hasher + 80% load factor

pub struct ScopeOrder<'arena> {
    pub loc: logger::Loc,
    pub scope: &'arena Scope,
}

#[derive(Clone, Copy)]
pub struct ParenExprOpts {
    pub async_range: logger::Range,
    pub is_async: bool,
    pub force_arrow_fn: bool,
}

impl Default for ParenExprOpts {
    fn default() -> Self {
        Self {
            async_range: logger::Range::NONE,
            is_async: false,
            force_arrow_fn: false,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum AwaitOrYield {
    #[default]
    AllowIdent = 0,
    AllowExpr = 1,
    ForbidAll = 2,
}

/// This is function-specific information used during parsing. It is saved and
/// restored on the call stack around code that parses nested functions and
/// arrow expressions.
#[derive(Clone)]
pub struct FnOrArrowDataParse {
    pub async_range: logger::Range,
    pub needs_async_loc: logger::Loc,
    pub allow_await: AwaitOrYield,
    pub allow_yield: AwaitOrYield,
    pub allow_super_call: bool,
    pub allow_super_property: bool,
    pub is_top_level: bool,
    pub is_constructor: bool,
    pub is_typescript_declare: bool,

    pub has_argument_decorators: bool,
    pub has_decorators: bool,

    pub is_return_disallowed: bool,
    pub is_this_disallowed: bool,

    pub has_async_range: bool,
    pub arrow_arg_errors: DeferredArrowArgErrors,
    pub track_arrow_arg_errors: bool,

    /// In TypeScript, forward declarations of functions have no bodies
    pub allow_missing_body_for_type_script: bool,

    /// Allow TypeScript decorators in function arguments
    pub allow_ts_decorators: bool,
}

impl Default for FnOrArrowDataParse {
    fn default() -> Self {
        Self {
            async_range: logger::Range::NONE,
            needs_async_loc: logger::Loc::EMPTY,
            allow_await: AwaitOrYield::AllowIdent,
            allow_yield: AwaitOrYield::AllowIdent,
            allow_super_call: false,
            allow_super_property: false,
            is_top_level: false,
            is_constructor: false,
            is_typescript_declare: false,
            has_argument_decorators: false,
            has_decorators: false,
            is_return_disallowed: false,
            is_this_disallowed: false,
            has_async_range: false,
            arrow_arg_errors: DeferredArrowArgErrors::default(),
            track_arrow_arg_errors: false,
            allow_missing_body_for_type_script: false,
            allow_ts_decorators: false,
        }
    }
}

impl FnOrArrowDataParse {
    pub fn i() -> FnOrArrowDataParse {
        FnOrArrowDataParse {
            allow_await: AwaitOrYield::ForbidAll,
            ..Default::default()
        }
    }
}

/// This is function-specific information used during visiting. It is saved and
/// restored on the call stack around code that parses nested functions and
/// arrow expressions.
#[derive(Clone, Copy, Default)]
pub struct FnOrArrowDataVisit {
    // super_index_ref: Option<&mut Ref>,
    pub is_arrow: bool,
    pub is_async: bool,
    pub is_inside_loop: bool,
    pub is_inside_switch: bool,
    pub is_outside_fn_or_arrow: bool,

    /// This is used to silence unresolvable imports due to "require" calls inside
    /// a try/catch statement. The assumption is that the try/catch statement is
    /// there to handle the case where the reference to "require" crashes.
    pub try_body_count: i32,
}

/// This is function-specific information used during visiting. It is saved and
/// restored on the call stack around code that parses nested functions (but not
/// nested arrow functions).
#[derive(Default)]
pub struct FnOnlyDataVisit<'a> {
    /// This is a reference to the magic "arguments" variable that exists inside
    /// functions in JavaScript. It will be non-nil inside functions and nil
    /// otherwise.
    pub arguments_ref: Option<Ref>,

    /// Arrow functions don't capture the value of "this" and "arguments". Instead,
    /// the values are inherited from the surrounding context. If arrow functions
    /// are turned into regular functions due to lowering, we will need to generate
    /// local variables to capture these values so they are preserved correctly.
    pub this_capture_ref: Option<Ref>,
    pub arguments_capture_ref: Option<Ref>,

    /// This is a reference to the enclosing class name if there is one. It's used
    /// to implement "this" and "super" references. A name is automatically generated
    /// if one is missing so this will always be present inside a class body.
    pub class_name_ref: Option<&'a mut Ref>,

    /// If true, we're inside a static class context where "this" expressions
    /// should be replaced with the class name.
    pub should_replace_this_with_class_name_ref: bool,

    /// If we're inside an async arrow function and async functions are not
    /// supported, then we will have to convert that arrow function to a generator
    /// function. That means references to "arguments" inside the arrow function
    /// will have to reference a captured variable instead of the real variable.
    pub is_inside_async_arrow_fn: bool,

    /// If false, disallow "new.target" expressions. We disallow all "new.target"
    /// expressions at the top-level of the file (i.e. not inside a function or
    /// a class field). Technically since CommonJS files are wrapped in a function
    /// you can use "new.target" in node as an alias for "undefined" but we don't
    /// support that.
    pub is_new_target_allowed: bool,

    /// If false, the value for "this" is the top-level module scope "this" value.
    /// That means it's "undefined" for ECMAScript modules and "exports" for
    /// CommonJS modules. We track this information so that we can substitute the
    /// correct value for these top-level "this" references at compile time instead
    /// of passing the "this" expression through to the output and leaving the
    /// interpretation up to the run-time behavior of the generated code.
    ///
    /// If true, the value for "this" is nested inside something (either a function
    /// or a class declaration). That means the top-level module scope "this" value
    /// has been shadowed and is now inaccessible.
    pub is_this_nested: bool,
}

/// Due to ES6 destructuring patterns, there are many cases where it's
/// impossible to distinguish between an array or object literal and a
/// destructuring assignment until we hit the "=" operator later on.
/// This object defers errors about being in one state or the other
/// until we discover which state we're in.
#[derive(Clone, Copy, Default)]
pub struct DeferredErrors {
    /// These are errors for expressions
    pub invalid_expr_default_value: Option<logger::Range>,
    pub invalid_expr_after_question: Option<logger::Range>,
    pub array_spread_feature: Option<logger::Range>,
}

impl DeferredErrors {
    pub fn is_empty(&self) -> bool {
        self.invalid_expr_default_value.is_none()
            && self.invalid_expr_after_question.is_none()
            && self.array_spread_feature.is_none()
    }

    pub fn merge_into(&self, to: &mut DeferredErrors) {
        to.invalid_expr_default_value = self
            .invalid_expr_default_value
            .or(to.invalid_expr_default_value);
        to.invalid_expr_after_question = self
            .invalid_expr_after_question
            .or(to.invalid_expr_after_question);
        to.array_spread_feature = self.array_spread_feature.or(to.array_spread_feature);
    }

    pub const NONE: DeferredErrors = DeferredErrors {
        invalid_expr_default_value: None,
        invalid_expr_after_question: None,
        array_spread_feature: None,
    };
}

#[derive(Default)]
pub struct ImportClause<'a> {
    pub items: &'a [js_ast::ClauseItem],
    pub is_single_line: bool,
    pub had_type_only_imports: bool,
}

pub struct PropertyOpts<'a> {
    pub async_range: logger::Range,
    pub declare_range: logger::Range,
    pub is_async: bool,
    pub is_generator: bool,

    // Class-related options
    pub is_static: bool,
    pub is_class: bool,
    pub class_has_extends: bool,
    pub allow_ts_decorators: bool,
    pub is_ts_abstract: bool,
    pub ts_decorators: &'a [Expr],
    pub has_argument_decorators: bool,
    pub has_class_decorators: bool,
}

impl<'a> Default for PropertyOpts<'a> {
    fn default() -> Self {
        Self {
            async_range: logger::Range::NONE,
            declare_range: logger::Range::NONE,
            is_async: false,
            is_generator: false,
            is_static: false,
            is_class: false,
            class_has_extends: false,
            allow_ts_decorators: false,
            is_ts_abstract: false,
            ts_decorators: &[],
            has_argument_decorators: false,
            has_class_decorators: false,
        }
    }
}

pub struct ScanPassResult {
    pub import_records: Vec<ImportRecord>,
    pub named_imports: js_ast::Ast::NamedImports,
    pub used_symbols: ParsePassSymbolUsageMap,
    pub import_records_to_keep: Vec<u32>,
    pub approximate_newline_count: usize,
}

#[derive(Clone, Copy)]
pub struct ParsePassSymbolUse {
    pub r#ref: Ref,
    pub used: bool,
    pub import_record_index: u32,
}

#[derive(Clone, Copy)]
pub struct NamespaceCounter {
    pub count: u16,
    pub import_record_index: u32,
}

pub type ParsePassSymbolUsageMap = StringArrayHashMap<ParsePassSymbolUse>;

impl ScanPassResult {
    pub fn init() -> ScanPassResult {
        ScanPassResult {
            import_records: Vec::new(),
            named_imports: Default::default(),
            used_symbols: ParsePassSymbolUsageMap::default(),
            import_records_to_keep: Vec::new(),
            approximate_newline_count: 0,
        }
    }

    pub fn reset(&mut self) {
        self.named_imports.clear();
        self.import_records.clear();
        self.used_symbols.clear();
        self.approximate_newline_count = 0;
    }
}

#[derive(Clone, Copy)]
pub struct FindLabelSymbolResult {
    pub r#ref: Ref,
    pub is_loop: bool,
    pub found: bool,
}

#[derive(Clone, Copy, Default)]
pub struct FindSymbolResult {
    pub r#ref: Ref,
    pub declare_loc: Option<logger::Loc>,
    pub is_inside_with_scope: bool,
}

#[derive(Default)]
pub struct ExportClauseResult<'a> {
    pub clauses: &'a [js_ast::ClauseItem],
    pub is_single_line: bool,
    pub had_type_only_exports: bool,
}

pub struct DeferredTsDecorators<'a> {
    pub values: &'a [js_ast::Expr],

    /// If this turns out to be a "declare class" statement, we need to undo the
    /// scopes that were potentially pushed while parsing the decorator arguments.
    pub scope_index: usize,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum LexicalDecl {
    #[default]
    Forbid = 0,
    AllowAll = 1,
    AllowFnInsideIf = 2,
    AllowFnInsideLabel = 3,
}

#[derive(Default)]
pub struct ParseClassOptions<'a> {
    pub ts_decorators: &'a [Expr],
    pub allow_ts_decorators: bool,
    pub is_type_script_declare: bool,
}

#[derive(Default)]
pub struct ParseStatementOptions<'a> {
    pub ts_decorators: Option<DeferredTsDecorators<'a>>,
    pub lexical_decl: LexicalDecl,
    pub is_module_scope: bool,
    pub is_namespace_scope: bool,
    pub is_export: bool,
    pub is_using_statement: bool,
    /// For "export default" pseudo-statements,
    pub is_name_optional: bool,
    pub is_typescript_declare: bool,
    pub is_for_loop_init: bool,
}

impl<'a> ParseStatementOptions<'a> {
    pub fn has_decorators(&self) -> bool {
        let Some(decs) = &self.ts_decorators else {
            return false;
        };
        !decs.values.is_empty()
    }
}

// TODO(port): `Prefill` holds mutable global AST node singletons (`pub var` in
// Zig). Rust forbids non-`Sync` mutable statics without `unsafe`; several of
// these contain raw pointers (e_string -> &E.String) and one (`ActivateIndex`)
// has an `undefined` field. Phase B should decide between `static mut` +
// `unsafe`, `LazyLock`, or eliminating the globals entirely. The byte-array
// constants are safe and ported as `pub const`.
pub mod prefill {
    use super::*;

    pub mod hot_module_reloading {
        use super::*;
        // TODO(port): mutable static Expr arrays — need `static mut` or `LazyLock`.
        // pub static DEBUG_ENABLED_ARGS: [Expr; 1] = [...];
        // pub static DEBUG_DISABLED: [Expr; 1] = [...];
        // pub static ACTIVATE_STRING: E::String = E::String { data: b"activate" };
        // pub static ACTIVATE_INDEX: E::Index = ...; // .target = undefined
    }

    pub mod string_literal {
        pub const KEY: [u8; 3] = *b"key";
        pub const CHILDREN: [u8; 8] = *b"children";
        pub const FILENAME: [u8; 8] = *b"fileName";
        pub const LINE_NUMBER: [u8; 10] = *b"lineNumber";
        pub const COLUMN_NUMBER: [u8; 12] = *b"columnNumber";
    }

    pub mod value {
        use super::*;
        pub const E_THIS: E::This = E::This {};
        pub const ZERO: E::Number = E::Number { value: 0.0 };
    }

    pub mod string {
        use super::*;
        // TODO(port): these are `pub var` (mutable) E.String holding &'static [u8].
        // Represented here as `pub static` — verify nothing actually mutates them.
        pub static KEY: E::String = E::String { data: &string_literal::KEY };
        pub static CHILDREN: E::String = E::String { data: &string_literal::CHILDREN };
        pub static FILENAME: E::String = E::String { data: &string_literal::FILENAME };
        pub static LINE_NUMBER: E::String = E::String { data: &string_literal::LINE_NUMBER };
        pub static COLUMN_NUMBER: E::String = E::String { data: &string_literal::COLUMN_NUMBER };

        pub static TYPEOF_SYMBOL: E::String = E::String { data: b"$$typeof" };
        pub static TYPE_: E::String = E::String { data: b"type" };
        pub static REF: E::String = E::String { data: b"ref" };
        pub static PROPS: E::String = E::String { data: b"props" };
        pub static OWNER: E::String = E::String { data: b"_owner" };
        pub static REACT_ELEMENT_TYPE: E::String = E::String { data: b"react.element" };
    }

    pub mod data {
        use super::*;
        // TODO(port): Expr.Data / Stmt.Data / B variant statics — needs final
        // shape of `js_ast::ExprData` (Rust enum) before these compile.
        // pub static B_MISSING: B = B::Missing(B::Missing {});
        // pub static E_MISSING: ExprData = ExprData::EMissing(E::Missing {});
        // pub static S_EMPTY: StmtData = StmtData::SEmpty(S::Empty {});
        // pub static FILENAME: ExprData = ExprData::EString(&string::FILENAME);
        // ... etc.
        pub const THIS: js_ast::ExprData = js_ast::ExprData::EThis(E::This {});
        pub const ZERO: js_ast::ExprData = js_ast::ExprData::ENumber(value::ZERO);
    }
}

#[derive(Default)]
struct ReactJSX {
    // TODO(port): ArrayHashMap with bun.ArrayIdentityContext (identity hash on Ref)
    hoisted_elements: ArrayHashMap<Ref, G::Decl>,
}

pub struct ImportOrRequireScanResults {
    pub import_records: Vec<ImportRecord>,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum JSXTransformType {
    #[default]
    None,
    React,
}

pub type ImportItemForNamespaceMap = StringArrayHashMap<LocRef>;

pub struct MacroState<'a> {
    pub refs: MacroRefs<'a>,
    pub prepend_stmts: &'a mut Vec<Stmt>,
    pub imports: ArrayHashMap<i32, Ref>,
}

impl<'a> MacroState<'a> {
    // TODO(port): Zig initializes `prepend_stmts = undefined`; Rust cannot leave
    // a `&mut` field uninitialized. Caller must supply a placeholder list, or
    // this field becomes `Option<&'a mut Vec<Stmt>>` set to `None` here.
    pub fn init(prepend_stmts: &'a mut Vec<Stmt>) -> MacroState<'a> {
        MacroState {
            refs: MacroRefs::default(),
            prepend_stmts,
            imports: ArrayHashMap::default(),
        }
    }
}

pub struct Jest {
    pub test: Ref,
    pub it: Ref,
    pub describe: Ref,
    pub expect: Ref,
    pub expect_type_of: Ref,
    pub before_all: Ref,
    pub before_each: Ref,
    pub after_each: Ref,
    pub after_all: Ref,
    pub jest: Ref,
    pub vi: Ref,
    pub xit: Ref,
    pub xtest: Ref,
    pub xdescribe: Ref,
}

impl Default for Jest {
    fn default() -> Self {
        Self {
            test: Ref::NONE,
            it: Ref::NONE,
            describe: Ref::NONE,
            expect: Ref::NONE,
            expect_type_of: Ref::NONE,
            before_all: Ref::NONE,
            before_each: Ref::NONE,
            after_each: Ref::NONE,
            after_all: Ref::NONE,
            jest: Ref::NONE,
            vi: Ref::NONE,
            xit: Ref::NONE,
            xtest: Ref::NONE,
            xdescribe: Ref::NONE,
        }
    }
}

// Doing this seems to yield a 1% performance improvement parsing larger files
// ❯ hyperfine "../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" "../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" --min-runs=500
// Benchmark #1: ../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
//   Time (mean ± σ):      25.1 ms ±   1.1 ms    [User: 20.4 ms, System: 3.1 ms]
//   Range (min … max):    23.5 ms …  31.7 ms    500 runs
//
// Benchmark #2: ../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
//   Time (mean ± σ):      25.6 ms ±   1.3 ms    [User: 20.9 ms, System: 3.1 ms]
//   Range (min … max):    24.1 ms …  39.7 ms    500 runs
// '../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable' ran
// 1.02 ± 0.07 times faster than '../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable'
//
// TODO(port): `NewParser` is a Zig comptime type-generating fn parametrised by
// a struct of bools (jsx/typescript/scan_only). The Rust port in `ast/P.rs`
// will expose this via const generics or a marker-type strategy; these aliases
// pin the eight monomorphizations.
pub type JavaScriptParser = NewParser!({});
pub type JSXParser = NewParser!({ jsx: react });
pub type TSXParser = NewParser!({ jsx: react, typescript: true });
pub type TypeScriptParser = NewParser!({ typescript: true });
pub type JavaScriptImportScanner = NewParser!({ scan_only: true });
pub type JSXImportScanner = NewParser!({ jsx: react, scan_only: true });
pub type TSXImportScanner = NewParser!({ jsx: react, typescript: true, scan_only: true });
pub type TypeScriptImportScanner = NewParser!({ typescript: true, scan_only: true });

/// The "await" and "yield" expressions are never allowed in argument lists but
/// may or may not be allowed otherwise depending on the details of the enclosing
/// function or module. This needs to be handled when parsing an arrow function
/// argument list because we don't know if these expressions are not allowed until
/// we reach the "=>" token (or discover the absence of one).
///
/// Specifically, for await:
///
///   // This is ok
///   async function foo() { (x = await y) }
///
///   // This is an error
///   async function foo() { (x = await y) => {} }
///
/// And for yield:
///
///   // This is ok
///   function* foo() { (x = yield y) }
///
///   // This is an error
///   function* foo() { (x = yield y) => {} }
#[derive(Clone, Copy)]
pub struct DeferredArrowArgErrors {
    pub invalid_expr_await: logger::Range,
    pub invalid_expr_yield: logger::Range,
}

impl Default for DeferredArrowArgErrors {
    fn default() -> Self {
        Self {
            invalid_expr_await: logger::Range::NONE,
            invalid_expr_yield: logger::Range::NONE,
        }
    }
}

pub fn new_lazy_export_ast<'bump>(
    bump: &'bump bun_alloc::Arena,
    define: &mut Define,
    opts: Parser::Options,
    log_to_copy_into: &mut logger::Log,
    expr: Expr,
    source: &logger::Source,
    runtime_api_call: &'static [u8], // PERF(port): was comptime monomorphization — profile in Phase B
) -> Result<Option<js_ast::Ast>, bun_core::Error> {
    new_lazy_export_ast_impl(
        bump,
        define,
        opts,
        log_to_copy_into,
        expr,
        source,
        runtime_api_call,
        Symbol::List::default(),
    )
}

pub fn new_lazy_export_ast_impl<'bump>(
    bump: &'bump bun_alloc::Arena,
    define: &mut Define,
    opts: Parser::Options,
    log_to_copy_into: &mut logger::Log,
    expr: Expr,
    source: &logger::Source,
    runtime_api_call: &'static [u8], // PERF(port): was comptime monomorphization — profile in Phase B
    symbols: Symbol::List,
) -> Result<Option<js_ast::Ast>, bun_core::Error> {
    let mut temp_log = logger::Log::init(bump);
    let log = &mut temp_log;
    let mut parser = Parser {
        options: opts,
        allocator: bump,
        lexer: js_lexer::Lexer::init_without_reading(log, source, bump),
        define,
        source,
        log,
    };
    let mut result = match parser.to_lazy_export_ast(expr, runtime_api_call, symbols) {
        Ok(r) => r,
        Err(err) => {
            if temp_log.errors == 0 {
                log_to_copy_into
                    .add_range_error(source, parser.lexer.range(), err.name())
                    .expect("unreachable");
            }
            let _ = temp_log.append_to_maybe_recycled(log_to_copy_into, source);
            return Ok(None);
        }
    };

    let _ = temp_log.append_to_maybe_recycled(log_to_copy_into, source);
    result.ast.has_lazy_export = true;
    Ok(Some(result.ast))
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum WrapMode {
    #[default]
    None,
    BunCommonjs,
}

/// "Fast Refresh" is React's solution for hot-module-reloading in the context of the UI framework
/// user guide: https://reactnative.dev/docs/fast-refresh (applies to react-dom and native)
///
/// This depends on performing a couple extra transformations at bundle time, as well as
/// including the `react-refresh` NPM package, which is able to do the heavy lifting,
/// integrating with `react` and `react-dom`.
///
/// Prior implementations:
///  [1]: https://github.com/facebook/react/blob/main/packages/react-refresh/src/ReactFreshBabelPlugin.js
///  [2]: https://github.com/swc-project/swc/blob/main/crates/swc_ecma_transforms_react/src/refresh/mod.rs
///
/// Additional reading:
///  [3] https://github.com/facebook/react/issues/16604#issuecomment-528663101
///  [4] https://github.com/facebook/react/blob/master/packages/react-refresh/src/__tests__/ReactFreshIntegration-test.js
///
/// Instead of a plugin which visits the tree separately, Bun's implementation of fast refresh
/// happens in tandem with the visit pass. The responsibilities of the transform are as follows:
///
/// 1. For all Components (which is defined as any top-level function/function variable, that is
///    named with a capital letter; see `isComponentishName`), register them to the runtime using
///    `$RefreshReg$(ComponentFunction, "Component");`. Implemented in `p.handleReactRefreshRegister`
///    HOC components are also registered, but only through a special case for `export default`
///
/// 2. For all functions which call a Hook (a hook is an identifier matching /^use[A-Z]/):
///     a. Outside of the function, create a signature function `const _s = $RefreshSig$();`
///     b. At the start of the function, call `_s()`
///     c. Record all of the hooks called, the variables they are assigned to, and
///        arguments depending on which hook has been used. `useState` and `useReducer`,
///        for example, are special-cased.
///     d. Directly after the function, call `_s(hook, "<hash>", forceReset)`
///         - If a user-defined hook is called, the alterate form is used:
///           `_s(hook, "<hash>", forceReset, () => [useCustom1, useCustom2])`
///
/// The upstream transforms do not declare `$RefreshReg$` or `$RefreshSig$`. A typical
/// implementation might look like this, prepending this data to the module start:
///
///     import * as Refresh from 'react-refresh/runtime';
///     const $RefreshReg$ = (type, id) => Refresh.register(type, "<file id here>" + id);
///     const $RefreshSig$ = Refresh.createSignatureFunctionForTransform;
///
/// Since Bun is a transpiler *and* bundler, we take a slightly different approach. Aside
/// from including the link to the refresh runtime, our notation of $RefreshReg$ is just
/// pointing at `Refresh.register`, which means when we call it, the second argument has
/// to be a string containing the filepath, not just the component name.
pub struct ReactRefresh<'a> {
    /// Set if this JSX/TSX file uses the refresh runtime. If so,
    /// we must insert an import statement to it.
    pub register_used: bool,
    pub signature_used: bool,

    /// $RefreshReg$ is called on all top-level variables that are
    /// components, as well as HOCs found in the `export default` clause.
    pub register_ref: Ref,

    /// $RefreshSig$ is called to create a signature function, which is
    /// used by the refresh runtime to perform smart hook tracking.
    pub create_signature_ref: Ref,

    /// If a comment with '@refresh reset' is seen, we will forward a
    /// force refresh to the refresh runtime. This lets you reset the
    /// state of hooks on an update on a per-component basis.
    // TODO: this is never set
    pub force_reset: bool,

    /// The last hook that was scanned. This is used when visiting
    /// `.s_local`, as we must hash the variable destructure if the
    /// hook's result is assigned directly to a local.
    // ARENA: identity-compared against Store-allocated AST node.
    pub last_hook_seen: Option<*const E::Call>,

    /// Every function sets up stack memory to hold data related to it's
    /// hook tracking. This is a pointer to that ?HookContext, where an
    /// inner null means there are no hook calls.
    ///
    /// The inner value is initialized when the first hook .e_call is
    /// visited, where the '_s' symbol is reserved. Additional hook calls
    /// append to the `hasher` and `user_hooks` as needed.
    ///
    /// When a function is done visiting, the stack location is checked,
    /// and then it will insert `var _s = ...`, add the `_s()` call at
    /// the start of the function, and then add the call to `_s(func, ...)`.
    pub hook_ctx_storage: Option<&'a mut Option<HookContext>>,

    /// This is the most recently generated `_s` call. This is used to compare
    /// against seen calls to plain identifiers when in "export default" and in
    /// "const Component =" to know if an expression had been wrapped in a hook
    /// signature function.
    pub latest_signature_ref: Ref,
}

impl<'a> Default for ReactRefresh<'a> {
    fn default() -> Self {
        Self {
            register_used: false,
            signature_used: false,
            register_ref: Ref::NONE,
            create_signature_ref: Ref::NONE,
            force_reset: false,
            last_hook_seen: None,
            hook_ctx_storage: None,
            latest_signature_ref: Ref::NONE,
        }
    }
}

pub struct HookContext {
    pub hasher: Wyhash,
    pub signature_cb: Ref,
    pub user_hooks: ArrayHashMap<Ref, Expr>,
}

impl ReactRefresh<'_> {
    /// https://github.com/facebook/react/blob/d1afcb43fd506297109c32ff462f6f659f9110ae/packages/react-refresh/src/ReactFreshBabelPlugin.js#L42
    pub fn is_componentish_name(id: &[u8]) -> bool {
        if id.is_empty() {
            return false;
        }
        matches!(id[0], b'A'..=b'Z')
    }

    /// https://github.com/facebook/react/blob/d1afcb43fd506297109c32ff462f6f659f9110ae/packages/react-refresh/src/ReactFreshBabelPlugin.js#L408
    pub fn is_hook_name(id: &[u8]) -> bool {
        id.len() >= 4
            && id.starts_with(b"use")
            && matches!(id[3], b'A'..=b'Z')
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
pub enum BuiltInHook {
    useState,
    useReducer,
    useEffect,
    useLayoutEffect,
    useMemo,
    useCallback,
    useRef,
    useContext,
    useImperativeHandle,
    useDebugValue,
    useId,
    useDeferredValue,
    useTransition,
    useInsertionEffect,
    useSyncExternalStore,
    useFormStatus,
    useFormState,
    useActionState,
    useOptimistic,
}

// TODO(port): bun.ComptimeEnumMap → phf::Map<&'static [u8], BuiltInHook> built
// from variant names. `strum::EnumString` above is a stand-in; for hot-path
// lookups Phase B should switch to `phf_map!` keyed on byte slices.
pub static BUILT_IN_HOOKS: phf::Map<&'static [u8], BuiltInHook> = phf::phf_map! {
    b"useState" => BuiltInHook::useState,
    b"useReducer" => BuiltInHook::useReducer,
    b"useEffect" => BuiltInHook::useEffect,
    b"useLayoutEffect" => BuiltInHook::useLayoutEffect,
    b"useMemo" => BuiltInHook::useMemo,
    b"useCallback" => BuiltInHook::useCallback,
    b"useRef" => BuiltInHook::useRef,
    b"useContext" => BuiltInHook::useContext,
    b"useImperativeHandle" => BuiltInHook::useImperativeHandle,
    b"useDebugValue" => BuiltInHook::useDebugValue,
    b"useId" => BuiltInHook::useId,
    b"useDeferredValue" => BuiltInHook::useDeferredValue,
    b"useTransition" => BuiltInHook::useTransition,
    b"useInsertionEffect" => BuiltInHook::useInsertionEffect,
    b"useSyncExternalStore" => BuiltInHook::useSyncExternalStore,
    b"useFormStatus" => BuiltInHook::useFormStatus,
    b"useFormState" => BuiltInHook::useFormState,
    b"useActionState" => BuiltInHook::useActionState,
    b"useOptimistic" => BuiltInHook::useOptimistic,
};

/// Equivalent of esbuild's js_ast_helpers.ToInt32
pub fn float_to_int32(f: f64) -> i32 {
    // Special-case non-finite numbers
    if !f.is_finite() {
        return 0;
    }

    // Note: Rust `as u32` saturates where Zig `@intFromFloat` is UB on overflow,
    // but `@mod` ensures the value is in [0, u32::MAX] so behavior matches.
    let uint: u32 = (f.abs() % (u32::MAX as f64 + 1.0)) as u32;
    let int: i32 = uint as i32; // bitcast (same-width int cast reinterprets bits)
    if f < 0.0 {
        0i32.wrapping_sub(int)
    } else {
        int
    }
}

#[derive(Clone, Copy, Default)]
pub struct ParseBindingOptions {
    /// This will prevent parsing of destructuring patterns, as using statement
    /// is only allowed to be `using name, name2, name3`, nothing special.
    pub is_using_statement: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/parser.zig (1277 lines)
//   confidence: medium
//   todos:      18
//   notes:      Prefill mutable statics, generated_symbol_name comptime hash, NewParser! type aliases, and JSXTag::parse parser-trait bound need Phase B design; arena ('bump) threaded through ScopeOrderList/LocList/StmtList/new_lazy_export_ast; many opts structs gained <'a> for arena/source slices.
// ──────────────────────────────────────────────────────────────────────────
