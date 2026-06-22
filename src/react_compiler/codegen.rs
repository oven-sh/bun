// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Code generation pass: converts a `ReactiveFunction` tree back into a
//! `bun_ast` function body with memoization (useMemoCache) wired in.
//!
//! Port of `react_compiler_reactive_scopes/codegen_reactive_function.rs`
//! emitting `bun_ast` directly — see DESIGN.md.

#![allow(
    clippy::disallowed_types,
    reason = "interops with vendored react_compiler_hir which uses std::collections"
)]

use std::collections::HashMap;
use std::collections::HashSet;

use crate::collections::IdMap;
use bun_alloc::{Arena, ArenaVec, AstAlloc, AstVec};
use bun_ast::{
    self as ast, ArrayBinding, Binding, Case, Catch, E, Expr, ExprData, ExprNodeList, Finally, G,
    Loc, LocRef, OpCode, OptionalChain, Ref, S, Stmt, StmtData, StmtNodeList, StoreSlice, StoreStr,
    b, flags,
};

use crate::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, CompilerError, CompilerErrorDetail,
    ErrorCategory, SourceLocation as DiagSourceLocation,
};
use crate::hir::environment::Environment;
use crate::hir::reactive::{
    PrunedReactiveScopeBlock, ReactiveBlock, ReactiveFunction, ReactiveInstruction,
    ReactiveScopeBlock, ReactiveStatement, ReactiveTerminal, ReactiveTerminalTargetKind,
    ReactiveValue,
};
use crate::hir::{
    ArrayElement, ArrayPattern, BlockId, DeclarationId, FunctionExpressionType, HirVec,
    IdentifierId, IdentifierName, InstructionKind, InstructionValue, JsxAttribute, JsxTag,
    LogicalOperator, NonLocalKind, ObjectPattern, ObjectPropertyKey, ObjectPropertyOrSpread,
    ObjectPropertyType, ParamPattern, Pattern, Place, PlaceOrSpread, PrimitiveValue,
    PropertyLiteral, ScopeId,
};
use crate::reactive_scopes::visitors::{ReactiveFunctionVisitor, visit_reactive_function};
use crate::reactive_scopes::{
    build_reactive_function, prune_hoisted_contexts, prune_unused_labels, prune_unused_lvalues,
    rename_variables,
};

use crate::program::{Host, JsxImportKind};

/// Result of code generation for a single function.
pub struct CodegenFunction {
    pub loc: Option<DiagSourceLocation>,
    pub id: Option<LocRef>,
    pub name_hint: Option<String>,
    pub params: Vec<G::Arg>,
    pub has_rest_arg: bool,
    pub body: Vec<Stmt>,
    pub generator: bool,
    pub is_async: bool,
    pub memo_slots_used: u32,
    pub memo_blocks: u32,
    pub memo_values: u32,
    pub pruned_memo_blocks: u32,
    pub pruned_memo_values: u32,
    pub outlined: Vec<OutlinedFunction>,
}

impl CodegenFunction {
    pub fn into_fn_body(self) -> G::FnBody {
        G::FnBody {
            loc: convert_loc(self.loc),
            stmts: leak_stmts(self.body),
        }
    }
}

impl std::fmt::Debug for CodegenFunction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CodegenFunction")
            .field("memo_slots_used", &self.memo_slots_used)
            .field("memo_blocks", &self.memo_blocks)
            .field("memo_values", &self.memo_values)
            .field("pruned_memo_blocks", &self.pruned_memo_blocks)
            .field("pruned_memo_values", &self.pruned_memo_values)
            .finish()
    }
}

pub struct OutlinedFunction {
    pub func: CodegenFunction,
    pub fn_type: Option<crate::hir::ReactFunctionType>,
}

#[derive(Clone, Copy)]
enum WellKnown {
    UseMemoCache,
    MemoCache,
    NaN,
    Infinity,
    Underscore,
    MemoCacheSentinel,
    EarlyReturnSentinel,
}

impl WellKnown {
    const COUNT: usize = 7;
}

/// Host-side state shared across nested function-expression codegen so the
/// same identifier name resolves to the same `Ref` everywhere in the compiled
/// component.
pub struct Codegen<'h> {
    pub host: &'h mut dyn Host,
    pub arena: &'h Arena,
    id_to_ref: IdMap<IdentifierId, Ref>,
    well_known: [Option<Ref>; WellKnown::COUNT],
    name_to_ref: HashMap<StoreStr, Ref>,
    label_to_ref: IdMap<BlockId, Ref>,
}

impl<'h> Codegen<'h> {
    pub fn new(host: &'h mut dyn Host, arena: &'h Arena, memo_cache_import: Option<Ref>) -> Self {
        let mut well_known = [None; WellKnown::COUNT];
        well_known[WellKnown::UseMemoCache as usize] = memo_cache_import;
        Codegen {
            host,
            arena,
            id_to_ref: IdMap::new(),
            well_known,
            name_to_ref: HashMap::new(),
            label_to_ref: IdMap::new(),
        }
    }

    fn ref_for_name(&mut self, name: StoreStr) -> Ref {
        if let Some(&r) = self.name_to_ref.get(&name) {
            self.host.record_usage(r);
            return r;
        }
        let r = self.host.new_generated(name.slice());
        self.name_to_ref.insert(name, r);
        r
    }

    fn well_known(&mut self, w: WellKnown, name: &[u8]) -> Ref {
        if let Some(r) = self.well_known[w as usize] {
            self.host.record_usage(r);
            return r;
        }
        let r = self.host.new_generated(name);
        self.well_known[w as usize] = Some(r);
        r
    }

    fn sentinel_expr(&mut self, w: WellKnown, loc: Loc) -> Expr {
        let r = if let Some(r) = self.well_known[w as usize] {
            r
        } else {
            let r = self
                .host
                .runtime_sentinel(matches!(w, WellKnown::EarlyReturnSentinel));
            self.well_known[w as usize] = Some(r);
            r
        };
        self.host.record_usage(r);
        Expr::init(E::ImportIdentifier::new(r, false), loc)
    }

    fn well_known_global(&mut self, w: WellKnown, name: &[u8]) -> Ref {
        if let Some(r) = self.well_known[w as usize] {
            self.host.record_usage(r);
            return r;
        }
        let r = self.host.global_ref(name);
        self.well_known[w as usize] = Some(r);
        r
    }

    fn ident_expr(&mut self, name: StoreStr, loc: Loc) -> Expr {
        if name.slice() == b"undefined" {
            return Expr::init(E::Undefined {}, loc);
        }
        Expr::init_identifier(self.ref_for_name(name), loc)
    }

    /// Emit an identifier expression for the original Bun `Ref` carried through
    /// HIR. If the symbol is an import, emit `EImportIdentifier` so the linker
    /// and printer can rewrite it to a namespace property access when react is
    /// bundled; otherwise emit a plain `EIdentifier`.
    fn ident_expr_for_ref(&mut self, ref_: Ref, loc: Loc) -> Expr {
        self.host.record_usage(ref_);
        if ref_.is_symbol() {
            if let Some(sym) = self.host.symbols().get(ref_.inner_index() as usize) {
                if sym.kind == bun_ast::symbol::Kind::Import {
                    return Expr::init(E::ImportIdentifier::new(ref_, true), loc);
                }
            }
        }
        Expr::init_identifier(ref_, loc)
    }

    fn ref_for_label(&mut self, id: BlockId) -> Ref {
        if let Some(&r) = self.label_to_ref.get(id) {
            return r;
        }
        use std::io::Write;
        let mut buf = [0u8; 24];
        let mut cursor = std::io::Cursor::new(&mut buf[..]);
        write!(cursor, "bb{}", id.0).unwrap();
        let len = cursor.position() as usize;
        let r = self.host.new_generated(&buf[..len]);
        self.label_to_ref.insert(id, r);
        r
    }
}

/// Top-level entry point: generates code for a reactive function.
pub fn codegen_function(
    func: &ReactiveFunction,
    env: &mut Environment,
    cg: &mut Codegen<'_>,
    unique_identifiers: HashSet<String>,
) -> Result<CodegenFunction, CompilerError> {
    let mut cx = Context::new(env, cg, unique_identifiers);

    // Fast Refresh: Bun handles HMR via its own React Refresh transform; the
    // upstream `enable_reset_cache_on_source_file_changes` path keys on
    // `env.code` which Bun never populates, so this is always `None`.
    let fast_refresh_state: Option<u32> = None;

    let mut compiled = codegen_reactive_function(&mut cx, func)?;

    // enableEmitHookGuards: wrap entire function body in try/finally with
    // $dispatcherGuard(PushHookGuard=0) / $dispatcherGuard(PopHookGuard=1).
    if let Some(hook_guard_name) = cx.env.hook_guard_name {
        if cx.env.output_mode == crate::hir::environment::OutputMode::Client {
            let guard_ref = cx.cg.ref_for_name(hook_guard_name);
            let body_stmts = std::mem::take(&mut compiled.body);
            compiled.body = vec![create_function_body_hook_guard(guard_ref, body_stmts, 0, 1)];
        }
    }

    let cache_count = compiled.memo_slots_used;
    if cache_count != 0 {
        let mut preface: Vec<Stmt> = Vec::new();
        let cache_name = cx.synthesize_name("$");
        let loc = Loc::EMPTY;

        // Synthesized AST is never re-visited by the parser's `EIdentifier→EImportIdentifier`
        // promotion, so emit `EImportIdentifier` directly.
        let use_memo_cache = Expr::init(
            E::ImportIdentifier::new(
                cx.cg.well_known(WellKnown::UseMemoCache, b"useMemoCache"),
                true,
            ),
            loc,
        );
        let call = Expr::init(
            E::Call {
                target: use_memo_cache,
                args: AstAlloc::vec_from_iter([Expr::init(
                    E::Number::new(cache_count as f64),
                    loc,
                )]),
                ..Default::default()
            },
            loc,
        );
        let cache_ref = cx
            .cg
            .well_known(WellKnown::MemoCache, cache_name.as_bytes());
        preface.push(Stmt::alloc(
            S::Local {
                kind: S::Kind::KLet,
                decls: decl_list([G::Decl {
                    binding: Binding::alloc(cx.cg.arena, b::Identifier { r#ref: cache_ref }, loc),
                    value: Some(call),
                }]),
                ..Default::default()
            },
            loc,
        ));

        // Fast Refresh hash invalidation block — see `fast_refresh_state` above.
        let _ = fast_refresh_state;

        let mut new_body = preface;
        new_body.append(&mut compiled.body);
        compiled.body = new_body;
    }

    // Instrument forget: emit instrumentation call at the top of the function body
    if let Some(instrument_config) = cx.env.config.enable_emit_instrument_forget.as_ref() {
        if func.id.is_some() && cx.env.output_mode == crate::hir::environment::OutputMode::Client {
            let instrument_fn_local = cx.env.instrument_fn_name.unwrap_or_else(|| {
                store_str(instrument_config.fn_.import_specifier_name.as_bytes())
            });
            let target = cx.cg.ident_expr(instrument_fn_local, Loc::EMPTY);

            let gating_expr: Option<Expr> = cx
                .env
                .instrument_gating_name
                .map(|name| cx.cg.ident_expr(name, Loc::EMPTY));
            let global_gating_expr: Option<Expr> = instrument_config
                .global_gating
                .as_deref()
                .map(|g| cx.cg.ident_expr(store_str(g.as_bytes()), Loc::EMPTY));

            let if_test = match (gating_expr, global_gating_expr) {
                (Some(gating), Some(global)) => Expr::init(
                    E::Binary {
                        op: OpCode::BinLogicalAnd,
                        left: global,
                        right: gating,
                    },
                    Loc::EMPTY,
                ),
                (Some(gating), None) => gating,
                (None, Some(global)) => global,
                (None, None) => unreachable!(
                    "InstrumentationConfig requires at least one of gating or globalGating"
                ),
            };

            let fn_name_str = func.id.as_deref().unwrap_or("");
            let filename_str = cx.env.filename.as_deref().unwrap_or(b"");
            let call = Expr::init(
                E::Call {
                    target,
                    args: AstAlloc::vec_from_iter([
                        string_expr(fn_name_str, Loc::EMPTY),
                        Expr::init(
                            E::EString::init(store_str(filename_str).slice()),
                            Loc::EMPTY,
                        ),
                    ]),
                    ..Default::default()
                },
                Loc::EMPTY,
            );
            let instrument_call = Stmt::alloc(
                S::If {
                    test_: if_test,
                    yes: expr_stmt(call, Loc::EMPTY),
                    no: None,
                },
                Loc::EMPTY,
            );
            compiled.body.insert(0, instrument_call);
        }
    }

    // Process outlined functions.
    let outlined_entries = cx.env.get_outlined_functions().to_vec();
    let mut outlined: Vec<OutlinedFunction> = Vec::new();
    for entry in outlined_entries {
        let reactive_fn = build_reactive_function(&entry.func, cx.env)?;
        let mut reactive_fn_mut = reactive_fn;
        prune_unused_labels(&mut reactive_fn_mut, cx.env)?;
        prune_unused_lvalues(&mut reactive_fn_mut, cx.env);
        prune_hoisted_contexts(&mut reactive_fn_mut, cx.env)?;

        let identifiers = rename_variables(&mut reactive_fn_mut, cx.env);
        let mut outlined_cx = Context::new(cx.env, cx.cg, identifiers);
        let codegen = codegen_reactive_function(&mut outlined_cx, &reactive_fn_mut)?;
        outlined.push(OutlinedFunction {
            func: codegen,
            fn_type: entry.fn_type,
        });
    }
    compiled.outlined = outlined;

    Ok(compiled)
}

// =============================================================================
// Context
// =============================================================================

type Temporaries = IdMap<DeclarationId, Option<Expr>>;

struct Context<'a, 'h> {
    env: &'a mut Environment,
    cg: &'a mut Codegen<'h>,
    next_cache_index: u32,
    declarations: HashSet<DeclarationId>,
    temp: Temporaries,
    object_methods: IdMap<IdentifierId, (InstructionValue, Option<DiagSourceLocation>)>,
    unique_identifiers: HashSet<String>,
    synthesized_names: HashMap<&'static str, String>,
}

impl<'a, 'h> Context<'a, 'h> {
    fn new(
        env: &'a mut Environment,
        cg: &'a mut Codegen<'h>,
        unique_identifiers: HashSet<String>,
    ) -> Self {
        Context {
            env,
            cg,
            next_cache_index: 0,
            declarations: HashSet::new(),
            temp: IdMap::new(),
            object_methods: IdMap::new(),
            unique_identifiers,
            synthesized_names: HashMap::new(),
        }
    }

    fn alloc_cache_index(&mut self) -> u32 {
        let idx = self.next_cache_index;
        self.next_cache_index += 1;
        idx
    }

    fn declare(&mut self, identifier_id: IdentifierId) {
        let ident = &self.env.identifiers[identifier_id.0 as usize];
        self.declarations.insert(ident.declaration_id);
    }

    fn has_declared(&self, identifier_id: IdentifierId) -> bool {
        let ident = &self.env.identifiers[identifier_id.0 as usize];
        self.declarations.contains(&ident.declaration_id)
    }

    fn synthesize_name(&mut self, name: &'static str) -> String {
        if let Some(prev) = self.synthesized_names.get(name) {
            return prev.clone();
        }
        let mut validated = String::from(name);
        let mut index = 0u32;
        while self.unique_identifiers.contains(&validated) {
            validated.clear();
            use std::fmt::Write;
            write!(validated, "{name}{index}").unwrap();
            index += 1;
        }
        self.unique_identifiers.insert(validated.clone());
        self.synthesized_names.insert(name, validated.clone());
        validated
    }

    fn record_error(&mut self, detail: CompilerErrorDetail) -> Result<(), CompilerError> {
        self.env.record_error(detail)
    }

    fn ref_for_id(&mut self, id: IdentifierId) -> Result<Ref, CompilerError> {
        if let Some(&r) = self.cg.id_to_ref.get(id) {
            self.cg.host.record_usage(r);
            return Ok(r);
        }
        let Some(name) = &self.env.identifiers[id.0 as usize].name else {
            return Err(unnamed_identifier_err(id.0));
        };
        let (IdentifierName::Named(s) | IdentifierName::Promoted(s)) = name;
        let r = self.cg.ref_for_name(*s);
        self.cg.id_to_ref.insert(id, r);
        Ok(r)
    }
}

// =============================================================================
// Core codegen functions
// =============================================================================

fn codegen_reactive_function(
    cx: &mut Context,
    func: &ReactiveFunction,
) -> Result<CodegenFunction, CompilerError> {
    for param in &func.params {
        let place = match param {
            ParamPattern::Place(p) => p,
            ParamPattern::Spread(sp) => &sp.place,
        };
        let ident = &cx.env.identifiers[place.identifier.0 as usize];
        cx.temp.insert(ident.declaration_id, None);
        cx.declare(place.identifier);
    }

    let mut has_rest_arg = false;
    let mut params: Vec<G::Arg> = Vec::with_capacity(func.params.len());
    for p in &func.params {
        params.push(convert_parameter(cx, p, &mut has_rest_arg)?);
    }

    let mut body = codegen_block(cx, &func.body)?;

    let mut directives: Vec<Stmt> = Vec::with_capacity(func.directives.len());
    for d in &func.directives {
        directives.push(Stmt::alloc(
            S::Directive {
                value: store_str(d.as_bytes()),
            },
            Loc::EMPTY,
        ));
    }
    if !directives.is_empty() {
        directives.append(&mut body);
        body = directives;
    }

    if let Some(last) = body.last() {
        if let StmtData::SReturn(ret) = last.data {
            if ret.value.is_none() {
                body.pop();
            }
        }
    }

    let (memo_blocks, memo_values, pruned_memo_blocks, pruned_memo_values) =
        count_memo_blocks(func, cx.env);

    let id = func.id.as_ref().map(|name| {
        let r = cx.cg.ref_for_name(store_str(name.as_bytes()));
        LocRef {
            loc: convert_loc(func.loc),
            ref_: r,
        }
    });

    Ok(CodegenFunction {
        loc: func.loc,
        id,
        name_hint: func.name_hint.clone(),
        params,
        has_rest_arg,
        body,
        generator: func.generator,
        is_async: func.is_async,
        memo_slots_used: cx.next_cache_index,
        memo_blocks,
        memo_values,
        pruned_memo_blocks,
        pruned_memo_values,
        outlined: Vec::new(),
    })
}

fn convert_parameter(
    cx: &mut Context,
    param: &ParamPattern,
    has_rest: &mut bool,
) -> Result<G::Arg, CompilerError> {
    match param {
        ParamPattern::Place(place) => {
            let (r, loc) = convert_identifier(cx, place.identifier)?;
            Ok(G::Arg {
                binding: Binding::alloc(cx.cg.arena, b::Identifier { r#ref: r }, loc),
                default: None,
                ..Default::default()
            })
        }
        ParamPattern::Spread(spread) => {
            *has_rest = true;
            let (r, loc) = convert_identifier(cx, spread.place.identifier)?;
            Ok(G::Arg {
                binding: Binding::alloc(cx.cg.arena, b::Identifier { r#ref: r }, loc),
                default: None,
                ..Default::default()
            })
        }
    }
}

// =============================================================================
// Block codegen
// =============================================================================

fn codegen_block(cx: &mut Context, block: &ReactiveBlock) -> Result<Vec<Stmt>, CompilerError> {
    let temp_snapshot: Temporaries = cx.temp.clone();
    let result = codegen_block_no_reset(cx, block)?;
    cx.temp = temp_snapshot;
    Ok(result)
}

fn codegen_block_no_reset(
    cx: &mut Context,
    block: &ReactiveBlock,
) -> Result<Vec<Stmt>, CompilerError> {
    let mut statements: Vec<Stmt> = Vec::new();
    for item in block {
        match item {
            ReactiveStatement::Instruction(instr) => {
                if let Some(stmt) = codegen_instruction_nullable(cx, instr)? {
                    statements.push(stmt);
                }
            }
            ReactiveStatement::PrunedScope(PrunedReactiveScopeBlock { instructions, .. }) => {
                let scope_block = codegen_block_no_reset(cx, instructions)?;
                statements.extend(scope_block);
            }
            ReactiveStatement::Scope(ReactiveScopeBlock {
                scope,
                instructions,
            }) => {
                let temp_snapshot = cx.temp.clone();
                codegen_reactive_scope(cx, &mut statements, *scope, instructions)?;
                cx.temp = temp_snapshot;
            }
            ReactiveStatement::Terminal(term_stmt) => {
                let stmt = codegen_terminal(cx, &term_stmt.terminal)?;
                let Some(stmt) = stmt else {
                    continue;
                };
                if let Some(ref label) = term_stmt.label {
                    if !label.implicit {
                        let inner = if let StmtData::SBlock(bs) = stmt.data {
                            let body = bs.stmts.slice();
                            if body.len() == 1 { body[0] } else { stmt }
                        } else {
                            stmt
                        };
                        let label_ref = cx.cg.ref_for_label(label.id);
                        statements.push(Stmt::alloc(
                            S::Label {
                                name: LocRef {
                                    loc: Loc::EMPTY,
                                    ref_: label_ref,
                                },
                                stmt: inner,
                            },
                            Loc::EMPTY,
                        ));
                    } else if let StmtData::SBlock(bs) = stmt.data {
                        statements.extend_from_slice(bs.stmts.slice());
                    } else {
                        statements.push(stmt);
                    }
                } else if let StmtData::SBlock(bs) = stmt.data {
                    statements.extend_from_slice(bs.stmts.slice());
                } else {
                    statements.push(stmt);
                }
            }
        }
    }
    Ok(statements)
}

// =============================================================================
// Reactive scope codegen (memoization)
// =============================================================================

fn codegen_reactive_scope(
    cx: &mut Context,
    statements: &mut Vec<Stmt>,
    scope_id: ScopeId,
    block: &ReactiveBlock,
) -> Result<(), CompilerError> {
    let scope_deps = cx.env.scopes[scope_id.0 as usize].dependencies.clone();
    let scope_decls = cx.env.scopes[scope_id.0 as usize].declarations.clone();
    let scope_reassignments = cx.env.scopes[scope_id.0 as usize].reassignments.clone();
    let loc = Loc::EMPTY;

    let mut cache_store_exprs: Vec<Expr> = Vec::new();
    let mut cache_load_exprs: Vec<Expr> = Vec::new();
    let mut cache_loads: Vec<(Ref, u32, Expr)> = Vec::new();
    let mut change_exprs: Vec<Expr> = Vec::new();

    let mut deps = scope_deps;
    deps.sort_unstable_by(|a, b| compare_scope_dependency(a, b, cx.env));

    let cache_name = cx.synthesize_name("$");
    let cache_ref = cx
        .cg
        .well_known(WellKnown::MemoCache, cache_name.as_bytes());
    let cache_ident = || Expr::init_identifier(cache_ref, loc);
    let cache_slot = |index: u32| {
        Expr::init(
            E::Index {
                target: cache_ident(),
                index: Expr::init(E::Number::new(index as f64), loc),
                optional_chain: None,
            },
            loc,
        )
    };

    for dep in &deps {
        let index = cx.alloc_cache_index();
        let comparison = Expr::init(
            E::Binary {
                op: OpCode::BinStrictNe,
                left: cache_slot(index),
                right: codegen_dependency(cx, dep)?,
            },
            loc,
        );
        change_exprs.push(comparison);

        let dep_value = codegen_dependency(cx, dep)?;
        cache_store_exprs.push(Expr::init(
            E::Binary {
                op: OpCode::BinAssign,
                left: cache_slot(index),
                right: dep_value,
            },
            loc,
        ));
    }

    let mut first_output_index: Option<u32> = None;

    let mut decls = scope_decls;
    decls.sort_unstable_by(|(_a, a), (_b, b)| compare_scope_declaration(a, b, cx.env));

    let mut output_declarators: Vec<G::Decl> = Vec::new();
    for (_ident_id, decl) in &decls {
        let index = cx.alloc_cache_index();
        if first_output_index.is_none() {
            first_output_index = Some(index);
        }

        let ident = &cx.env.identifiers[decl.identifier.0 as usize];
        if ident.name.is_none() {
            return Err(invariant_err(
                &format!(
                    "Expected scope declaration identifier to be named, id={}",
                    decl.identifier.0
                ),
                None,
            ));
        }

        let (name_ref, name_loc) = convert_identifier(cx, decl.identifier)?;
        if !cx.has_declared(decl.identifier) {
            output_declarators.push(G::Decl {
                binding: Binding::alloc(cx.cg.arena, b::Identifier { r#ref: name_ref }, name_loc),
                value: None,
            });
        }
        cache_loads.push((name_ref, index, Expr::init_identifier(name_ref, name_loc)));
        cx.declare(decl.identifier);
    }
    if !output_declarators.is_empty() {
        // Synthesized body is spliced post-visitor; mangleStmts won't merge these.
        statements.push(Stmt::alloc(
            S::Local {
                kind: S::Kind::KLet,
                decls: decl_list(output_declarators),
                ..Default::default()
            },
            loc,
        ));
    }

    for reassignment_id in scope_reassignments {
        let index = cx.alloc_cache_index();
        if first_output_index.is_none() {
            first_output_index = Some(index);
        }
        let (name_ref, name_loc) = convert_identifier(cx, reassignment_id)?;
        cache_loads.push((name_ref, index, Expr::init_identifier(name_ref, name_loc)));
    }

    let test_condition = if change_exprs.is_empty() {
        let first_idx = first_output_index.ok_or_else(|| {
            invariant_err("Expected scope to have at least one declaration", None)
        })?;
        Expr::init(
            E::Binary {
                op: OpCode::BinStrictEq,
                left: cache_slot(first_idx),
                right: cx.cg.sentinel_expr(WellKnown::MemoCacheSentinel, loc),
            },
            loc,
        )
    } else {
        change_exprs
            .into_iter()
            .reduce(|acc, expr| {
                Expr::init(
                    E::Binary {
                        op: OpCode::BinLogicalOr,
                        left: acc,
                        right: expr,
                    },
                    loc,
                )
            })
            .unwrap()
    };

    let mut computation_block = codegen_block(cx, block)?;

    for (name_ref, index, value) in &cache_loads {
        cache_store_exprs.push(Expr::init(
            E::Binary {
                op: OpCode::BinAssign,
                left: cache_slot(*index),
                right: *value,
            },
            loc,
        ));
        cache_load_exprs.push(Expr::init(
            E::Binary {
                op: OpCode::BinAssign,
                left: Expr::init_identifier(*name_ref, loc),
                right: cache_slot(*index),
            },
            loc,
        ));
    }

    if !cache_store_exprs.is_empty() {
        computation_block.push(expr_stmt(comma_seq(cache_store_exprs, loc), loc));
    }

    let yes = if computation_block
        .iter()
        .all(|s| matches!(s.data, StmtData::SExpr(_)))
    {
        let exprs: Vec<Expr> = computation_block
            .into_iter()
            .map(|s| match s.data {
                StmtData::SExpr(es) => es.value,
                _ => unreachable!(),
            })
            .collect();
        if exprs.is_empty() {
            empty_stmt()
        } else {
            expr_stmt(comma_seq(exprs, loc), loc)
        }
    } else {
        block_stmt(computation_block, loc)
    };

    let no = if cache_load_exprs.is_empty() {
        None
    } else {
        Some(expr_stmt(comma_seq(cache_load_exprs, loc), loc))
    };

    let memo_stmt = Stmt::alloc(
        S::If {
            test_: test_condition,
            yes,
            no,
        },
        loc,
    );
    statements.push(memo_stmt);

    let early_return_value = cx.env.scopes[scope_id.0 as usize]
        .early_return_value
        .clone();
    if let Some(ref early_return) = early_return_value {
        let early_ident = &cx.env.identifiers[early_return.value.0 as usize];
        let Some(name) = &early_ident.name else {
            return Err(invariant_err(
                "Expected early return value to be promoted to a named variable",
                early_return.loc,
            ));
        };
        let _ = name;
        let name_expr = Expr::init_identifier(cx.ref_for_id(early_return.value)?, loc);
        statements.push(Stmt::alloc(
            S::If {
                test_: Expr::init(
                    E::Binary {
                        op: OpCode::BinStrictNe,
                        left: name_expr,
                        right: cx.cg.sentinel_expr(WellKnown::EarlyReturnSentinel, loc),
                    },
                    loc,
                ),
                yes: Stmt::alloc(
                    S::Return {
                        value: Some(name_expr),
                    },
                    loc,
                ),
                no: None,
            },
            loc,
        ));
    }

    Ok(())
}

// =============================================================================
// Terminal codegen
// =============================================================================

fn codegen_terminal(
    cx: &mut Context,
    terminal: &ReactiveTerminal,
) -> Result<Option<Stmt>, CompilerError> {
    match terminal {
        ReactiveTerminal::Break {
            target,
            target_kind,
            loc,
            ..
        } => {
            if *target_kind == ReactiveTerminalTargetKind::Implicit {
                return Ok(None);
            }
            let label = if *target_kind == ReactiveTerminalTargetKind::Labeled {
                let r = cx.cg.ref_for_label(*target);
                Some(LocRef {
                    loc: Loc::EMPTY,
                    ref_: r,
                })
            } else {
                None
            };
            Ok(Some(Stmt::alloc(S::Break { label }, convert_loc(*loc))))
        }
        ReactiveTerminal::Continue {
            target,
            target_kind,
            loc,
            ..
        } => {
            if *target_kind == ReactiveTerminalTargetKind::Implicit {
                return Ok(None);
            }
            let label = if *target_kind == ReactiveTerminalTargetKind::Labeled {
                let r = cx.cg.ref_for_label(*target);
                Some(LocRef {
                    loc: Loc::EMPTY,
                    ref_: r,
                })
            } else {
                None
            };
            Ok(Some(Stmt::alloc(S::Continue { label }, convert_loc(*loc))))
        }
        ReactiveTerminal::Return { value, loc, .. } => {
            let expr = codegen_place_to_expression(cx, value)?;
            let stmt_loc = convert_loc(*loc);
            if matches!(expr.data, ExprData::EUndefined(_)) {
                return Ok(Some(Stmt::alloc(S::Return { value: None }, stmt_loc)));
            }
            Ok(Some(Stmt::alloc(S::Return { value: Some(expr) }, stmt_loc)))
        }
        ReactiveTerminal::Throw { value, loc, .. } => {
            let expr = codegen_place_to_expression(cx, value)?;
            Ok(Some(Stmt::alloc(
                S::Throw { value: expr },
                convert_loc(*loc),
            )))
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            loc,
            ..
        } => {
            let test_expr = codegen_place_to_expression(cx, test)?;
            let stmt_loc = convert_loc(*loc);
            let consequent_block = codegen_block(cx, consequent)?;
            let alternate_stmt = if let Some(alt) = alternate {
                let mut block = codegen_block(cx, alt)?;
                if block.is_empty() {
                    None
                } else if block.len() == 1 && matches!(block[0].data, StmtData::SIf(_)) {
                    Some(block.pop().unwrap())
                } else {
                    Some(body_stmt(block, stmt_loc))
                }
            } else {
                None
            };
            Ok(Some(Stmt::alloc(
                S::If {
                    test_: test_expr,
                    yes: body_stmt(consequent_block, stmt_loc),
                    no: alternate_stmt,
                },
                stmt_loc,
            )))
        }
        ReactiveTerminal::Switch {
            test, cases, loc, ..
        } => {
            let test_expr = codegen_place_to_expression(cx, test)?;
            let stmt_loc = convert_loc(*loc);
            let mut switch_cases: AstVec<Case> = AstAlloc::vec_with_capacity(cases.len());
            for case in cases {
                let test = case
                    .test
                    .as_ref()
                    .map(|t| codegen_place_to_expression(cx, t))
                    .transpose()?;
                let block = case
                    .block
                    .as_ref()
                    .map(|b| codegen_block(cx, b))
                    .transpose()?;
                let consequent = match block {
                    Some(b) if b.is_empty() => StmtNodeList::EMPTY,
                    Some(b) => leak_stmts(vec![block_stmt(b, stmt_loc)]),
                    None => StmtNodeList::EMPTY,
                };
                switch_cases.push(Case {
                    loc: stmt_loc,
                    value: test,
                    body: consequent,
                });
            }
            Ok(Some(Stmt::alloc(
                S::Switch {
                    test_: test_expr,
                    body_loc: stmt_loc,
                    cases: StoreSlice::new_mut(switch_cases.leak()),
                },
                stmt_loc,
            )))
        }
        ReactiveTerminal::DoWhile {
            loop_block,
            test,
            loc,
            ..
        } => {
            let test_expr = codegen_instruction_value_to_expression(cx, test)?;
            let stmt_loc = convert_loc(*loc);
            let body = codegen_block(cx, loop_block)?;
            Ok(Some(Stmt::alloc(
                S::DoWhile {
                    body: body_stmt(body, stmt_loc),
                    test_: test_expr,
                },
                stmt_loc,
            )))
        }
        ReactiveTerminal::While {
            test,
            loop_block,
            loc,
            ..
        } => {
            let test_expr = codegen_instruction_value_to_expression(cx, test)?;
            let stmt_loc = convert_loc(*loc);
            let body = codegen_block(cx, loop_block)?;
            Ok(Some(Stmt::alloc(
                S::While {
                    test_: test_expr,
                    body: body_stmt(body, stmt_loc),
                },
                stmt_loc,
            )))
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_block,
            loc,
            ..
        } => {
            let init_val = codegen_for_init(cx, init)?;
            let test_expr = codegen_instruction_value_to_expression(cx, test)?;
            let update_expr = update
                .as_ref()
                .map(|u| codegen_instruction_value_to_expression(cx, u))
                .transpose()?;
            let stmt_loc = convert_loc(*loc);
            let body = codegen_block(cx, loop_block)?;
            Ok(Some(Stmt::alloc(
                S::For {
                    init: init_val,
                    test_: Some(test_expr),
                    update: update_expr,
                    body: body_stmt(body, stmt_loc),
                },
                stmt_loc,
            )))
        }
        ReactiveTerminal::ForIn {
            init,
            loop_block,
            loc,
            ..
        } => codegen_for_in(cx, init, loop_block, *loc),
        ReactiveTerminal::ForOf {
            init,
            test,
            loop_block,
            loc,
            ..
        } => codegen_for_of(cx, init, test, loop_block, *loc),
        ReactiveTerminal::Label { block, .. } => {
            let body = codegen_block(cx, block)?;
            Ok(Some(block_stmt(body, Loc::EMPTY)))
        }
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            loc,
            ..
        } => {
            let stmt_loc = convert_loc(*loc);
            let catch_param = match handler_binding.as_ref() {
                Some(binding) => {
                    let ident = &cx.env.identifiers[binding.identifier.0 as usize];
                    cx.temp.insert(ident.declaration_id, None);
                    let (r, l) = convert_identifier(cx, binding.identifier)?;
                    Some(Binding::alloc(cx.cg.arena, b::Identifier { r#ref: r }, l))
                }
                None => None,
            };
            let try_block = codegen_block(cx, block)?;
            let handler_block = codegen_block(cx, handler)?;
            Ok(Some(Stmt::alloc(
                S::Try {
                    body_loc: stmt_loc,
                    body: leak_stmts(try_block),
                    catch_: Some(Catch {
                        loc: stmt_loc,
                        binding: catch_param,
                        body: leak_stmts(handler_block),
                        body_loc: stmt_loc,
                    }),
                    finally: None,
                },
                stmt_loc,
            )))
        }
    }
}

fn codegen_for_in(
    cx: &mut Context,
    init: &ReactiveValue,
    loop_block: &ReactiveBlock,
    loc: Option<DiagSourceLocation>,
) -> Result<Option<Stmt>, CompilerError> {
    let ReactiveValue::SequenceExpression { instructions, .. } = init else {
        return Err(invariant_err(
            "Expected a sequence expression init for for..in",
            None,
        ));
    };
    if instructions.len() != 2 {
        cx.record_error(CompilerErrorDetail {
            category: ErrorCategory::Todo,
            reason: "Support non-trivial for..in inits".to_string(),
            description: None,
            loc,
            suggestions: None,
        })?;
        return Ok(Some(empty_stmt()));
    }
    let iterable_collection = &instructions[0];
    let iterable_item = &instructions[1];
    let instr_value = get_instruction_value(&iterable_item.value)?;
    let (lval, var_decl_kind) = extract_for_in_of_lval(cx, instr_value, "for..in", loc)?;
    let right = codegen_instruction_value_to_expression(cx, &iterable_collection.value)?;
    let stmt_loc = convert_loc(loc);
    let body = codegen_block(cx, loop_block)?;
    Ok(Some(Stmt::alloc(
        S::ForIn {
            init: Stmt::alloc(
                S::Local {
                    kind: var_decl_kind,
                    decls: decl_list([G::Decl {
                        binding: lval,
                        value: None,
                    }]),
                    ..Default::default()
                },
                stmt_loc,
            ),
            value: right,
            body: body_stmt(body, stmt_loc),
        },
        stmt_loc,
    )))
}

fn codegen_for_of(
    cx: &mut Context,
    init: &ReactiveValue,
    test: &ReactiveValue,
    loop_block: &ReactiveBlock,
    loc: Option<DiagSourceLocation>,
) -> Result<Option<Stmt>, CompilerError> {
    let ReactiveValue::SequenceExpression {
        instructions: init_instrs,
        ..
    } = init
    else {
        return Err(invariant_err(
            "Expected a sequence expression init for for..of",
            None,
        ));
    };
    if init_instrs.len() != 1 {
        return Err(invariant_err(
            "Expected a single-expression sequence expression init for for..of",
            None,
        ));
    }
    let get_iter_value = get_instruction_value(&init_instrs[0].value)?;
    let InstructionValue::GetIterator { collection, .. } = get_iter_value else {
        return Err(invariant_err("Expected GetIterator in for..of init", None));
    };

    let ReactiveValue::SequenceExpression {
        instructions: test_instrs,
        ..
    } = test
    else {
        return Err(invariant_err(
            "Expected a sequence expression test for for..of",
            None,
        ));
    };
    if test_instrs.len() != 2 {
        cx.record_error(CompilerErrorDetail {
            category: ErrorCategory::Todo,
            reason: "Support non-trivial for..of inits".to_string(),
            description: None,
            loc,
            suggestions: None,
        })?;
        return Ok(Some(empty_stmt()));
    }
    let iterable_item = &test_instrs[1];
    let instr_value = get_instruction_value(&iterable_item.value)?;
    let (lval, var_decl_kind) = extract_for_in_of_lval(cx, instr_value, "for..of", loc)?;

    let right = codegen_place_to_expression(cx, collection)?;
    let stmt_loc = convert_loc(loc);
    let body = codegen_block(cx, loop_block)?;
    Ok(Some(Stmt::alloc(
        S::ForOf {
            is_await: false,
            init: Stmt::alloc(
                S::Local {
                    kind: var_decl_kind,
                    decls: decl_list([G::Decl {
                        binding: lval,
                        value: None,
                    }]),
                    ..Default::default()
                },
                stmt_loc,
            ),
            value: right,
            body: body_stmt(body, stmt_loc),
        },
        stmt_loc,
    )))
}

fn extract_for_in_of_lval(
    cx: &mut Context,
    instr_value: &InstructionValue,
    context_name: &str,
    loc: Option<DiagSourceLocation>,
) -> Result<(Binding, S::Kind), CompilerError> {
    let (lval, kind) = match instr_value {
        InstructionValue::StoreLocal { lvalue, .. } => (
            codegen_lvalue(cx, &LvalueRef::Place(&lvalue.place))?,
            lvalue.kind,
        ),
        InstructionValue::Destructure { lvalue, .. } => (
            codegen_lvalue(cx, &LvalueRef::Pattern(&lvalue.pattern))?,
            lvalue.kind,
        ),
        InstructionValue::StoreContext { .. } => {
            cx.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: format!("Support non-trivial {context_name} inits"),
                description: None,
                loc,
                suggestions: None,
            })?;
            let r = cx.cg.well_known(WellKnown::Underscore, b"_");
            return Ok((
                Binding::alloc(cx.cg.arena, b::Identifier { r#ref: r }, Loc::EMPTY),
                S::Kind::KLet,
            ));
        }
        _ => {
            return Err(invariant_err(
                &format!(
                    "Expected a StoreLocal or Destructure in {context_name} collection, found {:?}",
                    std::mem::discriminant(instr_value)
                ),
                None,
            ));
        }
    };
    let var_decl_kind = match kind {
        InstructionKind::Const => S::Kind::KConst,
        InstructionKind::Let => S::Kind::KLet,
        _ => {
            return Err(invariant_err(
                &format!("Unexpected {kind:?} variable in {context_name} collection"),
                None,
            ));
        }
    };
    Ok((lval, var_decl_kind))
}

fn codegen_for_init(cx: &mut Context, init: &ReactiveValue) -> Result<Option<Stmt>, CompilerError> {
    if let ReactiveValue::SequenceExpression { instructions, .. } = init {
        let block_items: Vec<ReactiveStatement> = instructions
            .iter()
            .map(|i| ReactiveStatement::Instruction(i.clone()))
            .collect();
        let body = codegen_block(cx, &block_items)?;
        let mut declarators: G::DeclList = AstAlloc::vec();
        let mut kind = S::Kind::KConst;
        for instr in body {
            if let StmtData::SExpr(expr_stmt) = instr.data {
                if let ExprData::EBinary(assign) = expr_stmt.value.data {
                    if assign.op == OpCode::BinAssign {
                        if let ExprData::EIdentifier(left_ident) = assign.left.data {
                            if let Some(top) = declarators.last_mut() {
                                if let b::B::BIdentifier(top_ident) = top.binding.data {
                                    if top_ident.r#ref == left_ident.ref_ && top.value.is_none() {
                                        top.value = Some(assign.right);
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let StmtData::SLocal(var_decl) = instr.data {
                match var_decl.kind {
                    S::Kind::KLet | S::Kind::KConst => {}
                    _ => {
                        return Err(invariant_err(
                            "Expected a let or const variable declaration",
                            None,
                        ));
                    }
                }
                if matches!(var_decl.kind, S::Kind::KLet) {
                    kind = S::Kind::KLet;
                }
                for d in var_decl.decls.iter() {
                    declarators.push(G::Decl {
                        binding: d.binding,
                        value: d.value,
                    });
                }
            } else {
                return Err(for_init_decl_err(<&str>::from(instr.data.tag())));
            }
        }
        if declarators.is_empty() {
            return Err(invariant_err(
                "Expected a variable declaration in for-init",
                None,
            ));
        }
        Ok(Some(Stmt::alloc(
            S::Local {
                kind,
                decls: declarators,
                ..Default::default()
            },
            Loc::EMPTY,
        )))
    } else {
        let expr = codegen_instruction_value_to_expression(cx, init)?;
        Ok(Some(expr_stmt(expr, expr.loc)))
    }
}

// =============================================================================
// Instruction codegen
// =============================================================================

fn codegen_instruction_nullable(
    cx: &mut Context,
    instr: &ReactiveInstruction,
) -> Result<Option<Stmt>, CompilerError> {
    if let ReactiveValue::Instruction(ref value) = instr.value {
        match value {
            InstructionValue::StoreLocal { .. }
            | InstructionValue::StoreContext { .. }
            | InstructionValue::Destructure { .. }
            | InstructionValue::DeclareLocal { .. }
            | InstructionValue::DeclareContext { .. } => {
                return codegen_store_or_declare(cx, instr, value);
            }
            InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => {
                return Ok(None);
            }
            InstructionValue::Debugger { .. } => {
                return Ok(Some(Stmt {
                    loc: convert_loc(instr.loc),
                    data: StmtData::SDebugger(S::Debugger {
                        break_on_first_line: false,
                    }),
                }));
            }
            InstructionValue::UnsupportedNode { node_type, loc, .. } => {
                // Bun's lowering bails before serializing unsupported nodes; if
                // one reaches codegen, surface it instead of trying to round-
                // trip a Babel JSON blob through `bun_ast`.
                cx.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: format!(
                        "(CodegenReactiveFunction) UnsupportedNode {} reached codegen",
                        node_type.as_deref().unwrap_or("unknown")
                    ),
                    description: None,
                    loc: *loc,
                    suggestions: None,
                })?;
                return Ok(None);
            }
            InstructionValue::ObjectMethod { loc, .. } => {
                invariant(
                    instr.lvalue.is_some(),
                    "Expected object methods to have a temp lvalue",
                    None,
                )?;
                let lvalue = instr.lvalue.as_ref().unwrap();
                cx.object_methods
                    .insert(lvalue.identifier, (value.clone(), *loc));
                return Ok(None);
            }
            _ => {}
        }
    }
    let expr_value = codegen_instruction_value(cx, &instr.value)?;
    let stmt = codegen_instruction(cx, instr, expr_value)?;
    if matches!(stmt.data, StmtData::SEmpty(_)) {
        Ok(None)
    } else {
        Ok(Some(stmt))
    }
}

fn codegen_store_or_declare(
    cx: &mut Context,
    instr: &ReactiveInstruction,
    value: &InstructionValue,
) -> Result<Option<Stmt>, CompilerError> {
    match value {
        InstructionValue::StoreLocal {
            lvalue, value: val, ..
        } => {
            let mut kind = lvalue.kind;
            if cx.has_declared(lvalue.place.identifier) {
                kind = InstructionKind::Reassign;
            }
            let rhs = codegen_place_to_expression(cx, val)?;
            emit_store(cx, instr, kind, &LvalueRef::Place(&lvalue.place), Some(rhs))
        }
        InstructionValue::StoreContext {
            lvalue, value: val, ..
        } => {
            let rhs = codegen_place_to_expression(cx, val)?;
            emit_store(
                cx,
                instr,
                lvalue.kind,
                &LvalueRef::Place(&lvalue.place),
                Some(rhs),
            )
        }
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::DeclareContext { lvalue, .. } => {
            if cx.has_declared(lvalue.place.identifier) {
                return Ok(None);
            }
            emit_store(
                cx,
                instr,
                lvalue.kind,
                &LvalueRef::Place(&lvalue.place),
                None,
            )
        }
        InstructionValue::Destructure {
            lvalue, value: val, ..
        } => {
            let kind = lvalue.kind;
            for place in crate::hir::visitors::each_pattern_operand(&lvalue.pattern) {
                let ident = &cx.env.identifiers[place.identifier.0 as usize];
                if kind != InstructionKind::Reassign && ident.name.is_none() {
                    cx.temp.insert(ident.declaration_id, None);
                }
            }
            let rhs = codegen_place_to_expression(cx, val)?;
            emit_store(
                cx,
                instr,
                kind,
                &LvalueRef::Pattern(&lvalue.pattern),
                Some(rhs),
            )
        }
        _ => unreachable!(),
    }
}

fn emit_store(
    cx: &mut Context,
    instr: &ReactiveInstruction,
    kind: InstructionKind,
    lvalue: &LvalueRef,
    value: Option<Expr>,
) -> Result<Option<Stmt>, CompilerError> {
    let stmt_loc = convert_loc(instr.loc);
    match kind {
        InstructionKind::Const => {
            if instr.lvalue.is_some() {
                return Err(invariant_err_with_detail_message(
                    "Const declaration cannot be referenced as an expression",
                    "this is Const",
                    instr.loc,
                ));
            }
            let lval = codegen_lvalue(cx, lvalue)?;
            Ok(Some(Stmt::alloc(
                S::Local {
                    kind: S::Kind::KLet,
                    decls: decl_list([G::Decl {
                        binding: lval,
                        value,
                    }]),
                    ..Default::default()
                },
                stmt_loc,
            )))
        }
        InstructionKind::Function => {
            let lval = codegen_lvalue(cx, lvalue)?;
            let b::B::BIdentifier(fn_id) = lval.data else {
                return Err(invariant_err(
                    "Expected an identifier as function declaration lvalue",
                    None,
                ));
            };
            let Some(rhs) = value else {
                return Err(invariant_err(
                    "Expected a function value for function declaration",
                    None,
                ));
            };
            match rhs.data {
                ExprData::EFunction(func_expr) => {
                    let mut func: G::Fn = G::Fn {
                        name: Some(LocRef {
                            loc: lval.loc,
                            ref_: fn_id.r#ref,
                        }),
                        open_parens_loc: stmt_loc,
                        args: func_expr.func.args,
                        body: G::FnBody {
                            loc: func_expr.func.body.loc,
                            stmts: func_expr.func.body.stmts,
                        },
                        flags: func_expr.func.flags,
                        ..Default::default()
                    };
                    func.flags &= !flags::FunctionSet::from(flags::Function::IsExport);
                    Ok(Some(Stmt::alloc(S::Function { func }, stmt_loc)))
                }
                _ => Err(invariant_err(
                    "Expected a function expression for function declaration",
                    None,
                )),
            }
        }
        InstructionKind::Let => {
            if instr.lvalue.is_some() {
                return Err(invariant_err_with_detail_message(
                    "Const declaration cannot be referenced as an expression",
                    "this is Let",
                    instr.loc,
                ));
            }
            let lval = codegen_lvalue(cx, lvalue)?;
            Ok(Some(Stmt::alloc(
                S::Local {
                    kind: S::Kind::KLet,
                    decls: decl_list([G::Decl {
                        binding: lval,
                        value,
                    }]),
                    ..Default::default()
                },
                stmt_loc,
            )))
        }
        InstructionKind::Reassign => {
            let Some(rhs) = value else {
                return Err(invariant_err("Expected a value for reassignment", None));
            };
            let lval = codegen_assignment_target(cx, lvalue)?;
            let expr = Expr::init(
                E::Binary {
                    op: OpCode::BinAssign,
                    left: lval,
                    right: rhs,
                },
                stmt_loc,
            );
            if let Some(ref lvalue_place) = instr.lvalue {
                let is_store_context = matches!(
                    &instr.value,
                    ReactiveValue::Instruction(InstructionValue::StoreContext { .. })
                );
                if !is_store_context {
                    let ident = &cx.env.identifiers[lvalue_place.identifier.0 as usize];
                    cx.temp.insert(ident.declaration_id, Some(expr));
                    return Ok(None);
                } else {
                    let stmt = codegen_instruction(cx, instr, expr)?;
                    if matches!(stmt.data, StmtData::SEmpty(_)) {
                        return Ok(None);
                    }
                    return Ok(Some(stmt));
                }
            }
            Ok(Some(expr_stmt(expr, stmt_loc)))
        }
        InstructionKind::Catch => Ok(Some(empty_stmt())),
        InstructionKind::HoistedLet
        | InstructionKind::HoistedConst
        | InstructionKind::HoistedFunction => Err(invariant_err(
            &format!("Expected {kind:?} to have been pruned in PruneHoistedContexts"),
            None,
        )),
    }
}

fn codegen_instruction(
    cx: &mut Context,
    instr: &ReactiveInstruction,
    value: Expr,
) -> Result<Stmt, CompilerError> {
    let stmt_loc = convert_loc(instr.loc);
    let Some(ref lvalue) = instr.lvalue else {
        return Ok(expr_stmt(value, stmt_loc));
    };
    let ident = &cx.env.identifiers[lvalue.identifier.0 as usize];
    if ident.name.is_none() {
        cx.temp.insert(ident.declaration_id, Some(value));
        return Ok(empty_stmt());
    }
    let (r, l) = convert_identifier(cx, lvalue.identifier)?;
    if cx.has_declared(lvalue.identifier) {
        Ok(expr_stmt(
            Expr::init(
                E::Binary {
                    op: OpCode::BinAssign,
                    left: Expr::init_identifier(r, l),
                    right: value,
                },
                stmt_loc,
            ),
            stmt_loc,
        ))
    } else {
        Ok(Stmt::alloc(
            S::Local {
                kind: S::Kind::KConst,
                decls: decl_list([G::Decl {
                    binding: Binding::alloc(cx.cg.arena, b::Identifier { r#ref: r }, l),
                    value: Some(value),
                }]),
                ..Default::default()
            },
            stmt_loc,
        ))
    }
}

// =============================================================================
// Instruction value codegen
// =============================================================================

fn codegen_instruction_value_to_expression(
    cx: &mut Context,
    instr_value: &ReactiveValue,
) -> Result<Expr, CompilerError> {
    codegen_instruction_value(cx, instr_value)
}

fn codegen_instruction_value(
    cx: &mut Context,
    instr_value: &ReactiveValue,
) -> Result<Expr, CompilerError> {
    match instr_value {
        ReactiveValue::Instruction(iv) => {
            let mut result = codegen_base_instruction_value(cx, iv)?;
            if let Some(loc) = iv.loc() {
                result.loc = convert_loc(Some(*loc));
            }
            Ok(result)
        }
        ReactiveValue::LogicalExpression {
            operator,
            left,
            right,
            ..
        } => {
            let left_expr = codegen_instruction_value_to_expression(cx, left)?;
            let right_expr = codegen_instruction_value_to_expression(cx, right)?;
            Ok(Expr::init(
                E::Binary {
                    op: convert_logical_operator(*operator),
                    left: left_expr,
                    right: right_expr,
                },
                Loc::EMPTY,
            ))
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            let test_expr = codegen_instruction_value_to_expression(cx, test)?;
            let cons_expr = codegen_instruction_value_to_expression(cx, consequent)?;
            let alt_expr = codegen_instruction_value_to_expression(cx, alternate)?;
            Ok(Expr::init(
                E::If {
                    test_: test_expr,
                    yes: cons_expr,
                    no: alt_expr,
                },
                Loc::EMPTY,
            ))
        }
        ReactiveValue::SequenceExpression {
            instructions,
            value,
            ..
        } => {
            let block_items: Vec<ReactiveStatement> = instructions
                .iter()
                .map(|i| ReactiveStatement::Instruction(i.clone()))
                .collect();
            let body = codegen_block_no_reset(cx, &block_items)?;
            let mut expressions: Vec<Expr> = Vec::new();
            for stmt in body {
                match stmt.data {
                    StmtData::SExpr(es) => {
                        expressions.push(es.value);
                    }
                    StmtData::SLocal(_) => {
                        cx.record_error(CompilerErrorDetail {
                            category: ErrorCategory::Todo,
                            reason: "(CodegenReactiveFunction::codegenInstructionValue) Cannot declare variables in a value block".to_string(),
                            description: None,
                            loc: None,
                            suggestions: None,
                        })?;
                        expressions.push(string_expr("TODO handle declaration", Loc::EMPTY));
                    }
                    _ => {
                        cx.record_error(CompilerErrorDetail {
                            category: ErrorCategory::Todo,
                            reason: "(CodegenReactiveFunction::codegenInstructionValue) Handle conversion of statement to expression".to_string(),
                            description: None,
                            loc: None,
                            suggestions: None,
                        })?;
                        expressions.push(string_expr("TODO handle statement", Loc::EMPTY));
                    }
                }
            }
            let final_expr = codegen_instruction_value_to_expression(cx, value)?;
            if expressions.is_empty() {
                Ok(final_expr)
            } else {
                expressions.push(final_expr);
                let mut it = expressions.into_iter();
                let first = it.next().unwrap();
                Ok(it.fold(first, |acc, next| {
                    Expr::init(
                        E::Binary {
                            op: OpCode::BinComma,
                            left: acc,
                            right: next,
                        },
                        Loc::EMPTY,
                    )
                }))
            }
        }
        ReactiveValue::OptionalExpression {
            value, optional, ..
        } => {
            let opt_value = codegen_instruction_value_to_expression(cx, value)?;
            let chain = Some(if *optional {
                OptionalChain::Start
            } else {
                OptionalChain::Continuation
            });
            match opt_value.data {
                ExprData::ECall(mut c) => {
                    c.optional_chain = chain;
                    Ok(opt_value)
                }
                ExprData::EDot(mut d) => {
                    d.optional_chain = chain;
                    Ok(opt_value)
                }
                ExprData::EIndex(mut i) => {
                    i.optional_chain = chain;
                    Ok(opt_value)
                }
                other => Err(invariant_err(
                    &format!(
                        "Expected optional value to resolve to call or member expression, got {:?}",
                        other.tag()
                    ),
                    None,
                )),
            }
        }
    }
}

fn codegen_base_instruction_value(
    cx: &mut Context,
    iv: &InstructionValue,
) -> Result<Expr, CompilerError> {
    let loc = convert_loc(iv.loc().copied());
    match iv {
        InstructionValue::Primitive { value, loc } => {
            Ok(codegen_primitive_value(cx, value, convert_loc(*loc)))
        }
        InstructionValue::BinaryExpression {
            operator,
            left,
            right,
            ..
        } => {
            let left_expr = codegen_place_to_expression(cx, left)?;
            let right_expr = codegen_place_to_expression(cx, right)?;
            Ok(Expr::init(
                E::Binary {
                    op: convert_binary_operator(*operator),
                    left: left_expr,
                    right: right_expr,
                },
                loc,
            ))
        }
        InstructionValue::UnaryExpression {
            operator, value, ..
        } => {
            let arg = codegen_place_to_expression(cx, value)?;
            Ok(Expr::init(
                E::Unary {
                    op: convert_unary_operator(*operator),
                    value: arg,
                    flags: E::UnaryFlags::empty(),
                },
                loc,
            ))
        }
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            codegen_place_to_expression(cx, place)
        }
        InstructionValue::LoadGlobal { binding, .. } => {
            if let NonLocalKind::BunOpaque(e) = binding.kind {
                return Ok(e);
            }
            if let NonLocalKind::ModuleLocal { name } = &binding.kind {
                if binding.ref_().is_none() && name.slice() == b"$rc_early" {
                    return Ok(cx.cg.sentinel_expr(WellKnown::EarlyReturnSentinel, loc));
                }
            }
            match binding.ref_() {
                Some(r) => Ok(cx.cg.ident_expr_for_ref(r, loc)),
                None => Ok(cx.cg.ident_expr(StoreStr::new(binding.name()), loc)),
            }
        }
        InstructionValue::CallExpression { callee, args, .. } => {
            let callee_expr = codegen_place_to_expression(cx, callee)?;
            let arguments = codegen_arguments(cx, args)?;
            if let ExprData::EImport(orig) = callee_expr.data {
                let mut it = arguments.into_iter();
                return Ok(Expr::init(
                    E::Import {
                        expr: it.next().unwrap_or(orig.expr),
                        options: it.next().unwrap_or(Expr::EMPTY),
                        import_record_index: orig.import_record_index,
                    },
                    loc,
                ));
            }
            let call_expr = Expr::init(
                E::Call {
                    target: callee_expr,
                    args: arguments,
                    ..Default::default()
                },
                loc,
            );
            Ok(maybe_wrap_hook_call(cx, call_expr, callee.identifier))
        }
        InstructionValue::MethodCall {
            receiver: _,
            property,
            args,
            ..
        } => {
            let member_expr = codegen_place_to_expression(cx, property)?;
            if !matches!(member_expr.data, ExprData::EDot(_) | ExprData::EIndex(_)) {
                return Err(method_call_property_err(property.loc, member_expr));
            }
            let arguments = codegen_arguments(cx, args)?;
            let call_expr = Expr::init(
                E::Call {
                    target: member_expr,
                    args: arguments,
                    ..Default::default()
                },
                loc,
            );
            Ok(maybe_wrap_hook_call(cx, call_expr, property.identifier))
        }
        InstructionValue::NewExpression { callee, args, .. } => {
            let callee_expr = codegen_place_to_expression(cx, callee)?;
            let arguments = codegen_arguments(cx, args)?;
            Ok(Expr::init(
                E::New {
                    target: callee_expr,
                    args: arguments,
                    ..Default::default()
                },
                loc,
            ))
        }
        InstructionValue::ArrayExpression { elements, .. } => {
            let mut elems: ExprNodeList = AstAlloc::vec_with_capacity(elements.len());
            for el in elements {
                match el {
                    ArrayElement::Place(place) => {
                        elems.push(codegen_place_to_expression(cx, place)?)
                    }
                    ArrayElement::Spread(spread) => {
                        let arg = codegen_place_to_expression(cx, &spread.place)?;
                        elems.push(Expr::init(E::Spread { value: arg }, loc));
                    }
                    ArrayElement::Hole => elems.push(Expr::init(E::Missing {}, loc)),
                }
            }
            Ok(Expr::init(
                E::Array {
                    items: elems,
                    ..Default::default()
                },
                loc,
            ))
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            codegen_object_expression(cx, properties, loc)
        }
        InstructionValue::PropertyLoad {
            object, property, ..
        } => {
            let obj = codegen_place_to_expression(cx, object)?;
            Ok(property_access_expr(obj, property, loc, None))
        }
        InstructionValue::PropertyStore {
            object,
            property,
            value,
            ..
        } => {
            let obj = codegen_place_to_expression(cx, object)?;
            let val = codegen_place_to_expression(cx, value)?;
            Ok(Expr::init(
                E::Binary {
                    op: OpCode::BinAssign,
                    left: property_access_expr(obj, property, loc, None),
                    right: val,
                },
                loc,
            ))
        }
        InstructionValue::PropertyDelete {
            object, property, ..
        } => {
            let obj = codegen_place_to_expression(cx, object)?;
            Ok(Expr::init(
                E::Unary {
                    op: OpCode::UnDelete,
                    value: property_access_expr(obj, property, loc, None),
                    flags: E::UnaryFlags::empty(),
                },
                loc,
            ))
        }
        InstructionValue::ComputedLoad {
            object, property, ..
        } => {
            let obj = codegen_place_to_expression(cx, object)?;
            let prop = codegen_place_to_expression(cx, property)?;
            Ok(Expr::init(
                E::Index {
                    target: obj,
                    index: prop,
                    optional_chain: None,
                },
                loc,
            ))
        }
        InstructionValue::ComputedStore {
            object,
            property,
            value,
            ..
        } => {
            let obj = codegen_place_to_expression(cx, object)?;
            let prop = codegen_place_to_expression(cx, property)?;
            let val = codegen_place_to_expression(cx, value)?;
            Ok(Expr::init(
                E::Binary {
                    op: OpCode::BinAssign,
                    left: Expr::init(
                        E::Index {
                            target: obj,
                            index: prop,
                            optional_chain: None,
                        },
                        loc,
                    ),
                    right: val,
                },
                loc,
            ))
        }
        InstructionValue::ComputedDelete {
            object, property, ..
        } => {
            let obj = codegen_place_to_expression(cx, object)?;
            let prop = codegen_place_to_expression(cx, property)?;
            Ok(Expr::init(
                E::Unary {
                    op: OpCode::UnDelete,
                    value: Expr::init(
                        E::Index {
                            target: obj,
                            index: prop,
                            optional_chain: None,
                        },
                        loc,
                    ),
                    flags: E::UnaryFlags::empty(),
                },
                loc,
            ))
        }
        InstructionValue::RegExpLiteral { pattern, flags, .. } => {
            let mut raw = Vec::with_capacity(2 + pattern.len() + flags.len());
            raw.push(b'/');
            raw.extend_from_slice(pattern.slice());
            raw.push(b'/');
            let flags_offset =
                if flags.is_empty() {
                    None
                } else {
                    Some(u16::try_from(raw.len()).map_err(|_| {
                        invariant_err("RegExp pattern exceeds u16 flags_offset", None)
                    })?)
                };
            raw.extend_from_slice(flags.slice());
            Ok(Expr::init(
                E::RegExp {
                    value: store_str(&raw),
                    flags_offset,
                },
                loc,
            ))
        }
        InstructionValue::MetaProperty { meta, property, .. } => match (*meta, *property) {
            ("import", "meta") => Ok(Expr::init(E::ImportMeta {}, loc)),
            ("new", "target") => Ok(Expr::init(
                E::NewTarget {
                    range: ast::Range { loc, len: 0 },
                },
                loc,
            )),
            (m, p) => Err(invariant_err(
                &format!("Unsupported MetaProperty {m}.{p}"),
                None,
            )),
        },
        InstructionValue::Await { value, .. } => {
            let arg = codegen_place_to_expression(cx, value)?;
            Ok(Expr::init(E::Await { value: arg }, loc))
        }
        InstructionValue::GetIterator { collection, .. } => {
            codegen_place_to_expression(cx, collection)
        }
        InstructionValue::IteratorNext { iterator, .. } => {
            codegen_place_to_expression(cx, iterator)
        }
        InstructionValue::NextPropertyOf { value, .. } => codegen_place_to_expression(cx, value),
        InstructionValue::PostfixUpdate {
            operation, lvalue, ..
        } => {
            let arg = codegen_place_to_expression(cx, lvalue)?;
            Ok(Expr::init(
                E::Unary {
                    op: convert_update_operator(*operation, false),
                    value: arg,
                    flags: E::UnaryFlags::empty(),
                },
                loc,
            ))
        }
        InstructionValue::PrefixUpdate {
            operation, lvalue, ..
        } => {
            let arg = codegen_place_to_expression(cx, lvalue)?;
            Ok(Expr::init(
                E::Unary {
                    op: convert_update_operator(*operation, true),
                    value: arg,
                    flags: E::UnaryFlags::empty(),
                },
                loc,
            ))
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            invariant(
                lvalue.kind == InstructionKind::Reassign,
                "Unexpected StoreLocal in codegenInstructionValue",
                None,
            )?;
            let lval = codegen_assignment_target(cx, &LvalueRef::Place(&lvalue.place))?;
            let rhs = codegen_place_to_expression(cx, value)?;
            Ok(Expr::init(
                E::Binary {
                    op: OpCode::BinAssign,
                    left: lval,
                    right: rhs,
                },
                loc,
            ))
        }
        InstructionValue::StoreGlobal {
            name, ref_, value, ..
        } => {
            let rhs = codegen_place_to_expression(cx, value)?;
            let left = if ref_.is_valid() {
                cx.cg.ident_expr_for_ref(*ref_, loc)
            } else {
                cx.cg.ident_expr(*name, loc)
            };
            Ok(Expr::init(
                E::Binary {
                    op: OpCode::BinAssign,
                    left,
                    right: rhs,
                },
                loc,
            ))
        }
        InstructionValue::FunctionExpression {
            name,
            name_hint,
            lowered_func,
            expr_type,
            ..
        } => codegen_function_expression(cx, name, name_hint, lowered_func, *expr_type, loc),
        InstructionValue::TaggedTemplateExpression { tag, value, .. } => {
            let tag_expr = codegen_place_to_expression(cx, tag)?;
            Ok(Expr::init(
                E::Template {
                    tag: Some(tag_expr),
                    head: E::TemplateContents::Raw(value.raw),
                    parts: StoreSlice::EMPTY,
                },
                loc,
            ))
        }
        InstructionValue::TemplateLiteral {
            subexprs, quasis, ..
        } => {
            let mut quasis_it = quasis.iter();
            let head_q = quasis_it
                .next()
                .ok_or_else(|| invariant_err("TemplateLiteral with no quasis", None))?;
            let head = template_contents(head_q);
            let mut parts: AstVec<E::TemplatePart> = AstAlloc::vec_with_capacity(subexprs.len());
            for (value, tail) in subexprs.iter().zip(quasis_it) {
                parts.push(E::TemplatePart {
                    value: codegen_place_to_expression(cx, value)?,
                    tail_loc: loc,
                    tail: template_contents(tail),
                });
            }
            Ok(Expr::init(
                E::Template {
                    tag: None,
                    head,
                    parts: StoreSlice::new_mut(parts.leak()),
                },
                loc,
            ))
        }
        InstructionValue::TypeCastExpression { value, .. } => {
            // Bun emits type-stripped output; the cast is a passthrough.
            codegen_place_to_expression(cx, value)
        }
        InstructionValue::JSXText { value, loc } => Ok(Expr::init(
            E::EString::init(value.slice()),
            convert_loc(*loc),
        )),
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            loc,
            opening_loc: _,
            closing_loc,
        } => codegen_jsx_expression(cx, tag, props, children, *loc, *closing_loc),
        InstructionValue::JsxFragment { children, .. } => {
            let mut child_elems: ExprNodeList = AstAlloc::vec_with_capacity(children.len());
            for child in children {
                child_elems.push(codegen_jsx_element(cx, child)?);
            }
            let fragment_ref = cx.cg.host.jsx_import(JsxImportKind::Fragment);
            cx.cg.host.record_usage(fragment_ref);
            let tag_value = Expr::init(E::ImportIdentifier::new(fragment_ref, true), loc);
            Ok(codegen_jsx_call(
                cx,
                tag_value,
                AstAlloc::vec(),
                child_elems,
                None,
                loc,
                loc,
            ))
        }
        InstructionValue::UnsupportedNode { node_type, .. } => {
            cx.record_error(CompilerErrorDetail {
                category: ErrorCategory::Todo,
                reason: format!(
                    "(CodegenReactiveFunction) UnsupportedNode {} reached codegen",
                    node_type.as_deref().unwrap_or("unknown")
                ),
                description: None,
                loc: iv.loc().copied(),
                suggestions: None,
            })?;
            Ok(Expr::init(E::Undefined {}, loc))
        }
        InstructionValue::StartMemoize { .. }
        | InstructionValue::FinishMemoize { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::DeclareLocal { .. }
        | InstructionValue::DeclareContext { .. }
        | InstructionValue::Destructure { .. }
        | InstructionValue::ObjectMethod { .. }
        | InstructionValue::StoreContext { .. } => Err(invariant_err(
            &format!(
                "Unexpected {:?} in codegenInstructionValue",
                std::mem::discriminant(iv)
            ),
            None,
        )),
    }
}

// =============================================================================
// Function expression codegen
// =============================================================================

fn codegen_function_expression(
    cx: &mut Context,
    name: &Option<StoreStr>,
    name_hint: &Option<StoreStr>,
    lowered_func: &crate::hir::LoweredFunction,
    expr_type: FunctionExpressionType,
    loc: Loc,
) -> Result<Expr, CompilerError> {
    let func = &cx.env.functions[lowered_func.func.0 as usize];
    let reactive_fn = build_reactive_function(func, cx.env)?;
    let mut reactive_fn_mut = reactive_fn;
    prune_unused_labels(&mut reactive_fn_mut, cx.env)?;
    prune_unused_lvalues(&mut reactive_fn_mut, cx.env);
    prune_hoisted_contexts(&mut reactive_fn_mut, cx.env)?;

    let mut inner_cx = Context::new(cx.env, cx.cg, cx.unique_identifiers.clone());
    inner_cx.temp.clone_from(&cx.temp);

    let fn_result = codegen_reactive_function(&mut inner_cx, &reactive_fn_mut)?;
    let arena = cx.cg.arena;

    let body = G::FnBody {
        loc,
        stmts: leak_stmts(fn_result.body),
    };
    let args = leak_args(fn_result.params);

    let value = match expr_type {
        FunctionExpressionType::ArrowFunctionExpression => {
            let single_return = body.stmts.len() == 1
                && reactive_fn_mut.directives.is_empty()
                && matches!(body.stmts.slice()[0].data, StmtData::SReturn(ret) if ret.value.is_some());
            Expr::init(
                E::Arrow {
                    args,
                    body,
                    is_async: fn_result.is_async,
                    has_rest_arg: fn_result.has_rest_arg,
                    prefer_expr: single_return,
                    has_react_hooks_suppression: false,
                },
                loc,
            )
        }
        _ => {
            let mut fn_flags = flags::FUNCTION_NONE;
            if fn_result.is_async {
                fn_flags |= flags::Function::IsAsync;
            }
            if fn_result.generator {
                fn_flags |= flags::Function::IsGenerator;
            }
            if fn_result.has_rest_arg {
                fn_flags |= flags::Function::HasRestArg;
            }
            let fn_name = name.as_ref().map(|n| {
                let r = cx.cg.ref_for_name(*n);
                LocRef { loc, ref_: r }
            });
            Expr::init(
                E::Function {
                    func: G::Fn {
                        name: fn_name,
                        open_parens_loc: loc,
                        args,
                        body,
                        flags: fn_flags,
                        ..Default::default()
                    },
                },
                loc,
            )
        }
    };

    if cx.env.config.enable_name_anonymous_functions && name.is_none() && name_hint.is_some() {
        let hint = name_hint.unwrap();
        let key = Expr::init(E::EString::init(hint.slice()), loc);
        let mut props: G::PropertyList = AstAlloc::vec_with_capacity(1);
        props.push(G::Property {
            kind: G::PropertyKind::Normal,
            key: Some(key),
            value: Some(value),
            ..Default::default()
        });
        let wrapped = Expr::init(
            E::Index {
                target: Expr::init(
                    E::Object {
                        properties: props,
                        ..Default::default()
                    },
                    loc,
                ),
                index: Expr::init(E::EString::init(hint.slice()), loc),
                optional_chain: None,
            },
            loc,
        );
        return Ok(wrapped);
    }
    let _ = arena;

    Ok(value)
}

// =============================================================================
// Object expression codegen
// =============================================================================

fn codegen_object_expression(
    cx: &mut Context,
    properties: &[ObjectPropertyOrSpread],
    loc: Loc,
) -> Result<Expr, CompilerError> {
    let mut ast_properties: G::PropertyList = AstAlloc::vec_with_capacity(properties.len());
    for prop in properties {
        match prop {
            ObjectPropertyOrSpread::Property(obj_prop) => {
                let key = codegen_object_property_key(cx, &obj_prop.key)?;
                let computed = matches!(obj_prop.key, ObjectPropertyKey::Computed { .. });
                match obj_prop.property_type {
                    ObjectPropertyType::Property => {
                        let value = codegen_place_to_expression(cx, &obj_prop.place)?;
                        let is_shorthand =
                            matches!(obj_prop.key, ObjectPropertyKey::Identifier { .. })
                                && matches!(
                                    (key.data, value.data),
                                    (ExprData::EString(k), ExprData::EIdentifier(_v))
                                        if name_matches_ref(cx, k.get(), value)
                                );
                        let mut prop_flags = flags::PROPERTY_NONE;
                        if computed {
                            prop_flags |= flags::Property::IsComputed;
                        }
                        if is_shorthand {
                            prop_flags |= flags::Property::WasShorthand;
                        }
                        ast_properties.push(G::Property {
                            kind: G::PropertyKind::Normal,
                            flags: prop_flags,
                            key: Some(key),
                            value: Some(value),
                            ..Default::default()
                        });
                    }
                    ObjectPropertyType::Method => {
                        let method_data = cx.object_methods.get(obj_prop.place.identifier).cloned();
                        let Some((InstructionValue::ObjectMethod { lowered_func, .. }, _)) =
                            method_data
                        else {
                            return Err(invariant_err("Expected ObjectMethod instruction", None));
                        };

                        let func = &cx.env.functions[lowered_func.func.0 as usize];
                        let reactive_fn = build_reactive_function(func, cx.env)?;
                        let mut reactive_fn_mut = reactive_fn;
                        prune_unused_labels(&mut reactive_fn_mut, cx.env)?;
                        prune_unused_lvalues(&mut reactive_fn_mut, cx.env);

                        let mut inner_cx =
                            Context::new(cx.env, cx.cg, cx.unique_identifiers.clone());
                        inner_cx.temp.clone_from(&cx.temp);

                        let fn_result = codegen_reactive_function(&mut inner_cx, &reactive_fn_mut)?;

                        let mut fn_flags = flags::FUNCTION_NONE;
                        if fn_result.is_async {
                            fn_flags |= flags::Function::IsAsync;
                        }
                        if fn_result.generator {
                            fn_flags |= flags::Function::IsGenerator;
                        }
                        if fn_result.has_rest_arg {
                            fn_flags |= flags::Function::HasRestArg;
                        }
                        let value = Expr::init(
                            E::Function {
                                func: G::Fn {
                                    name: None,
                                    open_parens_loc: loc,
                                    args: leak_args(fn_result.params),
                                    body: G::FnBody {
                                        loc,
                                        stmts: leak_stmts(fn_result.body),
                                    },
                                    flags: fn_flags,
                                    ..Default::default()
                                },
                            },
                            loc,
                        );
                        let mut prop_flags = flags::PropertySet::from(flags::Property::IsMethod);
                        if computed {
                            prop_flags |= flags::Property::IsComputed;
                        }
                        ast_properties.push(G::Property {
                            kind: G::PropertyKind::Normal,
                            flags: prop_flags,
                            key: Some(key),
                            value: Some(value),
                            ..Default::default()
                        });
                    }
                }
            }
            ObjectPropertyOrSpread::Spread(spread) => {
                let arg = codegen_place_to_expression(cx, &spread.place)?;
                ast_properties.push(G::Property {
                    kind: G::PropertyKind::Spread,
                    flags: flags::Property::IsSpread.into(),
                    value: Some(arg),
                    ..Default::default()
                });
            }
        }
    }
    Ok(Expr::init(
        E::Object {
            properties: ast_properties,
            ..Default::default()
        },
        loc,
    ))
}

fn name_matches_ref(cx: &Context, key: &E::EString, value: Expr) -> bool {
    let ExprData::EIdentifier(id) = value.data else {
        return false;
    };
    if !key.is_utf8() {
        return false;
    }
    let symbols = cx.cg.host.symbols();
    let idx = id.ref_.inner_index() as usize;
    symbols
        .get(idx)
        .is_some_and(|s| s.original_name.slice() == key.data.slice())
}

fn codegen_object_property_key(
    cx: &mut Context,
    key: &ObjectPropertyKey,
) -> Result<Expr, CompilerError> {
    match key {
        ObjectPropertyKey::String { name } => {
            Ok(Expr::init(E::EString::init(name.slice()), Loc::EMPTY))
        }
        ObjectPropertyKey::Identifier { name } => {
            Ok(Expr::init(E::EString::init(name.slice()), Loc::EMPTY))
        }
        ObjectPropertyKey::Computed { name } => codegen_place_to_expression(cx, name),
        ObjectPropertyKey::Number { name } => {
            Ok(Expr::init(E::Number::new(name.value()), Loc::EMPTY))
        }
    }
}

// =============================================================================
// JSX codegen
// =============================================================================

fn codegen_jsx_expression(
    cx: &mut Context,
    tag: &JsxTag,
    props: &[JsxAttribute],
    children: &Option<HirVec<Place>>,
    loc: Option<DiagSourceLocation>,
    closing_loc: Option<DiagSourceLocation>,
) -> Result<Expr, CompilerError> {
    let elem_loc = convert_loc(loc);
    let close_loc = convert_loc(closing_loc);

    let tag_value = match tag {
        JsxTag::Place(place) => codegen_place_to_expression(cx, place)?,
        JsxTag::Builtin(builtin) => Expr::init(
            E::EString::init(builtin.name.slice()),
            convert_loc(builtin.loc),
        ),
    };

    let mut child_nodes: ExprNodeList = AstAlloc::vec();
    if let Some(c) = children {
        child_nodes = AstAlloc::vec_with_capacity(c.len());
        for child in c {
            child_nodes.push(codegen_jsx_element(cx, child)?);
        }
    }

    let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(props.len() + 1);
    let mut key_value: Option<Expr> = None;
    for attr in props {
        if let JsxAttribute::Attribute { name, place } = attr
            && name.slice() == b"key"
        {
            key_value = Some(codegen_place_to_expression(cx, place)?);
            continue;
        }
        properties.push(codegen_jsx_attribute(cx, attr)?);
    }

    Ok(codegen_jsx_call(
        cx,
        tag_value,
        properties,
        child_nodes,
        key_value,
        elem_loc,
        close_loc,
    ))
}

/// Build the automatic-runtime `jsx(type, props, key?)` / `jsxDEV(...)` call
/// shape — mirrors `bun_js_parser::visit::visit_expr::e_jsx_element` for the
/// automatic runtime so the printer and tree-shaker see identical AST.
fn codegen_jsx_call(
    cx: &mut Context,
    tag_value: Expr,
    mut properties: G::PropertyList,
    children: ExprNodeList,
    key_value: Option<Expr>,
    loc: Loc,
    close_loc: Loc,
) -> Expr {
    let is_dev = cx.cg.host.is_jsx_dev();

    // TypeScript defines static jsx as children.len > 1 or a single spread.
    let is_static_jsx = children.len() > 1
        || (children.len() == 1 && matches!(children[0].data, ExprData::ESpread(..)));

    let children_key = string_expr("children", close_loc);
    if is_static_jsx {
        let is_single_line = children.len() < 2;
        properties.push(G::Property {
            key: Some(children_key),
            value: Some(Expr::init(
                E::Array {
                    items: children,
                    is_single_line,
                    ..Default::default()
                },
                close_loc,
            )),
            ..Default::default()
        });
    } else if children.len() == 1 {
        properties.push(G::Property {
            key: Some(children_key),
            value: Some(children[0]),
            ..Default::default()
        });
    }

    let args_len = if is_dev {
        6
    } else {
        2 + usize::from(key_value.is_some())
    };
    let mut args: ExprNodeList = AstAlloc::vec_with_capacity(args_len);
    args.push(tag_value);
    args.push(Expr::init(
        E::Object {
            properties,
            ..Default::default()
        },
        loc,
    ));

    if let Some(key) = key_value {
        args.push(key);
    } else if is_dev {
        args.push(Expr::init(E::Undefined {}, loc));
    }

    if is_dev {
        args.push(Expr::init(
            E::Boolean {
                value: is_static_jsx,
            },
            loc,
        ));
        args.push(Expr::init(E::Undefined {}, loc));
        args.push(Expr::init(E::This {}, loc));
    }

    let kind = if is_dev {
        JsxImportKind::JsxDEV
    } else if is_static_jsx {
        JsxImportKind::Jsxs
    } else {
        JsxImportKind::Jsx
    };
    let target_ref = cx.cg.host.jsx_import(kind);
    cx.cg.host.record_usage(target_ref);

    Expr::init(
        E::Call {
            target: Expr::init(E::ImportIdentifier::new(target_ref, true), loc),
            args,
            can_be_unwrapped_if_unused: E::CallUnwrap::IfUnused,
            was_jsx_element: true,
            close_paren_loc: close_loc,
            ..Default::default()
        },
        loc,
    )
}

fn codegen_jsx_attribute(
    cx: &mut Context,
    attr: &JsxAttribute,
) -> Result<G::Property, CompilerError> {
    match attr {
        JsxAttribute::Attribute { name, place } => {
            let loc = convert_loc(place.loc);
            let key = Expr::init(E::EString::init(name.slice()), loc);
            let inner_value = codegen_place_to_expression(cx, place)?;
            Ok(G::Property {
                kind: G::PropertyKind::Normal,
                key: Some(key),
                value: Some(inner_value),
                ..Default::default()
            })
        }
        JsxAttribute::SpreadAttribute { argument } => {
            let expr = codegen_place_to_expression(cx, argument)?;
            Ok(G::Property {
                kind: G::PropertyKind::Spread,
                flags: flags::Property::IsSpread.into(),
                value: Some(expr),
                ..Default::default()
            })
        }
    }
}

fn codegen_jsx_element(cx: &mut Context, place: &Place) -> Result<Expr, CompilerError> {
    codegen_place_to_expression(cx, place)
}

// =============================================================================
// Pattern codegen (lvalues)
// =============================================================================

enum LvalueRef<'a> {
    Place(&'a Place),
    Pattern(&'a Pattern),
}

fn codegen_lvalue(cx: &mut Context, pattern: &LvalueRef) -> Result<Binding, CompilerError> {
    match pattern {
        LvalueRef::Place(place) => {
            let (r, loc) = convert_identifier(cx, place.identifier)?;
            Ok(Binding::alloc(cx.cg.arena, b::Identifier { r#ref: r }, loc))
        }
        LvalueRef::Pattern(pat) => match pat {
            Pattern::Array(arr) => codegen_array_pattern(cx, arr),
            Pattern::Object(obj) => codegen_object_pattern(cx, obj),
        },
    }
}

fn codegen_assignment_target(cx: &mut Context, pattern: &LvalueRef) -> Result<Expr, CompilerError> {
    match pattern {
        LvalueRef::Place(place) => {
            let (r, loc) = convert_identifier(cx, place.identifier)?;
            Ok(Expr::init_identifier(r, loc))
        }
        LvalueRef::Pattern(pat) => match pat {
            Pattern::Array(arr) => {
                let loc = convert_loc(arr.loc);
                let mut items: ExprNodeList = AstAlloc::vec_with_capacity(arr.items.len());
                for item in &arr.items {
                    items.push(match item {
                        crate::hir::ArrayPatternElement::Place(place) => {
                            codegen_assignment_target(cx, &LvalueRef::Place(place))?
                        }
                        crate::hir::ArrayPatternElement::Spread(spread) => {
                            let inner =
                                codegen_assignment_target(cx, &LvalueRef::Place(&spread.place))?;
                            Expr::init(E::Spread { value: inner }, loc)
                        }
                        crate::hir::ArrayPatternElement::Hole => Expr::init(E::Missing {}, loc),
                    });
                }
                Ok(Expr::init(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    loc,
                ))
            }
            Pattern::Object(obj) => {
                let loc = convert_loc(obj.loc);
                let mut properties: G::PropertyList =
                    AstAlloc::vec_with_capacity(obj.properties.len());
                for prop in &obj.properties {
                    properties.push(match prop {
                        ObjectPropertyOrSpread::Property(obj_prop) => {
                            let key = codegen_object_property_key(cx, &obj_prop.key)?;
                            let value =
                                codegen_assignment_target(cx, &LvalueRef::Place(&obj_prop.place))?;
                            let mut prop_flags = flags::PROPERTY_NONE;
                            if matches!(obj_prop.key, ObjectPropertyKey::Computed { .. }) {
                                prop_flags |= flags::Property::IsComputed;
                            }
                            G::Property {
                                kind: G::PropertyKind::Normal,
                                flags: prop_flags,
                                key: Some(key),
                                value: Some(value),
                                ..Default::default()
                            }
                        }
                        ObjectPropertyOrSpread::Spread(spread) => {
                            let inner =
                                codegen_assignment_target(cx, &LvalueRef::Place(&spread.place))?;
                            // PropertyKind::Spread already makes the printer emit `...`;
                            // wrapping `inner` in E::Spread here double-prints (`......rest`).
                            // Matches codegen_object_pattern below which passes the value unwrapped.
                            G::Property {
                                kind: G::PropertyKind::Spread,
                                flags: flags::Property::IsSpread.into(),
                                value: Some(inner),
                                ..Default::default()
                            }
                        }
                    });
                }
                Ok(Expr::init(
                    E::Object {
                        properties,
                        ..Default::default()
                    },
                    loc,
                ))
            }
        },
    }
}

fn codegen_array_pattern(
    cx: &mut Context,
    pattern: &ArrayPattern,
) -> Result<Binding, CompilerError> {
    let loc = convert_loc(pattern.loc);
    let mut has_spread = false;
    let mut items: ArenaVec<ArrayBinding> =
        ArenaVec::with_capacity_in(pattern.items.len(), cx.cg.arena);
    for item in &pattern.items {
        match item {
            crate::hir::ArrayPatternElement::Place(place) => {
                items.push(ArrayBinding {
                    binding: codegen_lvalue(cx, &LvalueRef::Place(place))?,
                    default_value: None,
                });
            }
            crate::hir::ArrayPatternElement::Spread(spread) => {
                has_spread = true;
                items.push(ArrayBinding {
                    binding: codegen_lvalue(cx, &LvalueRef::Place(&spread.place))?,
                    default_value: None,
                });
            }
            crate::hir::ArrayPatternElement::Hole => {
                items.push(ArrayBinding {
                    binding: Binding {
                        loc: Loc::EMPTY,
                        data: b::B::BMissing(b::Missing {}),
                    },
                    default_value: None,
                });
            }
        }
    }
    Ok(Binding::alloc(
        cx.cg.arena,
        b::Array {
            items: StoreSlice::from_bump(items),
            has_spread,
            is_single_line: true,
        },
        loc,
    ))
}

fn codegen_object_pattern(
    cx: &mut Context,
    pattern: &ObjectPattern,
) -> Result<Binding, CompilerError> {
    let loc = convert_loc(pattern.loc);
    let mut properties: ArenaVec<b::Property> =
        ArenaVec::with_capacity_in(pattern.properties.len(), cx.cg.arena);
    for prop in &pattern.properties {
        match prop {
            ObjectPropertyOrSpread::Property(obj_prop) => {
                let key = codegen_object_property_key(cx, &obj_prop.key)?;
                let value = codegen_lvalue(cx, &LvalueRef::Place(&obj_prop.place))?;
                let mut prop_flags = flags::PropertySet::empty();
                if matches!(obj_prop.key, ObjectPropertyKey::Computed { .. }) {
                    prop_flags |= flags::Property::IsComputed;
                }
                properties.push(b::Property {
                    flags: prop_flags,
                    key,
                    value,
                    default_value: None,
                });
            }
            ObjectPropertyOrSpread::Spread(spread) => {
                let inner = codegen_lvalue(cx, &LvalueRef::Place(&spread.place))?;
                properties.push(b::Property {
                    flags: flags::Property::IsSpread.into(),
                    key: Expr::init(E::Missing {}, loc),
                    value: inner,
                    default_value: None,
                });
            }
        }
    }
    Ok(Binding::alloc(
        cx.cg.arena,
        b::Object {
            properties: StoreSlice::from_bump(properties),
            is_single_line: true,
        },
        loc,
    ))
}

// =============================================================================
// Place / identifier codegen
// =============================================================================

fn codegen_place_to_expression(cx: &mut Context, place: &Place) -> Result<Expr, CompilerError> {
    let ident = &cx.env.identifiers[place.identifier.0 as usize];
    if let Some(tmp) = cx.temp.get(ident.declaration_id) {
        if let Some(val) = tmp {
            return Ok(*val);
        }
    }
    if ident.name.is_none() && !cx.temp.contains_key(ident.declaration_id) {
        return Err(invariant_err(
            &format!(
                "[Codegen] No value found for temporary, identifier id={}",
                place.identifier.0
            ),
            place.loc,
        ));
    }
    let (r, _ident_loc) = convert_identifier(cx, place.identifier)?;
    Ok(Expr::init_identifier(r, convert_loc(place.loc)))
}

fn convert_identifier(
    cx: &mut Context,
    identifier_id: IdentifierId,
) -> Result<(Ref, Loc), CompilerError> {
    let loc = cx.env.identifiers[identifier_id.0 as usize].loc;
    Ok((cx.ref_for_id(identifier_id)?, convert_loc(loc)))
}

fn codegen_arguments(
    cx: &mut Context,
    args: &[PlaceOrSpread],
) -> Result<ExprNodeList, CompilerError> {
    let mut out: ExprNodeList = AstAlloc::vec_with_capacity(args.len());
    for arg in args {
        out.push(codegen_argument(cx, arg)?);
    }
    Ok(out)
}

fn codegen_argument(cx: &mut Context, arg: &PlaceOrSpread) -> Result<Expr, CompilerError> {
    match arg {
        PlaceOrSpread::Place(place) => codegen_place_to_expression(cx, place),
        PlaceOrSpread::Spread(spread) => {
            let expr = codegen_place_to_expression(cx, &spread.place)?;
            Ok(Expr::init(E::Spread { value: expr }, expr.loc))
        }
    }
}

// =============================================================================
// Dependency codegen
// =============================================================================

fn codegen_dependency(
    cx: &mut Context,
    dep: &crate::hir::ReactiveScopeDependency,
) -> Result<Expr, CompilerError> {
    let (r, loc) = convert_identifier(cx, dep.identifier)?;
    let mut object = Expr::init_identifier(r, loc);
    if !dep.path.is_empty() {
        let has_optional = dep.path.iter().any(|p| p.optional);
        for path_entry in &dep.path {
            let chain = if has_optional {
                Some(if path_entry.optional {
                    OptionalChain::Start
                } else {
                    OptionalChain::Continuation
                })
            } else {
                None
            };
            object = property_access_expr(object, &path_entry.property, loc, chain);
        }
    }
    Ok(object)
}

// =============================================================================
// CountMemoBlockVisitor
// =============================================================================

struct CountMemoBlockVisitor<'a> {
    env: &'a Environment,
}

struct CountMemoBlockState {
    memo_blocks: u32,
    memo_values: u32,
    pruned_memo_blocks: u32,
    pruned_memo_values: u32,
}

impl<'a> ReactiveFunctionVisitor for CountMemoBlockVisitor<'a> {
    type State = CountMemoBlockState;

    fn env(&self) -> &Environment {
        self.env
    }

    fn visit_scope(&self, scope_block: &ReactiveScopeBlock, state: &mut CountMemoBlockState) {
        state.memo_blocks += 1;
        let scope = &self.env.scopes[scope_block.scope.0 as usize];
        state.memo_values += scope.declarations.len() as u32;
        self.traverse_scope(scope_block, state);
    }

    fn visit_pruned_scope(
        &self,
        scope_block: &PrunedReactiveScopeBlock,
        state: &mut CountMemoBlockState,
    ) {
        state.pruned_memo_blocks += 1;
        let scope = &self.env.scopes[scope_block.scope.0 as usize];
        state.pruned_memo_values += scope.declarations.len() as u32;
        self.traverse_pruned_scope(scope_block, state);
    }
}

fn count_memo_blocks(func: &ReactiveFunction, env: &Environment) -> (u32, u32, u32, u32) {
    let visitor = CountMemoBlockVisitor { env };
    let mut state = CountMemoBlockState {
        memo_blocks: 0,
        memo_values: 0,
        pruned_memo_blocks: 0,
        pruned_memo_values: 0,
    };
    visit_reactive_function(func, &visitor, &mut state);
    (
        state.memo_blocks,
        state.memo_values,
        state.pruned_memo_blocks,
        state.pruned_memo_values,
    )
}

// =============================================================================
// Operator conversions
// =============================================================================

fn convert_binary_operator(op: crate::hir::BinaryOperator) -> OpCode {
    use crate::hir::BinaryOperator as B;
    match op {
        B::Equal => OpCode::BinLooseEq,
        B::NotEqual => OpCode::BinLooseNe,
        B::StrictEqual => OpCode::BinStrictEq,
        B::StrictNotEqual => OpCode::BinStrictNe,
        B::LessThan => OpCode::BinLt,
        B::LessEqual => OpCode::BinLe,
        B::GreaterThan => OpCode::BinGt,
        B::GreaterEqual => OpCode::BinGe,
        B::ShiftLeft => OpCode::BinShl,
        B::ShiftRight => OpCode::BinShr,
        B::UnsignedShiftRight => OpCode::BinUShr,
        B::Add => OpCode::BinAdd,
        B::Subtract => OpCode::BinSub,
        B::Multiply => OpCode::BinMul,
        B::Divide => OpCode::BinDiv,
        B::Modulo => OpCode::BinRem,
        B::Exponent => OpCode::BinPow,
        B::BitwiseOr => OpCode::BinBitwiseOr,
        B::BitwiseXor => OpCode::BinBitwiseXor,
        B::BitwiseAnd => OpCode::BinBitwiseAnd,
        B::In => OpCode::BinIn,
        B::InstanceOf => OpCode::BinInstanceof,
    }
}

fn convert_unary_operator(op: crate::hir::UnaryOperator) -> OpCode {
    use crate::hir::UnaryOperator as U;
    match op {
        U::Minus => OpCode::UnNeg,
        U::Plus => OpCode::UnPos,
        U::Not => OpCode::UnNot,
        U::BitwiseNot => OpCode::UnCpl,
        U::TypeOf => OpCode::UnTypeof,
        U::Void => OpCode::UnVoid,
    }
}

fn convert_logical_operator(op: LogicalOperator) -> OpCode {
    match op {
        LogicalOperator::And => OpCode::BinLogicalAnd,
        LogicalOperator::Or => OpCode::BinLogicalOr,
        LogicalOperator::NullishCoalescing => OpCode::BinNullishCoalescing,
    }
}

fn convert_update_operator(op: crate::hir::UpdateOperator, prefix: bool) -> OpCode {
    use crate::hir::UpdateOperator as U;
    match (op, prefix) {
        (U::Increment, true) => OpCode::UnPreInc,
        (U::Increment, false) => OpCode::UnPostInc,
        (U::Decrement, true) => OpCode::UnPreDec,
        (U::Decrement, false) => OpCode::UnPostDec,
    }
}

// =============================================================================
// Helpers
// =============================================================================

fn convert_loc(loc: Option<DiagSourceLocation>) -> Loc {
    match loc.and_then(|l| l.start.index) {
        Some(idx) => Loc { start: idx as i32 },
        None => Loc::EMPTY,
    }
}

#[inline]
fn store_str(bytes: &[u8]) -> StoreStr {
    StoreStr::new(ast::data_store_dupe_str(bytes))
}

fn estring_utf8(s: &str) -> E::EString {
    if s.is_ascii() {
        E::EString::init(store_str(s.as_bytes()).slice())
    } else {
        let units: AstVec<u16> = AstAlloc::vec_from_iter(s.encode_utf16());
        E::EString::init_utf16(units.leak())
    }
}

#[inline]
fn string_expr(s: &str, loc: Loc) -> Expr {
    Expr::init(estring_utf8(s), loc)
}

#[inline]
fn comma_seq(exprs: Vec<Expr>, loc: Loc) -> Expr {
    let mut it = exprs.into_iter();
    let first = it.next().expect("comma_seq: nonempty");
    it.fold(first, |acc, next| {
        Expr::init(
            E::Binary {
                op: OpCode::BinComma,
                left: acc,
                right: next,
            },
            loc,
        )
    })
}

#[inline]
fn expr_stmt(value: Expr, loc: Loc) -> Stmt {
    Stmt::alloc(
        S::SExpr {
            value,
            does_not_affect_tree_shaking: false,
        },
        loc,
    )
}

#[inline]
fn empty_stmt() -> Stmt {
    Stmt {
        loc: Loc::EMPTY,
        data: StmtData::SEmpty(S::Empty {}),
    }
}

fn block_stmt(body: Vec<Stmt>, loc: Loc) -> Stmt {
    Stmt::alloc(
        S::Block {
            stmts: leak_stmts(body),
            close_brace_loc: Loc::EMPTY,
        },
        loc,
    )
}

/// Unwrap only `SExpr` to avoid dangling-else and lexical-declaration-as-body.
fn body_stmt(mut body: Vec<Stmt>, loc: Loc) -> Stmt {
    if body.len() == 1 && matches!(body[0].data, StmtData::SExpr(_)) {
        return body.pop().unwrap();
    }
    block_stmt(body, loc)
}

fn leak_stmts(body: Vec<Stmt>) -> StmtNodeList {
    let v: AstVec<Stmt> = AstAlloc::vec_from_iter(body);
    StoreSlice::new_mut(v.leak())
}

fn leak_args(args: Vec<G::Arg>) -> StoreSlice<G::Arg> {
    let v: AstVec<G::Arg> = AstAlloc::vec_from_iter(args);
    StoreSlice::new_mut(v.leak())
}

fn decl_list(iter: impl IntoIterator<Item = G::Decl>) -> G::DeclList {
    AstAlloc::vec_from_iter(iter)
}

fn template_contents(q: &crate::hir::TemplateQuasi) -> E::TemplateContents {
    match q.cooked {
        Some(cooked) => E::TemplateContents::Cooked(E::EString::init(cooked.slice())),
        None => E::TemplateContents::Raw(q.raw),
    }
}

fn property_access_expr(
    target: Expr,
    prop: &PropertyLiteral,
    loc: Loc,
    optional_chain: Option<OptionalChain>,
) -> Expr {
    match prop {
        PropertyLiteral::String(s) => Expr::init(
            E::Dot {
                target,
                name: *s,
                name_loc: loc,
                optional_chain,
                ..Default::default()
            },
            loc,
        ),
        PropertyLiteral::Number(n) => Expr::init(
            E::Index {
                target,
                index: Expr::init(E::Number::new(n.value()), loc),
                optional_chain,
            },
            loc,
        ),
    }
}

fn codegen_primitive_value(cx: &mut Context, value: &PrimitiveValue, loc: Loc) -> Expr {
    match value {
        PrimitiveValue::Number(n) => {
            let f = n.value();
            if f.is_nan() {
                Expr::init_identifier(cx.cg.well_known_global(WellKnown::NaN, b"NaN"), loc)
            } else if f.is_infinite() {
                let inf = Expr::init_identifier(
                    cx.cg.well_known_global(WellKnown::Infinity, b"Infinity"),
                    loc,
                );
                if f > 0.0 {
                    inf
                } else {
                    Expr::init(
                        E::Unary {
                            op: OpCode::UnNeg,
                            value: inf,
                            flags: E::UnaryFlags::empty(),
                        },
                        loc,
                    )
                }
            } else {
                Expr::init(E::Number::new(f), loc)
            }
        }
        PrimitiveValue::Boolean(b) => Expr::init(E::Boolean { value: *b }, loc),
        PrimitiveValue::String(s) => Expr {
            data: ExprData::EString(s.as_estring()),
            loc,
        },
        PrimitiveValue::Null => Expr::init(E::Null {}, loc),
        PrimitiveValue::Undefined => Expr::init(E::Undefined {}, loc),
    }
}

fn get_instruction_value(
    reactive_value: &ReactiveValue,
) -> Result<&InstructionValue, CompilerError> {
    match reactive_value {
        ReactiveValue::Instruction(iv) => Ok(iv),
        _ => Err(invariant_err("Expected base instruction value", None)),
    }
}

fn invariant(
    condition: bool,
    reason: &str,
    loc: Option<DiagSourceLocation>,
) -> Result<(), CompilerError> {
    if !condition {
        Err(invariant_err(reason, loc))
    } else {
        Ok(())
    }
}

#[cold]
#[inline(never)]
fn invariant_err(reason: &str, loc: Option<DiagSourceLocation>) -> CompilerError {
    let mut err = CompilerError::new();
    err.push_diagnostic(
        CompilerDiagnostic::new(ErrorCategory::Invariant, reason, None::<String>).with_detail(
            CompilerDiagnosticDetail::Error {
                loc,
                message: Some(reason.to_string()),
                identifier_name: None,
            },
        ),
    );
    err
}

#[cold]
#[inline(never)]
fn invariant_err_with_detail_message(
    reason: &str,
    message: &str,
    loc: Option<DiagSourceLocation>,
) -> CompilerError {
    let mut err = CompilerError::new();
    err.push_diagnostic(
        CompilerDiagnostic::new(ErrorCategory::Invariant, reason, None::<String>).with_detail(
            CompilerDiagnosticDetail::Error {
                loc,
                message: Some(message.to_string()),
                identifier_name: None,
            },
        ),
    );
    err
}

#[cold]
#[inline(never)]
fn for_init_decl_err(tag: &str) -> CompilerError {
    let mut err = CompilerError::new();
    err.push_diagnostic(
        CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            "Expected a variable declaration".to_string(),
            Some(format!("Got {tag}")),
        )
        .with_detail(CompilerDiagnosticDetail::Error {
            loc: None,
            message: Some("Expected a variable declaration".to_string()),
            identifier_name: None,
        }),
    );
    err
}

#[cold]
#[inline(never)]
fn method_call_property_err(loc: Option<DiagSourceLocation>, member_expr: Expr) -> CompilerError {
    let mut err = CompilerError::new();
    err.push_diagnostic(
        CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            "[Codegen] Internal error: MethodCall::property must be an unpromoted + unmemoized MemberExpression",
            None,
        )
        .with_detail(CompilerDiagnosticDetail::Error {
            loc,
            message: Some(format!("Got: '{:?}'", member_expr.data.tag())),
            identifier_name: None,
        }),
    );
    err
}

#[cold]
#[inline(never)]
fn unnamed_identifier_err(id: u32) -> CompilerError {
    let reason =
        "Expected temporaries to be promoted to named identifiers in an earlier pass".to_string();
    let mut err = CompilerError::new();
    err.push_diagnostic(
        CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            reason.clone(),
            Some(format!("identifier {id} is unnamed")),
        )
        .with_detail(CompilerDiagnosticDetail::Error {
            loc: None,
            message: Some(reason),
            identifier_name: None,
        }),
    );
    err
}

fn compare_scope_dependency(
    a: &crate::hir::ReactiveScopeDependency,
    b: &crate::hir::ReactiveScopeDependency,
    env: &Environment,
) -> std::cmp::Ordering {
    dep_to_sort_key(a, env).cmp(&dep_to_sort_key(b, env))
}

fn dep_to_sort_key(dep: &crate::hir::ReactiveScopeDependency, env: &Environment) -> Vec<u8> {
    use std::io::Write;
    let mut out: Vec<u8> = Vec::with_capacity(32);
    let ident = &env.identifiers[dep.identifier.0 as usize];
    match &ident.name {
        Some(n) => out.extend_from_slice(n.value()),
        None => write!(out, "_t{}", dep.identifier.0).unwrap(),
    }
    for entry in &dep.path {
        out.push(b'.');
        if entry.optional {
            out.push(b'?');
        }
        match &entry.property {
            PropertyLiteral::String(s) => out.extend_from_slice(s.slice()),
            PropertyLiteral::Number(n) => write!(out, "{n}").unwrap(),
        }
    }
    out
}

fn compare_scope_declaration(
    a: &crate::hir::ReactiveScopeDeclaration,
    b: &crate::hir::ReactiveScopeDeclaration,
    env: &Environment,
) -> std::cmp::Ordering {
    let mut buf_a = [0u8; 24];
    let mut buf_b = [0u8; 24];
    let ka = ident_sort_key(a.identifier, env, &mut buf_a);
    let kb = ident_sort_key(b.identifier, env, &mut buf_b);
    ka.cmp(kb)
}

fn ident_sort_key<'a>(id: IdentifierId, env: &'a Environment, buf: &'a mut [u8; 24]) -> &'a [u8] {
    let ident = &env.identifiers[id.0 as usize];
    match &ident.name {
        Some(n) => n.value(),
        None => {
            use std::io::Write;
            let mut cursor = std::io::Cursor::new(&mut buf[..]);
            write!(cursor, "_t{}", id.0).unwrap();
            let len = cursor.position() as usize;
            &buf[..len]
        }
    }
}

fn maybe_wrap_hook_call(cx: &mut Context, call_expr: Expr, callee_id: IdentifierId) -> Expr {
    if let Some(hook_guard_name) = cx.env.hook_guard_name {
        if cx.env.output_mode == crate::hir::environment::OutputMode::Client
            && is_hook_identifier(cx, callee_id)
        {
            let guard_ref = cx.cg.ref_for_name(hook_guard_name);
            return wrap_hook_call_with_guard(guard_ref, call_expr, 2, 3);
        }
    }
    call_expr
}

fn is_hook_identifier(cx: &Context, identifier_id: IdentifierId) -> bool {
    let identifier = &cx.env.identifiers[identifier_id.0 as usize];
    let type_ = &cx.env.types[identifier.type_.0 as usize];
    cx.env
        .get_hook_kind_for_type(type_)
        .ok()
        .flatten()
        .is_some()
}

fn wrap_hook_call_with_guard(guard_ref: Ref, call_expr: Expr, before: u32, after: u32) -> Expr {
    let loc = Loc::EMPTY;
    let guard_call = |kind: u32| -> Stmt {
        expr_stmt(
            Expr::init(
                E::Call {
                    target: Expr::init_identifier(guard_ref, loc),
                    args: AstAlloc::vec_from_iter([Expr::init(E::Number::new(kind as f64), loc)]),
                    ..Default::default()
                },
                loc,
            ),
            loc,
        )
    };

    let try_stmt = Stmt::alloc(
        S::Try {
            body_loc: loc,
            body: leak_stmts(vec![
                guard_call(before),
                Stmt::alloc(
                    S::Return {
                        value: Some(call_expr),
                    },
                    loc,
                ),
            ]),
            catch_: None,
            finally: Some(Finally {
                loc,
                stmts: leak_stmts(vec![guard_call(after)]),
            }),
        },
        loc,
    );

    let iife = Expr::init(
        E::Function {
            func: G::Fn {
                body: G::FnBody {
                    loc,
                    stmts: leak_stmts(vec![try_stmt]),
                },
                ..Default::default()
            },
        },
        loc,
    );

    Expr::init(
        E::Call {
            target: iife,
            args: AstAlloc::vec(),
            ..Default::default()
        },
        loc,
    )
}

fn create_function_body_hook_guard(
    guard_ref: Ref,
    body_stmts: Vec<Stmt>,
    before: u32,
    after: u32,
) -> Stmt {
    let loc = Loc::EMPTY;
    let guard_call = |kind: u32| -> Stmt {
        expr_stmt(
            Expr::init(
                E::Call {
                    target: Expr::init_identifier(guard_ref, loc),
                    args: AstAlloc::vec_from_iter([Expr::init(E::Number::new(kind as f64), loc)]),
                    ..Default::default()
                },
                loc,
            ),
            loc,
        )
    };

    let mut try_body = vec![guard_call(before)];
    try_body.extend(body_stmts);

    Stmt::alloc(
        S::Try {
            body_loc: loc,
            body: leak_stmts(try_body),
            catch_: None,
            finally: Some(Finally {
                loc,
                stmts: leak_stmts(vec![guard_call(after)]),
            }),
        },
        loc,
    )
}
