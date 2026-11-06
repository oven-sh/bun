//! Conditional expressions (ternary-old.js: the layout without --experimental-ternaries).

use crate::ast::{F_COMPUTED, k};
use crate::doc::ALIGN_DEDENT;
use crate::print::statics::{_EXTENDS_, COLON_SPACE, LPAREN, QUESTION_SPACE, RPAREN, SPACE};
use crate::{Quick, R, Words, rare};

/// What print_ternary() has found out about the conditional whose parts it is printing. A conditional among these parts belongs to the same
/// chain, asks the same questions, and need not climb past this one or walk the whole chain again.
#[derive(Clone, Copy)]
pub(crate) struct PrintTernary {
    pub(crate) known: i32,
    last_conditional_parent: i32,
    /// The node above that one, or 0.
    above: i32,
    /// A conditional of the chain with an element of JSX among its parts, or 0 if the chain has none.
    jsx_in: i32,
}
impl PrintTernary {
    pub(crate) fn new() -> Self {
        Self {
            known: 0,
            last_conditional_parent: 0,
            above: 0,
            jsx_in: 0,
        }
    }
}

impl Quick {
    /// conditionalExpressionChainContainsJsx(): the first conditional in `n`, with nothing but conditionals between the two, that has an element of JSX among
    /// its parts, or 0.
    pub(crate) fn chain_contains_jsx(&self, n: i32) -> R<i32> {
        self.stack()?;
        let mut f: i32 = 4;
        while f <= 6 {
            let child = self.n.at(n + f);
            if self.is_jsx_element(child) {
                return Ok(n);
            }
            if (self.n.at(child) & 0xff) == k::ConditionalExpression {
                let found = self.chain_contains_jsx(child)?;
                if found != 0 {
                    return Ok(found);
                }
            }
            f += 1;
        }
        return Ok(0);
    }

    pub(crate) fn should_extra_indent(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::ConditionalExpression {
            return false;
        }
        let mut child = n;
        let parent: i32;
        loop {
            let node = self.n.at(child + 3);
            let k = self.n.at(node) & 0xff;
            if (k == k::CallExpression || k == k::MemberExpression || k == k::NonNullExpression)
                && self.n.at(node + 4) == child
            {
                child = node;
                continue;
            }
            if (k == k::NewExpression || k == k::AsExpression || k == k::SatisfiesExpression)
                && self.n.at(node + 4) == child
            {
                parent = self.n.at(node + 3);
                child = node;
            } else {
                parent = node;
            }
            break;
        }
        if child == n {
            return false;
        }
        match self.n.at(parent) & 0xff {
            k::AssignmentExpression | k::VariableDeclarator => {
                return self.n.at(parent + 5) == child;
            }
            k::ReturnStatement
            | k::ThrowStatement
            | k::UnaryExpression
            | k::YieldExpression
            | k::AwaitExpression => {
                return self.n.at(parent + 4) == child;
            }
            _ => {}
        }
        return false;
    }

    pub(crate) fn is_nil(&self, n: i32) -> bool {
        return (self.n.at(n) & 0xff) == k::NullLiteral
            || self.is_identifier_named(n, b"undefined");
    }

    pub(crate) fn print_wrapped(&mut self, n: i32) -> R<()> {
        self.if_break_text(LPAREN, 0, 0);
        self.indent_softline();
        self.print(n)?;
        self.dedent_softline();
        self.if_break_text(RPAREN, 0, 0);
        Ok(())
    }

    pub(crate) fn print_branch(&mut self, n: i32) -> R<()> {
        if self.options.use_tabs {
            self.indent_open();
        } else {
            if self.options.tab_width == 1
                && matches!(
                    self.n.at(n) & 0xff,
                    k::ConditionalExpression | k::ConditionalType
                )
            {
                return Err(self.rare(rare::TAB_WIDTH));
            }
            self.align_open(2);
        }
        self.print(n)?;
        self.indent_close();
        Ok(())
    }

    pub(crate) fn print_ternary(&mut self, n: i32, _args: i32) -> R<()> {
        let kind = self.n.at(n) & 0xff;
        let is_expression = kind == k::ConditionalExpression;
        // a conditional type has two nodes where an expression has its test
        let alternate_at = if is_expression { 6 } else { 7 };
        let test = self.n.at(n + 4);
        let consequent = self.n.at(n + alternate_at - 1);
        let alternate = self.n.at(n + alternate_at);
        let parent = self.n.at(n + 3);
        let parent_is_conditional = (self.n.at(parent) & 0xff) == kind;
        let is_parent_test = parent_is_conditional
            && (self.n.at(parent + 4) == n || (!is_expression && self.n.at(parent + 5) == n));
        let mut force_no_indent = parent_is_conditional && !is_parent_test;
        let mut previous_parent = n;
        let mut current_parent = parent;
        let mut is_known = false;
        while current_parent != 0
            && (self.n.at(current_parent) & 0xff) == kind
            && self.n.at(current_parent + 4) != previous_parent
            && (is_expression || self.n.at(current_parent + 5) != previous_parent)
        {
            if current_parent == self.print_ternary.known {
                previous_parent = self.print_ternary.last_conditional_parent;
                current_parent = self.print_ternary.above;
                is_known = true;
                break;
            }
            previous_parent = current_parent;
            current_parent = self.n.at(current_parent + 3);
        }
        let first_non_conditional_parent = if current_parent != 0 {
            current_parent
        } else {
            parent
        };
        let last_conditional_parent = previous_parent;
        let known_jsx_in = self.print_ternary.jsx_in;
        let jsx_in = if is_known {
            known_jsx_in
        } else if !is_expression {
            0
        } else if is_parent_test
            && parent == self.print_ternary.known
            && (known_jsx_in == 0
                || (self.n.at(n + 1) <= self.n.at(known_jsx_in + 1)
                    && self.n.at(known_jsx_in + 2) <= self.n.at(n + 2)))
        {
            // A test starts a chain of its own, which is part of what was looked through for the chain around it.
            known_jsx_in
        } else {
            self.chain_contains_jsx(last_conditional_parent)?
        };
        let chain_contains_jsx = jsx_in != 0;
        let own = PrintTernary {
            known: n,
            last_conditional_parent,
            above: current_parent,
            jsx_in,
        };
        let jsx_mode = is_expression
            && (self.is_jsx_element(test)
                || self.is_jsx_element(consequent)
                || self.is_jsx_element(alternate)
                || chain_contains_jsx);
        if jsx_mode {
            force_no_indent = true;
        }
        let extra_indent = self.should_extra_indent(n);
        let wrap_all = is_parent_test || extra_indent;
        let break_closing_paren = !jsx_mode
            && ((self.n.at(parent) & 0xff) == k::MemberExpression
                && (self.n.at(parent) & F_COMPUTED) == 0);
        let should_group = parent == first_non_conditional_parent;
        let outer = if wrap_all { self.group_open() } else { 0 };
        if wrap_all {
            self.indent_softline();
        }
        let g = if should_group { self.group_open() } else { 0 };
        // the test
        let is_alternate = parent_is_conditional && self.n.at(parent + alternate_at) == n;
        if is_alternate {
            self.align_open(2);
        }
        self.print_ternary = own;
        self.print(test)?;
        if !is_expression {
            self.text(_EXTENDS_);
            self.print_ternary = own;
            self.print(self.n.at(n + 5))?;
        }
        if is_alternate {
            self.indent_close();
        }
        if !force_no_indent {
            self.indent_open();
        }
        if jsx_mode {
            self.text(SPACE);
            self.text(QUESTION_SPACE);
            self.print_ternary = own;
            if self.is_nil(consequent) {
                self.print(consequent)?;
            } else {
                self.print_wrapped(consequent)?;
            }
            self.text(SPACE);
            self.text(COLON_SPACE);
            self.print_ternary = own;
            if (self.n.at(alternate) & 0xff) == k::ConditionalExpression || self.is_nil(alternate) {
                self.print(alternate)?;
            } else {
                self.print_wrapped(alternate)?;
            }
        } else {
            let plain = !parent_is_conditional || is_alternate || is_parent_test;
            if !plain {
                if self.options.use_tabs {
                    self.align_open(ALIGN_DEDENT);
                    self.indent_open();
                } else {
                    self.align_open(0.max(self.options.tab_width - 2));
                }
            }
            let consequent_is_conditional = (self.n.at(consequent) & 0xff) == kind;
            self.line();
            self.text(QUESTION_SPACE);
            if consequent_is_conditional {
                self.if_break_text(0, LPAREN, 0);
            }
            self.print_ternary = own;
            self.print_branch(consequent)?;
            if consequent_is_conditional {
                self.if_break_text(0, RPAREN, 0);
            }
            self.line();
            self.text(COLON_SPACE);
            self.print_ternary = own;
            self.print_branch(alternate)?;
            if !plain {
                self.indent_close();
                if self.options.use_tabs {
                    self.indent_close();
                }
            }
        }
        if !force_no_indent {
            self.indent_close();
        }
        if is_expression && break_closing_paren && !extra_indent {
            self.softline();
        }
        if should_group {
            self.group_close(g);
        }
        if wrap_all {
            self.dedent_softline();
            self.group_close(outer);
        }
        Ok(())
    }
}
