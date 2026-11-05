use super::Constant;
use super::children::{TreeNode, push_children};
use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use crate::atom::Atom;
use crate::bind::{Binding, Decl, SymFlags, SymbolId};
use crate::check::aot::{
    find_link_followed_by_transpiler, is_declared_around, is_member_visited_before,
};
use crate::hir::{BinOp, EnumId, EnumMemberId, ExprId, ExprKind};
use crate::util::{PositionSet, SharedSort};
use smallvec::SmallVec;

#[derive(Copy, Clone)]
struct MemberValue {
    value: Constant,
    needs_minify_syntax: bool,
}

pub(super) struct EnumMembers {
    values: Vec<Option<MemberValue>>,
    folded_ahead: PositionSet,
    reads: PositionSet,
    reads_of_results: PositionSet,
}

impl EnumMembers {
    pub(super) fn none() -> EnumMembers {
        EnumMembers {
            values: Vec::new(),
            folded_ahead: PositionSet::new(0),
            reads: PositionSet::new(0),
            reads_of_results: PositionSet::new(0),
        }
    }

    #[inline]
    pub(super) fn is_folded_ahead(&self, e: ExprId) -> bool {
        !self.values.is_empty() && self.folded_ahead.contains(e.idx())
    }
}

impl<'s> Folder<'_, 's> {
    pub(super) fn fold_enums(&mut self) {
        let hir = self.hir;
        if hir.enums.is_empty() {
            return;
        }
        self.enum_members = EnumMembers {
            values: vec![None; hir.enum_members.len()],
            folded_ahead: PositionSet::new(hir.exprs.len()),
            reads: PositionSet::new(hir.exprs.len()),
            reads_of_results: PositionSet::new(hir.exprs.len()),
        };
        let mut parts = Vec::new();
        for enumeration in (0..hir.enums.len() as u32).map(EnumId) {
            let mut next = Some(MemberValue {
                value: Constant::Number(0.0),
                needs_minify_syntax: false,
            });
            for member in hir[enumeration].members.iter() {
                let found = match hir[member].init.some() {
                    Some(initializer) => self.fold_initializer_ahead(initializer, &mut parts),
                    None => next,
                };
                next = found.and_then(|found| match found.value {
                    Constant::Number(number) => Some(MemberValue {
                        value: Constant::Number(number + 1.0),
                        ..found
                    }),
                    _ => None,
                });
                self.enum_members.values[member.idx()] = found;
            }
        }
    }

    fn collect_parts_known_ahead(&self, initializer: ExprId, parts: &mut Vec<ExprId>) -> bool {
        let hir = self.hir;
        parts.clear();
        let mut stack = vec![TreeNode::Expr(initializer)];
        while let Some(node) = stack.pop() {
            let TreeNode::Expr(part) = node else {
                return false;
            };
            let is_known_ahead = match hir[part].kind {
                ExprKind::Ident(_) => match self.bound.binding(part) {
                    Binding::Free => true,
                    Binding::Symbol(symbol) => self.is_enum_or_holds_one(symbol),
                    Binding::Arguments(_) | Binding::CommonJs(_) => false,
                },
                ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Template { .. }
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Unary { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Cond { .. }
                | ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => true,
                _ => false,
            };
            if !is_known_ahead {
                return false;
            }
            parts.push(part);
            push_children(hir, node, &mut stack);
        }
        parts.shared_sort_unstable();
        true
    }

    fn find_enum_behind_parameter_of_block(&self, symbol: SymbolId) -> SymbolId {
        let bound = self.bound;
        match *bound.symbol(symbol).decls {
            [made_by @ Decl::Enum(_)]
                if bound.container_parameter(bound.symbol_scope(symbol)) == symbol =>
            {
                bound.declared_symbol(made_by)
            }
            _ => symbol,
        }
    }

    fn is_enum_or_holds_one(&self, symbol: SymbolId) -> bool {
        let bound = self.bound;
        let symbol = self.find_enum_behind_parameter_of_block(symbol);
        let symbol = bound.export_symbol_of_value_symbol_if_exported(symbol);
        let flags = bound.symbol(symbol).flags;
        flags.intersects(SymFlags::NAMESPACE | SymFlags::ENUM_MEMBER)
    }

    fn fold_initializer_ahead(
        &mut self,
        initializer: ExprId,
        parts: &mut Vec<ExprId>,
    ) -> Option<MemberValue> {
        if !self.collect_parts_known_ahead(initializer, parts) {
            return None;
        }
        for &part in parts.iter() {
            self.fold_at(part);
            self.enum_members.folded_ahead.insert(part.idx());
        }
        let Value::Known(value) = self.folded(initializer).value else {
            return None;
        };
        let is_written = self.holds_under_minify_syntax(|it| it.is_folded_by_bun_run(initializer));
        let needs_minify_syntax = !self.is_folded_by_bun_run(initializer);
        match self.evaluator.to_constant(value) {
            value @ (Constant::Number(_) | Constant::String(_)) if is_written => {
                Some(MemberValue {
                    value,
                    needs_minify_syntax,
                })
            }
            _ => None,
        }
    }

    fn find_enum_member(&self, path: ExprId) -> Option<EnumMemberId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut first = path;
        while let Some((object, _)) = hir.member_key(first) {
            first = hir.skip_type_assertions(object);
        }
        let ExprKind::Ident(_) = hir[first].kind else {
            return None;
        };
        let Binding::Symbol(found) = bound.binding(first) else {
            return None;
        };
        if !self.is_enum_or_holds_one(bound.export_symbol_of_value_symbol_if_exported(found)) {
            return None;
        }
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut link = path;
        while hir.member_key(link).is_some() {
            let bytes_of = |name| self.atoms.bytes(name);
            let (object, name) = find_link_followed_by_transpiler(hir, link, bytes_of)?;
            names.push(name);
            link = hir.skip_type_assertions(object);
        }
        self.find_enum_member_below(first, found, &names)
    }

    fn find_enum_member_below(
        &self,
        first: ExprId,
        symbol: SymbolId,
        names: &[Atom],
    ) -> Option<EnumMemberId> {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = self.find_enum_behind_parameter_of_block(symbol);
        let root = bound.export_symbol_of_value_symbol_if_exported(symbol);
        if !self.is_enum_or_holds_one(root) || !self.has_static_lookup(first) {
            return None;
        }
        let mut found = root;
        for &name in names.iter().rev() {
            let holder = bound.symbol(found);
            if !holder.flags.intersects(SymFlags::NAMESPACE) {
                return None;
            }
            found = bound.lookup(holder.exports, name)?;
        }
        let member = match *bound.symbol(found).decls {
            [Decl::EnumMember(member)] => member,
            _ => return None,
        };
        if !names.is_empty() && !is_declared_around(hir, bound.symbol(root).decls, first) {
            return None;
        }
        bound.last_made_enum_member(member)
    }

    pub(super) fn fold_enum_member_read(&mut self, read: ExprId) -> Option<Folded> {
        if self.enum_members.values.is_empty() {
            return None;
        }
        let member = self.find_enum_member(read)?;
        self.fold_read_of_enum_member(read, member)
    }

    pub(super) fn fold_enum_member_named(
        &mut self,
        name: ExprId,
        symbol: SymbolId,
    ) -> Option<Folded> {
        if self.enum_members.values.is_empty() {
            return None;
        }
        let member = self.find_enum_member_below(name, symbol, &[])?;
        self.fold_read_of_enum_member(name, member)
    }

    fn fold_read_of_enum_member(&mut self, read: ExprId, member: EnumMemberId) -> Option<Folded> {
        let found = self.enum_members.values[member.idx()]?;
        if self.is_assignment_target(read)
            || self.is_delete_operand(read)
            || !is_member_visited_before(self.hir, member, read)
        {
            return None;
        }
        self.enum_members.reads.insert(read.idx());
        if found.needs_minify_syntax {
            self.mark_folded_by_build_alone(read);
            self.mark_folded_under_minify_syntax_if(read, |_| true);
        }
        Some(Folded::new(
            Value::from(found.value),
            Effects::LeftOutByBunRun,
        ))
    }

    pub(super) fn is_enum_member_written_in_place(&self, e: ExprId) -> bool {
        if self.enum_members.values.is_empty() {
            return false;
        }
        let hir = self.hir;
        let mut e = e;
        loop {
            e = hir.skip_type_assertions(e);
            if self.enum_members.reads.contains(e.idx()) {
                return true;
            }
            let select = |is_first: bool, first: ExprId, second: ExprId| match is_first {
                true => first,
                false => second,
            };
            let in_its_place = match hir[e].kind {
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    let is_truthy = self.is_test_truthy_in_bun_run(test);
                    is_truthy.map(|is_truthy| select(is_truthy, branches.yes, branches.no))
                }
                ExprKind::Binary { op, left, right } => match op {
                    BinOp::And => {
                        let is_truthy = self.is_truthy_in_bun_run(left);
                        is_truthy.map(|is_truthy| select(is_truthy, right, left))
                    }
                    BinOp::Or => {
                        let is_truthy = self.is_truthy_in_bun_run(left);
                        is_truthy.map(|is_truthy| select(is_truthy, left, right))
                    }
                    BinOp::Nullish => {
                        let is_nullish = self.is_nullish_in_bun_run(left);
                        is_nullish.map(|is_nullish| select(is_nullish, right, left))
                    }
                    BinOp::Comma => Some(right),
                    _ => None,
                },
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    self.written_in_place.get(&e).copied()
                }
                _ => None,
            };
            match in_its_place {
                Some(operand) => e = operand,
                None => return false,
            }
        }
    }

    pub(super) fn collect_constants_under_minify_syntax(&self) -> PositionSet {
        let mut found = PositionSet::new(self.hir.exprs.len());
        self.holds_under_minify_syntax(|folder| {
            for index in folder.folded_under_minify_syntax.iter() {
                if !folder.is_enum_member_written_in_place(ExprId(index as u32)) {
                    found.insert(index);
                }
            }
        });
        found
    }

    pub(super) fn note_constant_of_enum_member(
        &mut self,
        name: ExprId,
        initializer: ExprId,
    ) -> bool {
        if self.enum_members.values.is_empty()
            || self.folded(initializer).effects != Effects::LeftOutByBunRun
        {
            return false;
        }
        if self.is_enum_member_written_in_place(initializer) {
            self.enum_members.reads.insert(name.idx());
            return true;
        }
        let members = &self.enum_members;
        let mut stack = vec![TreeNode::Expr(initializer)];
        while let Some(node) = stack.pop() {
            if let TreeNode::Expr(part) = node
                && (members.reads.contains(part.idx())
                    || members.reads_of_results.contains(part.idx()))
            {
                self.enum_members.reads_of_results.insert(name.idx());
                return true;
            }
            push_children(self.hir, node, &mut stack);
        }
        false
    }
}
