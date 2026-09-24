#![warn(unused_must_use)]
//! Calls that fold to a literal during the visit pass.
//!
//! A function whose visited body returns the same primitive on every path
//! (`function isDev() { return false }`, an empty body, `if` chains over tests
//! the parser already knows) is recorded as `Ref -> value`. `P::e_call` then
//! replaces a plain call of it with the value, so branch folding and dead-code
//! elimination see a literal, the same as for `--define` and `feature()`.
//!
//! Only the bundler enables this. A fold is sound only while nothing rebinds
//! the function. An assignment or a direct `eval` can appear after a call was
//! already folded, so `_parse` parses the file once more without the functions
//! in [`ConstCalls::unsound`].
//!
//! Across files the value has to be known before the importer is visited. The
//! parse pass notes each import that a branch condition calls
//! ([`ConstCalls::guard_imports`]). `_parse` then stops before the visit pass
//! and returns those imports. The bundler parses the imported files first and
//! runs the parse again with a [`ConstCallSeed`] for each call it could
//! evaluate (`bun_bundler::const_call_inlining`).

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

/// A function body with more statements than this is never a candidate.
const MAX_BODY_STMTS: usize = 4;
const MAX_BODY_DEPTH: u32 = 4;
/// A longer string is data, not a flag: a copy at every call grows the output
/// (three.js returns its shader sources from functions like this).
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
    guard_imports: Vec<Ref>,
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

/// An import that a branch condition calls. `import_record_index` and `alias`
/// come back in the [`ConstCallSeed`], so the second parse finds the same item.
pub struct ConstCallImport<'a> {
    pub import_record_index: u32,
    /// The name of the export in the imported file.
    pub alias: &'a [u8],
    pub specifier: &'a [u8],
    pub range: bun_ast::Range,
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
        ExprData::ENumber(_)
        | ExprData::EBoolean(_)
        | ExprData::EBranchBoolean(_)
        | ExprData::ENull(_)
        | ExprData::EUndefined(_) => true,
        ExprData::EString(str) => str.next.is_none() && str.data.len() <= MAX_STRING_LEN,
        _ => false,
    }
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

/// The statement kinds a body that folds to one value can have, before the visit pass.
fn body_is_candidate(stmts: &[Stmt], depth: u32) -> bool {
    if stmts.len() > MAX_BODY_STMTS || depth > MAX_BODY_DEPTH {
        return false;
    }
    stmts.iter().all(|stmt| match stmt.data {
        StmtData::SReturn(_) | StmtData::SEmpty(_) | StmtData::SComment(_) => true,
        StmtData::SDirective(directive) => is_inert_directive(&directive),
        StmtData::SBlock(block) => body_is_candidate(block.stmts.slice(), depth + 1),
        StmtData::SIf(if_) => {
            body_is_candidate(core::slice::from_ref(&if_.yes), depth + 1)
                && if_
                    .no
                    .as_ref()
                    .is_none_or(|no| body_is_candidate(core::slice::from_ref(no), depth + 1))
        }
        _ => false,
    })
}

/// A module-scope function declaration worth visiting before the statements
/// that call it. The check is on the unvisited body, so it only looks at shape.
pub(crate) fn is_previsit_candidate(stmt: &Stmt) -> bool {
    let StmtData::SFunction(data) = stmt.data else {
        return false;
    };
    let func = &data.func;
    func.name.is_some()
        && is_plain_function(func.flags)
        && args_are_inert(func.args.slice())
        && body_is_candidate(func.body.stmts.slice(), 0)
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Runs once, after the parse pass: macro imports are known by then.
    pub(crate) fn enable_const_calls(&mut self) {
        self.const_calls_enabled = self.options.bundle
            && self.options.features.dead_code_elimination
            && !self.options.features.hot_module_reloading
            && !self.options.features.react_fast_refresh
            // The second parse would run each macro again.
            && self.macro_.refs.is_empty()
            && !self.options.const_call_retry.is_some_and(|retry| retry.disable);
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

    fn const_call_flow(&self, stmts: &[Stmt], depth: u32) -> Flow {
        if stmts.len() > MAX_BODY_STMTS || depth > MAX_BODY_DEPTH {
            return Flow::Unknown;
        }
        for stmt in stmts {
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
                StmtData::SBlock(block) => self.const_call_flow(block.stmts.slice(), depth + 1),
                StmtData::SIf(if_) => match SideEffects::to_boolean(self, &if_.test.data) {
                    Some(known) if known.side_effects == SideEffects::NoSideEffects => {
                        if known.value {
                            self.const_call_flow(core::slice::from_ref(&if_.yes), depth + 1)
                        } else if let Some(no) = &if_.no {
                            self.const_call_flow(core::slice::from_ref(no), depth + 1)
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
        match self.const_call_flow(body, 0) {
            Flow::Returns(value) => Some(value),
            Flow::FallsThrough => Some(Expr {
                data: ExprData::EUndefined(E::Undefined {}),
                loc: end,
            }),
            Flow::Unknown => None,
        }
    }

    fn record_const_call(&mut self, ref_: Ref, name_loc: Loc, value: Expr) {
        if self
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

    /// After `visit_func` of a function declaration that keeps its own binding.
    pub(crate) fn note_const_call_function(&mut self, func: &G::Fn) {
        let Some(name) = func.name else { return };
        if !is_plain_function(func.flags)
            // A function in a block is a second binding in sloppy mode.
            || !matches!(
                self.current_scope().kind,
                ScopeKind::Entry | ScopeKind::FunctionBody
            )
        {
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
            self.record_const_call(name.ref_, name.loc, value);
        }
    }

    /// `const f = () => value` or `const f = function () { return value }` in the const local prefix, where no call can run before the declaration.
    pub(crate) fn note_const_call_decl(&mut self, ref_: Ref, name_loc: Loc, value: &Expr) {
        if self.enclosing_namespace_arg_ref.is_some() {
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
            self.record_const_call(ref_, name_loc, value);
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
        let fact = self.const_calls.as_mut()?.values.get_mut(&target_ref)?;
        fact.folds += 1;
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

    /// Parse pass: `test` decides a branch. `deep` also looks at both sides of
    /// `&&`, `||`, `??` and `,`. Each of those operators checks its own left side, so
    /// a caller that is one of them passes `false` and a chain is walked once.
    #[inline]
    pub(crate) fn note_const_call_guard(&mut self, test: &Expr, deep: bool) {
        // An import statement below its first use is legal, and such a use is not seen here.
        if self.const_call_prefilter && !self.is_import_item.is_empty() {
            self.scan_const_call_guard(test, deep, 0);
        }
    }

    fn scan_const_call_guard(&mut self, expr: &Expr, deep: bool, depth: u32) {
        if depth > MAX_BODY_DEPTH * 4 {
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
        let calls = self.const_calls.get_or_insert_with(Default::default);
        if !calls.guard_imports.contains(&import_ref) {
            calls.guard_imports.push(import_ref);
        }
    }

    /// After the parse pass: the imports whose value the bundler must look up
    /// before this file is visited. `None` when the file can be visited now.
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
            // An attribute can change what the specifier loads.
            if record.loader.is_some() || record.tag != js_ast::ImportRecordTag::None {
                continue;
            }
            let items = import.items.slice();
            if !import
                .default_name
                .is_some_and(|name| guards.contains(&name.ref_))
                && !items.iter().any(|item| guards.contains(&item.name.ref_))
            {
                continue;
            }
            // The bundler waits for this file anyway, so every item of the
            // statement is asked about: a call outside a condition folds too.
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

    /// `to_ast`: what importers may fold. A function declaration is initialized
    /// before any module runs, so a call from an import cycle sees it too. A
    /// `const` is not.
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
