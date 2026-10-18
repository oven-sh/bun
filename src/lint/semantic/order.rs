//! The order in which the scope manager makes the references, where it does not visit a node as it is written: `Referencer`,
//! `ClassVisitor` and `PatternVisitor` of typescript-eslint, and what `eslint-scope` has of them.
//!
//! Every reference has a position that it is visited at, which is where it is written to begin with. A node whose parts are
//! visited in another order moves what is in them, as if the parts were written in that order. The references are made in
//! the order of these positions.

use super::ScopeKind;
use super::references::{self, RawReference};
use super::scopes;
use crate::ast::File;
use bun_sema::bind::{MemberOwner, Parent};
use bun_sema::hir::{self, ExprKind, ExprTag, MemberKind, ModifierKind, UnOp};
use smallvec::SmallVec;

/// Parts of the text that follow each other.
struct Parts {
    /// Where each starts, and where the last ends.
    bounds: SmallVec<[u32; 5]>,
    /// How far what is in each moves, which wraps around for what moves to the left.
    shifts: SmallVec<[u32; 4]>,
}

struct Moves<'t, 'a> {
    file: &'a File<'a>,
    /// Where the references are visited before any of this. Sorted.
    visits: &'t [u32],
    found: Vec<Parts>,
}

impl Moves<'_, '_> {
    /// `bounds`: see `Parts`. The parts are visited in the order of `ranks`, those with the same in the order of the source.
    fn add(&mut self, bounds: &[u32], ranks: &[u8]) {
        let [start, ends @ ..] = bounds else {
            return;
        };
        if !bounds.is_sorted() || ends.len() != ranks.len() {
            return;
        }
        // It takes references in two of the parts to change anything.
        let mut rest = &self.visits[self.visits.partition_point(|it| it < start)..];
        let mut parts_with_references = 0;
        for end in ends {
            let (here, after) = rest.split_at(rest.partition_point(|it| it < end));
            parts_with_references += u32::from(!here.is_empty());
            rest = after;
        }
        if parts_with_references < 2 {
            return;
        }
        let lengths = || bounds.iter().zip(ends).map(|(start, end)| end - start);
        let shifts = (bounds.iter().zip(ranks).enumerate()).map(|(part, (written_at, rank))| {
            let visited_before = (lengths().zip(ranks).enumerate())
                .filter(|&(other, (_, other_rank))| (other_rank, other) < (rank, part))
                .map(|(_, (length, _))| length);
            (start + visited_before.sum::<u32>()).wrapping_sub(*written_at)
        });
        self.found.push(Parts {
            shifts: shifts.collect(),
            bounds: SmallVec::from_slice(bounds),
        });
    }

    /// What is from `second` to `stop` is visited before what is from `first` to `second`.
    fn swap(&mut self, first: u32, second: u32, stop: u32) {
        self.add(&[first, second, stop], &[1, 0]);
    }

    /// `PatternVisitor.MemberExpression`: the `b` of `a[b]` before `a`.
    fn member(&mut self, id: hir::ExprId) {
        let file = self.file;
        if let Some(&hir::Expr {
            kind: ExprKind::Index { obj, .. },
            pos,
            end,
        }) = file.hir.exprs.get(id.idx())
            && let Some(obj) = file.hir.exprs.get(obj.idx())
            && references::is_in_pattern(file, id)
        {
            self.swap(pos, obj.end, end);
        }
    }

    /// `visitTypeAssertion`: the type last. `visitExpressionTarget`: of what is assigned to, the type first.
    fn assertion(&mut self, id: hir::ExprId) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let Some(&hir::Expr {
            kind: ExprKind::As { expr, ty },
            pos,
            end,
        }) = hir.exprs.get(id.idx())
        else {
            return;
        };
        let (Some(expr), Some(ty)) = (hir.exprs.get(expr.idx()), hir.types.get(ty.idx())) else {
            return;
        };
        let is_target = match bound.expr_parent.get(id.idx()) {
            Some(&Parent::Expr(parent)) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                Some(ExprKind::Assign { target, .. }) => target == id,
                Some(ExprKind::Unary { op, .. }) => matches!(
                    op,
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                ),
                _ => false,
            },
            _ => false,
        };
        let is_in_angle_brackets = ty.pos < expr.pos;
        match (is_in_angle_brackets, is_target) {
            (true, false) => self.swap(ty.pos, ty.end, end),
            (false, true) => self.swap(pos, ty.pos, ty.end),
            _ => {}
        }
    }

    /// `CallExpression`, `NewExpression`, `TaggedTemplateExpression`: the type arguments last.
    fn call(&mut self, id: hir::ExprId) {
        let file = self.file;
        let hir = &file.hir;
        if let Some(&hir::Expr {
            kind: ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call),
            end,
            ..
        }) = hir.exprs.get(id.idx())
            && let Some(call) = hir.calls.get(call.idx())
            && !call.type_args.is_empty()
        {
            let types = hir.ids.get(call.type_args.range()).unwrap_or_default();
            let mut types = types.iter().filter_map(|&it| hir.types.get(it as usize));
            if let Some(first) = types.next() {
                self.swap(first.pos, types.next_back().unwrap_or(first).end, end);
            }
        }
    }

    /// Where the decorators among `modifiers` start and end.
    fn decorators(&self, modifiers: hir::Span<hir::ModifierId>) -> Option<(u32, u32)> {
        let file = self.file;
        let hir = &file.hir;
        let modifiers = hir.modifiers.get(modifiers.range())?;
        let mut decorators = modifiers.iter().filter_map(|it| match it.kind {
            ModifierKind::Decorator(e) => Some((it.pos, hir.exprs.get(e.idx())?.end)),
            ModifierKind::Keyword(_) => None,
        });
        let first = decorators.next()?;
        Some((first.0, decorators.next_back().unwrap_or(first).1))
    }

    /// `visitFunction`, `visitMethodFunction`: parameter by parameter the pattern with its defaults and then the type, the
    /// return type, the type parameters. Before all that the decorators of the parameters of a method.
    fn function(&mut self, id: hir::FnId) {
        let file = self.file;
        let (hir, tree) = (&file.hir, file.scope_tree());
        let scope = (tree.of_fn.get(id.idx())).and_then(|&it| tree.scopes.get(it as usize));
        // Signatures and function types are visited as they are written.
        let Some(function) = (hir.fns.get(id.idx()))
            .filter(|_| scope.is_some_and(|it| it.kind == ScopeKind::Function))
        else {
            return;
        };
        let (mut bounds, mut ranks): (SmallVec<[u32; 8]>, SmallVec<[u8; 8]>) = Default::default();
        let mut end = 0;
        if let Some([first, .., last] | [first @ last]) =
            hir.type_params.get(function.type_params.range())
        {
            bounds.push(first.start);
            ranks.push(2);
            end = last.end;
        }
        let end_of_type_parameters = (end != 0).then_some(end);
        let parameters = (function.this_param.some().into_iter()).chain(function.params.iter());
        for id in parameters {
            let Some(parameter) = hir.params.get(id.idx()) else {
                continue;
            };
            let (ty, default) = (
                hir.types.get(parameter.ty.idx()),
                hir.exprs.get(parameter.default.idx()),
            );
            if let (Some(ty), Some(default)) = (ty, default) {
                self.swap(ty.pos, ty.end, default.end);
            }
            // The first part after the type parameters starts where they end.
            let start = |written_at: u32| match ranks[..] {
                [2] => end_of_type_parameters.unwrap_or(written_at),
                _ => written_at,
            };
            let modifiers = hir.modifiers_of_params.get(id.idx()).copied();
            if let Some(decorators) = modifiers.and_then(|it| self.decorators(it)) {
                bounds.extend([start(decorators.0), decorators.1]);
                ranks.extend([0, 1]);
            } else if matches!(ranks[..], [] | [2]) {
                bounds.push(start(parameter.pos));
                ranks.push(1);
            }
            end = [
                hir.pats.get(parameter.pat.idx()).map(|it| it.end),
                ty.map(|it| it.end),
                default.map(|it| it.end),
            ]
            .into_iter()
            .flatten()
            .fold(end, u32::max);
        }
        if let Some(ty) = hir.types.get(function.ret.idx()) {
            if let [2] = ranks[..] {
                bounds.extend(end_of_type_parameters);
                ranks.push(1);
            }
            end = end.max(ty.end);
        }
        bounds.push(end);
        self.add(&bounds, &ranks);
    }

    /// `visitClass`: what it extends before its type parameters.
    fn class(&mut self, id: hir::ClassId) {
        let file = self.file;
        let hir = &file.hir;
        if let Some(class) = hir.classes.get(id.idx())
            && let Some(extends) = hir.exprs.get(class.extends.idx())
            && let Some([first, .., last] | [first @ last]) =
                hir.type_params.get(class.type_params.range())
        {
            self.swap(first.start, last.end, extends.end);
        }
    }

    /// `visitMethod`, `visitPropertyDefinition`: the key, the value, the decorators, the type.
    fn member_of_class(&mut self, id: hir::MemberId) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let Some(member) = hir.members.get(id.idx()) else {
            return;
        };
        let (ty, init) = (
            hir.types.get(member.ty.idx()),
            hir.exprs.get(member.init.idx()),
        );
        if (member.modifiers.is_empty() && (ty.is_none() || init.is_none()))
            || !matches!(
                bound.member_owner.get(id.idx()),
                Some(MemberOwner::Class(_))
            )
        {
            return;
        }
        let (key, end) = (member.name_pos, member.loc.end);
        let start = self.decorators(member.modifiers).map_or(key, |it| it.0);
        match member.kind {
            MemberKind::Property => {
                let value = init.map_or(end, |it| it.pos);
                let (ty, value) = ty.map_or((value, value), |it| (it.pos, it.end));
                self.add(&[start, key, ty, value, end], &[2, 0, 3, 1]);
            }
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor => self.swap(start, key, end),
            _ => {}
        }
    }

    fn find(&mut self) {
        let file = self.file;
        file.every_expr_of(&[ExprTag::Index], |it| self.member(it.id()));
        // Without types and decorators that is all.
        if scopes::is_javascript_mode(file) {
            return;
        }
        file.every_expr_of(&[ExprTag::As], |it| self.assertion(it.id()));
        let calls = [ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate];
        file.every_expr_of(&calls, |it| self.call(it.id()));
        // `VariableDeclaration`: the type after the initializer.
        file.every_var_decl(|it| {
            if let Some(declaration) = file.hir.var_decls.get(it.id().idx())
                && let Some(ty) = file.hir.types.get(declaration.ty.idx())
                && let Some(init) = file.hir.exprs.get(declaration.init.idx())
            {
                self.swap(ty.pos, ty.end, init.end);
            }
        });
        file.every_func(|it| self.function(it.id()));
        file.every_class(|it| self.class(it.id()));
        file.every_member(|it| self.member_of_class(it.id()));
    }
}

/// Indices into `all`, which is in source order, in the order the references are made. `moved`: `References::moved`.
/// `None`: nothing but `moved` changes the order.
pub(super) fn as_made<'a>(
    file: &'a File<'a>,
    all: &[RawReference],
    moved: &[(u32, u32)],
) -> Option<Vec<u32>> {
    // The position and the index in one number: those at one position keep their order.
    let key = |visit: u32, index: u32| u64::from(visit) << 32 | u64::from(index);
    let mut written: Vec<u64> = (all.iter().zip(0..))
        .map(|(it, index)| key(it.pos, index))
        .collect();
    for &(index, visit) in moved {
        if let Some(it) = written.get_mut(index as usize) {
            *it = key(visit, index);
        }
    }
    let was_in_order = written.is_sorted();
    references::sort_what_is_nearly_in_order(&mut written);
    let mut visits: Vec<u32> = written.iter().map(|it| (it >> 32) as u32).collect();
    let mut moves = Moves {
        file,
        visits: &visits,
        found: Vec::new(),
    };
    moves.find();
    let found = moves.found;
    if found.is_empty() {
        // `moved` has more than went into `References::visiting_order`.
        let order = || written.iter().map(|&it| it as u32).collect();
        return (!was_in_order).then(order);
    }
    // What is inside first: it stays in its part of what is around it.
    let length = |it: &Parts| match it.bounds[..] {
        [start, .., end] => end - start,
        _ => 0,
    };
    let mut inside_first: Vec<u64> = (found.iter().zip(0..))
        .map(|(it, index)| key(length(it), index))
        .collect();
    inside_first.sort();
    let first_at = {
        let written_at = visits.clone();
        move |pos: u32| written_at.partition_point(|&it| it < pos)
    };
    for parts in inside_first.iter().map(|&it| &found[it as u32 as usize]) {
        let [start, ends @ .., end] = &parts.bounds[..] else {
            continue;
        };
        for visit in &mut visits[first_at(*start)..first_at(*end)] {
            let part = ends.partition_point(|it| *it <= *visit);
            *visit = visit.wrapping_add(parts.shifts[part]);
        }
    }
    let mut made: Vec<u64> = (visits.iter().zip(0..))
        .map(|(&visit, place)| key(visit, place))
        .collect();
    references::sort_what_is_nearly_in_order(&mut made);
    let index = |place: &u64| written[*place as u32 as usize] as u32;
    Some(made.iter().map(index).collect())
}
