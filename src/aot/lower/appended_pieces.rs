use bun_sema::bind::{Binding, CodeUnit, Decl, Parent, PatParent, SymbolId};
use bun_sema::fold::{Decision, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, FnBody, IdList, NodeData, PatKind, Span, StmtId, StmtKind,
    VarDeclId, VarKind,
};

use crate::ir::ValueId;
use crate::lower::member::KeyConversion;
use crate::lower::scope::{BindingRef, Storage};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone)]
pub(in crate::lower) struct AppendedPiece {
    piece: SymbolId,
    join: ExprId,
    whole: ExprId,
    whole_symbol: SymbolId,
    last_statement: StmtId,
}

struct PieceScan<'x, 'a, 'c, 'p, 's> {
    file: &'x FileLowering<'a, 'c, 'p, 's>,
    piece: SymbolId,
    whole: SymbolId,
    mentions_of_piece: usize,
    may_have_appended: bool,
    loops: u32,
    break_targets: u32,
}

impl FileLowering<'_, '_, '_, '_> {
    fn local_named_by(&self, name: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        if !matches!(hir[name].kind, ExprKind::Ident(_))
            || matches!(self.decisions().decision(name), Decision::GlobalPath(_))
            || bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some()
        {
            return None;
        }
        match bound.binding(name) {
            Binding::Symbol(symbol) => Some(symbol),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        }
    }

    fn is_empty_string(&self, value: ExprId) -> bool {
        matches!(self.hir[value].kind, ExprKind::String(text) if self.queries.atom_bytes(text).is_empty())
    }

    fn own_variable(&self, symbol: SymbolId) -> Option<VarDeclId> {
        let bound = self.bound;
        let &[Decl::Var(name)] = bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
            return None;
        };
        let placement = self.scopes.placement(BindingRef::Symbol(symbol))?;
        let is_own = placement.storage == Storage::Local
            && !placement.is_shared
            && !bound.is_visible_to_eval(symbol)
            && bound.symbol(symbol).parent.is_none();
        is_own.then_some(declaration)
    }

    fn starts_piece(&self, statement: StmtId) -> Option<SymbolId> {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Expr(expression) => match hir[expression].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if self.is_empty_string(value) => self.local_named_by(target),
                _ => None,
            },
            StmtKind::Var(declarations) => {
                let mut declarations = declarations.iter();
                let (Some(declaration), None) = (declarations.next(), declarations.next()) else {
                    return None;
                };
                let written = hir[declaration];
                match (hir[written.pat].kind, written.init.some()) {
                    (PatKind::Ident(_), Some(value)) if self.is_empty_string(value) => {
                        let symbol = self.bound.declared_symbol(Decl::Var(written.pat));
                        (!symbol.is_none()).then_some(symbol)
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn find_join_of_piece(&self, statement: StmtId, piece: SymbolId) -> Option<(ExprId, ExprId)> {
        let hir = self.hir;
        let StmtKind::Expr(join) = hir[statement].kind else {
            return None;
        };
        let ExprKind::Assign {
            op: Some(BinOp::Add),
            target,
            value,
        } = hir[join].kind
        else {
            return None;
        };
        let mut front = value;
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            ..
        } = hir[front].kind
        {
            front = left;
        }
        (self.local_named_by(front) == Some(piece)).then_some((join, target))
    }

    fn is_string_literal(&self, value: ExprId) -> bool {
        matches!(
            self.hir[value].kind,
            ExprKind::String(_) | ExprKind::Template { .. }
        )
    }

    fn always_holds_string(&self, symbol: SymbolId, declaration: VarDeclId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Some(initializer) = hir[declaration].init.some() else {
            return false;
        };
        self.is_string_literal(initializer)
            && (bound.assignments_to(symbol).iter()).all(|&(_, target)| {
                let Parent::Expr(assignment) = bound.parent_of_expr(target) else {
                    return false;
                };
                match hir[assignment].kind {
                    ExprKind::Assign {
                        op,
                        target: stored,
                        value,
                    } if stored == target => match op {
                        Some(BinOp::Add) => true,
                        None => self.is_string_literal(value),
                        Some(_) => false,
                    },
                    _ => false,
                }
            })
    }

    fn outermost_loop_behind(&self, declaration: VarDeclId, statement: StmtId) -> Option<StmtId> {
        let (hir, bound) = (self.hir, self.bound);
        let declaring = bound.var_stmt[declaration.idx()].some()?;
        let is_in_own_list = match bound.parent_of_stmt(declaring) {
            Parent::FnBody(_) => true,
            Parent::Stmt(list) => {
                matches!(hir[list].kind, StmtKind::Block(_))
                    && matches!(bound.variable_kind(hir, declaration), VarKind::Let)
            }
            _ => false,
        };
        let is_variable = matches!(
            bound.variable_kind(hir, declaration),
            VarKind::Let | VarKind::Var
        );
        if !is_in_own_list || !is_variable || hir[declaring].loc.end > hir[statement].start {
            return None;
        }
        let mut outermost = None;
        let mut above = bound.parent_of_stmt(statement);
        loop {
            let around = match above {
                Parent::Stmt(around) => around,
                Parent::FnBody(_) => return outermost,
                _ => return None,
            };
            if hir[around].start <= hir[declaring].start
                && hir[declaring].loc.end <= hir[around].loc.end
            {
                return outermost;
            }
            match hir[around].kind {
                StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. } => outermost = Some(around),
                StmtKind::Block(_) | StmtKind::If { .. } | StmtKind::Labeled { .. } => {}
                _ => return None,
            }
            above = bound.parent_of_stmt(around);
        }
    }

    fn visit_names(
        &self,
        mut pending: Vec<TreeNode>,
        mut visit: impl FnMut(ExprId) -> bool,
    ) -> bool {
        while let Some(node) = pending.pop() {
            match node {
                TreeNode::Function(_) => continue,
                TreeNode::Class(_) => return false,
                TreeNode::Expr(expression) => match self.hir[expression].kind {
                    ExprKind::Ident(_) if !visit(expression) => return false,
                    _ => {}
                },
                TreeNode::Stmt(_) | TreeNode::Pattern(_) => {}
            }
            push_children(self.hir, node, &mut pending);
        }
        true
    }

    fn names(&self, name: ExprId, symbol: SymbolId) -> bool {
        matches!(self.bound.binding(name), Binding::Symbol(named) if named == symbol)
    }

    fn is_only_appended_to(&self, symbol: SymbolId, loop_statement: StmtId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        self.visit_names(vec![TreeNode::Stmt(loop_statement)], |name| {
            if !self.names(name, symbol) {
                return true;
            }
            let Parent::Expr(append) = bound.parent_of_expr(name) else {
                return false;
            };
            matches!(hir[append].kind, ExprKind::Assign { op: Some(BinOp::Add), target, .. } if target == name)
                && matches!(bound.parent_of_expr(append), Parent::Stmt(statement) if matches!(hir[statement].kind, StmtKind::Expr(written) if written == append))
        })
    }

    fn number_of_mentions(&self, symbol: SymbolId) -> Option<usize> {
        let (hir, bound) = (self.hir, self.bound);
        let CodeUnit::Function(function) = bound.code_unit(bound.symbol_scope(symbol)) else {
            return None;
        };
        let FnBody::Block(statements) = hir[function].body else {
            return None;
        };
        let mut mentions = 0;
        let pending = hir.ids(statements).map(TreeNode::Stmt).collect();
        self.visit_names(pending, |name| {
            mentions += usize::from(self.names(name, symbol));
            true
        })
        .then_some(mentions)
    }

    fn find_appended_piece(
        &self,
        statements: IdList<StmtId>,
        index: u32,
        piece: SymbolId,
    ) -> Option<AppendedPiece> {
        let hir = self.hir;
        let (behind, (join, whole)) = (index + 1..statements.len).find_map(|behind| {
            let statement = hir.id_at(statements, behind as usize);
            Some((behind, self.find_join_of_piece(statement, piece)?))
        })?;
        let first_statement = hir.id_at(statements, index as usize);
        let last_statement = hir.id_at(statements, behind as usize);
        let whole_symbol = self.local_named_by(whole)?;
        let declaration = self.own_variable(whole_symbol)?;
        if whole_symbol == piece
            || self.decisions().is_dead_stmt(last_statement)
            || self.own_variable(piece).is_none()
            || !self.always_holds_string(whole_symbol, declaration)
        {
            return None;
        }
        let loop_statement = self.outermost_loop_behind(declaration, first_statement)?;
        let mut scan = PieceScan {
            file: self,
            piece,
            whole: whole_symbol,
            mentions_of_piece: 0,
            may_have_appended: false,
            loops: 0,
            break_targets: 0,
        };
        let between = index + 1..behind;
        if !between
            .map(|at| hir.id_at(statements, at as usize))
            .all(|it| scan.statement(it))
            || !scan.parts_of_join(join)
            || !self.is_only_appended_to(whole_symbol, loop_statement)
        {
            return None;
        }
        let mentions_at_start = usize::from(matches!(hir[first_statement].kind, StmtKind::Expr(_)));
        let mentions = scan.mentions_of_piece + mentions_at_start;
        (self.number_of_mentions(piece) == Some(mentions)).then_some(AppendedPiece {
            piece,
            join,
            whole,
            whole_symbol,
            last_statement,
        })
    }
}

impl PieceScan<'_, '_, '_, '_, '_> {
    fn value(&mut self, value: ExprId) -> bool {
        value.is_none() || self.nodes(vec![TreeNode::Expr(value)])
    }

    fn nodes(&self, mut pending: Vec<TreeNode>) -> bool {
        let (hir, file) = (self.file.hir, self.file);
        while let Some(node) = pending.pop() {
            match node {
                TreeNode::Function(_) => continue,
                TreeNode::Class(_) => return false,
                TreeNode::Expr(expression) => match hir[expression].kind {
                    ExprKind::Await(_) | ExprKind::Yield { .. } => return false,
                    ExprKind::Ident(_)
                        if file.names(expression, self.piece)
                            || file.names(expression, self.whole) =>
                    {
                        return false;
                    }
                    _ => {}
                },
                TreeNode::Stmt(_) | TreeNode::Pattern(_) => {}
            }
            push_children(hir, node, &mut pending);
        }
        true
    }

    fn effect(&mut self, expression: ExprId) -> bool {
        let hir = self.file.hir;
        if expression.is_none() {
            return true;
        }
        match hir[expression].kind {
            ExprKind::Assign {
                op: Some(BinOp::Add),
                target,
                value,
            } if self.file.local_named_by(target) == Some(self.piece) => {
                self.mentions_of_piece += 1;
                let appends = self.value(value);
                self.may_have_appended = true;
                appends
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => self.effect(left) && self.effect(right),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => self.value(left) && self.effect(right),
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                self.value(test) && self.effect(yes) && self.effect(no)
            }
            _ => self.value(expression),
        }
    }

    fn declarations(&mut self, declarations: Span<VarDeclId>) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        declarations.iter().all(|declaration| {
            let written = hir[declaration];
            !matches!(
                bound.variable_kind(hir, declaration),
                VarKind::Using | VarKind::AwaitUsing
            ) && self.value(written.init)
                && self.nodes(vec![TreeNode::Pattern(written.pat)])
        })
    }

    fn loop_parts(&mut self, loop_statement: StmtId, body: StmtId, update: ExprId) -> bool {
        self.may_have_appended |= !self.nodes(vec![TreeNode::Stmt(loop_statement)]);
        self.loops += 1;
        self.break_targets += 1;
        let fits = self.statement(body) && self.effect(update);
        self.loops -= 1;
        self.break_targets -= 1;
        fits
    }

    fn exit(&self, stays: bool) -> bool {
        stays || !self.may_have_appended
    }

    fn statement(&mut self, statement: StmtId) -> bool {
        let hir = self.file.hir;
        if statement.is_none() {
            return true;
        }
        match hir[statement].kind {
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_) => true,
            StmtKind::Expr(expression) => self.effect(expression),
            StmtKind::Var(declarations) => self.declarations(declarations),
            StmtKind::Return(value) | StmtKind::Throw(value) => self.value(value),
            StmtKind::If { test, yes, no } => {
                let before = self.may_have_appended;
                let fits = self.value(test) && self.statement(yes);
                let behind_yes = std::mem::replace(&mut self.may_have_appended, before);
                let fits = fits && self.statement(no);
                self.may_have_appended |= behind_yes;
                fits
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.statement(init) && self.value(test) && self.loop_parts(statement, body, update)
            }
            StmtKind::While { test, body } | StmtKind::DoWhile { test, body } => {
                self.value(test) && self.loop_parts(statement, body, ExprId::NONE)
            }
            StmtKind::ForIn { left, expr, body } => {
                self.nodes(vec![TreeNode::Stmt(left)])
                    && self.value(expr)
                    && self.loop_parts(statement, body, ExprId::NONE)
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                !is_await
                    && self.nodes(vec![TreeNode::Stmt(left)])
                    && self.value(expr)
                    && self.loop_parts(statement, body, ExprId::NONE)
            }
            StmtKind::Block(statements) => hir.ids(statements).all(|it| self.statement(it)),
            StmtKind::Switch { expr, cases } => {
                self.break_targets += 1;
                let fits = self.value(expr)
                    && cases.iter().all(|case| {
                        self.value(hir[case].test)
                            && hir.ids(hir[case].body).all(|it| self.statement(it))
                    });
                self.break_targets -= 1;
                fits
            }
            StmtKind::Break(label) => self.exit(label.is_none() && self.break_targets != 0),
            StmtKind::Continue(label) => self.exit(label.is_none() && self.loops != 0),
            StmtKind::Labeled { body, .. } => self.statement(body),
            _ => false,
        }
    }

    fn parts_of_join(&mut self, join: ExprId) -> bool {
        let hir = self.file.hir;
        let ExprKind::Assign { value, .. } = hir[join].kind else {
            return false;
        };
        self.mentions_of_piece += 1;
        let mut front = value;
        while let ExprKind::Binary { left, right, .. } = hir[front].kind {
            if !self.value(right) {
                return false;
            }
            front = left;
        }
        true
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn begin_appended_piece(
        &mut self,
        statements: IdList<StmtId>,
        index: u32,
    ) {
        let statement = self.file.hir.id_at(statements, index as usize);
        let Some(piece) = self.file.starts_piece(statement) else {
            return;
        };
        if self.file.counted_places.is_some() {
            return;
        }
        let Some(mut found) = self.file.find_appended_piece(statements, index, piece) else {
            return;
        };
        let around = self.appended_pieces.iter();
        if let Some(around) = around
            .rev()
            .find(|around| around.piece == found.whole_symbol)
        {
            found.whole = around.whole;
            found.whole_symbol = around.whole_symbol;
        }
        self.appended_pieces.push(found);
    }

    pub(in crate::lower) fn end_appended_piece(&mut self, statement: StmtId) {
        self.appended_pieces
            .retain(|piece| piece.last_statement != statement);
    }

    pub(in crate::lower) fn whole_strings_of(
        &self,
        stored: &[BindingRef],
    ) -> smallvec::SmallVec<[BindingRef; 2]> {
        let pieces = self.appended_pieces.iter();
        pieces
            .filter(|piece| stored.contains(&BindingRef::Symbol(piece.piece)))
            .map(|piece| BindingRef::Symbol(piece.whole_symbol))
            .filter(|whole| !stored.contains(whole))
            .collect()
    }

    pub(in crate::lower) fn try_lower_append_to_piece(
        &mut self,
        append: ExprId,
        target: ExprId,
        value: ExprId,
    ) -> Option<ValueId> {
        if self.appended_pieces.is_empty() {
            return None;
        }
        let joined = (self.appended_pieces.iter()).find(|piece| piece.join == append);
        if let Some(&AppendedPiece { whole, .. }) = joined {
            return Some(self.lower_parts_behind_piece(append, whole, value));
        }
        let named = self.file.local_named_by(target)?;
        let &AppendedPiece { whole, .. } =
            (self.appended_pieces.iter()).find(|piece| piece.piece == named)?;
        let reference = self.lower_reference(whole, KeyConversion::Once);
        let old = self.get_reference(&reference);
        let part = self.lower_expression(value);
        let updated = self.builder.add(old, part);
        self.set_position(self.file.hir[target].pos);
        Some(self.put_reference(&reference, updated, Some(append)))
    }

    fn lower_parts_behind_piece(&mut self, join: ExprId, whole: ExprId, value: ExprId) -> ValueId {
        let hir = self.file.hir;
        let reference = self.lower_reference(whole, KeyConversion::Once);
        let mut updated = self.get_reference(&reference);
        let mut parts: smallvec::SmallVec<[(ExprId, ExprId); 4]> = smallvec::SmallVec::new();
        let mut front = value;
        while let ExprKind::Binary { left, right, .. } = hir[front].kind {
            parts.push((front, right));
            front = left;
        }
        if parts.is_empty() {
            return updated;
        }
        for &(sum, right) in parts.iter().rev() {
            let part = self.lower_expression(right);
            self.set_position(hir[sum].pos);
            updated = self.builder.add(updated, part);
        }
        self.set_position(hir[whole].pos);
        self.put_reference(&reference, updated, Some(join))
    }
}
