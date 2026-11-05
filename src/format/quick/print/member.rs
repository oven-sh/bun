use crate::ast::{F_COMPUTED, F_OPTIONAL, k};
use crate::doc::LABEL_MEMBER_CHAIN;
use crate::print::statics::{DOT, LBRACKET, QUESTION_DOT, RBRACKET};
use crate::{Quick, R, Words};

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

    pub(crate) fn print_member_expression(&mut self, n: i32) -> R<()> {
        let object = self.n.at(n + 4);
        self.print(object)?;
        let object_label = self.doc.label;
        let mut parent = self.n.at(n + 3);
        let mut first_non_member = parent;
        while (self.n.at(first_non_member) & 0xff) == k::MemberExpression
            || (self.n.at(first_non_member) & 0xff) == k::NonNullExpression
        {
            first_non_member = self.n.at(first_non_member + 3);
        }
        let fk = self.n.at(first_non_member) & 0xff;
        while (self.n.at(parent) & 0xff) == k::NonNullExpression {
            parent = self.n.at(parent + 3);
        }
        let pk = self.n.at(parent) & 0xff;
        let mut stripped_object = object;
        while (self.n.at(stripped_object) & 0xff) == k::NonNullExpression {
            stripped_object = self.n.at(stripped_object + 4);
        }
        let should_inline = fk == k::BindExpression
            || (fk == k::AssignmentExpression
                && (self.n.at(self.n.at(first_non_member + 4)) & 0xff) != k::Identifier)
            || (self.n.at(n) & F_COMPUTED) != 0
            || ((self.n.at(object) & 0xff) == k::Identifier
                && (self.n.at(self.n.at(n + 5)) & 0xff) == k::Identifier
                && pk != k::MemberExpression)
            || ((pk == k::AssignmentExpression || pk == k::VariableDeclarator)
                && (((self.n.at(stripped_object) & 0xff) == k::CallExpression
                    && self.n.at(self.n.at(stripped_object + 5)) > 0)
                    || object_label == LABEL_MEMBER_CHAIN))
            || self.should_inline_new_expression_callee(n);
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
