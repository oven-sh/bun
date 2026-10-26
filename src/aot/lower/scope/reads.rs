//! `bun run` keeps the names that closures share in one object for each scope. A suspended function holds such an object, and with it all that
//! its names hold, where code behind the suspension reads the scope. `ReadScope` stands at each of those places.

use bun_sema::bind::{Binding, ScopeId, SymbolId};
use bun_sema::fold::{Constant, Decision};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::node::{Node, NodeData, ToNode};
use smallvec::SmallVec;

use super::{BindingRef, DeadZone, Storage, bindings};
use crate::ir::generated::FunctionFlags;
use crate::ir::{BlockId, ValueId};
use crate::lower::FunctionLowering;

/// Where the function last read a scope, and how many of the entered scopes the read covers.
#[derive(Copy, Clone)]
pub(super) struct ScopeRead {
    block: BlockId,
    stretch: u32,
    depth: usize,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn can_be_suspended(&self) -> bool {
        let suspends = FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR;
        self.builder.function().flags.intersects(suspends)
    }

    /// A read of a scope in front of this place says nothing of a read behind it.
    pub(in crate::lower) fn begin_stretch_of_scope_reads(&mut self) {
        self.scopes.stretch_of_reads += 1;
    }

    pub(in crate::lower) fn read_innermost_scope(&mut self) {
        self.read_scopes(self.scopes.entered.len());
    }

    /// The code here reads the last of the first `depth` entered scopes. A scope holds the scopes around it.
    pub(in crate::lower) fn read_scopes(&mut self, depth: usize) {
        if !self.can_be_suspended() || self.builder.is_unreachable() {
            return;
        }
        let block = self.builder.current_block();
        let stretch = self.scopes.stretch_of_reads;
        let is_covered = self.scopes.last_read.is_some_and(|last| {
            last.block == block && last.stretch == stretch && depth <= last.depth
        });
        if is_covered {
            return;
        }
        self.scopes.last_read = Some(ScopeRead {
            block,
            stretch,
            depth,
        });
        let mut values: SmallVec<[ValueId; 8]> = SmallVec::new();
        for index in 0..depth {
            let entered = self.scopes.entered[index];
            if let Some(environment) = entered.environment {
                values.push(self.builder.read_variable(environment));
            }
            for position in 0..self.file.scopes.bindings(entered.scope).len() {
                let binding = self.file.scopes.bindings(entered.scope)[position];
                if !self.is_shared_by_value(binding) {
                    continue;
                }
                let Some(local) = self.scopes.find_local(binding) else {
                    continue;
                };
                if local.dead_zone == DeadZone::Uninitialized {
                    continue;
                }
                let value = self.builder.read_variable(local.variable);
                if !values.contains(&value) {
                    values.push(value);
                }
            }
        }
        if !values.is_empty() {
            self.builder.read_scope(&values);
        }
    }

    fn is_shared_by_value(&self, binding: BindingRef) -> bool {
        let placement = self.file.scopes.placement(binding);
        placement
            .is_some_and(|placement| placement.is_shared && placement.storage == Storage::Local)
    }

    /// The function can be suspended, and `bun run` makes an object for the scope.
    pub(super) fn has_shared_names(&self, scope: ScopeId) -> bool {
        if !self.can_be_suspended() {
            return false;
        }
        let bindings = self.file.scopes.bindings(scope).iter();
        bindings.copied().any(|binding| {
            let placement = self.file.scopes.placement(binding);
            placement.is_some_and(|placement| {
                placement.is_shared && !matches!(placement.storage, Storage::Variable(_))
            })
        })
    }

    /// `bun run` makes an object for one of the scopes that were entered behind the first `depth`.
    pub(in crate::lower) fn has_shared_names_inside(&self, depth: usize) -> bool {
        let inner = self.scopes.entered.get(depth..).unwrap_or_default();
        inner
            .iter()
            .any(|entered| self.has_shared_names(entered.scope))
    }

    /// How many scopes the function has entered so far for which `bun run` makes an object.
    pub(in crate::lower) fn count_scopes_with_shared_names(&self) -> u32 {
        self.scopes.scopes_with_shared_names
    }

    pub(in crate::lower) fn entered_scope_count(&self) -> usize {
        self.scopes.entered.len()
    }

    fn find_entered_depth(&self, symbol: SymbolId) -> Option<usize> {
        let scope = self.file.bound.symbol_scope(symbol).some()?;
        let mut entered = self.scopes.entered.iter();
        Some(entered.rposition(|entered| entered.scope == scope)? + 1)
    }

    /// What `bun run` reads to find the name. A local that no closure names lies in no scope. The parameters of a function that can be suspended
    /// lie in a scope around its body.
    pub(in crate::lower) fn read_scope_of_binding(&mut self, binding: Binding) {
        if !self.can_be_suspended() {
            return;
        }
        let Binding::Symbol(symbol) = bindings::normalize_binding(self.file, binding) else {
            return self.read_innermost_scope();
        };
        let binding = BindingRef::Symbol(symbol);
        match self.find_entered_depth(symbol) {
            Some(_) if self.coroutine.held.contains(&binding) => self.read_innermost_scope(),
            Some(depth) => {
                let placement = self.file.scopes.placement(binding);
                if placement.is_some_and(|placement| placement.is_shared) {
                    self.read_scopes(depth);
                }
            }
            None => self.read_innermost_scope(),
        }
    }

    /// A store to a name that lies in a scope of the function itself reads the scope. For any other name `bun run` has found the scope in front of
    /// the value that is stored.
    pub(super) fn read_scope_stored_into(&mut self, symbol: SymbolId) {
        let binding = BindingRef::Symbol(symbol);
        let placement = self.file.scopes.placement(binding);
        if !self.can_be_suspended()
            || self.coroutine.held.contains(&binding)
            || !placement.is_some_and(|placement| placement.is_shared)
        {
            return;
        }
        if let Some(depth) = self.find_entered_depth(symbol) {
            self.begin_stretch_of_scope_reads();
            self.read_scopes(depth);
        }
    }

    fn read_scope_of_identifier(&mut self, identifier: ExprId) {
        let binding = self.file.bound.binding(identifier);
        let decisions = self.file.decisions();
        // Where `bun run` too puts a value in place of the name it reads nothing, but it writes NaN as the name.
        let is_name_in_bun_run = match decisions.decision(identifier) {
            Decision::Constant(Constant::Number(number)) if number.is_nan() => true,
            Decision::Unknown => true,
            _ => decisions.is_folded_by_build_alone(identifier),
        };
        if is_name_in_bun_run {
            self.read_scope_of_binding(binding);
        }
    }

    /// The name that the evaluation of the expression starts with, or every name where the build puts a value in place of the expression.
    pub(in crate::lower) fn read_scopes_of_expression(&mut self, expression: ExprId) {
        if !self.can_be_suspended() {
            return;
        }
        let hir = self.file.hir;
        if self.file.decisions().decision(expression) != Decision::Unknown {
            return self.read_scopes_of_names_under(expression.to_node(hir));
        }
        let mut first = expression;
        loop {
            first = match hir[first].kind {
                ExprKind::Ident(_) => return self.read_scope_of_identifier(first),
                ExprKind::ImportMeta => return self.read_innermost_scope(),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                    hir[call].callee
                }
                ExprKind::Unary { operand, .. } => operand,
                ExprKind::Assign { target, .. } => target,
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::Instantiation { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => expr,
                _ => return,
            };
        }
    }

    pub(in crate::lower) fn read_scopes_of_names_under(&mut self, root: Node) {
        let hir = self.file.hir;
        let mut pending: SmallVec<[Node; 16]> = SmallVec::from_slice(&[root]);
        while let Some(node) = pending.pop() {
            if let NodeData::Expr(expression) = hir.data(node) {
                match hir[expression].kind {
                    ExprKind::Ident(_) => {
                        self.read_scope_of_identifier(expression);
                        continue;
                    }
                    ExprKind::ImportMeta => self.read_innermost_scope(),
                    _ => {}
                }
            }
            hir.for_each_child(node, &mut |child| {
                pending.push(child);
                false
            });
        }
    }
}
