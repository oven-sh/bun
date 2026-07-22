//! Port of `react_compiler_lowering/hir_builder.rs` — see ../DESIGN.md.
//!
//! Upstream's `HirBuilder` carries `&ScopeInfo`; the Bun port carries
//! `&dyn Host` (which exposes `symbols()/module_scope()/import_records()`)
//! instead, since Bun's parser already resolved every reference to a `Ref`.

use crate::collections::IndexMap;
use crate::collections::IndexSet;
use crate::diagnostics::CompilerDiagnostic;
use crate::diagnostics::CompilerDiagnosticDetail;
use crate::diagnostics::CompilerError;
use crate::diagnostics::CompilerErrorDetail;
use crate::diagnostics::ErrorCategory;
use crate::diagnostics::Position;
use crate::hir::environment::Environment;
use crate::hir::visitors::each_terminal_successor;
use crate::hir::visitors::terminal_fallthrough;
use crate::hir::*;
use bun_ast::{self as ast, E, G, Loc, Ref, Symbol, symbol};

use crate::program::Host;

// ---------------------------------------------------------------------------
// Reserved word check (matches TS isReservedWord)
// ---------------------------------------------------------------------------

pub(crate) fn is_always_reserved_word(s: &str) -> bool {
    matches!(
        s,
        "break"
            | "case"
            | "catch"
            | "continue"
            | "debugger"
            | "default"
            | "do"
            | "else"
            | "finally"
            | "for"
            | "function"
            | "if"
            | "in"
            | "instanceof"
            | "new"
            | "return"
            | "switch"
            | "this"
            | "throw"
            | "try"
            | "typeof"
            | "var"
            | "void"
            | "while"
            | "with"
            | "class"
            | "const"
            | "enum"
            | "export"
            | "extends"
            | "import"
            | "super"
            | "null"
            | "true"
            | "false"
            | "delete"
    )
}

#[cold]
#[inline(never)]
pub(crate) fn reserved_identifier_diagnostic(name: &str) -> CompilerDiagnostic {
    CompilerDiagnostic::new(
        ErrorCategory::Syntax,
        "Expected a non-reserved identifier name",
        Some(format!(
            "`{}` is a reserved word in JavaScript and cannot be used as an identifier name",
            name
        )),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc: None,
        message: Some("reserved word".to_string()),
        identifier_name: None,
    })
}

// ---------------------------------------------------------------------------
// Loc → SourceLocation
// ---------------------------------------------------------------------------

/// Bun's `Loc` is a byte offset; HIR `SourceLocation` wants `{line, column}`.
/// The compiler only uses the end position for diagnostic span width, so a
/// start-only location with the byte offset in `Position.index` is sufficient.
pub(crate) fn convert_loc(loc: Loc) -> Option<SourceLocation> {
    if loc.start < 0 {
        return None;
    }
    let pos = Position {
        line: 0,
        column: 0,
        index: Some(loc.start as u32),
    };
    Some(SourceLocation {
        start: pos,
        end: pos,
    })
}

// ---------------------------------------------------------------------------
// symbol::Kind → BindingKind
// ---------------------------------------------------------------------------

fn convert_binding_kind(kind: symbol::Kind) -> BindingKind {
    use symbol::Kind as Sk;
    match kind {
        Sk::Hoisted => BindingKind::Var,
        Sk::HoistedFunction | Sk::GeneratorOrAsyncFunction => BindingKind::Hoisted,
        Sk::Constant => BindingKind::Const,
        Sk::Class => BindingKind::Local,
        Sk::Import => BindingKind::Module,
        Sk::CatchIdentifier => BindingKind::Let,
        Sk::Other => BindingKind::Let,
        _ => BindingKind::Unknown,
    }
}

// ---------------------------------------------------------------------------
// FunctionNode: one of the function shapes the compiler can lower
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
pub(crate) enum FunctionNode<'a> {
    Function(&'a G::Fn),
    Arrow(&'a E::Arrow),
}

impl<'a> FunctionNode<'a> {
    pub(crate) fn args(&self) -> &'a [G::Arg] {
        match self {
            FunctionNode::Function(f) => f.args.slice(),
            FunctionNode::Arrow(a) => a.args.slice(),
        }
    }

    pub(crate) fn body(&self) -> &'a G::FnBody {
        match self {
            FunctionNode::Function(f) => &f.body,
            FunctionNode::Arrow(a) => &a.body,
        }
    }

    pub(crate) fn is_async(&self) -> bool {
        match self {
            FunctionNode::Function(f) => f.flags.contains(ast::flags::Function::IsAsync),
            FunctionNode::Arrow(a) => a.is_async,
        }
    }

    pub(crate) fn is_generator(&self) -> bool {
        match self {
            FunctionNode::Function(f) => f.flags.contains(ast::flags::Function::IsGenerator),
            FunctionNode::Arrow(_) => false,
        }
    }

    pub(crate) fn has_rest_arg(&self) -> bool {
        match self {
            FunctionNode::Function(f) => f.flags.contains(ast::flags::Function::HasRestArg),
            FunctionNode::Arrow(a) => a.has_rest_arg,
        }
    }

    pub(crate) fn has_react_hooks_suppression(&self) -> bool {
        match self {
            FunctionNode::Function(f) => f
                .flags
                .contains(ast::flags::Function::HasReactHooksSuppression),
            FunctionNode::Arrow(a) => a.has_react_hooks_suppression,
        }
    }

    pub(crate) fn loc(&self) -> Loc {
        match self {
            FunctionNode::Function(f) => f.body.loc,
            FunctionNode::Arrow(a) => a.body.loc,
        }
    }

    /// Loc that keys the parser's `FunctionArgs` scope for this function.
    /// For `G::Fn` this is `open_parens_loc`; arrows have no stable field so
    /// callers fall back via `HirBuilder::push_scope`'s no-op-on-miss.
    pub(crate) fn args_loc(&self) -> Loc {
        match self {
            FunctionNode::Function(f) => f.open_parens_loc,
            FunctionNode::Arrow(a) => a.body.loc,
        }
    }

    pub(crate) fn name_ref(&self) -> Option<Ref> {
        match self {
            FunctionNode::Function(f) => f.name.as_ref().map(|n| n.ref_).filter(|r| r.is_valid()),
            FunctionNode::Arrow(_) => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Scope types for tracking break/continue targets
// ---------------------------------------------------------------------------

enum Scope {
    Loop {
        label: Option<String>,
        continue_block: BlockId,
        break_block: BlockId,
    },
    Label {
        label: String,
        break_block: BlockId,
    },
    Switch {
        label: Option<String>,
        break_block: BlockId,
    },
}

impl Scope {
    fn label(&self) -> Option<&str> {
        match self {
            Scope::Loop { label, .. } => label.as_deref(),
            Scope::Label { label, .. } => Some(label.as_str()),
            Scope::Switch { label, .. } => label.as_deref(),
        }
    }

    fn break_block(&self) -> BlockId {
        match self {
            Scope::Loop { break_block, .. } => *break_block,
            Scope::Label { break_block, .. } => *break_block,
            Scope::Switch { break_block, .. } => *break_block,
        }
    }
}

// ---------------------------------------------------------------------------
// WipBlock: a block under construction that does not yet have a terminal
// ---------------------------------------------------------------------------

pub(crate) struct WipBlock {
    pub id: BlockId,
    pub instructions: HirVec<InstructionId>,
    pub kind: BlockKind,
}

fn new_block(id: BlockId, kind: BlockKind) -> WipBlock {
    WipBlock {
        id,
        kind,
        instructions: AstAlloc::vec(),
    }
}

// ---------------------------------------------------------------------------
// HirBuilder: helper struct for constructing a CFG
// ---------------------------------------------------------------------------

#[allow(
    clippy::disallowed_types,
    reason = "vendored react_compiler_hir HashSet<BindingId> contract"
)]
type RefSet = std::collections::HashSet<Ref>;

pub(crate) struct HirBuilder<'h> {
    completed: IndexMap<BlockId, BasicBlock>,
    current: WipBlock,
    entry: BlockId,
    scopes: Vec<Scope>,
    /// Context identifiers: variables captured from an outer scope.
    /// Maps the outer scope's binding `Ref` to the source location where it was referenced.
    context: IndexMap<Ref, Option<SourceLocation>>,
    /// Resolved bindings: maps a `Ref` to the HIR IdentifierId created for it.
    bindings: IndexMap<Ref, IdentifierId>,
    /// Refs already resolved to bindings, for collision avoidance.
    used_refs: IndexSet<Ref>,
    env: &'h mut Environment,
    host: &'h dyn Host,
    exception_handler_stack: Vec<BlockId>,
    /// Flat instruction table being built up.
    instruction_table: HirVec<Instruction>,
    /// The scope of the function being compiled (for context identifier checks).
    function_scope: &'h ast::Scope,
    /// The scope of the outermost component/hook function.
    component_scope: &'h ast::Scope,
    /// Current lexical scope stack (top = innermost). Used by `resolve_ref` to
    /// resolve `RefTag::SourceContentsSlice` identifier references — this hook
    /// runs before the visit pass that would normally rewrite them to
    /// `RefTag::Symbol`.
    scope_stack: Vec<&'h ast::Scope>,
    /// Set of `Ref`s for variables declared in scopes between component_scope
    /// and any inner function scope, that are referenced from an inner function scope.
    /// These need StoreContext/LoadContext instead of StoreLocal/LoadLocal.
    context_identifiers: RefSet,
    /// ES-module import bindings keyed by clause-item `Ref`. Populated from the
    /// module's `SImport` statements before lowering so `resolve_identifier`
    /// can return `ImportSpecifier`/`ImportDefault`/`ImportNamespace` (and thus
    /// reach `Environment::resolve_module_type`) when `Symbol::namespace_alias`
    /// is absent — which it is for plain `import {x} from 'm'` outside HMR.
    import_bindings: IndexMap<Ref, VariableBinding>,
}

impl<'h> HirBuilder<'h> {
    // -----------------------------------------------------------------------
    // M2: Core methods
    // -----------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        env: &'h mut Environment,
        host: &'h dyn Host,
        function_scope: &'h ast::Scope,
        component_scope: &'h ast::Scope,
        context_identifiers: RefSet,
        bindings: Option<IndexMap<Ref, IdentifierId>>,
        context: Option<IndexMap<Ref, Option<SourceLocation>>>,
        entry_block_kind: Option<BlockKind>,
        used_refs: Option<IndexSet<Ref>>,
    ) -> Self {
        let entry = env.next_block_id();
        let kind = entry_block_kind.unwrap_or(BlockKind::Block);
        HirBuilder {
            completed: IndexMap::new(),
            current: new_block(entry, kind),
            entry,
            scopes: Vec::new(),
            context: context.unwrap_or_default(),
            bindings: bindings.unwrap_or_default(),
            used_refs: used_refs.unwrap_or_default(),
            env,
            host,
            exception_handler_stack: Vec::new(),
            instruction_table: AstAlloc::vec(),
            function_scope,
            component_scope,
            scope_stack: vec![function_scope],
            context_identifiers,
            import_bindings: IndexMap::new(),
        }
    }

    pub(crate) fn environment(&self) -> &Environment {
        self.env
    }

    pub(crate) fn environment_mut(&mut self) -> &mut Environment {
        self.env
    }

    pub(crate) fn host(&self) -> &'h dyn Host {
        self.host
    }

    pub(crate) fn set_import_bindings(&mut self, bindings: IndexMap<Ref, VariableBinding>) {
        self.import_bindings = bindings;
    }

    pub(crate) fn import_bindings(&self) -> &IndexMap<Ref, VariableBinding> {
        &self.import_bindings
    }

    pub(crate) fn function_scope(&self) -> &'h ast::Scope {
        self.function_scope
    }

    pub(crate) fn component_scope(&self) -> &'h ast::Scope {
        self.component_scope
    }

    // -----------------------------------------------------------------------
    // Lexical scope tracking (for pre-visit `Ref` resolution)
    // -----------------------------------------------------------------------

    /// Push the lexical scope keyed at `loc`. If the host has no scope at that
    /// loc, the current top is re-pushed so `pop_scope` always balances.
    pub(crate) fn push_scope(&mut self, loc: Loc) {
        let next = self
            .host
            .scope_for_loc(loc)
            .unwrap_or_else(|| self.current_scope());
        self.scope_stack.push(next);
    }

    pub(crate) fn pop_scope(&mut self) {
        debug_assert!(self.scope_stack.len() > 1, "pop_scope underflow");
        self.scope_stack.pop();
    }

    pub(crate) fn current_scope(&self) -> &'h ast::Scope {
        *self.scope_stack.last().expect("scope_stack never empty")
    }

    /// Resolve a `Ref` to its canonical `RefTag::Symbol` form.
    ///
    /// This hook runs before the parser's visit pass, so identifier
    /// *references* still carry `RefTag::SourceContentsSlice` (a byte-range
    /// into source text) rather than the resolved symbol ref. Walk the scope
    /// chain from `current_scope()` to find the declaring `Member`.
    pub(crate) fn resolve_ref(&self, ref_: Ref) -> Ref {
        use bun_ast::base::RefTag;
        if ref_.tag() == RefTag::Symbol {
            return ref_;
        }
        let name = self.host.ref_name(ref_);
        let mut scope = Some(self.current_scope());
        while let Some(s) = scope {
            if let Some(member) = s.members.get(name) {
                return member.ref_;
            }
            scope = s.parent.as_deref();
        }
        ref_
    }

    pub(crate) fn context(&self) -> &IndexMap<Ref, Option<SourceLocation>> {
        &self.context
    }

    pub(crate) fn context_identifiers(&self) -> &RefSet {
        &self.context_identifiers
    }

    pub(crate) fn add_context_identifier(&mut self, ref_: Ref) {
        self.context_identifiers.insert(self.resolve_ref(ref_));
    }

    pub(crate) fn host_and_env_mut(&mut self) -> (&'h dyn Host, &mut Environment) {
        (self.host, self.env)
    }

    pub(crate) fn bindings(&self) -> &IndexMap<Ref, IdentifierId> {
        &self.bindings
    }

    pub(crate) fn used_refs(&self) -> &IndexSet<Ref> {
        &self.used_refs
    }

    pub(crate) fn merge_used_refs(&mut self, child_used_refs: &IndexSet<Ref>) {
        for &ref_ in child_used_refs.iter() {
            self.used_refs.insert(ref_);
        }
    }

    pub(crate) fn merge_bindings(&mut self, child_bindings: IndexMap<Ref, IdentifierId>) {
        for (ref_, identifier_id) in child_bindings {
            self.bindings.entry(ref_).or_insert(identifier_id);
        }
    }

    pub(crate) fn push(&mut self, instruction: Instruction) {
        let loc = instruction.loc;
        let instr_id = InstructionId(self.instruction_table.len() as u32);
        self.instruction_table.push(instruction);
        self.current.instructions.push(instr_id);

        if let Some(&handler) = self.exception_handler_stack.last() {
            let continuation = self.reserve(self.current_block_kind());
            self.terminate_with_continuation(
                Terminal::MaybeThrow {
                    continuation: continuation.id,
                    handler: Some(handler),
                    id: EvaluationOrder(0),
                    loc,
                    effects: None,
                },
                continuation,
            );
        }
    }

    pub(crate) fn terminate(&mut self, terminal: Terminal, next_block_kind: Option<BlockKind>) -> BlockId {
        let wip = std::mem::replace(
            &mut self.current,
            new_block(BlockId(u32::MAX), BlockKind::Block),
        );
        let block_id = wip.id;

        self.completed.insert(
            block_id,
            BasicBlock {
                kind: wip.kind,
                id: block_id,
                instructions: wip.instructions,
                terminal,
                preds: IndexSet::new(),
                phis: AstAlloc::vec(),
            },
        );

        if let Some(kind) = next_block_kind {
            let next_id = self.env.next_block_id();
            self.current = new_block(next_id, kind);
        }
        block_id
    }

    pub(crate) fn terminate_with_continuation(&mut self, terminal: Terminal, continuation: WipBlock) {
        let wip = std::mem::replace(&mut self.current, continuation);
        let block_id = wip.id;
        self.completed.insert(
            block_id,
            BasicBlock {
                kind: wip.kind,
                id: block_id,
                instructions: wip.instructions,
                terminal,
                preds: IndexSet::new(),
                phis: AstAlloc::vec(),
            },
        );
    }

    pub(crate) fn reserve(&mut self, kind: BlockKind) -> WipBlock {
        let id = self.env.next_block_id();
        new_block(id, kind)
    }

    pub(crate) fn try_enter_reserved(
        &mut self,
        wip: WipBlock,
        f: impl FnOnce(&mut Self) -> Result<Terminal, CompilerDiagnostic>,
    ) -> Result<(), CompilerDiagnostic> {
        let prev = std::mem::replace(&mut self.current, wip);
        let terminal = f(self)?;
        let completed_wip = std::mem::replace(&mut self.current, prev);
        self.completed.insert(
            completed_wip.id,
            BasicBlock {
                kind: completed_wip.kind,
                id: completed_wip.id,
                instructions: completed_wip.instructions,
                terminal,
                preds: IndexSet::new(),
                phis: AstAlloc::vec(),
            },
        );
        Ok(())
    }

    pub(crate) fn try_enter(
        &mut self,
        kind: BlockKind,
        f: impl FnOnce(&mut Self, BlockId) -> Result<Terminal, CompilerDiagnostic>,
    ) -> Result<BlockId, CompilerDiagnostic> {
        let wip = self.reserve(kind);
        let wip_id = wip.id;
        self.try_enter_reserved(wip, |this| f(this, wip_id))?;
        Ok(wip_id)
    }

    pub(crate) fn try_enter_try_catch(
        &mut self,
        handler: BlockId,
        f: impl FnOnce(&mut Self) -> Result<(), CompilerDiagnostic>,
    ) -> Result<(), CompilerDiagnostic> {
        self.exception_handler_stack.push(handler);
        let result = f(self);
        self.exception_handler_stack.pop();
        result
    }

    pub(crate) fn resolve_throw_handler(&self) -> Option<BlockId> {
        self.exception_handler_stack.last().copied()
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn loop_scope<T>(
        &mut self,
        label: Option<String>,
        continue_block: BlockId,
        break_block: BlockId,
        f: impl FnOnce(&mut Self) -> Result<T, CompilerDiagnostic>,
    ) -> Result<T, CompilerDiagnostic> {
        self.scopes.push(Scope::Loop {
            label: label.clone(),
            continue_block,
            break_block,
        });
        let value = f(self)?;
        let last = self
            .scopes
            .pop()
            .expect("Mismatched loop scope: stack empty");
        match &last {
            Scope::Loop {
                label: l,
                continue_block: c,
                break_block: b,
            } => {
                assert!(
                    *l == label && *c == continue_block && *b == break_block,
                    "Mismatched loop scope"
                );
            }
            _ => {
                return Err(CompilerDiagnostic::new(
                    ErrorCategory::Invariant,
                    "Mismatched loop scope: expected Loop, got other",
                    None,
                ));
            }
        }
        Ok(value)
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn label_scope<T>(
        &mut self,
        label: String,
        break_block: BlockId,
        f: impl FnOnce(&mut Self) -> Result<T, CompilerDiagnostic>,
    ) -> Result<T, CompilerDiagnostic> {
        self.scopes.push(Scope::Label {
            label: label.clone(),
            break_block,
        });
        let value = f(self)?;
        let last = self
            .scopes
            .pop()
            .expect("Mismatched label scope: stack empty");
        match &last {
            Scope::Label {
                label: l,
                break_block: b,
            } => {
                assert!(*l == label && *b == break_block, "Mismatched label scope");
            }
            _ => {
                return Err(CompilerDiagnostic::new(
                    ErrorCategory::Invariant,
                    "Mismatched label scope: expected Label, got other",
                    None,
                ));
            }
        }
        Ok(value)
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn switch_scope<T>(
        &mut self,
        label: Option<String>,
        break_block: BlockId,
        f: impl FnOnce(&mut Self) -> Result<T, CompilerDiagnostic>,
    ) -> Result<T, CompilerDiagnostic> {
        self.scopes.push(Scope::Switch {
            label: label.clone(),
            break_block,
        });
        let value = f(self)?;
        let last = self
            .scopes
            .pop()
            .expect("Mismatched switch scope: stack empty");
        match &last {
            Scope::Switch {
                label: l,
                break_block: b,
            } => {
                assert!(*l == label && *b == break_block, "Mismatched switch scope");
            }
            _ => {
                return Err(CompilerDiagnostic::new(
                    ErrorCategory::Invariant,
                    "Mismatched switch scope: expected Switch, got other",
                    None,
                ));
            }
        }
        Ok(value)
    }

    pub(crate) fn lookup_break(&self, label: Option<&str>) -> Result<BlockId, CompilerDiagnostic> {
        for scope in self.scopes.iter().rev() {
            match scope {
                Scope::Loop { .. } | Scope::Switch { .. } if label.is_none() => {
                    return Ok(scope.break_block());
                }
                _ if label.is_some() && scope.label() == label => {
                    return Ok(scope.break_block());
                }
                _ => continue,
            }
        }
        Err(CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            "Expected a loop or switch to be in scope for break",
            None,
        ))
    }

    pub(crate) fn lookup_continue(&self, label: Option<&str>) -> Result<BlockId, CompilerDiagnostic> {
        for scope in self.scopes.iter().rev() {
            match scope {
                Scope::Loop {
                    label: scope_label,
                    continue_block,
                    ..
                } => {
                    if label.is_none() || label == scope_label.as_deref() {
                        return Ok(*continue_block);
                    }
                }
                _ => {
                    if label.is_some() && scope.label() == label {
                        return Err(CompilerDiagnostic::new(
                            ErrorCategory::Invariant,
                            "Continue may only refer to a labeled loop",
                            None,
                        ));
                    }
                }
            }
        }
        Err(CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            "Expected a loop to be in scope for continue",
            None,
        ))
    }

    pub(crate) fn make_temporary(&mut self, loc: Option<SourceLocation>) -> IdentifierId {
        let id = self.env.next_identifier_id();
        self.env.identifiers[id.0 as usize].loc = loc;
        id
    }

    pub(crate) fn record_error(&mut self, error: CompilerErrorDetail) -> Result<(), CompilerError> {
        self.env.record_error(error)
    }

    pub(crate) fn record_diagnostic(&mut self, diagnostic: CompilerDiagnostic) {
        self.env.record_diagnostic(diagnostic);
    }

    pub(crate) fn current_block_kind(&self) -> BlockKind {
        self.current.kind
    }

    pub(crate) fn build(
        mut self,
    ) -> Result<
        (
            HIR,
            HirVec<Instruction>,
            IndexSet<Ref>,
            IndexMap<Ref, IdentifierId>,
        ),
        CompilerError,
    > {
        let mut hir = HIR {
            blocks: std::mem::take(&mut self.completed),
            entry: self.entry,
        };

        let mut instructions = AstAlloc::take(&mut self.instruction_table);

        let rpo_blocks = get_reverse_postordered_blocks(&hir, &instructions);

        for (id, block) in &hir.blocks {
            if !rpo_blocks.contains_key(id) {
                let has_function_expr = block.instructions.iter().any(|&instr_id| {
                    matches!(
                        instructions[instr_id.0 as usize].value,
                        InstructionValue::FunctionExpression { .. }
                    )
                });
                if has_function_expr {
                    let loc = block
                        .instructions
                        .first()
                        .and_then(|&i| instructions[i.0 as usize].loc)
                        .or_else(|| block.terminal.loc().copied());
                    self.env.record_error(CompilerErrorDetail {
                        category: ErrorCategory::Todo,
                        reason: "Support functions with unreachable code that may contain hoisted declarations".to_string(),
                        description: None,
                        loc,
                        suggestions: None,
                    })?;
                }
            }
        }

        hir.blocks = rpo_blocks;

        remove_unreachable_for_updates(&mut hir);
        remove_dead_do_while_statements(&mut hir);
        remove_unnecessary_try_catch(&mut hir);
        mark_instruction_ids(&mut hir, &mut instructions);
        mark_predecessors(&mut hir);

        let used_refs = self.used_refs;
        let bindings = self.bindings;
        Ok((hir, instructions, used_refs, bindings))
    }

    // -----------------------------------------------------------------------
    // M3: Binding resolution methods
    // -----------------------------------------------------------------------

    fn symbol(&self, ref_: Ref) -> Option<&'h Symbol> {
        let ref_ = self.resolve_ref(ref_);
        if !ref_.is_symbol() {
            return None;
        }
        self.host.symbols().get(ref_.inner_index() as usize)
    }

    pub(crate) fn ref_name(&self, ref_: Ref) -> Result<String, CompilerError> {
        core::str::from_utf8(self.host.ref_name(ref_))
            .map(str::to_owned)
            .map_err(|_| crate::diagnostics::cold_todo("non-utf8 identifier", None))
    }

    /// Map a `Ref` to an HIR IdentifierId.
    ///
    /// On first encounter, creates a new Identifier with the symbol's name and a
    /// fresh id. On subsequent encounters, returns the cached IdentifierId.
    pub(crate) fn resolve_binding(&mut self, ref_: Ref) -> Result<IdentifierId, CompilerError> {
        self.resolve_binding_with_loc(ref_, None)
    }

    pub(crate) fn resolve_binding_with_loc(
        &mut self,
        ref_: Ref,
        loc: Option<SourceLocation>,
    ) -> Result<IdentifierId, CompilerError> {
        let ref_ = self.resolve_ref(ref_);
        let name = self.ref_name(ref_)?;

        if name == "fbt" {
            let should_record_fbt_error = if let Some(&identifier_id) = self.bindings.get(&ref_) {
                match &self.env.identifiers[identifier_id.0 as usize].name {
                    Some(IdentifierName::Named(resolved_name)) => resolved_name == b"fbt",
                    _ => false,
                }
            } else {
                true
            };
            if should_record_fbt_error {
                self.env.record_error(CompilerErrorDetail {
                    category: ErrorCategory::Todo,
                    reason: "Support local variables named `fbt`".to_string(),
                    description: Some(
                        "Local variables named `fbt` may conflict with the fbt plugin and are not yet supported".to_string(),
                    ),
                    loc,
                    suggestions: None,
                })?;
            }
        }

        if let Some(&identifier_id) = self.bindings.get(&ref_) {
            return Ok(identifier_id);
        }

        if is_always_reserved_word(&name) {
            return Err(CompilerError::from(reserved_identifier_diagnostic(&name)));
        }

        let name_taken = |env: &Environment,
                          used_refs: &IndexSet<Ref>,
                          bindings: &IndexMap<Ref, IdentifierId>,
                          candidate: &[u8],
                          ref_: Ref|
         -> bool {
            used_refs.iter().any(|&r| {
                r != ref_
                    && bindings.get(&r).is_some_and(|&id| {
                        matches!(
                            &env.identifiers[id.0 as usize].name,
                            Some(IdentifierName::Named(n)) if n.slice() == candidate
                        )
                    })
            })
        };

        let mut candidate = name.clone();
        let mut index = 0u32;
        while name_taken(
            self.env,
            &self.used_refs,
            &self.bindings,
            candidate.as_bytes(),
            ref_,
        ) {
            candidate = format!("{}_{}", name, index);
            index += 1;
        }

        let stored_name = StoreStr::new(self.host.ref_name(ref_));
        let stored_candidate = if candidate == name {
            stored_name
        } else {
            StoreStr::new(bun_ast::data_store_dupe_str(candidate.as_bytes()))
        };
        if candidate != name {
            if let Some(start) = loc.as_ref().and_then(|l| l.start.index) {
                self.env
                    .renames
                    .push(crate::hir::environment::BindingRename {
                        original: stored_name,
                        renamed: stored_candidate,
                        declaration_start: start,
                    });
            }
        }

        let id = self.env.next_identifier_id();
        self.env.identifiers[id.0 as usize].name = Some(IdentifierName::Named(stored_candidate));
        if let Some(loc) = loc {
            self.env.identifiers[id.0 as usize].loc = Some(loc);
        }

        self.used_refs.insert(ref_);
        self.bindings.insert(ref_, id);
        Ok(id)
    }

    pub(crate) fn set_identifier_declaration_loc(
        &mut self,
        id: IdentifierId,
        loc: &Option<SourceLocation>,
    ) {
        if let Some(loc_val) = loc {
            self.env.identifiers[id.0 as usize].loc = Some(*loc_val);
        }
    }

    /// Resolve an identifier reference (`Ref`) to a VariableBinding.
    ///
    /// Bun's parser already resolved every reference, so the `Ref` directly
    /// indexes the symbol table; this maps `symbol::Kind` to the HIR's
    /// Global/Import*/ModuleLocal/Identifier classification.
    pub(crate) fn resolve_identifier(
        &mut self,
        ref_: Ref,
        loc: Option<SourceLocation>,
    ) -> Result<VariableBinding, CompilerError> {
        let ref_ = self.resolve_ref(ref_);
        let Some(sym) = self.symbol(ref_) else {
            return Err(crate::diagnostics::cold_todo(
                "Unresolved symbol reference",
                loc,
            ));
        };
        let name = sym.original_name;

        use symbol::Kind as Sk;
        match sym.kind {
            Sk::Unbound | Sk::Arguments => {
                return Ok(VariableBinding::Global { name });
            }
            Sk::TsEnum | Sk::TsNamespace => {
                return Ok(VariableBinding::Global { name });
            }
            Sk::Import => {
                if let Some(alias) = &sym.namespace_alias {
                    if let Some(record) = self
                        .host
                        .import_records()
                        .get(alias.import_record_index as usize)
                    {
                        let module = StoreStr::new(record.path.text);
                        let imported = alias.alias;
                        return Ok(if imported.slice() == b"default" {
                            VariableBinding::ImportDefault { name, module }
                        } else {
                            VariableBinding::ImportSpecifier {
                                name,
                                module,
                                imported,
                            }
                        });
                    }
                }
                // `namespace_alias` is only populated by `scan_imports` (after
                // visit) or under HMR, so it is usually absent here. Consult
                // the `Ref → ImportSpecifier/Default/Namespace` map collected
                // from the module's `SImport` clauses so
                // `Environment::get_global_declaration` can route through
                // `resolve_module_type` for typed modules (e.g. shared-runtime
                // `graphql` → Primitive). Falling back to `Global` keeps the
                // React-globals-by-local-name behaviour for unmapped imports;
                // `ModuleLocal` stays reserved for true module-scope
                // declarations below.
                if let Some(binding) = self.import_bindings.get(&ref_) {
                    return Ok(binding.clone());
                }
                return Ok(VariableBinding::Global { name });
            }
            _ => {}
        }

        let module_scope = self.host.module_scope();
        if let Some(member) = module_scope.members.get(sym.original_name.slice()) {
            if member.ref_ == ref_ {
                return Ok(VariableBinding::ModuleLocal { name });
            }
        }
        // Module-scope generated symbols (jsx-runtime `jsx`/`jsxDEV`/`Fragment`,
        // compiler-runtime `c`, etc.) are minted by the parser's visit pass after
        // `collect_import_bindings` runs, so they are absent from both `members`
        // and `import_bindings`. They are module-level imports, not locals —
        // classify them as Global so inference initializes them as Frozen instead
        // of tripping the "Expected value kind to be initialized" invariant.
        if module_scope.generated.contains(&ref_) {
            return Ok(VariableBinding::Global { name });
        }

        let binding_kind = convert_binding_kind(sym.kind);
        let identifier_id = self.resolve_binding_with_loc(ref_, loc)?;
        Ok(VariableBinding::Identifier {
            identifier: identifier_id,
            binding_kind,
        })
    }

    /// Check if a `Ref` resolves to a context identifier (captured from an
    /// enclosing function scope).
    pub(crate) fn is_context_identifier(&self, ref_: Ref) -> bool {
        let ref_ = self.resolve_ref(ref_);
        if let Some(member) = self.symbol(ref_).and_then(|sym| {
            self.host
                .module_scope()
                .members
                .get(sym.original_name.slice())
        }) {
            if member.ref_ == ref_ {
                return false;
            }
        }
        self.context_identifiers.contains(&ref_)
    }

    pub(crate) fn is_context_binding(&self, ref_: Ref) -> bool {
        self.is_context_identifier(ref_)
    }
}

// ---------------------------------------------------------------------------
// Post-build helper functions
// ---------------------------------------------------------------------------

fn get_reverse_postordered_blocks(
    hir: &HIR,
    _instructions: &[Instruction],
) -> IndexMap<BlockId, BasicBlock> {
    let mut visited: IndexSet<BlockId> = IndexSet::new();
    let mut used: IndexSet<BlockId> = IndexSet::new();
    let mut used_fallthroughs: IndexSet<BlockId> = IndexSet::new();
    let mut postorder: Vec<BlockId> = Vec::new();

    fn visit(
        hir: &HIR,
        block_id: BlockId,
        is_used: bool,
        visited: &mut IndexSet<BlockId>,
        used: &mut IndexSet<BlockId>,
        used_fallthroughs: &mut IndexSet<BlockId>,
        postorder: &mut Vec<BlockId>,
    ) {
        let was_used = used.contains(&block_id);
        let was_visited = visited.contains(&block_id);
        visited.insert(block_id);
        if is_used {
            used.insert(block_id);
        }
        if was_visited && (was_used || !is_used) {
            return;
        }

        let block = hir
            .blocks
            .get(&block_id)
            .unwrap_or_else(|| panic!("[HIRBuilder] expected block {:?} to exist", block_id));

        let mut successors = each_terminal_successor(&block.terminal);
        successors.reverse();

        let fallthrough = terminal_fallthrough(&block.terminal);

        if let Some(ft) = fallthrough {
            if is_used {
                used_fallthroughs.insert(ft);
            }
            visit(hir, ft, false, visited, used, used_fallthroughs, postorder);
        }
        for successor in successors {
            visit(
                hir,
                successor,
                is_used,
                visited,
                used,
                used_fallthroughs,
                postorder,
            );
        }

        if !was_visited {
            postorder.push(block_id);
        }
    }

    visit(
        hir,
        hir.entry,
        true,
        &mut visited,
        &mut used,
        &mut used_fallthroughs,
        &mut postorder,
    );

    let mut blocks = IndexMap::new();
    for block_id in postorder.into_iter().rev() {
        let block = hir.blocks.get(&block_id).unwrap();
        if used.contains(&block_id) {
            blocks.insert(block_id, block.clone());
        } else if used_fallthroughs.contains(&block_id) {
            blocks.insert(
                block_id,
                BasicBlock {
                    kind: block.kind,
                    id: block_id,
                    instructions: AstAlloc::vec(),
                    terminal: Terminal::Unreachable {
                        id: block.terminal.evaluation_order(),
                        loc: block.terminal.loc().copied(),
                    },
                    preds: block.preds.clone(),
                    phis: AstAlloc::vec(),
                },
            );
        }
    }

    blocks
}

fn remove_unreachable_for_updates(hir: &mut HIR) {
    let block_ids: IndexSet<BlockId> = hir.blocks.keys().copied().collect();
    for block in hir.blocks.values_mut() {
        if let Terminal::For { update, .. } = &mut block.terminal {
            if let Some(update_id) = *update {
                if !block_ids.contains(&update_id) {
                    *update = None;
                }
            }
        }
    }
}

fn remove_dead_do_while_statements(hir: &mut HIR) {
    let block_ids: IndexSet<BlockId> = hir.blocks.keys().copied().collect();
    for block in hir.blocks.values_mut() {
        let should_replace = if let Terminal::DoWhile { test, .. } = &block.terminal {
            !block_ids.contains(test)
        } else {
            false
        };
        if should_replace {
            if let Terminal::DoWhile {
                loop_block,
                id,
                loc,
                ..
            } = std::mem::replace(
                &mut block.terminal,
                Terminal::Unreachable {
                    id: EvaluationOrder(0),
                    loc: None,
                },
            ) {
                block.terminal = Terminal::Goto {
                    block: loop_block,
                    variant: GotoVariant::Break,
                    id,
                    loc,
                };
            }
        }
    }
}

fn remove_unnecessary_try_catch(hir: &mut HIR) {
    let block_ids: IndexSet<BlockId> = hir.blocks.keys().copied().collect();

    let replacements: Vec<(BlockId, BlockId, BlockId, BlockId, Option<SourceLocation>)> = hir
        .blocks
        .iter()
        .filter_map(|(&block_id, block)| {
            if let Terminal::Try {
                block: try_block,
                handler,
                fallthrough,
                loc,
                ..
            } = &block.terminal
            {
                if !block_ids.contains(handler) {
                    return Some((block_id, *try_block, *handler, *fallthrough, *loc));
                }
            }
            None
        })
        .collect();

    for (block_id, try_block, handler_id, fallthrough_id, loc) in replacements {
        if let Some(block) = hir.blocks.get_mut(&block_id) {
            block.terminal = Terminal::Goto {
                block: try_block,
                id: EvaluationOrder(0),
                loc,
                variant: GotoVariant::Break,
            };
        }

        if let Some(fallthrough) = hir.blocks.get_mut(&fallthrough_id) {
            if fallthrough.preds.len() == 1 && fallthrough.preds.contains(&handler_id) {
                hir.blocks.shift_remove(&fallthrough_id);
            } else {
                fallthrough.preds.shift_remove(&handler_id);
            }
        }
    }
}

fn mark_instruction_ids(hir: &mut HIR, instructions: &mut [Instruction]) {
    let mut order: u32 = 0;
    for block in hir.blocks.values_mut() {
        for &instr_id in &block.instructions {
            order += 1;
            instructions[instr_id.0 as usize].id = EvaluationOrder(order);
        }
        order += 1;
        block.terminal.set_evaluation_order(EvaluationOrder(order));
    }
}

fn mark_predecessors(hir: &mut HIR) {
    for block in hir.blocks.values_mut() {
        block.preds.clear();
    }

    let mut visited: IndexSet<BlockId> = IndexSet::new();

    fn visit(
        hir: &mut HIR,
        block_id: BlockId,
        prev_block_id: Option<BlockId>,
        visited: &mut IndexSet<BlockId>,
    ) {
        if let Some(prev_id) = prev_block_id {
            if let Some(block) = hir.blocks.get_mut(&block_id) {
                block.preds.insert(prev_id);
            } else {
                return;
            }
        }

        if visited.contains(&block_id) {
            return;
        }
        visited.insert(block_id);

        let successors = if let Some(block) = hir.blocks.get(&block_id) {
            each_terminal_successor(&block.terminal)
        } else {
            return;
        };

        for successor in successors {
            visit(hir, successor, Some(block_id), visited);
        }
    }

    visit(hir, hir.entry, None, &mut visited);
}

// ---------------------------------------------------------------------------
// Public helper functions
// ---------------------------------------------------------------------------

pub(crate) fn create_temporary_place(env: &mut Environment, loc: Option<SourceLocation>) -> Place {
    let id = env.next_identifier_id();
    env.identifiers[id.0 as usize].loc = loc;
    Place {
        identifier: id,
        reactive: false,
        effect: Effect::Unknown,
        loc: None,
    }
}
