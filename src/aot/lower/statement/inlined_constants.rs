use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl, PatParent};
use bun_sema::check::aot::ConstLocalPrefixes;
use bun_sema::fold::{self, Constant, Decision, FoldedValue};
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey, StmtId, StmtKind, VarKind};
use smallvec::SmallVec;

use crate::lower::FileLowering;

fn to_index(key: Constant) -> Option<usize> {
    match key {
        Constant::Number(number) if number >= 0.0 && number.fract() == 0.0 => Some(number as usize),
        _ => None,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn find_inlined_constant(&mut self, name: ExprId) -> Option<Constant> {
        let (hir, bound) = (self.hir, self.bound);
        if self.transpiled.as_ref()?.has_identifier_at(hir[name].pos) {
            return None;
        }
        let Binding::Symbol(symbol) = bound.binding(name) else {
            return None;
        };
        let [Decl::Var(pattern)] = *bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let statement = bound.var_stmt[declaration.idx()];
        let is_inlined = hir[declaration].kind == VarKind::Const
            && hir[declaration].loc.end <= hir[name].pos
            && self.const_local_prefixes.contains(hir, bound, statement);
        if !is_inlined {
            return None;
        }
        if !self.inlined_constants.contains_key(&declaration) {
            self.evaluate_const_local_prefix(statement);
        }
        *self.inlined_constants.entry(declaration).or_insert(None)
    }

    fn evaluate_const_local_prefix(&mut self, statement: StmtId) {
        let (hir, bound) = (self.hir, self.bound);
        for visited in ConstLocalPrefixes::statements_in_scope_of(hir, bound, statement) {
            if !self.const_local_prefixes.contains(hir, bound, visited) {
                break;
            }
            let StmtKind::Var(declarations) = hir[visited].kind else {
                continue;
            };
            for declaration in declarations.iter() {
                let value = match hir[declaration].init.some() {
                    Some(initializer) if hir[declaration].kind == VarKind::Const => {
                        self.evaluate_inlined(initializer)
                    }
                    Some(_) | None => None,
                };
                self.inlined_constants.insert(declaration, value);
            }
        }
    }

    /// Each name in the expression gives way to the value of its constant, so none is read in its dead zone. Operands are asked first and each expression once: a sum of many terms asks for each of the sums in it.
    pub(in crate::lower) fn names_only_inlined_constants(&mut self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut pending: SmallVec<[(ExprId, bool); 16]> = SmallVec::new();
        pending.push((expression, false));
        while let Some((visited, has_asked_operands)) = pending.pop() {
            if self.names_only_inlined_constants.contains_key(&visited) {
                continue;
            }
            let mut operands: SmallVec<[ExprId; 4]> = SmallVec::new();
            let answer = match hir[visited].kind {
                ExprKind::Ident(_) => Some(self.find_inlined_constant(visited).is_some()),
                ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_) => Some(true),
                ExprKind::Binary { left, right, .. } => {
                    operands.extend([left, right]);
                    None
                }
                ExprKind::Unary { operand, .. } => {
                    operands.push(operand);
                    None
                }
                ExprKind::Template { exprs } => {
                    operands.extend(hir.ids(exprs));
                    None
                }
                _ => Some(false),
            };
            let answer = match answer {
                Some(answer) => answer,
                None if has_asked_operands => operands
                    .iter()
                    .all(|operand| self.names_only_inlined_constants[operand]),
                None => {
                    pending.push((visited, true));
                    pending.extend(operands.into_iter().map(|operand| (operand, false)));
                    continue;
                }
            };
            self.names_only_inlined_constants.insert(visited, answer);
        }
        self.names_only_inlined_constants[&expression]
    }

    fn find_folded_wherever_it_runs(&self, expression: ExprId) -> Option<Constant> {
        if let Decision::Constant(constant) = self.decisions().decision(expression) {
            return Some(constant);
        }
        match self.decisions().constant(self.hir, expression) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                Some(constant)
            }
            FoldedValue::Unknown => None,
        }
    }

    pub(super) fn is_truthy(&self, constant: Constant) -> Option<bool> {
        match constant {
            Constant::Undefined | Constant::Null => Some(false),
            Constant::Boolean(value) => Some(value),
            Constant::Number(value) => Some(value != 0.0 && !value.is_nan()),
            Constant::String(text) => Some(!self.queries.atom_bytes(text).is_empty()),
            Constant::BigInt(_) => None,
        }
    }

    fn evaluate_inlined(&mut self, expression: ExprId) -> Option<Constant> {
        let hir = self.hir;
        let mut right_operands: SmallVec<[(BinOp, ExprId); 8]> = SmallVec::new();
        let mut leftmost = hir.skip_type_assertions(expression);
        let mut value = loop {
            if let Some(folded) = self.find_folded_wherever_it_runs(leftmost) {
                break folded;
            }
            let ExprKind::Binary { op, left, right } = hir[leftmost].kind else {
                break self.evaluate_inlined_operand(leftmost)?;
            };
            right_operands.push((op, right));
            leftmost = hir.skip_type_assertions(left);
        };
        while let Some((op, right)) = right_operands.pop() {
            let takes_right = match op {
                BinOp::And => Some(self.is_truthy(value)?),
                BinOp::Or => Some(!self.is_truthy(value)?),
                BinOp::Nullish => Some(matches!(value, Constant::Null | Constant::Undefined)),
                BinOp::Comma => Some(true),
                _ => None,
            };
            value = match takes_right {
                Some(true) => self.evaluate_inlined(right)?,
                Some(false) => value,
                None => {
                    let operands = [value, self.evaluate_inlined(right)?];
                    fold::apply_binary(&self.queries.files().atoms, op, operands, usize::MAX)?
                }
            };
        }
        Some(value)
    }

    fn evaluate_inlined_operand(&mut self, expression: ExprId) -> Option<Constant> {
        let hir = self.hir;
        match hir[expression].kind {
            ExprKind::Ident(_) => self.find_inlined_constant(expression),
            ExprKind::Unary { op, operand } => {
                let operand = self.evaluate_inlined(operand)?;
                fold::apply_unary(&self.queries.files().atoms, op, operand)
            }
            ExprKind::Cond { test, branches } => {
                let test = self.evaluate_inlined(test)?;
                let branches = hir.branches(branches);
                match self.is_truthy(test)? {
                    true => self.evaluate_inlined(branches.yes),
                    false => self.evaluate_inlined(branches.no),
                }
            }
            ExprKind::Template { exprs } => {
                let mut substitutions: SmallVec<[Constant; 4]> = SmallVec::new();
                for substitution in hir.ids(exprs) {
                    substitutions.push(self.evaluate_inlined(substitution)?);
                }
                let texts: SmallVec<[Atom; 4]> = hir.ids(hir.template_texts(exprs)).collect();
                let atoms = &self.queries.files().atoms;
                fold::apply_template(atoms, &texts, &substitutions, usize::MAX)
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.evaluate_inlined_member(expression)
            }
            _ => None,
        }
    }

    fn evaluate_inlined_member(&mut self, access: ExprId) -> Option<Constant> {
        let hir = self.hir;
        if hir.has_typescript_semantics()
            && let Some(member) = self.find_enum_member_read(access)
        {
            return Some(member);
        }
        if let Some(read) = self.find_read_out_of_literal(access) {
            return match hir[read].kind {
                ExprKind::Missing => Some(Constant::Undefined),
                _ => self.evaluate_inlined(read),
            };
        }
        let (object, key) = hir.member_key(access)?;
        let Constant::String(text) = self.evaluate_inlined(object)? else {
            return None;
        };
        let key = match key {
            MemberKey::Name(name) => Constant::String(name),
            MemberKey::Computed(index) => self.evaluate_inlined(index)?,
            MemberKey::PrivateName(_) => return None,
        };
        self.evaluate_member_of_string(text, key)
    }

    fn find_read_out_of_literal(&mut self, access: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let (object, key) = hir.member_key(access)?;
        let object = hir.skip_type_assertions(object);
        let object = match self.find_read_out_of_literal(object) {
            Some(read) => hir.skip_type_assertions(read),
            None => object,
        };
        match (hir[object].kind, key) {
            (ExprKind::Object(_), _) => self.find_only_member(object, key),
            (ExprKind::Array(items), MemberKey::Computed(index)) => {
                let is_spread = |item: ExprId| matches!(hir[item].kind, ExprKind::Spread(_));
                if hir.ids(items).any(is_spread) {
                    return None;
                }
                let index = to_index(self.evaluate_inlined(index)?)?;
                hir.ids(items).nth(index)
            }
            _ => None,
        }
    }

    fn evaluate_member_of_string(&self, text: Atom, key: Constant) -> Option<Constant> {
        let bytes = self.queries.atom_bytes(text);
        match key {
            Constant::String(name) if name == known::length => {
                Some(Constant::Number(f64::from(strings::wtf8_len_utf16(bytes))))
            }
            Constant::Number(_) if bytes.is_ascii() => {
                let index = to_index(key)?;
                let unit = bytes.get(index..index.checked_add(1)?)?;
                Some(Constant::String(self.queries.files().atoms.intern(unit)))
            }
            _ => None,
        }
    }
}
