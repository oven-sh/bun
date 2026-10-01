//! PROTOTYPE (research of B3, never part of the worktree): what typescript-go reads another way than Bun's parse pass, found in the finished tree of a lint parse.
//! The walk reports the one place that stands first in the source. It runs after a lint parse that logged nothing.

use std::collections::HashMap;

use bun_alloc::Arena;
use bun_ast::walk::{self, Visitor};
use bun_ast::{
    B, Binding, E, Expr, ExprData, G, Loc, Log, OpCode, Range, S, Source, Stmt, StmtData,
    StmtOrExpr, ts,
};

use crate::Error;
use crate::lexer::{Lexer, T};
use crate::p::P;
use crate::parse::erased::{ErasedData, ErasedMemberData, ErasedTables};
use crate::parse::syntax_errors as codes;
use crate::parse::wrappers::{ExprId, Wrapper, WrapperData};

/// What the reference reports at the place.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Report {
    /// The expression ends before the token: the reference asks for what follows the expression there.
    Ends,
    /// Expression_expected at the token.
    ExpressionExpected,
    /// Identifier_expected where the dot ends; the token is the name.
    IdentifierExpected,
    /// The "=" after the block of a function expression.
    AfterBlock,
}

#[derive(Clone, Copy)]
struct Found {
    /// The token the message of Bun is at.
    token_start: u32,
    token_end: u32,
    token: T,
    line_break_before: bool,
    /// Where the diagnostic of the reference starts and ends.
    start: u32,
    end: u32,
    report: Report,
    /// The node whose reading the reference ends at the token.
    node: ExprId,
}

/// What the reference expects after an expression.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum After {
    Statement,
    Declaration,
    ForDeclaration,
    ClassField,
    EnumMember,
    Token(T),
}

/// What the reference reads after a statement that a line break ended.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Follow {
    List,
    Case,
    Do,
}

#[derive(Clone, Copy)]
struct Context {
    after: After,
    follow: Follow,
}

struct Tok {
    token: T,
    start: u32,
    end: u32,
    line_break_before: bool,
}

struct Checker<'s, 'a> {
    source: &'a Source,
    contents: &'a [u8],
    arena: &'a Arena,
    comments: &'s [Range],
    wrappers: &'s [Wrapper],
    /// The last record of each operand, and for each record the one before it of the same operand plus one.
    index: Option<(HashMap<ExprId, u32>, Vec<u32>)>,
    scratch_log: Box<Log>,
    stack: bun_core::StackCheck,
    best: Option<Found>,
}

fn offset(loc: Loc) -> Option<u32> {
    u32::try_from(loc.start).ok()
}

fn is_postfix(op: OpCode) -> bool {
    matches!(op, OpCode::UnPostInc | OpCode::UnPostDec)
}

fn is_prefix_update(op: OpCode) -> bool {
    matches!(op, OpCode::UnPreInc | OpCode::UnPreDec)
}

/// A kind that ast.IsLeftHandSideExpression does not take.
fn is_no_left_hand_side_kind(expr: &Expr) -> bool {
    matches!(
        expr.data,
        ExprData::EUnary(_)
            | ExprData::EBinary(_)
            | ExprData::EIf(_)
            | ExprData::EAwait(_)
            | ExprData::EYield(_)
            | ExprData::EArrow(_)
            | ExprData::ESpread(_)
    )
}

fn id_of_binary(node: &E::Binary, loc: Loc) -> ExprId {
    ExprId {
        loc: loc.start,
        tag: bun_ast::ExprTag::EBinary,
        payload: core::ptr::from_ref(node) as usize,
    }
}

impl<'s, 'a> Checker<'s, 'a> {
    fn records(&mut self) -> &(HashMap<ExprId, u32>, Vec<u32>) {
        let wrappers = self.wrappers;
        self.index.get_or_insert_with(|| {
            let mut last: HashMap<ExprId, u32> = HashMap::new();
            let mut before: Vec<u32> = Vec::with_capacity(wrappers.len());
            for (at, record) in wrappers.iter().enumerate() {
                let previous = last.insert(ExprId::of(&record.operand), at as u32);
                before.push(previous.map_or(0, |index| index + 1));
            }
            (last, before)
        })
    }

    /// The wrapper that stands around all the others of `expr`.
    fn outer(&mut self, expr: &Expr) -> Option<Wrapper> {
        if self.wrappers.is_empty() {
            return None;
        }
        let id = ExprId::of(expr);
        let at = *self.records().0.get(&id)?;
        self.wrappers.get(at as usize).copied()
    }

    /// Every wrapper of `expr`, the outer one first.
    fn wrappers_of(&mut self, expr: &Expr) -> Vec<Wrapper> {
        let mut list = Vec::new();
        if self.wrappers.is_empty() {
            return list;
        }
        let id = ExprId::of(expr);
        let Some(&last) = self.records().0.get(&id) else {
            return list;
        };
        let mut at = last + 1;
        while at != 0 {
            let Some(record) = self.wrappers.get(at as usize - 1).copied() else {
                break;
            };
            list.push(record);
            at = self.records().1.get(at as usize - 1).copied().unwrap_or(0);
        }
        list
    }

    /// Parentheses or a non-null "!" make a left-hand side expression of anything.
    fn is_made_left_hand_side(&mut self, expr: &Expr) -> bool {
        matches!(
            self.outer(expr).map(|record| record.data),
            Some(WrapperData::Parenthesized | WrapperData::NonNull)
        )
    }

    /// The left side of an assignment: ast.IsLeftHandSideExpression.
    fn is_left_hand_side(&mut self, expr: &Expr) -> bool {
        match self.outer(expr).map(|record| record.data) {
            Some(WrapperData::Parenthesized | WrapperData::NonNull) => true,
            Some(
                WrapperData::As(_) | WrapperData::Satisfies(_) | WrapperData::TypeAssertion(_),
            ) => false,
            None => !is_no_left_hand_side_kind(expr),
        }
    }

    /// What parseLeftHandSideExpressionOrHigher does not return: a member, a call, a template or an update does not go on from it.
    fn ends_the_chain(&mut self, expr: &Expr) -> bool {
        let kind = is_no_left_hand_side_kind(expr) || matches!(expr.data, ExprData::EJsxElement(_));
        kind && !self.is_made_left_hand_side(expr)
    }

    fn lexer_at(&mut self, at: u32) -> Option<Lexer<'a>> {
        if at as usize > self.contents.len() {
            return None;
        }
        let mut lexer = Lexer::init_without_reading(&mut self.scratch_log, self.source, self.arena);
        lexer.is_log_disabled = true;
        lexer.current = at as usize;
        lexer.step();
        Some(lexer)
    }

    fn next(lexer: &mut Lexer<'a>) -> Option<Tok> {
        lexer.next().ok()?;
        Some(Tok {
            token: lexer.token,
            start: u32::try_from(lexer.start).ok()?,
            end: u32::try_from(lexer.end).ok()?,
            line_break_before: lexer.has_newline_before,
        })
    }

    /// The token that starts at or after `at`.
    fn token_at(&mut self, at: u32) -> Option<Tok> {
        let mut lexer = self.lexer_at(at)?;
        Self::next(&mut lexer)
    }

    fn byte(&self, at: u32) -> Option<u8> {
        self.contents.get(at as usize).copied()
    }

    /// Where `expr` starts as it is written: parentheses and a type assertion stand before the node.
    fn start_of(&mut self, expr: &Expr) -> u32 {
        let mut start = u32::try_from(expr.loc.start).unwrap_or(0);
        let mut node = *expr;
        let mut steps = 0u32;
        loop {
            for record in self.wrappers_of(&node) {
                if matches!(
                    record.data,
                    WrapperData::Parenthesized | WrapperData::TypeAssertion(_)
                ) {
                    start = start.min(record.op);
                }
            }
            let next = match &node.data {
                ExprData::EBinary(e) => e.left,
                ExprData::ECall(e) => e.target,
                ExprData::EDot(e) => e.target,
                ExprData::EIndex(e) => e.target,
                ExprData::EIf(e) => e.test,
                ExprData::EUnary(e) if is_postfix(e.op) => e.value,
                ExprData::ETemplate(e) => match e.tag {
                    Some(tag) => tag,
                    None => break,
                },
                _ => break,
            };
            node = next;
            steps += 1;
            if steps > 1_000_000 {
                break;
            }
        }
        start
    }

    /// The offset after the last token of `expr` as it is written. `None`: the tree does not say.
    fn end_of(&mut self, expr: &Expr) -> Option<u32> {
        if !self.stack.is_safe_to_recurse() {
            return None;
        }
        let after: Option<u32> = self
            .wrappers_of(expr)
            .iter()
            .filter(|record| !matches!(record.data, WrapperData::TypeAssertion(_)))
            .map(|record| record.end)
            .max();
        if after.is_some() {
            return after;
        }
        match &expr.data {
            ExprData::EIdentifier(_)
            | ExprData::EPrivateIdentifier(_)
            | ExprData::EThis(_)
            | ExprData::ESuper(_)
            | ExprData::ENull(_)
            | ExprData::EBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_) => Some(self.token_at(offset(expr.loc)?)?.end),
            ExprData::ERegExp(_) => {
                let mut lexer = self.lexer_at(offset(expr.loc)?)?;
                let slash = Self::next(&mut lexer)?;
                if !matches!(slash.token, T::TSlash | T::TSlashEquals) {
                    return None;
                }
                lexer.scan_reg_exp().ok()?;
                u32::try_from(lexer.end).ok()
            }
            ExprData::EImportMeta(_) => {
                let mut lexer = self.lexer_at(offset(expr.loc)?)?;
                Self::next(&mut lexer)?;
                Self::next(&mut lexer)?;
                Some(Self::next(&mut lexer)?.end)
            }
            ExprData::ENewTarget(e) => u32::try_from(e.range.end().start).ok(),
            ExprData::EDot(e) => Some(self.token_at(offset(e.name_loc)?)?.end),
            ExprData::EIndex(e) => {
                if matches!(e.index.data, ExprData::EPrivateIdentifier(_)) {
                    return Some(self.token_at(offset(e.index.loc)?)?.end);
                }
                let index = e.index;
                let end = self.end_of(&index)?;
                let close = self.token_at(end)?;
                (close.token == T::TCloseBracket).then_some(close.end)
            }
            ExprData::ECall(e) => self.after_byte(e.close_paren_loc, b')'),
            ExprData::ENew(e) => {
                if e.close_parens_loc.start >= 0 {
                    return self.after_byte(e.close_parens_loc, b')');
                }
                let target = e.target;
                self.end_of(&target)
            }
            ExprData::EArray(e) => self.after_byte(e.close_bracket_loc, b']'),
            ExprData::EObject(e) => self.after_byte(e.close_brace_loc, b'}'),
            ExprData::EClass(e) => self.after_byte(e.close_brace_loc, b'}'),
            ExprData::EUnary(e) => {
                let value = e.value;
                let end = self.end_of(&value)?;
                if !is_postfix(e.op) {
                    return Some(end);
                }
                let operator = self.token_at(end)?;
                matches!(operator.token, T::TPlusPlus | T::TMinusMinus).then_some(operator.end)
            }
            ExprData::EBinary(e) => {
                let right = e.right;
                self.end_of(&right)
            }
            ExprData::EIf(e) => {
                let no = e.no;
                self.end_of(&no)
            }
            ExprData::EAwait(e) => {
                let value = e.value;
                self.end_of(&value)
            }
            ExprData::ESpread(e) => {
                let value = e.value;
                self.end_of(&value)
            }
            ExprData::EYield(e) => {
                let value = e.value?;
                self.end_of(&value)
            }
            ExprData::EJsxElement(e) => {
                let from = offset(e.close_tag_loc)? as usize;
                let close = self.contents.get(from..)?.iter().position(|byte| *byte == b'>')?;
                u32::try_from(from + close + 1).ok()
            }
            ExprData::ETemplate(e) => {
                if !e.parts().is_empty() {
                    return None;
                }
                let from = match e.tag {
                    Some(tag) => self.end_of(&tag)?,
                    None => offset(expr.loc)?,
                };
                let template = self.token_at(from)?;
                (template.token == T::TNoSubstitutionTemplateLiteral).then_some(template.end)
            }
            _ => None,
        }
    }

    fn after_byte(&self, loc: Loc, byte: u8) -> Option<u32> {
        let at = offset(loc)?;
        (self.byte(at) == Some(byte)).then_some(at + 1)
    }

    fn keep(&mut self, found: Found) {
        let first = match &self.best {
            Some(best) => (found.start, found.end) < (best.start, best.end),
            None => true,
        };
        if first {
            self.best = Some(found);
        }
    }

    fn at_token(token: &Tok, report: Report, node: ExprId) -> Found {
        Found {
            token_start: token.start,
            token_end: token.end,
            token: token.token,
            line_break_before: token.line_break_before,
            start: token.start,
            end: token.end,
            report,
            node,
        }
    }

    /// The first token after `expr`, which the reference does not go on from.
    fn token_after(&mut self, expr: &Expr) -> Option<Tok> {
        let end = self.end_of(expr)?;
        self.token_at(end)
    }

    /// Where nothing says where the token is: the place of the node, as a position.
    fn at_node(node: ExprId, report: Report) -> Found {
        let at = u32::try_from(node.loc).unwrap_or(0);
        Found {
            token_start: at,
            token_end: at,
            token: T::TEndOfFile,
            line_break_before: false,
            start: at,
            end: at,
            report,
            node,
        }
    }

    /// parseAssignmentExpressionOrHigher reads an assignment after a left-hand side expression only.
    fn assignment(&mut self, node: &E::Binary, loc: Loc) {
        let left = node.left;
        let id = id_of_binary(node, loc);
        let report = if node.op == OpCode::BinAssign
            && matches!(left.data, ExprData::EFunction(_))
            && self.outer(&left).is_none()
        {
            // parseBlock: "=" after the block of a function expression
            Report::AfterBlock
        } else if !self.is_left_hand_side(&left) {
            Report::Ends
        } else {
            return;
        };
        let operator = bun_ast::op::TABLE.get_ptr_const(node.op).text;
        // Forward from the end of the left side, where the tree says where that is.
        if let Some(token) = self.token_after(&left)
            && token.token.is_assign()
            && self.contents.get(token.start as usize..token.end as usize) == Some(operator)
        {
            self.keep(Self::at_token(&token, report, id));
            return;
        }
        // Back from the start of the right side.
        let right = node.right;
        let right_start = self.start_of(&right);
        let end = ts::full_start(self.contents, self.comments, right_start);
        if let Some(start) = end.checked_sub(operator.len() as u32)
            && self.contents.get(start as usize..end as usize) == Some(operator)
        {
            let before = ts::full_start(self.contents, self.comments, start);
            let line_break_before = self
                .contents
                .get(before as usize..start as usize)
                .is_some_and(|between| between.iter().any(|byte| matches!(byte, b'\n' | b'\r')));
            if let Some(mut token) = self.token_at(start)
                && token.start == start
            {
                token.line_break_before = line_break_before;
                self.keep(Self::at_token(&token, report, id));
                return;
            }
        }
        self.keep(Self::at_node(id, report));
    }

    /// parseUpdateExpression reads the operand of "++" and "--" with parseLeftHandSideExpressionOrHigher, and one postfix operator.
    fn update(&mut self, node: &E::Unary, loc: Loc) {
        let id = ExprId {
            loc: loc.start,
            tag: bun_ast::ExprTag::EUnary,
            payload: core::ptr::from_ref(node) as usize,
        };
        let value = node.value;
        if is_postfix(node.op) {
            if !self.ends_the_chain(&value) {
                return;
            }
            match self.token_after(&value) {
                Some(token) if matches!(token.token, T::TPlusPlus | T::TMinusMinus) => {
                    self.keep(Self::at_token(&token, Report::Ends, id));
                }
                _ => self.keep(Self::at_node(id, Report::Ends)),
            }
            return;
        }
        if !is_prefix_update(node.op) {
            return;
        }
        // A type assertion is a unary expression.
        if let Some(record) = self.outer(&value)
            && matches!(record.data, WrapperData::TypeAssertion(_))
        {
            self.keep(Found {
                token_start: record.op,
                token_end: record.op + 1,
                token: T::TLessThan,
                line_break_before: false,
                start: record.op,
                end: record.op + 1,
                report: Report::ExpressionExpected,
                node: id,
            });
            return;
        }
        if !self.ends_the_chain(&value) {
            return;
        }
        // "++a++": the reference reads "++a" and ends before the postfix operator that follows the innermost operand.
        if let ExprData::EUnary(inner) = &value.data
            && is_postfix(inner.op)
        {
            let mut operand = inner.value;
            loop {
                let ExprData::EUnary(deeper) = &operand.data else {
                    break;
                };
                if !is_postfix(deeper.op) || self.is_made_left_hand_side(&operand) {
                    break;
                }
                operand = deeper.value;
            }
            match self.token_after(&operand) {
                Some(token) if matches!(token.token, T::TPlusPlus | T::TMinusMinus) => {
                    self.keep(Self::at_token(&token, Report::Ends, id));
                }
                _ => self.keep(Self::at_node(id, Report::Ends)),
            }
            return;
        }
        // The operand starts with a token that starts no left-hand side expression.
        match offset(value.loc).and_then(|at| self.token_at(at)) {
            Some(mut token) => {
                if matches!(value.data, ExprData::EJsxElement(_)) {
                    token.end = token.start + 1;
                }
                self.keep(Self::at_token(&token, Report::ExpressionExpected, id));
            }
            None => self.keep(Self::at_node(id, Report::ExpressionExpected)),
        }
    }

    /// parseMemberExpressionRest and parseCallExpressionRest go on after a left-hand side expression only.
    fn chain(&mut self, target: &Expr, id: ExprId, is_token: fn(T) -> bool) {
        if !self.ends_the_chain(target) {
            return;
        }
        match self.token_after(target) {
            Some(token) if is_token(token.token) => {
                self.keep(Self::at_token(&token, Report::Ends, id));
            }
            _ => self.keep(Self::at_node(id, Report::Ends)),
        }
    }

    /// parseRightSideOfDot: a name on a later line than its dot, before a word on the line of the name.
    fn name_after_dot(&mut self, target: &Expr, name_loc: Loc, id: ExprId) {
        let Some(name_start) = offset(name_loc) else {
            return;
        };
        if name_start == 0 || self.byte(name_start - 1) == Some(b'.') {
            return;
        }
        let from = match self.end_of(target) {
            Some(end) => end,
            None => {
                let dot_end = ts::full_start(self.contents, self.comments, name_start);
                match dot_end.checked_sub(1) {
                    Some(start) if self.byte(start) == Some(b'.') => {
                        if start > 0 && self.byte(start - 1) == Some(b'?') {
                            start - 1
                        } else {
                            start
                        }
                    }
                    _ => return,
                }
            }
        };
        let Some(mut lexer) = self.lexer_at(from) else {
            return;
        };
        let Some(dot) = Self::next(&mut lexer) else {
            return;
        };
        if !matches!(dot.token, T::TDot | T::TQuestionDot) {
            return;
        }
        let Some(name) = Self::next(&mut lexer) else {
            return;
        };
        let is_word = |token: T| token == T::TPrivateIdentifier || (token as u32) >= (T::TIdentifier as u32);
        if name.start != name_start || !name.line_break_before || !is_word(name.token) {
            return;
        }
        let Some(following) = Self::next(&mut lexer) else {
            return;
        };
        if following.line_break_before || !is_word(following.token) {
            return;
        }
        self.keep(Found {
            token_start: name.start,
            token_end: name.end,
            token: name.token,
            line_break_before: true,
            start: dot.end,
            end: dot.end,
            report: Report::IdentifierExpected,
            node: id,
        });
    }

    /// parseYieldExpression: "yield*" reads an assignment expression.
    fn yield_star(&mut self, loc: Loc, id: ExprId) {
        let found = (|| {
            let mut lexer = self.lexer_at(offset(loc)?)?;
            Self::next(&mut lexer)?;
            let star = Self::next(&mut lexer)?;
            if star.token != T::TAsterisk {
                return None;
            }
            Self::next(&mut lexer)
        })();
        match found {
            Some(token) => self.keep(Self::at_token(&token, Report::ExpressionExpected, id)),
            None => self.keep(Self::at_node(id, Report::ExpressionExpected)),
        }
    }
}

impl<'ast> Visitor<'ast> for Checker<'_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if !self.stack.is_safe_to_recurse() {
            return;
        }
        walk::walk_stmt(self, stmt);
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        if !self.stack.is_safe_to_recurse() {
            return;
        }
        walk::walk_expr(self, expr);
    }

    fn visit_binding(&mut self, binding: &'ast Binding) {
        if !self.stack.is_safe_to_recurse() {
            return;
        }
        walk::walk_binding(self, binding);
    }

    fn visit_e_binary(&mut self, node: &'ast E::Binary, loc: Loc) -> Option<&'ast Expr> {
        if node.op.binary_assign_target() != bun_ast::AssignTarget::None {
            self.assignment(node, loc);
        }
        walk::walk_e_binary(self, node)
    }

    fn visit_e_unary(&mut self, node: &'ast E::Unary, loc: Loc) {
        if is_postfix(node.op) || is_prefix_update(node.op) {
            self.update(node, loc);
        }
        walk::walk_e_unary(self, node);
    }

    fn visit_e_dot(&mut self, node: &'ast E::Dot, loc: Loc) {
        let id = ExprId {
            loc: loc.start,
            tag: bun_ast::ExprTag::EDot,
            payload: core::ptr::from_ref(node) as usize,
        };
        let target = node.target;
        self.chain(&target, id, |token| matches!(token, T::TDot | T::TQuestionDot));
        self.name_after_dot(&target, node.name_loc, id);
        walk::walk_e_dot(self, node);
    }

    fn visit_e_index(&mut self, node: &'ast E::Index, loc: Loc) {
        let id = ExprId {
            loc: loc.start,
            tag: bun_ast::ExprTag::EIndex,
            payload: core::ptr::from_ref(node) as usize,
        };
        let target = node.target;
        self.chain(&target, id, |token| {
            matches!(token, T::TOpenBracket | T::TQuestionDot | T::TDot)
        });
        if matches!(node.index.data, ExprData::EPrivateIdentifier(_)) {
            self.name_after_dot(&target, node.index.loc, id);
        }
        walk::walk_e_index(self, node);
    }

    fn visit_e_call(&mut self, node: &'ast E::Call, loc: Loc) {
        let id = ExprId {
            loc: loc.start,
            tag: bun_ast::ExprTag::ECall,
            payload: core::ptr::from_ref(node) as usize,
        };
        let target = node.target;
        self.chain(&target, id, |token| matches!(token, T::TOpenParen | T::TQuestionDot));
        walk::walk_e_call(self, node);
    }

    fn visit_e_template(&mut self, node: &'ast E::Template, loc: Loc) {
        if let Some(tag) = node.tag {
            let id = ExprId {
                loc: loc.start,
                tag: bun_ast::ExprTag::ETemplate,
                payload: core::ptr::from_ref(node) as usize,
            };
            self.chain(&tag, id, |token| {
                matches!(token, T::TNoSubstitutionTemplateLiteral | T::TTemplateHead)
            });
        }
        walk::walk_e_template(self, node);
    }

    fn visit_e_yield(&mut self, node: &'ast E::Yield, loc: Loc) {
        if node.is_star && node.value.is_none() {
            let id = ExprId {
                loc: loc.start,
                tag: bun_ast::ExprTag::EYield,
                payload: core::ptr::from_ref(node) as usize,
            };
            self.yield_star(loc, id);
        }
        walk::walk_e_yield(self, node);
    }
}

/// Finds what the reference expects after the expression that ends inside the node `target`. Runs for the one place that is reported.
struct Resolver<'c, 's, 'a> {
    checker: &'c mut Checker<'s, 'a>,
    target: ExprId,
}

impl Resolver<'_, '_, '_> {
    fn stmts(&mut self, stmts: &[Stmt], follow: Follow) -> Option<Context> {
        stmts.iter().find_map(|stmt| self.stmt(stmt, follow, false))
    }

    fn stmt(&mut self, stmt: &Stmt, follow: Follow, is_for_init: bool) -> Option<Context> {
        if !self.checker.stack.is_safe_to_recurse() {
            return None;
        }
        let paren = After::Token(T::TCloseParen);
        match &stmt.data {
            StmtData::SExpr(s) => {
                let after = if is_for_init {
                    After::Token(T::TSemicolon)
                } else {
                    After::Statement
                };
                self.expr(&s.value, after, follow)
            }
            StmtData::SLocal(s) => {
                let after = if is_for_init {
                    After::ForDeclaration
                } else {
                    After::Declaration
                };
                s.decls.iter().find_map(|decl| {
                    self.binding(&decl.binding)
                        .or_else(|| decl.value.and_then(|value| self.expr(&value, after, follow)))
                })
            }
            StmtData::SReturn(s) => s.value.and_then(|value| self.expr(&value, After::Statement, follow)),
            StmtData::SThrow(s) => self.expr(&s.value, After::Statement, follow),
            StmtData::SExportEquals(s) => self.expr(&s.value, After::Statement, follow),
            StmtData::SExportDefault(s) => match &s.value {
                StmtOrExpr::Expr(expr) => self.expr(expr, After::Statement, follow),
                StmtOrExpr::Stmt(inner) => self.stmt(inner, follow, false),
            },
            StmtData::SIf(s) => self
                .expr(&s.test, paren, follow)
                .or_else(|| self.stmt(&s.yes, follow, false))
                .or_else(|| s.no.as_ref().and_then(|no| self.stmt(no, follow, false))),
            StmtData::SWhile(s) => self
                .expr(&s.test, paren, follow)
                .or_else(|| self.stmt(&s.body, follow, false)),
            StmtData::SWith(s) => self
                .expr(&s.value, paren, follow)
                .or_else(|| self.stmt(&s.body, follow, false)),
            StmtData::SDoWhile(s) => self
                .stmt(&s.body, Follow::Do, false)
                .or_else(|| self.expr(&s.test, paren, follow)),
            StmtData::SFor(s) => s
                .init
                .as_ref()
                .and_then(|init| self.stmt(init, follow, true))
                .or_else(|| {
                    s.test
                        .and_then(|test| self.expr(&test, After::Token(T::TSemicolon), follow))
                })
                .or_else(|| s.update.and_then(|update| self.expr(&update, paren, follow)))
                .or_else(|| self.stmt(&s.body, follow, false)),
            StmtData::SForIn(s) => self
                .stmt(&s.init, follow, true)
                .or_else(|| self.expr(&s.value, paren, follow))
                .or_else(|| self.stmt(&s.body, follow, false)),
            StmtData::SForOf(s) => self
                .stmt(&s.init, follow, true)
                .or_else(|| self.expr(&s.value, paren, follow))
                .or_else(|| self.stmt(&s.body, follow, false)),
            StmtData::SSwitch(s) => self.expr(&s.test, paren, follow).or_else(|| {
                s.cases.slice().iter().find_map(|case| {
                    case.value
                        .and_then(|value| self.expr(&value, After::Token(T::TColon), follow))
                        .or_else(|| self.stmts(case.body.slice(), Follow::Case))
                })
            }),
            StmtData::SBlock(s) => self.stmts(s.stmts.slice(), Follow::List),
            StmtData::SLabel(s) => self.stmt(&s.stmt, follow, false),
            StmtData::STry(s) => self
                .stmts(s.body.slice(), Follow::List)
                .or_else(|| {
                    s.catch.as_ref().and_then(|catch| {
                        catch
                            .binding
                            .as_ref()
                            .and_then(|binding| self.binding(binding))
                            .or_else(|| self.stmts(catch.body.slice(), Follow::List))
                    })
                })
                .or_else(|| {
                    s.finally
                        .as_ref()
                        .and_then(|finally| self.stmts(finally.stmts.slice(), Follow::List))
                }),
            StmtData::SNamespace(s) => self.stmts(s.stmts.slice(), Follow::List),
            StmtData::SFunction(s) => self.function(&s.func),
            StmtData::SClass(s) => self.class(&s.class),
            StmtData::SEnum(s) => s.values.slice().iter().find_map(|value| {
                value
                    .value
                    .and_then(|value| self.expr(&value, After::EnumMember, follow))
            }),
            _ => None,
        }
    }

    fn function(&mut self, func: &G::Fn) -> Option<Context> {
        self.args(func.args.slice())
            .or_else(|| self.stmts(func.body.stmts.slice(), Follow::List))
    }

    fn args(&mut self, args: &[G::Arg]) -> Option<Context> {
        args.iter().find_map(|arg| {
            arg.ts_decorators
                .iter()
                .find_map(|decorator| self.expr(decorator, After::Statement, Follow::List))
                .or_else(|| self.binding(&arg.binding))
                .or_else(|| {
                    arg.default.and_then(|default| {
                        self.expr(&default, After::Token(T::TComma), Follow::List)
                    })
                })
        })
    }

    fn class(&mut self, class: &G::Class) -> Option<Context> {
        class
            .ts_decorators
            .iter()
            .find_map(|decorator| self.expr(decorator, After::Statement, Follow::List))
            .or_else(|| {
                class
                    .extends
                    .and_then(|extends| self.expr(&extends, After::Token(T::TComma), Follow::List))
            })
            .or_else(|| {
                class
                    .properties
                    .slice()
                    .iter()
                    .find_map(|property| self.property(property, After::ClassField))
            })
    }

    fn property(&mut self, property: &G::Property, initializer: After) -> Option<Context> {
        let is_computed = property.flags.contains(bun_ast::flags::Property::IsComputed);
        let key = if is_computed {
            After::Token(T::TCloseBracket)
        } else {
            After::Token(T::TComma)
        };
        property
            .ts_decorators
            .iter()
            .find_map(|decorator| self.expr(decorator, After::Statement, Follow::List))
            .or_else(|| property.key.and_then(|expr| self.expr(&expr, key, Follow::List)))
            .or_else(|| {
                property
                    .value
                    .and_then(|expr| self.expr(&expr, After::Token(T::TComma), Follow::List))
            })
            .or_else(|| {
                property
                    .initializer
                    .and_then(|expr| self.expr(&expr, initializer, Follow::List))
            })
            .or_else(|| {
                property
                    .class_static_block
                    .as_ref()
                    .and_then(|block| self.stmts(&block.stmts, Follow::List))
            })
    }

    fn binding(&mut self, binding: &Binding) -> Option<Context> {
        if !self.checker.stack.is_safe_to_recurse() {
            return None;
        }
        let comma = After::Token(T::TComma);
        match &binding.data {
            B::B::BArray(b) => b.items.slice().iter().find_map(|item| {
                self.binding(&item.binding).or_else(|| {
                    item.default_value
                        .and_then(|value| self.expr(&value, comma, Follow::List))
                })
            }),
            B::B::BObject(b) => b.properties.slice().iter().find_map(|property| {
                let is_computed = property.flags.contains(bun_ast::flags::Property::IsComputed);
                let key = if is_computed {
                    After::Token(T::TCloseBracket)
                } else {
                    comma
                };
                self.expr(&property.key, key, Follow::List)
                    .or_else(|| self.binding(&property.value))
                    .or_else(|| {
                        property
                            .default_value
                            .and_then(|value| self.expr(&value, comma, Follow::List))
                    })
            }),
            _ => None,
        }
    }

    fn exprs(&mut self, exprs: &[Expr], after: After, follow: Follow) -> Option<Context> {
        exprs.iter().find_map(|expr| self.expr(expr, after, follow))
    }

    fn expr(&mut self, expr: &Expr, after: After, follow: Follow) -> Option<Context> {
        if !self.checker.stack.is_safe_to_recurse() {
            return None;
        }
        let comma = After::Token(T::TComma);
        let mut expr = *expr;
        let mut after = after;
        loop {
            let is_parenthesized = self
                .checker
                .wrappers_of(&expr)
                .iter()
                .any(|record| matches!(record.data, WrapperData::Parenthesized));
            if is_parenthesized {
                after = After::Token(T::TCloseParen);
            }
            if ExprId::of(&expr) == self.target {
                return Some(Context { after, follow });
            }
            // The left side of a binary expression is read in a loop: a chain of them is as deep as it is long.
            let ExprData::EBinary(e) = &expr.data else {
                break;
            };
            if let Some(found) = self.expr(&e.right, after, follow) {
                return Some(found);
            }
            expr = e.left;
        }
        match &expr.data {
            ExprData::EUnary(e) => self.expr(&e.value, after, follow),
            ExprData::EAwait(e) => self.expr(&e.value, after, follow),
            ExprData::ESpread(e) => self.expr(&e.value, after, follow),
            ExprData::EYield(e) => e.value.and_then(|value| self.expr(&value, after, follow)),
            ExprData::EDot(e) => self.expr(&e.target, after, follow),
            ExprData::EIndex(e) => self
                .expr(&e.target, after, follow)
                .or_else(|| self.expr(&e.index, After::Token(T::TCloseBracket), follow)),
            ExprData::ECall(e) => self
                .expr(&e.target, after, follow)
                .or_else(|| self.exprs(&e.args, comma, follow)),
            ExprData::ENew(e) => self
                .expr(&e.target, after, follow)
                .or_else(|| self.exprs(&e.args, comma, follow)),
            ExprData::EImport(e) => self
                .expr(&e.expr, comma, follow)
                .or_else(|| self.expr(&e.options, comma, follow)),
            ExprData::EArray(e) => self.exprs(&e.items, comma, follow),
            ExprData::EObject(e) => e
                .properties
                .iter()
                .find_map(|property| self.property(property, comma)),
            ExprData::ETemplate(e) => e
                .tag
                .and_then(|tag| self.expr(&tag, after, follow))
                .or_else(|| {
                    e.parts().iter().find_map(|part| {
                        self.expr(&part.value, After::Token(T::TCloseBrace), follow)
                    })
                }),
            ExprData::EIf(e) => self
                .expr(&e.test, after, follow)
                .or_else(|| self.expr(&e.yes, After::Token(T::TColon), follow))
                .or_else(|| self.expr(&e.no, after, follow)),
            ExprData::EArrow(e) => self.args(e.args.slice()).or_else(|| {
                // An expression that is the body of an arrow function ends where the arrow function ends.
                if e.prefer_expr
                    && let [only] = e.body.stmts.slice()
                    && let StmtData::SReturn(body) = &only.data
                    && let Some(value) = body.value
                {
                    return self.expr(&value, after, follow);
                }
                self.stmts(e.body.stmts.slice(), Follow::List)
            }),
            ExprData::EFunction(e) => self.function(&e.func),
            ExprData::EClass(e) => self.class(e),
            ExprData::EJsxElement(e) => e
                .tag
                .and_then(|tag| self.expr(&tag, after, follow))
                .or_else(|| {
                    e.properties
                        .iter()
                        .find_map(|property| self.property(property, After::Token(T::TCloseBrace)))
                })
                .or_else(|| self.exprs(&e.children, After::Token(T::TCloseBrace), follow)),
            _ => None,
        }
    }
}

/// What is logged for `found` in the context `context`: the diagnostic of the reference and its argument.
fn diagnostic(found: &Found, context: Context) -> (codes::Message, &'static [u8]) {
    match found.report {
        Report::ExpressionExpected => (codes::EXPRESSION_EXPECTED, b""),
        Report::IdentifierExpected => (codes::IDENTIFIER_EXPECTED, b""),
        Report::AfterBlock => (codes::EQUALS_AFTER_BLOCK, b""),
        Report::Ends => {
            let line_break = found.line_break_before;
            // A token that starts a statement: the reference reads a new statement after the line break.
            let starts_statement = matches!(
                found.token,
                T::TOpenParen | T::TOpenBracket | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead
            );
            let expected = |text: &'static [u8]| (codes::X_0_EXPECTED, text);
            match context.after {
                After::Token(T::TCloseParen) => expected(b")"),
                After::Token(T::TCloseBracket) => expected(b"]"),
                After::Token(T::TCloseBrace) => expected(b"}"),
                After::Token(T::TColon) => expected(b":"),
                After::Token(T::TSemicolon) => expected(b";"),
                After::Token(_) => expected(b","),
                After::EnumMember => (codes::ENUM_MEMBER_NAME_MUST_BE_FOLLOWED, b""),
                After::ForDeclaration if line_break => expected(b";"),
                After::ForDeclaration => expected(b","),
                After::ClassField if line_break && !starts_statement => {
                    (codes::UNEXPECTED_TOKEN_CLASS_MEMBER, b"")
                }
                After::ClassField => expected(b";"),
                After::Statement | After::Declaration if !line_break => {
                    if context.after == After::Statement {
                        expected(b";")
                    } else {
                        expected(b",")
                    }
                }
                After::Statement | After::Declaration => match context.follow {
                    Follow::Do => expected(b"while"),
                    _ if starts_statement => expected(b";"),
                    Follow::List => (codes::DECLARATION_OR_STATEMENT_EXPECTED, b""),
                    Follow::Case => (codes::STATEMENT_EXPECTED, b""),
                },
            }
        }
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// A postfix update or a JSX element that neither parentheses nor "!" hold: the reference ends its member chain there.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_bare_chain_end(&self, expr: &Expr) -> bool {
        let is_kind = match &expr.data {
            ExprData::EUnary(unary) => is_postfix(unary.op),
            ExprData::EJsxElement(_) => true,
            _ => false,
        };
        if !is_kind {
            return false;
        }
        let last = self
            .starts_for_parse_only
            .as_deref()
            .and_then(|starts| starts.wrappers.records.last());
        !last.is_some_and(|record| {
            record.wraps(expr)
                && matches!(
                    record.data,
                    WrapperData::Parenthesized | WrapperData::NonNull
                )
        })
    }

    /// After a lint parse that logged nothing: fails where the reference reads the tree another way, with its first diagnostic.
    #[cold]
    #[inline(never)]
    pub(crate) fn check_operands_for_lint(&mut self, stmts: &[Stmt]) -> Result<(), Error> {
        let Some(starts) = self.starts_for_parse_only.as_deref() else {
            return Ok(());
        };
        let erased: &ErasedTables = &starts.erased;
        let mut checker = Checker {
            source: self.source,
            contents: self.lexer.contents,
            arena: self.arena,
            comments: &self.lexer.all_comments,
            wrappers: &starts.wrappers.records,
            index: None,
            scratch_log: Box::new(Log::init()),
            stack: bun_core::StackCheck::init(),
            best: None,
        };
        for stmt in stmts {
            checker.visit_stmt(stmt);
        }
        for record in &erased.statements {
            match &record.data {
                ErasedData::Declaration(stmt) => checker.visit_stmt(stmt),
                ErasedData::Module(module) => {
                    if let Some(body) = &module.body {
                        for stmt in body.slice() {
                            checker.visit_stmt(stmt);
                        }
                    }
                }
                _ => {}
            }
        }
        for member in &erased.members {
            if let ErasedMemberData::Property(property) = &member.data {
                for expr in [property.key, property.value, property.initializer]
                    .into_iter()
                    .flatten()
                {
                    checker.visit_expr(&expr);
                }
            }
        }
        let Some(found) = checker.best else {
            return Ok(());
        };
        let mut context = Context {
            after: After::Statement,
            follow: Follow::List,
        };
        if found.report == Report::Ends {
            let mut resolver = Resolver {
                checker: &mut checker,
                target: found.node,
            };
            let mut resolved = resolver.stmts(stmts, Follow::List);
            if resolved.is_none() {
                for record in &erased.statements {
                    resolved = match &record.data {
                        ErasedData::Declaration(stmt) => resolver.stmt(stmt, Follow::List, false),
                        ErasedData::Module(module) => module
                            .body
                            .as_ref()
                            .and_then(|body| resolver.stmts(body.slice(), Follow::List)),
                        _ => None,
                    };
                    if resolved.is_some() {
                        break;
                    }
                }
            }
            if let Some(resolved) = resolved {
                context = resolved;
            }
        }
        drop(checker);
        let (message, argument) = diagnostic(&found, context);
        let contents = self.lexer.contents;
        let raw = contents
            .get(found.token_start as usize..found.token_end as usize)
            .unwrap_or(b"");
        let at = ts::range(found.token_start, found.token_end);
        let msgs_len = self.log().msgs.len();
        if message.code() == 1005 {
            self.log().add_range_error_fmt(
                Some(self.source),
                at,
                format_args!(
                    "Expected \"{}\" but found \"{}\"",
                    bstr::BStr::new(argument),
                    bstr::BStr::new(raw)
                ),
            );
        } else if found.report == Report::IdentifierExpected {
            self.log().add_range_error_fmt(
                Some(self.source),
                at,
                format_args!("Expected identifier but found \"{}\"", bstr::BStr::new(raw)),
            );
        } else {
            self.log().add_range_error_fmt(
                Some(self.source),
                at,
                format_args!("Unexpected {}", bstr::BStr::new(raw)),
            );
        }
        self.code_syntax_error(msgs_len, message, argument, ts::range(found.start, found.end));
        Err(Error::SyntaxError)
    }
}
