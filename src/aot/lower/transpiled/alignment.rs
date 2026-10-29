use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{AssignTarget, E, Expr, Loc, OpCode, Stmt, StmtOrExpr};
use bun_core::strings;
use bun_sema::atom::{Interner, known};
use bun_sema::bind::{Binding, Bound, Decl, PatParent};
use bun_sema::fold::{Constant, TreeNode, push_children};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, FnBody, IdList, PatId, PropKey, StmtId, StmtKind, UnOp,
};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

use super::{ParsedText, PositionSet};

/// What the transpiler prints in place of an expression.
#[derive(Copy, Clone)]
pub(in crate::lower) enum Rewrite {
    Literal {
        position: u32,
        value: Constant,
    },
    /// One of its operands, or the initializer of the variable that it names.
    Operand(ExprId),
    /// The expression itself, with its two operands exchanged.
    SwappedOperands,
    /// `x + "a" + "b"` is printed `x + "ab"`: the left operand, whose text has grown.
    JoinedWithLeftOperand,
}

#[derive(Default)]
pub(super) struct Rewrites {
    pub(super) expressions: FxHashMap<ExprId, Rewrite>,
    /// The initializers that are evaluated as the value of a `return`, each with the position of that `return`.
    pub(super) returned_initializers: FxHashMap<ExprId, u32>,
}

pub(super) struct PrintedTree<'a> {
    pub(super) identifiers: &'a PositionSet,
    pub(super) statements: &'a [(u32, Stmt)],
    /// What initializes a binding or a field, by the position of its name, and what a class extends, by the position of `class`.
    pub(super) initializers: &'a [(u32, Expr)],
    pub(super) computed_keys: &'a [(u32, Expr)],
    /// Calls by the position of their `)`, and `new` expressions by their own.
    pub(super) calls: &'a [(u32, Expr)],
    pub(super) import_paths: &'a [&'a [u8]],
}

/// Walks the front end's tree and the tree that the transpiler prints side by side.
pub(super) struct Alignment<'a, 's> {
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    atoms: &'a Interner<'s>,
    max_steps: u64,
    printed: PrintedTree<'a>,
    rewrites: FxHashMap<ExprId, Rewrite>,
    returned_initializers: FxHashMap<ExprId, u32>,
    pending: Vec<(ExprId, Expr)>,
    /// One bit for each expression that has been held against what is printed for it.
    aligned: Vec<u64>,
}

fn position_of(position: Loc) -> Option<u32> {
    u32::try_from(position.start).ok()
}

fn find_by_position<T: Copy>(sorted: &[(u32, T)], position: u32) -> Option<T> {
    let index = sorted.binary_search_by_key(&position, |entry| entry.0);
    index.ok().map(|index| sorted[index].1)
}

fn binary_op_code(op: BinOp) -> OpCode {
    match op {
        BinOp::Add => OpCode::BinAdd,
        BinOp::Sub => OpCode::BinSub,
        BinOp::Mul => OpCode::BinMul,
        BinOp::Div => OpCode::BinDiv,
        BinOp::Rem => OpCode::BinRem,
        BinOp::Pow => OpCode::BinPow,
        BinOp::Shl => OpCode::BinShl,
        BinOp::Shr => OpCode::BinShr,
        BinOp::UShr => OpCode::BinUShr,
        BinOp::BitAnd => OpCode::BinBitwiseAnd,
        BinOp::BitOr => OpCode::BinBitwiseOr,
        BinOp::BitXor => OpCode::BinBitwiseXor,
        BinOp::Lt => OpCode::BinLt,
        BinOp::Le => OpCode::BinLe,
        BinOp::Gt => OpCode::BinGt,
        BinOp::Ge => OpCode::BinGe,
        BinOp::EqEq => OpCode::BinLooseEq,
        BinOp::NotEq => OpCode::BinLooseNe,
        BinOp::EqEqEq => OpCode::BinStrictEq,
        BinOp::NotEqEq => OpCode::BinStrictNe,
        BinOp::In => OpCode::BinIn,
        BinOp::Instanceof => OpCode::BinInstanceof,
        BinOp::And => OpCode::BinLogicalAnd,
        BinOp::Or => OpCode::BinLogicalOr,
        BinOp::Nullish => OpCode::BinNullishCoalescing,
        BinOp::Comma => OpCode::BinComma,
    }
}

fn unary_op_code(op: UnOp) -> OpCode {
    match op {
        UnOp::Plus => OpCode::UnPos,
        UnOp::Minus => OpCode::UnNeg,
        UnOp::BitNot => OpCode::UnCpl,
        UnOp::Not => OpCode::UnNot,
        UnOp::Typeof => OpCode::UnTypeof,
        UnOp::Void => OpCode::UnVoid,
        UnOp::Delete => OpCode::UnDelete,
        UnOp::PreInc => OpCode::UnPreInc,
        UnOp::PreDec => OpCode::UnPreDec,
        UnOp::PostInc => OpCode::UnPostInc,
        UnOp::PostDec => OpCode::UnPostDec,
    }
}

fn is_equality(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq
    )
}

pub(in crate::lower) fn find_written_literal(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
) -> Option<Constant> {
    Some(match hir[expression].kind {
        ExprKind::Null => Constant::Null,
        ExprKind::True => Constant::Boolean(true),
        ExprKind::False => Constant::Boolean(false),
        ExprKind::Number(index) => Constant::Number(hir.numbers[index as usize]),
        ExprKind::BigInt(digits) => Constant::BigInt(digits),
        ExprKind::String(text) => Constant::String(text),
        ExprKind::Template { exprs } if exprs.is_empty() => {
            Constant::String(hir.id_at(hir.template_texts(exprs), 0))
        }
        ExprKind::Ident(name) if bound.binding(expression) == Binding::Free => match name {
            known::undefined => Constant::Undefined,
            known::NaN => Constant::Number(f64::NAN),
            known::Infinity => Constant::Number(f64::INFINITY),
            _ => return None,
        },
        _ => return None,
    })
}

fn find_assigned_value(statement: Stmt) -> Option<Expr> {
    let StmtData::SExpr(statement) = statement.data else {
        return None;
    };
    match statement.value.data {
        ExprData::EBinary(binary) if binary.op == OpCode::BinAssign => Some(binary.right),
        _ => None,
    }
}

/// The `value` of `Enum.Name = value` and of `Enum[Enum.Name = value] = "Name"`.
fn find_enum_member_value(statement: Stmt) -> Option<Expr> {
    let StmtData::SExpr(statement) = statement.data else {
        return None;
    };
    let find_assignment = |expression: Expr| match expression.data {
        ExprData::EBinary(binary) if binary.op == OpCode::BinAssign => Some(binary),
        _ => None,
    };
    let outer = find_assignment(statement.value)?;
    let inner = match outer.left.data {
        ExprData::EIndex(target) => find_assignment(target.index),
        _ => None,
    };
    Some(inner.unwrap_or(outer).right)
}

fn push_printed_operands(expression: Expr, operands: &mut Vec<Expr>) {
    match expression.data {
        ExprData::EUnary(operator) => operands.push(operator.value),
        ExprData::EBinary(operator) => operands.extend([operator.left, operator.right]),
        ExprData::EIf(choice) => operands.extend([choice.test, choice.yes, choice.no]),
        ExprData::ECall(site) => {
            operands.push(site.target);
            operands.extend_from_slice(&site.args);
        }
        ExprData::ENew(site) => {
            operands.push(site.target);
            operands.extend_from_slice(&site.args);
        }
        ExprData::EDot(access) => operands.push(access.target),
        ExprData::EIndex(access) => operands.extend([access.target, access.index]),
        ExprData::EArray(list) => operands.extend_from_slice(&list.items),
        ExprData::EObject(object) => {
            for property in object.properties.iter() {
                operands.extend(property.key);
                operands.extend(property.value);
            }
        }
        ExprData::ETemplate(template) => {
            operands.extend(template.tag);
            operands.extend(template.parts().iter().map(|part| part.value));
        }
        ExprData::ESpread(spread) => operands.push(spread.value),
        ExprData::EAwait(awaited) => operands.push(awaited.value),
        ExprData::EYield(yielded) => operands.extend(yielded.value),
        ExprData::EInlinedEnum(member) => operands.push(member.value),
        _ => {}
    }
}

fn is_same_literal(written: Constant, printed: Constant) -> bool {
    match (written, printed) {
        (Constant::Number(written), Constant::Number(printed)) => {
            written == printed || (written.is_nan() && printed.is_nan())
        }
        _ => written == printed,
    }
}

impl<'a, 's> Alignment<'a, 's> {
    pub(super) fn new(parsed: ParsedText<'a, 's>, printed: PrintedTree<'a>) -> Alignment<'a, 's> {
        Alignment {
            hir: parsed.hir,
            bound: parsed.bound,
            atoms: parsed.atoms,
            max_steps: parsed.max_steps,
            printed,
            rewrites: FxHashMap::default(),
            returned_initializers: FxHashMap::default(),
            pending: Vec::new(),
            aligned: vec![0; parsed.hir.exprs.len() / 64 + 1],
        }
    }

    pub(super) fn find_rewrites(mut self) -> Rewrites {
        for statement in (0..self.hir.stmts.len() as u32).map(StmtId) {
            self.align_statement(statement);
            self.align_pending();
        }
        for pattern in (0..self.hir.pats.len() as u32).map(PatId) {
            self.align_pattern(pattern);
            self.align_pending();
        }
        for class in self.hir.classes.iter() {
            self.align_initializer(class.extends, class.text_start);
        }
        for member in self.hir.members.iter() {
            self.align_field_initializer(member.init, member.name_pos);
        }
        // Beneath an expression that is printed in a form this walk does not know, it goes on at what keeps its position.
        for function in self.hir.fns.iter() {
            if let FnBody::Expr(body) = function.body {
                self.align_arrow_body(body);
            }
        }
        for expression in (0..self.hir.exprs.len() as u32).map(ExprId) {
            self.align_call(expression);
        }
        Rewrites {
            expressions: self.rewrites,
            returned_initializers: self.returned_initializers,
        }
    }

    fn align_pending(&mut self) {
        while let Some((expression, printed)) = self.pending.pop() {
            self.align_expression(expression, printed);
        }
    }

    fn align_arrow_body(&mut self, body: ExprId) {
        let position = self.parsed_position(body);
        if let Some(statement) = find_by_position(self.printed.statements, position)
            && let StmtData::SReturn(statement) = statement.data
        {
            self.push_optional(body, statement.value);
            self.align_pending();
        }
    }

    fn align_call(&mut self, expression: ExprId) {
        let hir = self.hir;
        let position = match hir[expression].kind {
            ExprKind::Call(site) => hir[site].close_pos,
            ExprKind::New(_) => hir[expression].pos,
            _ => return,
        };
        if !self.is_aligned(expression)
            && let Some(printed) = find_by_position(self.printed.calls, position)
        {
            self.push(expression, printed);
            self.align_pending();
        }
    }

    fn is_aligned(&self, expression: ExprId) -> bool {
        self.aligned[expression.idx() / 64] >> (expression.idx() % 64) & 1 != 0
    }

    fn align_initializer(&mut self, initializer: ExprId, position: u32) {
        let printed = find_by_position(self.printed.initializers, position);
        self.push_optional(initializer, printed);
        self.align_pending();
    }

    /// A field that the constructor assigns is printed `this.name = initializer`, at the position of its name.
    fn align_field_initializer(&mut self, initializer: ExprId, name_position: u32) {
        let assignment = find_by_position(self.printed.statements, name_position);
        match assignment.and_then(find_assigned_value) {
            Some(printed) => {
                self.push(initializer, printed);
                self.align_pending();
            }
            None => self.align_initializer(initializer, name_position),
        }
    }

    fn align_pattern(&mut self, pattern: PatId) {
        let hir = self.hir;
        let position = hir[pattern].pos;
        let parent = self.bound.pat_parent[pattern.idx()];
        let initializer = find_by_position(self.printed.initializers, position);
        self.push_optional(parent.initializer(hir), initializer);
        if let PatParent::Prop(_, property) = parent
            && let PropKey::Computed(key) = hir[property].key
        {
            self.push_optional(key, find_by_position(self.printed.computed_keys, position));
        }
    }

    fn push(&mut self, expression: ExprId, printed: Expr) {
        if expression.is_some() {
            self.pending.push((expression, printed));
        }
    }

    fn push_optional(&mut self, expression: ExprId, printed: Option<Expr>) {
        if let Some(printed) = printed {
            self.push(expression, printed);
        }
    }

    fn push_each(&mut self, expressions: IdList<ExprId>, printed: &[Expr]) {
        if expressions.len() == printed.len() {
            for (expression, &printed) in self.hir.ids(expressions).zip(printed) {
                self.push(expression, printed);
            }
        }
    }

    fn align_statement(&mut self, statement: StmtId) {
        let hir = self.hir;
        let stmt = hir[statement];
        if let StmtKind::Enum(enumeration) = stmt.kind {
            for member in hir[enumeration].members.iter().map(|member| hir[member]) {
                let printed = find_by_position(self.printed.statements, member.pos);
                self.push_optional(member.init, printed.and_then(find_enum_member_value));
            }
            return;
        }
        let Some(printed) = find_by_position(self.printed.statements, stmt.start) else {
            return;
        };
        match (stmt.kind, printed.data) {
            (StmtKind::Expr(value), StmtData::SExpr(printed)) => self.push(value, printed.value),
            (StmtKind::Return(value), StmtData::SReturn(printed)) => {
                if let (Some(value), Some(printed)) = (value.some(), printed.value) {
                    self.align_returned_value(value, printed, stmt.start);
                }
            }
            (StmtKind::Throw(value), StmtData::SThrow(printed)) => self.push(value, printed.value),
            (StmtKind::If { test, .. }, StmtData::SIf(printed)) => self.push(test, printed.test),
            (StmtKind::While { test, .. }, StmtData::SWhile(printed)) => {
                self.push(test, printed.test);
            }
            (StmtKind::While { test, .. }, StmtData::SFor(printed)) => {
                self.push_optional(test, printed.test);
            }
            (StmtKind::DoWhile { test, .. }, StmtData::SDoWhile(printed)) => {
                self.push(test, printed.test);
            }
            (StmtKind::For { test, update, .. }, StmtData::SFor(printed)) => {
                self.push_optional(test, printed.test);
                self.push_optional(update, printed.update);
            }
            (StmtKind::ForIn { expr, .. }, StmtData::SForIn(printed)) => {
                self.push(expr, printed.value);
            }
            (StmtKind::ForOf { expr, .. }, StmtData::SForOf(printed)) => {
                self.push(expr, printed.value);
            }
            (StmtKind::With { object, .. }, StmtData::SWith(printed)) => {
                self.push(object, printed.value);
            }
            (StmtKind::Switch { expr, cases }, StmtData::SSwitch(printed)) => {
                self.push(expr, printed.test);
                let printed_cases = printed.cases.slice();
                if cases.len() == printed_cases.len() {
                    for (case, printed) in cases.iter().zip(printed_cases) {
                        self.push_optional(hir[case].test, printed.value);
                    }
                }
            }
            (StmtKind::ExportDefault(value), StmtData::SExportDefault(printed)) => {
                if let StmtOrExpr::Expr(printed) = printed.value {
                    self.push(value, printed);
                }
            }
            _ => {}
        }
    }

    /// `const a = f(); const b = a; return b;` is printed `return f();`: both initializers are evaluated there.
    /// Of `const c = 1; g(); return c;` the `return` has the value alone.
    fn align_returned_value(&mut self, value: ExprId, printed: Expr, position: u32) {
        if !self.align_expression(value, printed) {
            return;
        }
        let hir = self.hir;
        let mut current = hir.skip_type_assertions(value);
        while let Some(&Rewrite::Operand(operand)) = self.rewrites.get(&current) {
            if let ExprKind::Ident(_) = hir[current].kind {
                self.returned_initializers.insert(operand, position);
            }
            current = hir.skip_type_assertions(operand);
        }
    }

    fn text_of(&self, string: &E::EString) -> Vec<u8> {
        let mut text = Vec::new();
        let mut part = Some(string);
        while let Some(string) = part {
            match string.is_utf8() {
                true => text.extend_from_slice(string.slice8()),
                false => text.extend_from_slice(&strings::to_utf8_alloc(string.slice16())),
            }
            part = string.next.as_deref();
        }
        text
    }

    fn find_literal_value(&self, printed: Expr) -> Option<Constant> {
        Some(match printed.data {
            ExprData::ENumber(number) => Constant::Number(number.value()),
            ExprData::EBoolean(boolean) | ExprData::EBranchBoolean(boolean) => {
                Constant::Boolean(boolean.value)
            }
            ExprData::ENull(_) => Constant::Null,
            ExprData::EUndefined(_) => Constant::Undefined,
            ExprData::EBigInt(number) => Constant::BigInt(self.atoms.intern(number.value.slice())),
            ExprData::EString(string) => {
                Constant::String(self.atoms.intern(&self.text_of(&string)))
            }
            _ => return None,
        })
    }

    fn find_initializer_of_replaced_name(&self, name: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        if self.printed.identifiers.contains(hir[name].pos) {
            return None;
        }
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        let [Decl::Var(pattern) | Decl::Require(pattern)] = *self.bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Var(declaration) = self.bound.pat_parent[pattern.idx()] else {
            return None;
        };
        let is_declared = hir[declaration].loc.end <= hir[name].pos;
        hir[declaration].init.some().filter(|_| is_declared)
    }

    /// The position that the parser gives the expression: that of its first operand, without parentheses.
    fn parsed_position(&self, expression: ExprId) -> u32 {
        let hir = self.hir;
        let mut first = hir.skip_type_assertions(expression);
        loop {
            let next = match hir[first].kind {
                ExprKind::Binary { left, .. } => left,
                ExprKind::Cond { test, .. } => test,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => obj,
                ExprKind::Call(site) | ExprKind::TaggedTemplate(site) => hir[site].callee,
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => operand,
                _ => return hir[first].pos,
            };
            first = hir.skip_type_assertions(next);
        }
    }

    /// The operands that may be printed in place of the expression.
    fn operands_printed_alone(&self, expression: ExprId) -> SmallVec<[ExprId; 4]> {
        let hir = self.hir;
        match hir[expression].kind {
            ExprKind::Ident(_) => self
                .find_initializer_of_replaced_name(expression)
                .into_iter()
                .collect(),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => smallvec![right],
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => smallvec![left, right],
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                smallvec![branches.yes, branches.no]
            }
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Void,
                operand,
            } => smallvec![operand],
            ExprKind::Index { obj, .. } | ExprKind::Dot { obj, .. } => {
                let mut object = hir.skip_type_assertions(obj);
                if let Some(initializer) = self.find_initializer_of_replaced_name(object) {
                    object = hir.skip_type_assertions(initializer);
                }
                match hir[object].kind {
                    ExprKind::Array(elements) => hir.ids(elements).collect(),
                    ExprKind::Object(properties) => properties
                        .iter()
                        .map(|property| hir[property].value)
                        .filter(|value| value.is_some())
                        .collect(),
                    _ => SmallVec::new(),
                }
            }
            _ => SmallVec::new(),
        }
    }

    /// Whether the expression, or what may be printed in its place, is what the caller looks for.
    fn may_be_printed_as(&self, expression: ExprId, is_found: impl Fn(ExprId) -> bool) -> bool {
        let hir = self.hir;
        let mut candidates: SmallVec<[ExprId; 8]> = smallvec![expression];
        let mut searched = 0;
        while let Some(candidate) = candidates.pop() {
            searched += 1;
            if searched > self.max_steps {
                return false;
            }
            let candidate = hir.skip_type_assertions(candidate);
            if is_found(candidate) {
                return true;
            }
            candidates.extend(self.operands_printed_alone(candidate));
            // A folded result may take the position of what is printed for its first operand.
            if let ExprKind::Binary { left, .. } = hir[candidate].kind {
                candidates.push(left);
            }
        }
        false
    }

    fn may_be_printed_at(&self, expression: ExprId, position: Loc) -> bool {
        let position = position_of(position);
        self.may_be_printed_as(expression, |it| Some(self.parsed_position(it)) == position)
    }

    fn find_operand_printed_at(&self, expression: ExprId, position: Loc) -> Option<ExprId> {
        let operands = self.operands_printed_alone(expression);
        operands
            .into_iter()
            .find(|&operand| self.may_be_printed_at(operand, position))
    }

    /// `require(a ? "b" : "c")` is printed `a ? require("b") : require("c")`.
    fn align_specifier(&mut self, specifier: ExprId, printed: Expr) -> bool {
        let hir = self.hir;
        let mut pending: SmallVec<[(ExprId, Expr); 4]> = smallvec![(specifier, printed)];
        while let Some((specifier, printed)) = pending.pop() {
            let import_record_index = match printed.data {
                ExprData::ERequireString(required) => required.import_record_index,
                ExprData::ERequireResolveString(resolved) => resolved.import_record_index,
                ExprData::EIf(printed) => {
                    let specifier = hir.skip_type_assertions(specifier);
                    let ExprKind::Cond { test, branches } = hir[specifier].kind else {
                        return false;
                    };
                    let branches = hir.branches(branches);
                    self.push(test, printed.test);
                    pending.push((branches.yes, printed.yes));
                    pending.push((branches.no, printed.no));
                    continue;
                }
                _ => return false,
            };
            let paths = self.printed.import_paths;
            if let Some(path) = paths.get(import_record_index as usize) {
                self.align_literal(specifier, path, printed.loc);
            }
        }
        true
    }

    /// Of `(0, require)("a")` the transpiler prints `require("a")`.
    fn align_callee_with_require(&mut self, callee: ExprId) {
        let hir = self.hir;
        let is_require =
            |candidate: ExprId| matches!(hir[candidate].kind, ExprKind::Ident(known::require));
        let mut callee = hir.skip_type_assertions(callee);
        for _ in 0..self.max_steps {
            let operands = self.operands_printed_alone(callee);
            let mut operands = operands.into_iter();
            let Some(operand) = operands.find(|&it| self.may_be_printed_as(it, is_require)) else {
                return;
            };
            self.rewrites.insert(callee, Rewrite::Operand(operand));
            callee = hir.skip_type_assertions(operand);
        }
    }

    /// True: what is printed evaluates the expression, or what stands for it. False: its value is printed, or it has been aligned before.
    fn align_expression(&mut self, expression: ExprId, printed: Expr) -> bool {
        let printed = match printed.data {
            ExprData::EInlinedEnum(member) => member.value,
            _ => printed,
        };
        let literal = self.find_literal_value(printed);
        self.align_with(expression, Some(printed), literal, printed.loc)
    }

    fn align_literal(&mut self, expression: ExprId, text: &[u8], position: Loc) {
        let literal = Constant::String(self.atoms.intern(text));
        self.align_with(expression, None, Some(literal), position);
    }

    fn align_with(
        &mut self,
        expression: ExprId,
        printed: Option<Expr>,
        literal: Option<Constant>,
        position: Loc,
    ) -> bool {
        let hir = self.hir;
        let mut current = hir.skip_type_assertions(expression);
        if self.is_aligned(current) {
            return false;
        }
        for _ in 0..self.max_steps {
            self.aligned[current.idx() / 64] |= 1 << (current.idx() % 64);
            if let Some(printed) = printed
                && self.align_operands(current, printed)
            {
                return true;
            }
            let written = find_written_literal(hir, self.bound, current);
            if let (Some(written), Some(printed)) = (written, literal)
                && is_same_literal(written, printed)
            {
                return false;
            }
            if let (
                ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    ..
                },
                Some(ExprData::EBinary(sum)),
            ) = (hir[current].kind, printed.map(|printed| printed.data))
                && sum.op == OpCode::BinAdd
            {
                self.rewrites
                    .insert(current, Rewrite::JoinedWithLeftOperand);
                current = hir.skip_type_assertions(left);
                continue;
            }
            let Some(operand) = self.find_operand_printed_at(current, position) else {
                break;
            };
            self.rewrites.insert(current, Rewrite::Operand(operand));
            current = hir.skip_type_assertions(operand);
        }
        if let (Some(value), Some(position)) = (literal, position_of(position)) {
            self.rewrites
                .insert(current, Rewrite::Literal { position, value });
            return false;
        }
        if let Some(printed) = printed {
            self.align_beneath(current, printed);
        }
        printed.is_some()
    }

    /// The expression is printed in a form that this walk does not know. What stands beneath it is looked for beneath what is printed, by position.
    fn align_beneath(&mut self, expression: ExprId, printed: Expr) {
        let hir = self.hir;
        let mut candidates: Vec<Expr> = Vec::new();
        let mut pending_candidates = vec![printed];
        while let Some(candidate) = pending_candidates.pop() {
            if candidates.len() as u64 >= self.max_steps {
                return;
            }
            candidates.push(candidate);
            push_printed_operands(candidate, &mut pending_candidates);
        }
        let mut beneath = Vec::new();
        push_children(hir, TreeNode::Expr(expression), &mut beneath);
        let mut steps = 0;
        while let Some(node) = beneath.pop() {
            let TreeNode::Expr(operand) = node else {
                continue;
            };
            steps += 1;
            if steps > self.max_steps {
                return;
            }
            let operand = hir.skip_type_assertions(operand);
            if operand.is_none() || self.is_aligned(operand) {
                continue;
            }
            let position = Some(self.parsed_position(operand));
            let mut same = candidates.iter().copied();
            let same = same.find(|&candidate| {
                position_of(candidate.loc) == position && self.align_operands(operand, candidate)
            });
            if same.is_some() {
                self.aligned[operand.idx() / 64] |= 1 << (operand.idx() % 64);
                continue;
            }
            let mut replacements = candidates.iter().rev().copied();
            let replacement = replacements.find(|&candidate| {
                match self.find_literal_value(candidate).is_some() {
                    true => self.may_be_printed_at(operand, candidate.loc),
                    false => self
                        .find_operand_printed_at(operand, candidate.loc)
                        .is_some(),
                }
            });
            match replacement {
                Some(replacement) => self.push(operand, replacement),
                None => push_children(hir, TreeNode::Expr(operand), &mut beneath),
            }
        }
    }

    /// False: something else is printed in place of the expression.
    fn align_operands(&mut self, expression: ExprId, printed: Expr) -> bool {
        let hir = self.hir;
        match (hir[expression].kind, printed.data) {
            (
                ExprKind::Ident(_),
                ExprData::EIdentifier(_)
                | ExprData::EImportIdentifier(_)
                | ExprData::ECommonjsExportIdentifier(_),
            ) => position_of(printed.loc) == Some(hir[expression].pos),
            (ExprKind::Binary { op, left, right }, ExprData::EBinary(printed))
                if printed.op == binary_op_code(op) =>
            {
                let is_in_order = self.may_be_printed_at(right, printed.right.loc);
                let is_swapped = !is_in_order
                    && is_equality(op)
                    && self.may_be_printed_at(left, printed.right.loc)
                    && self.may_be_printed_at(right, printed.left.loc);
                let (printed_left, printed_right) = match (is_in_order, is_swapped) {
                    (true, _) => (printed.left, printed.right),
                    (false, true) => (printed.right, printed.left),
                    (false, false) => return false,
                };
                if is_swapped {
                    self.rewrites.insert(expression, Rewrite::SwappedOperands);
                }
                self.push(left, printed_left);
                self.push(right, printed_right);
                true
            }
            (ExprKind::Assign { target, value, .. }, ExprData::EBinary(printed))
                if printed.op.binary_assign_target() != AssignTarget::None =>
            {
                self.push(target, printed.left);
                self.push(value, printed.right);
                true
            }
            (ExprKind::Unary { op, operand }, ExprData::EUnary(printed))
                if printed.op == unary_op_code(op) =>
            {
                self.push(operand, printed.value);
                true
            }
            (ExprKind::Cond { test, branches }, ExprData::EIf(printed)) => {
                let branches = hir.branches(branches);
                let is_same = self.may_be_printed_at(branches.yes, printed.yes.loc)
                    && self.may_be_printed_at(branches.no, printed.no.loc);
                if is_same {
                    self.push(test, printed.test);
                    self.push(branches.yes, printed.yes);
                    self.push(branches.no, printed.no);
                }
                is_same
            }
            (ExprKind::Call(site), ExprData::ECall(printed)) => {
                let site = hir[site];
                let is_same = position_of(printed.close_paren_loc) == Some(site.close_pos);
                if is_same {
                    self.push(site.callee, printed.target);
                    self.push_each(site.args, &printed.args);
                }
                is_same
            }
            (
                ExprKind::Call(site),
                ExprData::ERequireString(_) | ExprData::ERequireResolveString(_) | ExprData::EIf(_),
            ) => {
                let [specifier] = hir.ids[hir[site].args.range()] else {
                    return false;
                };
                let is_same = self.align_specifier(ExprId::from(specifier), printed);
                if is_same {
                    self.align_callee_with_require(hir[site].callee);
                }
                is_same
            }
            (ExprKind::New(site), ExprData::ENew(constructed)) => {
                let is_same = position_of(printed.loc) == Some(hir[expression].pos);
                if is_same {
                    self.push(hir[site].callee, constructed.target);
                    self.push_each(hir[site].args, &constructed.args);
                }
                is_same
            }
            (ExprKind::Dot { obj, .. }, ExprData::EDot(printed)) => {
                let is_same = position_of(printed.name_loc) == Some(hir.name_pos(expression));
                if is_same {
                    self.push(obj, printed.target);
                }
                is_same
            }
            (ExprKind::Dot { obj, .. }, ExprData::EIndex(printed)) => {
                let is_same = position_of(printed.index.loc) == Some(hir.name_pos(expression));
                if is_same {
                    self.push(obj, printed.target);
                }
                is_same
            }
            // `a["b" + "c"]` is printed `a.bc`.
            (ExprKind::Index { obj, index, .. }, ExprData::EDot(printed)) => {
                self.push(obj, printed.target);
                self.align_literal(index, printed.name.slice(), printed.name_loc);
                true
            }
            (ExprKind::Index { obj, index, .. }, ExprData::EIndex(printed)) => {
                let is_same = self.may_be_printed_at(index, printed.index.loc);
                if is_same {
                    self.push(obj, printed.target);
                    self.push(index, printed.index);
                }
                is_same
            }
            (ExprKind::Array(elements), ExprData::EArray(list)) => {
                let is_same = position_of(printed.loc) == Some(hir[expression].pos);
                if is_same {
                    self.push_each(elements, &list.items);
                }
                is_same
            }
            (ExprKind::Object(properties), ExprData::EObject(object)) => {
                let is_same = position_of(printed.loc) == Some(hir[expression].pos);
                if is_same && properties.len() == object.properties.len() {
                    for (property, printed) in properties.iter().zip(object.properties.iter()) {
                        let property = hir[property];
                        if let PropKey::Computed(key) = property.key {
                            self.push_optional(key, printed.key);
                        }
                        self.push_optional(property.value, printed.value);
                    }
                }
                is_same
            }
            (ExprKind::Template { exprs }, ExprData::ETemplate(template))
                if template.tag.is_none() =>
            {
                let parts = template.parts();
                if exprs.len() == parts.len() {
                    for (expression, part) in hir.ids(exprs).zip(parts) {
                        self.push(expression, part.value);
                    }
                }
                true
            }
            (ExprKind::TaggedTemplate(site), ExprData::ETemplate(template)) => {
                let Some(tag) = template.tag else {
                    return false;
                };
                let site = hir[site];
                self.push(site.callee, tag);
                let parts = template.parts();
                if site.args.len() == parts.len() {
                    for (expression, part) in hir.ids(site.args).zip(parts) {
                        self.push(expression, part.value);
                    }
                }
                true
            }
            (ExprKind::Spread(operand), ExprData::ESpread(printed)) => {
                self.push(operand, printed.value);
                true
            }
            (ExprKind::Await(operand), ExprData::EAwait(printed)) => {
                self.push(operand, printed.value);
                true
            }
            (ExprKind::Yield { value, .. }, ExprData::EYield(printed)) => {
                self.push_optional(value, printed.value);
                true
            }
            (ExprKind::Fn(function), ExprData::EArrow(arrow)) => {
                if let FnBody::Expr(body) = hir[function].body
                    && let [returned] = arrow.body.stmts.slice()
                    && position_of(returned.loc) == Some(self.parsed_position(body))
                    && let StmtData::SReturn(returned) = returned.data
                {
                    self.push_optional(body, returned.value);
                }
                true
            }
            (ExprKind::ImportCall { args }, ExprData::EImport(import)) => {
                self.push(hir.id_at(args, 0), import.expr);
                true
            }
            (ExprKind::Fn(_), ExprData::EFunction(_))
            | (ExprKind::Class(_), ExprData::EClass(_))
            | (ExprKind::This, ExprData::EThis(_))
            | (ExprKind::Super, ExprData::ESuper(_))
            | (ExprKind::Regex { .. }, ExprData::ERegExp(_)) => true,
            _ => false,
        }
    }
}
