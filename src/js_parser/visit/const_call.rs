#![warn(unused_must_use)]
//! Folds a call of a function that always returns `true`, `false`, `null` or `undefined`, during the visit pass.

use crate::p::P;
use crate::scan::scan_side_effects::SideEffects;
use bun_ast as js_ast;
use bun_ast::b::B as BData;
use bun_ast::flags;
use bun_ast::scope::Kind as ScopeKind;
use bun_ast::symbol::Kind as SymbolKind;
use bun_ast::{E, Expr, ExprData, G, Loc, Ref, Stmt, StmtData};
use bun_collections::{HashMap, VecExt as _};

bun_core::declare_scope!(const_call, hidden);

/// The statements of a body that are stepped over before the check gives up.
const MAX_STEPS: u32 = 16;
const MAX_GUARD_DEPTH: u32 = 16;

/// What every call of a function evaluates to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConstCallValue {
    True,
    False,
    Null,
    Undefined,
}

impl ConstCallValue {
    fn of(data: &ExprData) -> Option<Self> {
        Some(match data {
            ExprData::EBoolean(boolean) if boolean.value => Self::True,
            ExprData::EBoolean(_) => Self::False,
            ExprData::ENull(_) => Self::Null,
            ExprData::EUndefined(_) => Self::Undefined,
            _ => return None,
        })
    }

    fn data(self) -> ExprData {
        match self {
            Self::True => ExprData::EBoolean(E::Boolean { value: true }),
            Self::False => ExprData::EBoolean(E::Boolean { value: false }),
            Self::Null => ExprData::ENull(E::Null {}),
            Self::Undefined => ExprData::EUndefined(E::Undefined {}),
        }
    }
}

/// Answers what a call of an import returns. The bundler has one for each file it parses.
pub trait ConstCallLookup {
    /// `specifier` is the one of an `import` statement of the file, `alias` is the name of the export.
    fn lookup(&self, specifier: &[u8], alias: &[u8]) -> Option<ConstCallValue>;
}

/// What the exports of a file return, for the lookup of its importers.
#[derive(Default)]
pub struct ConstCallExports {
    pub values: Vec<(Box<[u8]>, ConstCallValue)>,
    pub reexports: Vec<ConstCallReexport>,
    /// The specifier, when the file is only `module.exports = require(specifier)`.
    pub redirect: Option<Box<[u8]>>,
}

/// `export { imported as alias } from specifier`, or an import that the file exports again.
pub struct ConstCallReexport {
    pub alias: Box<[u8]>,
    pub specifier: Box<[u8]>,
    pub imported: Box<[u8]>,
}

pub(crate) struct Fact {
    value: ConstCallValue,
    /// Identifies the function in a second parse of the same source.
    name_loc: Loc,
    folds: u32,
}

#[derive(Default)]
pub(crate) struct ConstCalls {
    values: HashMap<Ref, Fact>,
    /// Import items that a branch condition calls with no argument or with literals only.
    guard_imports: HashMap<Ref, ()>,
    /// Function declarations that share their binding with a `var`.
    merged_with_var: Vec<Ref>,
    /// Name locs of folded functions that something rebinds.
    pub(crate) unsound: Vec<Loc>,
    /// A direct `eval` can rebind every function.
    pub(crate) unsound_all: bool,
}

/// Set by `_parse` for an attempt after the first.
#[derive(Clone, Copy)]
pub struct ConstCallRetry<'a> {
    pub(crate) blocklist: &'a [Loc],
    pub(crate) disable: bool,
}

/// `ExprData` variants a parse-pass call argument can be for the call to count as a guard.
fn is_literal_arg(data: &ExprData) -> bool {
    matches!(
        data,
        ExprData::ENumber(_) | ExprData::EBoolean(_) | ExprData::ENull(_) | ExprData::EString(_)
    )
}

enum Flow {
    Returns(ConstCallValue),
    FallsThrough,
    Unknown,
}

/// What is known before the parse pass. `P::enable_const_calls` adds the rest.
pub(crate) fn const_calls_allowed(options: &crate::parse::parse_entry::Options<'_>) -> bool {
    options.bundle
        // The same switch as for the values of `const` declarations.
        && options.features.inlining
        && options.tree_shaking
        && options.features.dead_code_elimination
        && !options.features.hot_module_reloading
        && !options.features.react_fast_refresh
        // A folded hook call changes which functions the compiler memoizes.
        && !options.features.react_compiler.is_enabled()
        && !options.const_call_retry.is_some_and(|retry| retry.disable)
        && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_CONST_CALL_FOLDING::get()
            .unwrap_or(false)
}

fn is_plain_function(flags: flags::FunctionSet) -> bool {
    !flags.contains(flags::Function::IsAsync) && !flags.contains(flags::Function::IsGenerator)
}

/// `"use server"` and similar directives give the function a meaning a fold would drop.
fn is_inert_directive(directive: &js_ast::S::Directive) -> bool {
    directive.value.slice() == b"use strict"
}

/// No parameter runs code when the function is called.
fn args_are_inert(args: &[G::Arg]) -> bool {
    args.iter()
        .all(|arg| matches!(arg.binding.data, BData::BIdentifier(_)) && arg.default.is_none())
}

/// Parse pass: reports the names `expr` calls. `deep` also looks under `&&`, `||`, `??` and `,`.
fn scan_guard(expr: &Expr, deep: bool, depth: u32, found: &mut dyn FnMut(Ref)) {
    if depth > MAX_GUARD_DEPTH {
        return;
    }
    match expr.data {
        ExprData::ECall(call) => {
            if call.optional_chain.is_none()
                && call
                    .args
                    .slice()
                    .iter()
                    .all(|arg| is_literal_arg(&arg.data))
            {
                if let ExprData::EIdentifier(id) = call.target.data {
                    found(id.ref_);
                }
            }
        }
        ExprData::EUnary(unary) if unary.op == js_ast::OpCode::UnNot => {
            scan_guard(&unary.value, deep, depth + 1, found);
        }
        ExprData::EBinary(binary) => {
            use js_ast::OpCode as Op;
            let follow = match binary.op {
                Op::BinStrictEq | Op::BinStrictNe | Op::BinLooseEq | Op::BinLooseNe => true,
                Op::BinLogicalAnd | Op::BinLogicalOr | Op::BinNullishCoalescing | Op::BinComma => {
                    deep
                }
                _ => false,
            };
            if follow {
                scan_guard(&binary.left, deep, depth + 1, found);
                scan_guard(&binary.right, deep, depth + 1, found);
            }
        }
        _ => {}
    }
}

/// Parse pass: `scan_guard` on what the body of a top-level function returns.
fn scan_returns(stmts: &[Stmt], steps: &mut u32, found: &mut dyn FnMut(Ref)) {
    for stmt in stmts {
        if *steps == 0 {
            return;
        }
        *steps -= 1;
        match stmt.data {
            StmtData::SReturn(ret) => {
                if let Some(value) = &ret.value {
                    scan_guard(value, true, 0, found);
                }
            }
            StmtData::SBlock(block) => scan_returns(block.stmts.slice(), steps, found),
            StmtData::SIf(if_) => {
                scan_returns(core::slice::from_ref(&if_.yes), steps, found);
                if let Some(no) = &if_.no {
                    scan_returns(core::slice::from_ref(no), steps, found);
                }
            }
            _ => {}
        }
    }
}

impl ConstCalls {
    fn record(&mut self, ref_: Ref, name_loc: Loc, value: ConstCallValue) {
        if self.unsound_all || self.merged_with_var.contains(&ref_) {
            return;
        }
        self.values.insert(
            ref_,
            Fact {
                value,
                name_loc,
                folds: 0,
            },
        );
    }

    /// `record_assignment` on the root of a link chain.
    #[cold]
    pub(crate) fn rebound(&mut self, ref_: Ref) {
        if let Some(fact) = self.values.remove(&ref_) {
            if fact.folds > 0 {
                self.unsound.push(fact.name_loc);
            }
        }
    }

    fn direct_eval(&mut self) {
        self.unsound_all = self.values.values().any(|fact| fact.folds > 0);
        self.values.clear();
    }

    /// Asks `lookup` about each import that a condition calls, and records the answers as facts.
    fn seed_imports(
        &mut self,
        stmts: &[Stmt],
        records: &[js_ast::ImportRecord],
        lookup: &dyn ConstCallLookup,
    ) {
        if self.guard_imports.is_empty() {
            return;
        }
        for stmt in stmts {
            let StmtData::SImport(import) = stmt.data else {
                continue;
            };
            let record = &records[import.import_record_index as usize];
            let specifier = record.path.text;
            // An attribute can change what the specifier loads, and a builtin has no source.
            if record.loader.is_some()
                || record.tag != js_ast::ImportRecordTag::None
                || specifier.starts_with(b"node:")
                || specifier.starts_with(b"bun:")
            {
                continue;
            }
            let default = import.default_name.map(|name| (&b"default"[..], name));
            let items = import
                .items
                .slice()
                .iter()
                .map(|item| (item.alias.slice(), item.name));
            for (alias, name) in default.into_iter().chain(items) {
                if !self.guard_imports.contains_key(&name.ref_) {
                    continue;
                }
                if let Some(value) = lookup.lookup(specifier, alias) {
                    self.record(name.ref_, name.loc, value);
                }
            }
        }
    }

    /// What importers may fold: only function declarations, which exist before any module runs.
    fn exports(&self, ast: &js_ast::Ast<'_>) -> ConstCallExports {
        let mut exports = ConstCallExports::default();
        let symbols = ast.symbols.as_slice();
        let records = ast.import_records.as_slice();
        for (alias, export) in ast.named_exports.iter() {
            let symbol = &symbols[export.ref_.inner_index() as usize];
            if let Some(fact) = self.values.get(&export.ref_) {
                if symbol.kind == SymbolKind::HoistedFunction
                    && ast
                        .module_scope
                        .members
                        .get(symbol.original_name.slice())
                        .is_some_and(|member| member.ref_ == export.ref_)
                {
                    exports.values.push((Box::from(&alias[..]), fact.value));
                }
                continue;
            }
            let Some(import) = ast.named_imports.get(&export.ref_) else {
                continue;
            };
            let Some(imported) = import.alias.filter(|_| !import.alias_is_star) else {
                continue;
            };
            let record = &records[import.import_record_index as usize];
            if record.kind == js_ast::ImportKind::Stmt
                && record.loader.is_none()
                && record.tag == js_ast::ImportRecordTag::None
            {
                exports.reexports.push(ConstCallReexport {
                    alias: Box::from(&alias[..]),
                    specifier: Box::from(record.path.text),
                    imported: Box::from(imported.slice()),
                });
            }
        }
        exports
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Runs once, after the parse pass: macro imports are known by then.
    pub(crate) fn enable_const_calls(&mut self) {
        // A second attempt would run each macro again.
        self.const_calls_enabled =
            const_calls_allowed(&self.options) && self.macro_.refs.is_empty();
    }

    /// `function f() {}` declared where a `var f` also binds: `var f = x` rebinds it without an assignment expression.
    #[cold]
    pub(crate) fn note_function_merged_with_var(&mut self, function_ref: Ref) {
        if self.options.bundle {
            self.const_calls
                .get_or_insert_with(Default::default)
                .merged_with_var
                .push(function_ref);
        }
    }

    fn const_call_flow(&self, stmts: &[Stmt], steps: &mut u32) -> Flow {
        for stmt in stmts {
            if *steps == 0 {
                return Flow::Unknown;
            }
            *steps -= 1;
            let flow = match stmt.data {
                StmtData::SEmpty(_) | StmtData::SComment(_) => Flow::FallsThrough,
                StmtData::SDirective(directive) if is_inert_directive(&directive) => {
                    Flow::FallsThrough
                }
                StmtData::SReturn(ret) => match ret.value {
                    None => Flow::Returns(ConstCallValue::Undefined),
                    Some(value) => match ConstCallValue::of(&value.unwrap_inlined().data) {
                        Some(value) => Flow::Returns(value),
                        None => Flow::Unknown,
                    },
                },
                StmtData::SBlock(block) => self.const_call_flow(block.stmts.slice(), steps),
                StmtData::SIf(if_) => match SideEffects::to_boolean(self, &if_.test.data) {
                    Some(known) if known.side_effects == SideEffects::NoSideEffects => {
                        if known.value {
                            self.const_call_flow(core::slice::from_ref(&if_.yes), steps)
                        } else if let Some(no) = &if_.no {
                            self.const_call_flow(core::slice::from_ref(no), steps)
                        } else {
                            Flow::FallsThrough
                        }
                    }
                    _ => Flow::Unknown,
                },
                _ => Flow::Unknown,
            };
            match flow {
                Flow::FallsThrough => {}
                other => return other,
            }
        }
        Flow::FallsThrough
    }

    /// The value every call of a function with this visited body evaluates to.
    fn const_call_value(&self, args: &[G::Arg], body: &[Stmt]) -> Option<ConstCallValue> {
        if !args_are_inert(args) {
            return None;
        }
        match self.const_call_flow(body, &mut { MAX_STEPS }) {
            Flow::Returns(value) => Some(value),
            Flow::FallsThrough => Some(ConstCallValue::Undefined),
            Flow::Unknown => None,
        }
    }

    fn record_const_call(&mut self, ref_: Ref, name_loc: Loc, value: ConstCallValue) {
        if self
            .options
            .const_call_retry
            .is_some_and(|retry| retry.blocklist.contains(&name_loc))
        {
            return;
        }
        self.const_calls
            .get_or_insert_with(Default::default)
            .record(ref_, name_loc, value);
    }

    /// A declaration in a block is a second binding in sloppy mode, and a `switch` body is entered at any `case`.
    fn is_in_function_or_module_scope(&self) -> bool {
        matches!(
            self.current_scope().kind,
            ScopeKind::Entry | ScopeKind::FunctionBody
        )
    }

    /// After `visit_func` of a function declaration that keeps its own binding.
    pub(crate) fn note_const_call_function(&mut self, func: &G::Fn) {
        let Some(name) = func.name else { return };
        if !is_plain_function(func.flags) || !self.is_in_function_or_module_scope() {
            return;
        }
        let symbol = &self.symbols[name.ref_.inner_index() as usize];
        if symbol.kind != SymbolKind::HoistedFunction
            || symbol.has_link()
            || symbol.has_been_assigned_to()
        {
            return;
        }
        if let Some(value) = self.const_call_value(func.args.slice(), func.body.stmts.slice()) {
            self.record_const_call(name.ref_, name.loc, value);
        }
    }

    /// `const f = () => value` or `const f = function () { return value }` in the const local prefix, where the value of a `const` is inlined too.
    pub(crate) fn note_const_call_decl(&mut self, ref_: Ref, name_loc: Loc, value: &Expr) {
        if self.enclosing_namespace_arg_ref.is_some() || !self.is_in_function_or_module_scope() {
            return;
        }
        let folded = match value.data {
            ExprData::EArrow(arrow) if !arrow.is_async => {
                self.const_call_value(arrow.args.slice(), arrow.body.stmts.slice())
            }
            ExprData::EFunction(function) if is_plain_function(function.func.flags) => {
                self.const_call_value(function.func.args.slice(), function.func.body.stmts.slice())
            }
            _ => None,
        };
        if let Some(value) = folded {
            self.record_const_call(ref_, name_loc, value);
        }
    }

    /// `e_call` after the target and the arguments are visited. Argument side effects stay, in order, before the value.
    #[inline(never)]
    pub(crate) fn fold_const_call(&mut self, call: &E::Call, loc: Loc) -> Option<Expr> {
        // `require(cond() ? a : b)` is a way to keep a specifier away from the bundler.
        if call.optional_chain.is_some() || self.in_import_specifier || self.in_template_tag {
            return None;
        }
        let target_ref = match call.target.data {
            // Inside `with`, the name can be a property of the object.
            ExprData::EIdentifier(id) if !id.must_keep_due_to_with_stmt() => id.ref_,
            ExprData::EImportIdentifier(id) => id.ref_,
            _ => return None,
        };
        let fact = self.const_calls.as_mut()?.values.get_mut(&target_ref)?;
        fact.folds += 1;
        let result = Expr {
            loc,
            data: fact.value.data(),
        };
        self.ignore_usage(target_ref);

        let mut side_effects: Option<Expr> = None;
        for arg in call.args.slice() {
            let arg = match arg.data {
                // `f(...xs)` iterates `xs`.
                ExprData::ESpread(_) => self.new_expr(
                    E::Array {
                        items: js_ast::ExprNodeList::init_one(*arg),
                        is_single_line: true,
                        ..Default::default()
                    },
                    arg.loc,
                ),
                _ => *arg,
            };
            if let Some(kept) = SideEffects::simplify_unused_expr(self, arg) {
                side_effects = Some(match side_effects {
                    Some(before) => before.join_with_comma(kept),
                    None => kept,
                });
            }
        }
        Some(match side_effects {
            Some(before) => before.join_with_comma(result),
            None => result,
        })
    }

    /// Parse pass: notes the imports `test` calls. `deep` also looks under `&&`, `||`, `??` and `,`.
    #[inline]
    pub(crate) fn note_const_call_guard(&mut self, test: &Expr, deep: bool) {
        // An import statement below its first use is legal, and such a use is not seen here.
        if self.const_call_prefilter && !self.is_import_item.is_empty() {
            scan_guard(test, deep, 0, &mut |name| {
                self.note_const_call_guard_name(name)
            });
        }
    }

    /// A local binding with the same name only makes the file ask for nothing.
    fn note_const_call_guard_name(&mut self, name_ref: Ref) {
        let name = self.load_name_from_ref(name_ref);
        let Some(member) = self.module_scope().members.get(name) else {
            return;
        };
        let import_ref = member.ref_;
        if self.symbols[import_ref.inner_index() as usize].kind != SymbolKind::Import
            || !self.is_import_item.contains_key(&import_ref)
        {
            return;
        }
        self.const_calls
            .get_or_insert_with(Default::default)
            .guard_imports
            .insert(import_ref, ());
    }

    /// Parse pass, after a top-level function declaration: `return isDev()` makes the function a wrapper of the import.
    pub(crate) fn note_const_call_wrapper(&mut self, func: &G::Fn) {
        if !self.const_call_prefilter
            || self.is_import_item.is_empty()
            || !is_plain_function(func.flags)
            || !args_are_inert(func.args.slice())
        {
            return;
        }
        scan_returns(func.body.stmts.slice(), &mut { MAX_STEPS }, &mut |name| {
            self.note_const_call_guard_name(name)
        });
    }

    /// After the parse pass: asks the bundler what the imports that a condition calls return.
    pub(crate) fn seed_const_call_imports(&mut self, stmts: &[Stmt]) {
        if !self.const_calls_enabled {
            return;
        }
        let (Some(lookup), Some(calls)) = (self.options.const_call_lookup, &mut self.const_calls)
        else {
            return;
        };
        calls.seed_imports(stmts, self.import_records.items(), lookup);
    }

    /// After `to_ast` of a file that the bundler parses for the lookup of its importers.
    pub(crate) fn send_const_call_exports(&self, ast: &js_ast::Ast<'_>) {
        let (Some(exports), Some(calls)) = (self.options.const_call_exports, &self.const_calls)
        else {
            return;
        };
        if self.const_calls_enabled {
            exports.set(Some(Box::new(calls.exports(ast))));
        }
    }

    /// The file is only `module.exports = require()` of the record.
    pub(crate) fn send_const_call_redirect(&self, import_record_index: u32) {
        let Some(exports) = self.options.const_call_exports else {
            return;
        };
        let record = &self.import_records.items()[import_record_index as usize];
        exports.set(Some(Box::new(ConstCallExports {
            redirect: Some(Box::from(record.path.text)),
            ..Default::default()
        })));
    }

    /// A direct `eval` anywhere in the file.
    #[cold]
    pub(crate) fn const_call_direct_eval(&mut self) {
        if !self.const_calls_enabled {
            return;
        }
        self.const_calls_enabled = false;
        if let Some(calls) = self.const_calls.as_mut() {
            calls.direct_eval();
        }
    }

    /// After the visit pass. `Some` means a fold was unsound and the file must be parsed again.
    pub(crate) fn const_call_retry(&self) -> Option<ConstCallRetry<'a>> {
        let calls = self.const_calls.as_ref()?;
        if !calls.unsound_all && calls.unsound.is_empty() {
            return None;
        }
        bun_core::scoped_log!(
            const_call,
            "parse {} again: {} folded function(s) are rebound, direct eval: {}",
            bstr::BStr::new(self.source.path.pretty),
            calls.unsound.len(),
            calls.unsound_all
        );
        // An attempt after the first keeps what the attempts before it found.
        let before = self.options.const_call_retry;
        let mut blocklist = before.map_or(&[][..], |retry| retry.blocklist).to_vec();
        blocklist.extend_from_slice(&calls.unsound);
        Some(ConstCallRetry {
            blocklist: self.arena.alloc_slice_copy(&blocklist),
            disable: calls.unsound_all || before.is_some_and(|retry| retry.disable),
        })
    }
}
