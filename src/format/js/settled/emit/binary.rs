//! Binary, logical, conditional and sequence expressions.

use super::*;

pub(super) fn precedence(op: T) -> u8 {
    match op {
        T::QuestionQuestion => 1,
        T::BarBar => 2,
        T::AmpAmp => 3,
        T::Bar => 4,
        T::Caret => 5,
        T::Amp => 6,
        T::EqEq | T::BangEq | T::EqEqEq | T::BangEqEq => EQUALS,
        T::Shl | T::Shr | T::UShr => SHIFT,
        T::Plus | T::Minus => ADD,
        T::Star | T::Slash | T::Percent => MULTIPLY,
        T::StarStar => EXPONENT,
        _ => 8,
    }
}

const EQUALS: u8 = 7;
pub(super) const SHIFT: u8 = 9;
pub(super) const ADD: u8 = 10;
const MULTIPLY: u8 = 11;
const EXPONENT: u8 = 12;

pub(super) fn should_flatten(parent: T, op: T) -> bool {
    let level = precedence(op);
    precedence(parent) == level
        && match level {
            EXPONENT | EQUALS | SHIFT => false,
            MULTIPLY => parent == op && op != T::Percent,
            _ => true,
        }
}

fn operator_after_space(op: T) -> &'static str {
    match op {
        T::Plus => " +",
        T::Minus => " -",
        T::Star => " *",
        T::Slash => " /",
        T::Percent => " %",
        T::StarStar => " **",
        T::Shl => " <<",
        T::Shr => " >>",
        T::UShr => " >>>",
        T::Amp => " &",
        T::Bar => " |",
        T::Caret => " ^",
        T::Lt => " <",
        T::LtEq => " <=",
        T::Gt => " >",
        T::GtEq => " >=",
        T::EqEq => " ==",
        T::BangEq => " !=",
        T::EqEqEq => " ===",
        T::BangEqEq => " !==",
        T::In => " in",
        T::Instanceof => " instanceof",
        T::AmpAmp => " &&",
        T::BarBar => " ||",
        _ => " ??",
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Layout {
    Root,
    NestedTest,
    NestedConsequent,
    NestedAlternate,
}

impl<'t> Emitter<'_, 't> {
    #[inline]
    pub(super) fn is_binaryish(&self, id: Id) -> bool {
        matches!(self.kind(id), K::Binary | K::Logical)
    }

    fn is_inlined_operand(&self, right: Id) -> bool {
        let node = self.node(right);
        match node.kind {
            K::Object | K::Array => node.len > 0,
            kind => kind == K::Jsx,
        }
    }

    pub(super) fn should_inline_logical_expression(&self, id: Id) -> bool {
        let node = self.node(id);
        node.kind == K::Logical && self.is_inlined_operand(node.b)
    }

    pub(super) fn is_inside_condition(&self, id: Id) -> bool {
        let parent = self.node(self.node(id).parent);
        match parent.kind {
            K::If | K::While | K::Switch => parent.a == id,
            K::DoWhile => parent.b == id,
            _ => false,
        }
    }

    fn should_not_indent_if_parent_indents(&self, id: Id, parent: Id) -> bool {
        let node = self.node(parent);
        match node.kind {
            K::Return | K::Throw | K::For | K::Template | K::Arrow => true,
            K::JsxContainer => self.kind(node.parent) == K::JsxAttr,
            K::Cond => !matches!(
                self.parent_kind(parent),
                K::Return | K::Throw | K::Call | K::New
            ),
            K::Call => {
                node.a != id
                    && !node.has(flag::OPTIONAL)
                    && self.args(parent).len() == 1
                    && self.is_name(node.a, b"Boolean")
            }
            _ => false,
        }
    }

    fn should_indent_if_parent_inlines(&self, parent: Id) -> bool {
        let node = self.node(parent);
        match node.kind {
            K::Prop if node.op == T::Ident => false,
            K::Prop => node.op == T::Colon || self.is_oxfmt,
            K::Assign => !node.has(flag::TARGET),
            K::Declarator | K::Field => true,
            _ => false,
        }
    }

    pub(super) fn binary(&mut self, id: Id) {
        // The chain from its end to its start.
        let mut chain = SmallVec::<[Id; 8]>::new();
        let mut current = id;
        loop {
            chain.push(current);
            let node = self.node(current);
            let right = self.node(node.b);
            if right.kind == K::Logical && right.op == node.op {
                return self.give_up();
            }
            let left = self.node(node.a);
            match self.is_binaryish(node.a) && should_flatten(node.op, left.op) {
                true => current = node.a,
                false => break,
            }
        }
        let first = self.node(current).a;
        if self.is_inside_condition(id) {
            return self.operands(first, &chain, true);
        }
        let parent = self.parent(id);
        if matches!(self.kind(parent), K::Dot | K::Unary) || self.is_callee(id) {
            return self.group(|e| e.soft_block_indent(|e| e.operands(first, &chain, false)));
        }
        let is_inlined = self.should_inline_logical_expression(id);
        if self.is_flat()
            || self.should_not_indent_if_parent_indents(id, parent)
            || (is_inlined && chain.len() == 1)
            || (!is_inlined && self.should_indent_if_parent_inlines(parent))
        {
            return self.group(|e| e.operands(first, &chain, false));
        }
        let ends_with_jsx = self.kind(self.node(id).b) == K::Jsx;
        let tail = chain.get(usize::from(ends_with_jsx)..).unwrap_or_default();
        let group_id = self.group_id();
        self.group_if(ends_with_jsx, |e| {
            e.group_with(false, Some(group_id), |e| {
                e.first_operand(first);
                if !tail.is_empty() {
                    e.indent(|e| tail.iter().rev().for_each(|&it| e.right_side(it, false)));
                }
            });
            if ends_with_jsx {
                e.indent_if_group_breaks(group_id, |e| e.right_side(id, false));
            }
        });
    }

    fn operands(&mut self, first: Id, chain: &[Id], is_inside_condition: bool) {
        self.first_operand(first);
        for &it in chain.iter().rev() {
            self.right_side(it, is_inside_condition);
        }
    }

    fn first_operand(&mut self, id: Id) {
        self.group(|e| {
            e.expr(id);
            e.trailing_comments(e.comment_after_operator(e.node(e.node(id).parent)));
        });
    }

    fn comment_after_operator(&self, binary: &Node) -> &'t [Comment] {
        self.line_comment_after(binary, binary.a, operator_after_space(binary.op).as_bytes())
    }

    fn right_side_with_comments(&mut self, id: Id, should_group: bool, is_inlined: bool) {
        let node = self.node(id);
        let (after_left, parent) = (self.comment_after_operator(node), self.node(node.parent));
        let leading = match self.kind(node.b) {
            K::Jsx => &[],
            _ => self.comments_leading(node, node.b),
        };
        let leading = leading.get(after_left.len()..).unwrap_or_default();
        if !after_left.is_empty()
            && (is_inlined || self.is_chain_root(node.a) || self.kind(node.a) == K::Jsx)
            || (is_inlined && self.has_line_break_after(leading))
        {
            return self.give_up();
        }
        let write = |e: &mut Self| {
            e.token(operator_after_space(node.op));
            e.flush_trailing_comments(after_left);
            match is_inlined {
                true => e.space(),
                false => e.line(),
            }
            e.leading_comments_of(node.b, leading);
            e.expr(node.b);
        };
        match should_group {
            true => self.group_with(!after_left.is_empty(), None, write),
            false => write(self),
        }
        if parent.a == id && self.is_binaryish(node.parent) && should_flatten(parent.op, node.op) {
            self.trailing_comments(self.comment_after_operator(parent));
        }
    }

    fn right_side(&mut self, id: Id, is_inside_condition: bool) {
        let node = self.node(id);
        let (left, right) = (self.node(node.a), self.node(node.b));
        let should_group = !(self.kind(node.parent) == node.kind
            || left.kind == node.kind
            || right.kind == node.kind
            || (is_inside_condition && node.kind == K::Logical));
        let would_end_type_arguments =
            node.op == T::Gt && left.kind == K::Binary && left.op == T::Lt && !self.is_javascript;
        let is_inlined = self.should_inline_logical_expression(id) || would_end_type_arguments;
        if (node.flags | self.node(node.parent).flags) & flag::COMMENT != 0 {
            return self.right_side_with_comments(id, should_group, is_inlined);
        }
        self.group_if(should_group, |e| {
            e.token(operator_after_space(node.op));
            match is_inlined {
                true => e.space(),
                false => e.line(),
            }
            e.expr(node.b);
        });
    }

    // ───────────────────────────── conditionals ─────────────────────────────

    fn should_extra_indent(&self, conditional: Id) -> bool {
        let mut e = conditional;
        loop {
            let parent = self.node(e).parent;
            let node = self.node(parent);
            match node.kind {
                K::Dot | K::Index | K::Call | K::NonNull if node.a == e => e = parent,
                K::New | K::As | K::Satisfies if node.a == e => {
                    e = parent;
                    break;
                }
                _ => break,
            }
        }
        let parent = self.node(self.node(e).parent);
        e != conditional
            && match parent.kind {
                K::Declarator => parent.c == e,
                K::Return | K::Throw | K::Unary | K::Yield | K::Await => true,
                K::Assign => parent.b == e && !parent.has(flag::TARGET),
                _ => false,
            }
    }

    pub(super) fn is_jsx_conditional_chain(&self, id: Id) -> bool {
        let node = self.node(id);
        [node.a, node.b, node.c]
            .into_iter()
            .any(|it| match self.kind(it) {
                K::Jsx => true,
                K::Cond => self.is_jsx_conditional_chain(it),
                _ => false,
            })
    }

    pub(super) fn conditional_like(&mut self, id: Id, is_in_jsx_chain: bool) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let node = self.node(id);
        let is_type = node.kind == K::Conditional;
        let branches = |node: &Node| {
            if is_type {
                (node.c, node.d)
            } else {
                (node.b, node.c)
            }
        };
        let (yes, no) = branches(node);
        let parent = self.node(node.parent);
        let layout = match (parent.kind == node.kind, branches(parent)) {
            (false, _) => Layout::Root,
            (true, (it, _)) if it == id => Layout::NestedConsequent,
            (true, (_, it)) if it == id => Layout::NestedAlternate,
            _ => Layout::NestedTest,
        };
        let is_head = matches!(layout, Layout::Root | Layout::NestedTest);
        let should_extra_indent =
            layout == Layout::Root && !is_type && self.should_extra_indent(id);
        let is_jsx_chain =
            is_in_jsx_chain || (is_head && !is_type && self.is_jsx_conditional_chain(id));
        let after_test = match is_type || is_jsx_chain {
            true => &[],
            false => self.line_comment_after(node, node.a, b""),
        };
        let inner = |e: &mut Self| {
            e.align(
                if layout == Layout::NestedAlternate {
                    2
                } else {
                    0
                },
                |e| {
                    e.operand(node.a);
                    e.trailing_comments(after_test);
                    if is_type {
                        e.space();
                        e.keyword("extends");
                        e.ty(node.b);
                    }
                },
            );
            if is_jsx_chain {
                e.space();
                e.keyword("?");
                e.jsx_chain_expression(yes, false);
                e.space();
                e.keyword(":");
                return e.jsx_chain_expression(no, true);
            }
            e.flush_trailing_comments(after_test);
            let tail = |e: &mut Self| e.consequent_and_alternate(node, yes, no);
            match layout {
                Layout::Root | Layout::NestedTest => e.indent(tail),
                Layout::NestedConsequent => e.dedent(DedentMode::Level, |e| e.indent(tail)),
                Layout::NestedAlternate => tail(e),
            }
            if !should_extra_indent && layout == Layout::Root && parent.kind == K::Dot {
                e.soft_line();
            }
        };
        match layout == Layout::NestedTest || should_extra_indent {
            true => self.group(|e| e.soft_block_indent(|e| e.group(inner))),
            false => self.group_if(is_head, inner),
        }
    }

    fn operand(&mut self, id: Id) {
        match self.kind(id) >= K::TypeKeyword {
            true => self.ty(id),
            false => self.expr(id),
        }
    }

    fn consequent_and_alternate(&mut self, node: &Node, yes: Id, no: Id) {
        let is_space = self.f.options().indent_style.is_space();
        let branch = |e: &mut Self, id: Id, trailing: &[Comment]| {
            let write = |e: &mut Self| {
                if node.kind == K::Cond {
                    e.comments_after_operator(id, e.comments_leading(node, id));
                }
                match e.kind(id) {
                    K::Cond | K::Conditional => e.conditional_like(id, false),
                    _ => e.operand(id),
                }
                e.trailing_comments(trailing);
            };
            match is_space {
                true => e.align(2, write),
                false => e.indent(write),
            }
        };
        let is_nested = matches!(self.kind(yes), K::Cond | K::Conditional);
        self.line();
        self.keyword("?");
        if is_nested {
            self.token_if_fits("(");
        }
        let after_yes = match is_nested || node.kind != K::Cond {
            true => &[],
            false => self.line_comment_after(node, yes, b""),
        };
        branch(self, yes, after_yes);
        self.flush_trailing_comments(after_yes);
        if is_nested {
            self.token_if_fits(")");
        }
        self.line();
        self.keyword(":");
        branch(self, no, &[]);
    }

    fn jsx_chain_expression(&mut self, id: Id, is_alternate: bool) {
        let node = self.node(id);
        let is_conditional = node.kind == K::Cond;
        let write = |e: &mut Self| match is_conditional {
            true => e.conditional_like(id, true),
            false => e.expr(id),
        };
        let is_bare = match node.kind {
            K::Ident => node.op == T::Undefined,
            K::Null => true,
            _ => is_conditional && is_alternate,
        };
        if is_bare {
            return write(self);
        }
        let comments = self.comments_leading(self.node(node.parent), id);
        if !comments.iter().all(|it| it.is_first_on_line) {
            return self.give_up();
        }
        self.token_if_breaks("(");
        self.soft_block_indent(|e| {
            e.leading_comments_of(id, comments);
            write(e);
        });
        self.token_if_breaks(")");
    }

    pub(super) fn sequence(&mut self, id: Id) {
        let (all, parent) = (self.list(id), self.parent_kind(id));
        let is_head = matches!(parent, K::For | K::ExprStmt);
        let inner = |e: &mut Self| {
            for (i, &it) in all.iter().enumerate() {
                if i == 0 {
                    e.expr(it);
                    continue;
                }
                e.token(",");
                e.indent_if(is_head, |e| {
                    e.line();
                    e.expr(it);
                });
            }
        };
        match parent {
            K::Arrow => self.group(|e| e.soft_block_indent(inner)),
            K::Return | K::Throw => {
                self.group(|e| e.soft_block_indent(|e| e.group_if(e.is_oxfmt, inner)));
            }
            _ => self.group(inner),
        }
    }
}
