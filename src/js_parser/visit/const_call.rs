#![warn(unused_must_use)]
//! Folds a call of a function that always returns the same primitive, during the visit pass.

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
/// A longer string at every call grows the output (three.js returns shader sources this way).
const MAX_STRING_LEN: usize = 64;

pub(crate) struct Fact {
    value: Expr,
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

/// Set by `_parse` for its second attempt.
#[derive(Clone, Copy)]
pub struct ConstCallRetry<'a> {
    pub(crate) blocklist: &'a [Loc],
    pub(crate) disable: bool,
}

/// An import that a branch condition calls. The bundler answers with a [`ConstCallSeed`].
pub struct ConstCallImport<'a> {
    pub import_record_index: u32,
    /// The name of the export in the imported file.
    pub alias: &'a [u8],
    pub specifier: &'a [u8],
    pub range: bun_ast::Range,
}

pub struct ConstCallStop<'a> {
    pub imports: Vec<ConstCallImport<'a>>,
    /// The file as visited without the values. `None` when that visit failed.
    pub ast: Option<bun_ast::Ast<'a>>,
}

/// The value every call of an import evaluates to.
pub struct ConstCallSeed<'a> {
    pub import_record_index: u32,
    pub alias: &'a [u8],
    pub value: Expr,
}

/// `ExprData` variants a parse-pass call argument can be for the call to count as a guard.
fn is_literal_arg(data: &ExprData) -> bool {
    matches!(
        data,
        ExprData::ENumber(_) | ExprData::EBoolean(_) | ExprData::ENull(_) | ExprData::EString(_)
    )
}

enum Flow {
    Returns(Expr),
    FallsThrough,
    Unknown,
}

fn is_const_call_value(data: &ExprData) -> bool {
    match data {
        ExprData::ENumber(_) => true,
        ExprData::EString(str) => str.next.is_none() && str.data.len() <= MAX_STRING_LEN,
        _ => folds_anywhere(data),
    }
}

/// A string or a number can be a specifier, so it folds only in the condition of `if` or `?:`.
fn folds_anywhere(data: &ExprData) -> bool {
    matches!(
        data,
        ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENull(_)
            | ExprData::EUndefined(_)
    )
}

/// What is known before the parse pass. `P::enable_const_calls` adds the rest.
pub(crate) fn const_calls_allowed(options: &crate::parse::parse_entry::Options<'_>) -> bool {
    options.bundle
        // Without tree shaking the graph is only scanned (`bun test --changed`).
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

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Runs once, after the parse pass: macro imports are known by then.
    pub(crate) fn enable_const_calls(&mut self) {
        // The second parse would run each macro again.
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
                    None => Flow::Returns(Expr {
                        data: ExprData::EUndefined(E::Undefined {}),
                        loc: stmt.loc,
                    }),
                    Some(value) => {
                        let value = value.unwrap_inlined();
                        if is_const_call_value(&value.data) {
                            Flow::Returns(value)
                        } else {
                            Flow::Unknown
                        }
                    }
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
    fn const_call_value(&self, args: &[G::Arg], body: &[Stmt], end: Loc) -> Option<Expr> {
        if !args_are_inert(args) {
            return None;
        }
        match self.const_call_flow(body, &mut { MAX_STEPS }) {
            Flow::Returns(value) => Some(value),
            Flow::FallsThrough => Some(Expr {
                data: ExprData::EUndefined(E::Undefined {}),
                loc: end,
            }),
            Flow::Unknown => None,
        }
    }

    fn record_const_call(&mut self, ref_: Ref, name_loc: Loc, value: Expr, build_time: bool) {
        // By default only a function that reads a `--define` or `feature()` value folds.
        if !(build_time || self.options.features.inlining)
            || self
                .options
                .const_call_retry
                .is_some_and(|retry| retry.blocklist.contains(&name_loc))
        {
            return;
        }
        let calls = self.const_calls.get_or_insert_with(Default::default);
        if calls.unsound_all || calls.merged_with_var.contains(&ref_) {
            return;
        }
        calls.values.insert(
            ref_,
            Fact {
                value,
                name_loc,
                folds: 0,
            },
        );
    }

    /// A declaration in a block is a second binding in sloppy mode, and a `switch` body is entered at any `case`.
    fn is_in_function_or_module_scope(&self) -> bool {
        matches!(
            self.current_scope().kind,
            ScopeKind::Entry | ScopeKind::FunctionBody
        )
    }

    /// After `visit_func` of a function declaration that keeps its own binding. `build_time`: the body read a build-time value.
    pub(crate) fn note_const_call_function(&mut self, func: &G::Fn, build_time: bool) {
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
        if let Some(value) =
            self.const_call_value(func.args.slice(), func.body.stmts.slice(), func.body.loc)
        {
            self.record_const_call(name.ref_, name.loc, value, build_time);
        }
    }

    /// `const f = () => value` or `const f = function () { return value }` in the const local prefix, where no call can run before the declaration.
    pub(crate) fn note_const_call_decl(
        &mut self,
        ref_: Ref,
        name_loc: Loc,
        value: &Expr,
        build_time: bool,
    ) {
        if self.enclosing_namespace_arg_ref.is_some() || !self.is_in_function_or_module_scope() {
            return;
        }
        let folded = match value.data {
            ExprData::EArrow(arrow) if !arrow.is_async => {
                self.const_call_value(arrow.args.slice(), arrow.body.stmts.slice(), arrow.body.loc)
            }
            ExprData::EFunction(function) if is_plain_function(function.func.flags) => self
                .const_call_value(
                    function.func.args.slice(),
                    function.func.body.stmts.slice(),
                    function.func.body.loc,
                ),
            _ => None,
        };
        if let Some(value) = folded {
            self.record_const_call(ref_, name_loc, value, build_time);
        }
    }

    /// `e_call` after the target and the arguments are visited. Argument side effects stay, in order, before the value.
    #[inline(never)]
    pub(crate) fn fold_const_call(&mut self, call: &E::Call, loc: Loc) -> Option<Expr> {
        // `require(name())` is a way to keep a specifier away from the bundler.
        if call.optional_chain.is_some() || self.in_import_specifier {
            return None;
        }
        let target_ref = match call.target.data {
            // Inside `with`, the name can be a property of the object.
            ExprData::EIdentifier(id) if !id.must_keep_due_to_with_stmt() => id.ref_,
            ExprData::EImportIdentifier(id) => id.ref_,
            _ => return None,
        };
        let in_branch_condition = self.in_branch_condition;
        let fact = self.const_calls.as_mut()?.values.get_mut(&target_ref)?;
        if !in_branch_condition && !folds_anywhere(&fact.value.data) {
            return None;
        }
        fact.folds += 1;
        self.build_time_values = self.build_time_values.wrapping_add(1);
        let fact = self.const_calls.as_ref()?.values.get(&target_ref)?;
        let mut result = Expr {
            loc,
            data: fact.value.data,
        };
        if let ExprData::EString(str) = result.data {
            // String folding appends to a node in place.
            result = self.new_expr(
                E::String {
                    data: str.data,
                    is_utf16: str.is_utf16,
                    prefer_template: str.prefer_template,
                    ..Default::default()
                },
                loc,
            );
        }
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
            self.scan_const_call_guard(test, deep, 0);
        }
    }

    fn scan_const_call_guard(&mut self, expr: &Expr, deep: bool, depth: u32) {
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
                        self.note_const_call_guard_name(id.ref_);
                    }
                }
            }
            ExprData::EUnary(unary) if unary.op == js_ast::OpCode::UnNot => {
                self.scan_const_call_guard(&unary.value, deep, depth + 1);
            }
            ExprData::EBinary(binary) => {
                use js_ast::OpCode as Op;
                let follow = match binary.op {
                    Op::BinStrictEq | Op::BinStrictNe | Op::BinLooseEq | Op::BinLooseNe => true,
                    Op::BinLogicalAnd
                    | Op::BinLogicalOr
                    | Op::BinNullishCoalescing
                    | Op::BinComma => deep,
                    _ => false,
                };
                if follow {
                    self.scan_const_call_guard(&binary.left, deep, depth + 1);
                    self.scan_const_call_guard(&binary.right, deep, depth + 1);
                }
            }
            _ => {}
        }
    }

    /// A local binding with the same name only makes the file stop for nothing.
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
        self.scan_const_call_returns(func.body.stmts.slice(), &mut { MAX_STEPS });
    }

    fn scan_const_call_returns(&mut self, stmts: &[Stmt], steps: &mut u32) {
        for stmt in stmts {
            if *steps == 0 {
                return;
            }
            *steps -= 1;
            match stmt.data {
                StmtData::SReturn(ret) => {
                    if let Some(value) = &ret.value {
                        self.scan_const_call_guard(value, true, 0);
                    }
                }
                StmtData::SBlock(block) => self.scan_const_call_returns(block.stmts.slice(), steps),
                StmtData::SIf(if_) => {
                    self.scan_const_call_returns(core::slice::from_ref(&if_.yes), steps);
                    if let Some(no) = &if_.no {
                        self.scan_const_call_returns(core::slice::from_ref(no), steps);
                    }
                }
                _ => {}
            }
        }
    }

    /// The imports the bundler must look up before this file is visited, if any.
    pub(crate) fn const_call_imports(&self, stmts: &[Stmt]) -> Option<Vec<ConstCallImport<'a>>> {
        if !self.const_calls_enabled || self.options.const_call_seeds.is_some() {
            return None;
        }
        let guards = &self.const_calls.as_ref()?.guard_imports;
        if guards.is_empty() {
            return None;
        }
        let mut imports = Vec::new();
        for stmt in stmts {
            let StmtData::SImport(import) = stmt.data else {
                continue;
            };
            let record = &self.import_records.items()[import.import_record_index as usize];
            let specifier = record.path.text;
            // An attribute can change what the specifier loads, and a builtin has no source.
            if record.loader.is_some()
                || record.tag != js_ast::ImportRecordTag::None
                || specifier.starts_with(b"node:")
                || specifier.starts_with(b"bun:")
            {
                continue;
            }
            // `export default function` is not recorded, so a default import alone has no value to get.
            let items = import.items.slice();
            if !items
                .iter()
                .any(|item| guards.contains_key(&item.name.ref_))
            {
                continue;
            }
            // The bundler waits for this file anyway, so it is asked about every item of the statement.
            let aliases = import
                .default_name
                .map(|_| &b"default"[..])
                .into_iter()
                .chain(items.iter().map(|item| item.alias.slice()));
            for alias in aliases {
                imports.push(ConstCallImport {
                    import_record_index: import.import_record_index,
                    alias,
                    specifier: record.path.text,
                    range: record.range,
                });
            }
        }
        (!imports.is_empty()).then_some(imports)
    }

    /// After the parse pass of a run the bundler seeded.
    pub(crate) fn install_const_call_seeds(&mut self, stmts: &[Stmt]) {
        let Some(seeds) = self.options.const_call_seeds else {
            return;
        };
        if seeds.is_empty() || !self.const_calls_enabled {
            return;
        }
        for stmt in stmts {
            let StmtData::SImport(import) = stmt.data else {
                continue;
            };
            for seed in seeds {
                if seed.import_record_index != import.import_record_index {
                    continue;
                }
                // `import a, { default as b } from` binds the same export twice.
                let names = import
                    .default_name
                    .filter(|_| seed.alias == b"default")
                    .into_iter()
                    .chain(
                        import
                            .items
                            .slice()
                            .iter()
                            .filter(|item| item.alias.slice() == seed.alias)
                            .map(|item| item.name),
                    );
                for name in names {
                    self.const_calls
                        .get_or_insert_with(Default::default)
                        .values
                        .insert(
                            name.ref_,
                            Fact {
                                value: seed.value,
                                name_loc: name.loc,
                                folds: 0,
                            },
                        );
                }
            }
        }
    }

    /// What importers may fold: only function declarations, which exist before any module runs.
    pub(crate) fn const_call_exports(&self) -> js_ast::ast_result::ConstCallValues {
        let mut exports = js_ast::ast_result::ConstCallValues::default();
        let Some(calls) = self.const_calls.as_ref() else {
            return exports;
        };
        if !self.const_calls_enabled {
            return exports;
        }
        let module_scope = self.module_scope();
        for (ref_, fact) in calls.values.iter() {
            let symbol = &self.symbols[ref_.inner_index() as usize];
            if symbol.kind == SymbolKind::HoistedFunction
                && module_scope
                    .members
                    .get(symbol.original_name.slice())
                    .is_some_and(|member| member.ref_ == *ref_)
            {
                exports.put(*ref_, fact.value).expect("oom");
            }
        }
        exports
    }

    /// `record_assignment` on the root of a link chain.
    #[cold]
    pub(crate) fn const_call_rebound(&mut self, ref_: Ref) {
        let Some(calls) = self.const_calls.as_mut() else {
            return;
        };
        if let Some(fact) = calls.values.remove(&ref_) {
            if fact.folds > 0 {
                calls.unsound.push(fact.name_loc);
            }
        }
    }

    /// A direct `eval` anywhere in the file.
    #[cold]
    pub(crate) fn const_call_direct_eval(&mut self) {
        if !self.const_calls_enabled {
            return;
        }
        self.const_calls_enabled = false;
        if let Some(calls) = self.const_calls.as_mut() {
            calls.unsound_all = calls.values.values().any(|fact| fact.folds > 0);
            calls.values.clear();
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
        Some(ConstCallRetry {
            blocklist: self.arena.alloc_slice_copy(&calls.unsound),
            disable: calls.unsound_all,
        })
    }
}
