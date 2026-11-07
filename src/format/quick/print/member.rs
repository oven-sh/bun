//! Member expressions (member.js).

use crate::ast::{F_CHAIN, F_COMPUTED, F_OPTIONAL, F_PAREN, k};
use crate::doc::LABEL_MEMBER_CHAIN;
use crate::print::statics::{DOT, LBRACKET, QUESTION_DOT, RBRACKET};
use crate::{Quick, R, Words};

/// What print_member_expression() has found out about the member expression whose object it is printing. The next one down the row
/// asks the same questions of the nodes above it, and need not climb past this one.
pub(crate) struct PrintMember {
    pub(crate) known: i32,
    known_first_non_member: i32,
    known_is_callee_of_new: bool,
    known_is_in_chain_expression: bool,
    /// The first and the last of these answers for one more member expression: the one around the last that found nothing known above
    /// it. The links of a member chain are not printed by print_member_expression(), and what is in the brackets of each asks about
    /// the links above it.
    around: i32,
    around_first_non_member: i32,
    around_is_in_chain_expression: bool,
}
impl PrintMember {
    pub(crate) fn new() -> Self {
        Self {
            known: 0,
            known_first_non_member: 0,
            known_is_callee_of_new: false,
            known_is_in_chain_expression: false,
            around: 0,
            around_first_non_member: 0,
            around_is_in_chain_expression: false,
        }
    }
}

impl Quick {
    pub(crate) fn print_member_lookup(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let property = self.n.at(n + 5);
        if (head & F_COMPUTED) == 0 {
            self.text(if (head & F_OPTIONAL) != 0 {
                QUESTION_DOT
            } else {
                DOT
            });
            self.print(property)?;
            return Ok(());
        }
        if (self.n.at(property) & 0xff) == k::NumericLiteral {
            if (head & F_OPTIONAL) != 0 {
                self.text(QUESTION_DOT);
            }
            self.text(LBRACKET);
            self.print(property)?;
            self.text(RBRACKET);
            return Ok(());
        }
        let g = self.group_open();
        if (head & F_OPTIONAL) != 0 {
            self.text(QUESTION_DOT);
        }
        self.text(LBRACKET);
        self.indent_softline();
        self.print(property)?;
        self.dedent_softline();
        self.text(RBRACKET);
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn should_inline_new_expression_callee(&self, n: i32) -> bool {
        let mut child = n;
        loop {
            let ancestor = self.n.at(child + 3);
            if ancestor == 0 {
                return false;
            }
            if ancestor == self.print_member.known && self.n.at(ancestor + 4) == child {
                return self.print_member.known_is_callee_of_new;
            }
            let ak = self.n.at(ancestor) & 0xff;
            if !((ak == k::MemberExpression || ak == k::NonNullExpression)
                && self.n.at(ancestor + 4) == child)
            {
                return (self.n.at(ancestor) & 0xff) == k::NewExpression
                    && self.n.at(ancestor + 4) == child;
            }
            child = ancestor;
        }
    }

    /// Does the optional chain that `child` is part of end with it? `parent` is the node around it. A `!` is part of the chain.
    #[cold]
    fn ends_chain(&self, child: i32, parent: i32) -> bool {
        (self.n.at(child) & F_PAREN) != 0
            || self.n.at(parent + 4) != child
            || !matches!(
                self.n.at(parent) & 0xff,
                k::MemberExpression | k::CallExpression | k::NonNullExpression
            )
    }

    pub(crate) fn forget_member_around(&mut self) {
        self.print_member.around = 0;
    }

    /// Are the answers that are kept for `around` those for the member expression `member`? They are those for every member expression
    /// above `around` up to where an optional chain ends or something else than a member expression or a `!` follows: for the links of its
    /// chain. If `member` is one of these, the answers are kept for it from now on, so no link is climbed past twice.
    fn knows_member_around(&mut self, member: i32) -> bool {
        let mut link = self.print_member.around;
        if link == 0 {
            return false;
        }
        while link != member {
            let is_chain = (self.n.at(link) & F_CHAIN) != 0 && self.mode.wraps_chains;
            loop {
                let above = self.n.at(link + 3);
                if is_chain && self.ends_chain(link, above) {
                    return false;
                }
                link = above;
                match self.n.at(above) & 0xff {
                    k::MemberExpression => break,
                    k::NonNullExpression => {}
                    _ => return false,
                }
            }
        }
        self.print_member.around = member;
        true
    }

    pub(crate) fn print_member_expression(&mut self, n: i32) -> R<()> {
        let object = self.n.at(n + 4);
        let mut parent = self.n.at(n + 3);
        let mut first_non_member = parent;
        // In the trees of TypeScript's and of Flow's parser a ChainExpression is around an optional chain, and that is the first node
        // around the members of the chain that is no member. Babel's tree has none.
        let mut is_in_chain_expression = false;
        let mut child = n;
        let mut is_chain = false;
        let mut around: i32 = 0;
        let mut ends_chain_below = false;
        loop {
            // (a `!` is what is in front of it)
            if (self.n.at(child) & 0xff) == k::MemberExpression {
                is_chain = (self.n.at(child) & F_CHAIN) != 0;
            }
            if is_chain && self.mode.wraps_chains && self.ends_chain(child, first_non_member) {
                is_in_chain_expression = true;
                is_chain = false;
            }
            if (self.n.at(first_non_member) & 0xff) != k::MemberExpression
                && (self.n.at(first_non_member) & 0xff) != k::NonNullExpression
            {
                break;
            }
            if first_non_member == self.print_member.known {
                first_non_member = self.print_member.known_first_non_member;
                is_in_chain_expression |= self.print_member.known_is_in_chain_expression;
                break;
            }
            if child == n && (self.n.at(first_non_member) & 0xff) == k::MemberExpression {
                if self.knows_member_around(first_non_member) {
                    first_non_member = self.print_member.around_first_non_member;
                    is_in_chain_expression |= self.print_member.around_is_in_chain_expression;
                    break;
                }
                // (from here on the answers are those for the parent)
                around = first_non_member;
                ends_chain_below = is_in_chain_expression;
                is_in_chain_expression = false;
            }
            child = first_non_member;
            first_non_member = self.n.at(first_non_member + 3);
        }
        if around != 0 {
            self.print_member.around = around;
            self.print_member.around_first_non_member = first_non_member;
            self.print_member.around_is_in_chain_expression = is_in_chain_expression;
            is_in_chain_expression |= ends_chain_below;
        }
        let is_callee_of_new =
            !is_in_chain_expression && self.should_inline_new_expression_callee(n);
        self.print_member.known = n;
        self.print_member.known_first_non_member = first_non_member;
        self.print_member.known_is_callee_of_new = is_callee_of_new;
        self.print_member.known_is_in_chain_expression = is_in_chain_expression;
        self.print(object)?;
        // (for what is in the brackets)
        self.print_member.known = n;
        self.print_member.known_first_non_member = first_non_member;
        self.print_member.known_is_callee_of_new = is_callee_of_new;
        self.print_member.known_is_in_chain_expression = is_in_chain_expression;
        let object_label = self.doc.label;
        let fk = self.n.at(first_non_member) & 0xff;
        while (self.n.at(parent) & 0xff) == k::NonNullExpression {
            parent = self.n.at(parent + 3);
        }
        let pk = self.n.at(parent) & 0xff;
        let mut stripped_object = object;
        while (self.n.at(stripped_object) & 0xff) == k::NonNullExpression {
            stripped_object = self.n.at(stripped_object + 4);
        }
        let should_inline = (fk == k::AssignmentExpression
            && !is_in_chain_expression
            && (self.n.at(self.n.at(first_non_member + 4)) & 0xff) != k::Identifier)
            || (self.n.at(n) & F_COMPUTED) != 0
            || ((self.n.at(object) & 0xff) == k::Identifier
                && (self.n.at(self.n.at(n + 5)) & 0xff) == k::Identifier
                && pk != k::MemberExpression)
            || ((pk == k::AssignmentExpression || pk == k::VariableDeclarator)
                && (((self.n.at(stripped_object) & 0xff) == k::CallExpression
                    && self.n.at(self.n.at(stripped_object + 5)) > 0)
                    || object_label == LABEL_MEMBER_CHAIN))
            || is_callee_of_new;
        self.line_suffix_boundary();
        if should_inline {
            self.print_member_lookup(n)?;
        } else {
            let g = self.group_open();
            self.indent_softline();
            self.print_member_lookup(n)?;
            self.indent_close();
            self.group_close(g);
        }
        self.set_label(object_label);
        Ok(())
    }
}
