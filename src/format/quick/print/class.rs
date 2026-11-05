use crate::arena::SUB_SHIFT;
use crate::ast::{
    CL_BODY, CL_EXTENDS, CL_ID, CL_IMPLEMENTS, CL_MIXINS, CL_SUPER, CL_SUPER_TYPE_ARGUMENTS,
    CL_TYPE_PARAMETERS, EXT_AT, F_ACCESSOR, F_ASYNC, F_COMPUTED, F_DEFINITE, F_EXACT, F_EXT,
    F_EXTRA, F_GENERATOR, F_INEXACT, F_OPTIONAL, F_STATIC, M_GET, M_MASK, M_SET, MOD_ABSTRACT,
    MOD_ACCESSIBILITY, MOD_DECLARE, MOD_OVERRIDE, MOD_READONLY, k,
};
use crate::options::TRAILING_COMMA_NONE;
use crate::print::comments::{DANGLING_EXTENDS, DANGLING_IMPLEMENTS, DANGLING_MIXINS};
use crate::print::statics::{
    ABSTRACT_, ACCESSOR_, BANG, BAR_RBRACE, CLASS, COMMA, DECLARE_, ELLIPSIS, EQ, EXTENDS,
    EXTENDS_, IMPLEMENTS, IMPLEMENTS_, INTERFACE, LBRACE, LBRACE_BAR, LPAREN, MIXINS, MIXINS_,
    OVERRIDE_, QUESTION, RBRACE, READONLY_, RECORD, RPAREN, SEMI, SPACE, STATIC_,
};
use crate::print::util::IS_FUNCTION_LIKE;
use crate::{Quick, R, Words};

impl Quick {
    pub(crate) fn has_newline_between_or_after_decorators(&self, decorators: i32) -> bool {
        let mut i: i32 = 1;
        while i <= self.n.at(decorators) {
            if self.has_newline(self.n.at(self.n.at(decorators + i) + 2)) {
                return true;
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn print_decorator_list(&mut self, decorators: i32) -> R<()> {
        let mut i: i32 = 1;
        while i <= self.n.at(decorators) {
            if i > 1 {
                self.line();
            }
            self.print(self.n.at(decorators + i))?;
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn print_class_member_decorators(&mut self, decorators: i32) -> R<()> {
        let g = self.group_open();
        self.print_decorator_list(decorators)?;
        if self.has_newline_between_or_after_decorators(decorators) {
            self.hardline();
        } else {
            self.line();
        }
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn has_decorators_before_export(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return (k == k::ExportDefaultDeclaration || k == k::ExportNamedDeclaration)
            && (self.n.at(n) & F_EXTRA) != 0;
    }

    pub(crate) fn print_decorators_before_export(&mut self, n: i32) -> R<()> {
        if !self.has_decorators_before_export(n) {
            return Ok(());
        }
        let decorators = self.n.at(self.n.at(n + 4) + 7);
        let mut i: i32 = 1;
        while i <= self.n.at(decorators) {
            self.print(self.n.at(decorators + i))?;
            self.hardline();
            i += 1;
        }
        Ok(())
    }

    /// The decorators of a class or a parameter.
    pub(crate) fn print_decorators(&mut self, n: i32, decorators: i32) -> R<()> {
        let parent = self.n.at(n + 3);
        if self.n.at(decorators) == 0
            || self.has_decorators_before_export(parent)
            || self.has_ignore_comment(n)
        {
            return Ok(());
        }
        let pk = self.n.at(parent) & 0xff;
        let k = self.n.at(n) & 0xff;
        if (pk == k::ExportDefaultDeclaration || pk == k::ExportNamedDeclaration)
            && self.n.at(parent + 4) == n
        {
            self.hardline();
        } else if k == k::ClassDeclaration
            || k == k::ClassExpression
            || self.has_newline_between_or_after_decorators(decorators)
        {
            self.break_parent();
        }
        self.print_decorator_list(decorators)?;
        self.line();
        Ok(())
    }

    pub(crate) fn has_multiple_heritage(&self, n: i32) -> bool {
        return (if self.n.at(n + CL_SUPER) != 0 { 1 } else { 0 })
            + self.n.at(self.n.at(n + CL_EXTENDS))
            + self.n.at(self.n.at(n + CL_MIXINS))
            + self.n.at(self.n.at(n + CL_IMPLEMENTS))
            > 1;
    }

    pub(crate) fn strip_non_null(&self, mut n: i32) -> i32 {
        while (self.n.at(n) & 0xff) == k::NonNullExpression {
            n = self.n.at(n + 4);
        }
        return n;
    }

    pub(crate) fn should_print_class_in_group_mode(&self, n: i32) -> bool {
        let id = self.n.at(n + CL_ID);
        let super_class = self.n.at(n + CL_SUPER);
        let type_parameters = self.n.at(n + CL_TYPE_PARAMETERS);
        if (id != 0 && self.has_trailing_comment(id))
            || (type_parameters != 0 && self.has_trailing_comment(type_parameters))
            || (super_class != 0 && self.has_comment(super_class))
            || self.has_multiple_heritage(n)
        {
            return true;
        }
        if super_class != 0 {
            if (self.n.at(self.n.at(n + 3)) & 0xff) == k::AssignmentExpression {
                return false;
            }
            return self.n.at(n + CL_SUPER_TYPE_ARGUMENTS) == 0
                && (self.n.at(self.strip_non_null(super_class)) & 0xff) == k::MemberExpression;
        }
        let mut list = self.n.at(n + CL_EXTENDS);
        if self.n.at(list) == 0 {
            list = self.n.at(n + CL_MIXINS);
        }
        if self.n.at(list) == 0 {
            list = self.n.at(n + CL_IMPLEMENTS);
        }
        if self.n.at(list) == 0 {
            return false;
        }
        // ClassImplements of Flow is not among the types that are looked at
        if self.mode.is_flow && list == self.n.at(n + CL_IMPLEMENTS) {
            return false;
        }
        let heritage = self.n.at(list + 1);
        let ek = self.n.at(self.n.at(heritage + 4)) & 0xff;
        return self.n.at(heritage + 5) == 0
            && (ek == k::MemberExpression || ek == k::QualifiedName);
    }

    pub(crate) fn print_super_class(&mut self, n: i32, super_class: i32) -> R<()> {
        self.text(EXTENDS_);
        self.print_leading_comments(super_class);
        if (self.n.at(self.n.at(n + 3)) & 0xff) == k::AssignmentExpression {
            let d = self.detach_open();
            self.print(super_class)?;
            let doc = self.detach_close(d);
            let g = self.group_open();
            let h = self.if_break_open(0);
            self.text(LPAREN);
            self.indent_softline();
            self.call(doc);
            self.dedent_softline();
            self.text(RPAREN);
            self.if_break_else(h);
            self.call(doc);
            self.if_break_close(h);
            self.group_close(g);
        } else {
            self.print(super_class)?;
        }
        self.print(self.n.at(n + CL_SUPER_TYPE_ARGUMENTS))?;
        self.print_trailing_comments(super_class);
        Ok(())
    }

    pub(crate) fn print_heritage_list(&mut self, list: i32) -> R<()> {
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            if i > 1 {
                self.text(COMMA);
                self.line();
            }
            self.print(self.n.at(list + i))?;
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn print_heritage_clauses(
        &mut self,
        n: i32,
        list: i32,
        keyword: i32,
        keyword_and_space: i32,
        marker: i32,
        group_mode: bool,
    ) -> R<()> {
        if self.n.at(list) == 0 {
            return Ok(());
        }
        if !self.has_multiple_heritage(n) {
            // like a superclass
            let mut g: i32 = 0;
            if group_mode {
                self.line();
                g = self.group_open();
            } else {
                self.text(SPACE);
            }
            self.text(keyword_and_space);
            self.print_dangling_comments_filtered(n, marker, false);
            self.print_heritage_list(list)?;
            if group_mode {
                self.group_close(g);
            }
            return Ok(());
        }
        self.line();
        if self.print_dangling_comments_filtered(n, marker, false) {
            self.hardline();
        }
        self.text(keyword);
        let g = self.group_open();
        self.indent_line();
        self.print_heritage_list(list)?;
        self.indent_close();
        self.group_close(g);
        Ok(())
    }

    /// The name or the type parameters of a class, with their comments.
    pub(crate) fn print_class_head_part(&mut self, part: i32) -> R<()> {
        if part == 0 {
            return Ok(());
        }
        self.print_leading_comments(part);
        self.print(part)?;
        if self.has_trailing_comment(part) {
            self.indent_open();
            self.print_trailing_comments(part);
            self.indent_close();
        }
        Ok(())
    }

    pub(crate) fn print_class_without_decorators(&mut self, n: i32) -> R<()> {
        let id = self.n.at(n + CL_ID);
        let super_class = self.n.at(n + CL_SUPER);
        let body = self.n.at(n + CL_BODY);
        let k = self.n.at(n) & 0xff;
        let is_interface = k == k::InterfaceDeclaration || k == k::InterfaceType;
        let modifiers = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
        if (modifiers & MOD_DECLARE) != 0 {
            self.text(DECLARE_);
        }
        if (modifiers & MOD_ABSTRACT) != 0 {
            self.text(ABSTRACT_);
        }
        self.text(if is_interface {
            INTERFACE
        } else {
            if k == k::RecordDeclaration {
                RECORD
            } else {
                CLASS
            }
        });
        let group_mode = self.should_print_class_in_group_mode(n);
        let heritage_group_id = if group_mode { self.new_group_id() } else { 0 };
        let g = if group_mode { self.group_open() } else { 0 };
        if id != 0 {
            self.text(SPACE);
        }
        self.print_class_head_part(id)?;
        self.print_class_head_part(self.n.at(n + CL_TYPE_PARAMETERS))?;
        if group_mode {
            self.indent_open();
        }
        if super_class != 0 {
            if group_mode {
                self.line();
                let g2 = self.group_open();
                self.print_super_class(n, super_class)?;
                self.group_close(g2);
            } else {
                self.text(SPACE);
                self.print_super_class(n, super_class)?;
            }
        } else {
            self.print_heritage_clauses(
                n,
                self.n.at(n + CL_EXTENDS),
                EXTENDS,
                EXTENDS_,
                DANGLING_EXTENDS,
                group_mode,
            )?;
        }
        self.print_heritage_clauses(
            n,
            self.n.at(n + CL_MIXINS),
            MIXINS,
            MIXINS_,
            DANGLING_MIXINS,
            group_mode,
        )?;
        self.print_heritage_clauses(
            n,
            self.n.at(n + CL_IMPLEMENTS),
            IMPLEMENTS,
            IMPLEMENTS_,
            DANGLING_IMPLEMENTS,
            group_mode,
        )?;
        if group_mode {
            self.indent_close();
            self.group_close_with(g, false, heritage_group_id);
        }
        if !is_interface && group_mode && self.n.at(self.n.at(body + 4)) > 0 {
            let h = self.if_break_open(heritage_group_id);
            self.hardline();
            self.if_break_else(h);
            self.text(SPACE);
            self.if_break_close(h);
        } else {
            self.text(SPACE);
        }
        self.print(body)?;
        Ok(())
    }

    pub(crate) fn print_class(&mut self, n: i32) -> R<()> {
        if (self.n.at(n) & 0xff) == k::ClassExpression && self.n.at(self.n.at(n + 7)) > 0 {
            let parens = self.needs_parens(n)?;
            if parens {
                self.indent_softline();
            }
            self.print_decorators(n, self.n.at(n + 7))?;
            self.print_class_without_decorators(n)?;
            if parens {
                self.dedent_softline();
            }
            return Ok(());
        }
        self.print_class_without_decorators(n)?;
        Ok(())
    }

    pub(crate) fn is_keyword_property(&self, member: i32) -> bool {
        if (self.n.at(member) & F_COMPUTED) != 0 {
            return false;
        }
        // a type annotation
        if if (self.n.at(member) & 0xff) == k::ClassProperty {
            self.n.at(member + 7) != 0
        } else {
            self.n.at(member + 5) != 0
        } {
            return false;
        }
        let key = self.n.at(member + 4);
        return (self.n.at(key) & 0xff) == k::Identifier
            && (self.name_is(key, b"static")
                || self.name_is(key, b"get")
                || self.name_is(key, b"set"));
    }

    pub(crate) fn should_print_semicolon_after_class_property(
        &self,
        member: i32,
        next: i32,
    ) -> bool {
        if self.options.semi || (self.n.at(member) & 0xff) != k::ClassProperty {
            return false;
        }
        if self.n.at(member + 5) == 0 && self.is_keyword_property(member) {
            return true;
        }
        if next == 0 {
            return false;
        }
        let nh = self.n.at(next);
        let nk = nh & 0xff;
        if nk == k::StaticBlock {
            return false;
        }
        if (nh & F_STATIC) != 0 {
            return false;
        }
        if (((nh as u32) >> SUB_SHIFT) as i32 & (MOD_ACCESSIBILITY | MOD_READONLY)) != 0 {
            return false;
        }
        if nk == k::IndexSignature {
            return true;
        }
        if (nh & F_COMPUTED) == 0 {
            let key = self.n.at(next + 4);
            if (self.n.at(key) & 0xff) == k::Identifier
                && (self.name_is(key, b"in") || self.name_is(key, b"instanceof"))
            {
                return true;
            }
        }
        if nk == k::ClassProperty {
            // a variance sigil of Flow
            if self.n.at(next + 8) != 0 && (((nh as u32) >> SUB_SHIFT) as i32 & MOD_DECLARE) == 0 {
                return true;
            }
            // ClassPrivateProperty and ClassAccessorProperty are other types in Babel's tree
            if (nh & F_ACCESSOR) != 0
                || (!self.mode.is_type_script
                    && (self.n.at(self.n.at(next + 4)) & 0xff) == k::PrivateName)
            {
                return false;
            }
            return (nh & F_COMPUTED) != 0;
        }
        if nk == k::ClassMethod {
            let method = ((nh as u32) >> SUB_SHIFT) as i32 & M_MASK;
            if (nh & F_ASYNC) != 0 || method == M_GET || method == M_SET {
                return false;
            }
            return (nh & (F_COMPUTED | F_GENERATOR)) != 0;
        }
        return false;
    }

    pub(crate) fn should_print_semicolon_after_interface_property(
        &self,
        member: i32,
        next: i32,
    ) -> bool {
        if self.options.semi || (self.n.at(member) & 0xff) != k::PropertySignature {
            return false;
        }
        if self.is_keyword_property(member) {
            return true;
        }
        if next == 0 {
            return false;
        }
        return (self.n.at(next) & 0xff) == k::CallSignature && self.n.at(member + 5) == 0;
    }

    /// The semicolon of a member of an interface or a type literal. `position`: see memberPosition().
    pub(crate) fn print_class_member_semicolon(&mut self, member: i32, position: i32) {
        let pk = self.n.at(self.n.at(member + 3)) & 0xff;
        if pk == k::ClassBody || pk == k::InterfaceBody {
            if self.options.semi || self.mode.is_flow {
                self.text(SEMI);
            }
            return;
        }
        if pk != k::TypeLiteral || !self.mode.is_type_script {
            return;
        }
        if position < 0 {
            if self.options.semi {
                self.if_break_text(SEMI, 0, 0);
            }
            return;
        }
        if self.options.semi
            || self.should_print_semicolon_after_interface_property(member, position)
        {
            self.text(SEMI);
        } else {
            self.if_break_text(0, SEMI, 0);
        }
    }

    /// Is the type `n` the annotation of the only parameter of a function, one that is hugged?
    pub(crate) fn is_type_of_hugged_parameter(&self, n: i32) -> bool {
        let annotation = self.n.at(n + 3);
        if (self.n.at(annotation) & 0xff) == k::FunctionTypeParam {
            return self.should_hug_the_only_function_parameter(self.n.at(annotation + 3));
        }
        if (self.n.at(annotation) & 0xff) != k::TypeAnnotation {
            return false;
        }
        let parameter = self.n.at(annotation + 3);
        if (self.n.at(parameter) & F_EXT) == 0
            || EXT_AT.at(self.n.at(parameter) & 0xff) == 0
            || self
                .n
                .at(parameter + EXT_AT.at(self.n.at(parameter) & 0xff))
                != annotation
        {
            return false;
        }
        let fn_ = self.n.at(parameter + 3);
        return IS_FUNCTION_LIKE.at(self.n.at(fn_) & 0xff) != 0
            && self.n.at(fn_ + 4) != parameter
            && self.n.at(fn_ + 5) != parameter
            && self.should_hug_the_only_function_parameter(fn_);
    }

    /// ClassBody, InterfaceBody, TypeLiteral.
    pub(crate) fn print_class_body(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        let has_dangling = self.has_dangling_comment(n);
        let is_object_type = (self.n.at(n) & 0xff) == k::TypeLiteral;
        if is_object_type {
            let is_exact = (self.n.at(n) & F_EXACT) != 0 && self.mode.is_flow;
            let is_inexact = (self.n.at(n) & F_INEXACT) != 0 && self.mode.is_flow;
            if count == 0 && !has_dangling && !is_inexact {
                self.text(if is_exact { LBRACE_BAR } else { LBRACE });
                self.text(if is_exact { BAR_RBRACE } else { RBRACE });
                return Ok(());
            }
            let should_break = self.has_dangling_line_comment(n)
                || (self.options.object_wrap_preserve
                    && count > 0
                    && self.has_newline_in_range(
                        self.n.at(n + 1),
                        self.n.at(self.n.at(list + 1) + 1),
                    ));
            let with_group = !self.is_type_of_hugged_parameter(n);
            let tight =
                !self.options.bracket_spacing || (count == 0 && !is_inexact && !should_break);
            let g = if with_group { self.group_open() } else { 0 };
            self.text(if is_exact { LBRACE_BAR } else { LBRACE });
            self.indent_open();
            if tight {
                self.softline();
            } else {
                self.line();
            }
            let mut i: i32 = 1;
            while i <= count {
                self.reserve();
                let member = self.n.at(list + i);
                self.set_member_position(
                    i == count,
                    if i < count {
                        self.n.at(list + i + 1)
                    } else {
                        0
                    },
                );
                self.print(member)?;
                if self.mode.is_flow {
                    if is_inexact || i < count {
                        self.text(COMMA);
                    } else if self.options.trailing_comma != TRAILING_COMMA_NONE {
                        self.if_break_text(COMMA, 0, 0);
                    }
                }
                if i < count {
                    self.line();
                    if self.is_next_line_empty(member) {
                        self.hardline();
                    }
                }
                i += 1;
            }
            if has_dangling {
                self.print_dangling_comments(n);
            }
            if is_inexact {
                if has_dangling {
                    if self.has_line_comment(n)
                        || self.has_newline(self.comment_end(self.last_dangling_comment(n)))
                    {
                        self.hardline();
                    } else {
                        self.line();
                    }
                } else if count > 0 {
                    self.line();
                }
                self.text(ELLIPSIS);
            }
            self.indent_close();
            if tight {
                self.softline();
            } else {
                self.line();
            }
            self.text(if is_exact { BAR_RBRACE } else { RBRACE });
            if with_group {
                self.group_close_with(g, should_break, 0);
            }
            return Ok(());
        }
        let is_record = (self.n.at(n) & 0xff) == k::RecordDeclarationBody;
        self.text(LBRACE);
        if count > 0 || has_dangling {
            self.indent_hardline();
            let mut i: i32 = 1;
            while i <= count {
                self.reserve();
                let member = self.n.at(list + i);
                let next = if i < count {
                    self.n.at(list + i + 1)
                } else {
                    0
                };
                self.set_member_position(i == count, next);
                self.print_item(member)?;
                if is_record {
                    if (self.n.at(member) & 0xff) != k::ClassMethod {
                        self.text(COMMA);
                    }
                } else if self.should_print_semicolon_after_class_property(member, next)
                    || self.should_print_semicolon_after_interface_property(member, next)
                {
                    self.text(SEMI);
                }
                if i < count {
                    self.hardline();
                    if self.is_next_line_empty(member) {
                        self.hardline();
                    }
                }
                i += 1;
            }
            if has_dangling {
                self.print_dangling_comments(n);
            }
            self.dedent_hardline();
        }
        self.text(RBRACE);
        Ok(())
    }

    pub(crate) fn print_class_method(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        if self.n.at(self.n.at(n + 7)) > 0 {
            self.print_class_member_decorators(self.n.at(n + 7))?;
        }
        if (((head as u32) >> SUB_SHIFT) as i32) > M_MASK {
            self.print_accessibility(head);
        }
        if (head & F_STATIC) != 0 {
            self.text(STATIC_);
        }
        if (((head as u32) >> SUB_SHIFT) as i32 & MOD_ABSTRACT) != 0 {
            self.text(ABSTRACT_);
        }
        if (((head as u32) >> SUB_SHIFT) as i32 & MOD_OVERRIDE) != 0 {
            self.text(OVERRIDE_);
        }
        self.print_method(n)?;
        Ok(())
    }

    /// Everything of a class property up to the `=`.
    pub(crate) fn print_class_property_left(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let modifiers = ((head as u32) >> SUB_SHIFT) as i32;
        if self.n.at(self.n.at(n + 6)) > 0 {
            self.print_class_member_decorators(self.n.at(n + 6))?;
        }
        if (modifiers & MOD_DECLARE) != 0 {
            self.text(DECLARE_);
        }
        if modifiers != 0 {
            self.print_accessibility(head);
        }
        if (head & F_STATIC) != 0 {
            self.text(STATIC_);
        }
        if (modifiers & MOD_ABSTRACT) != 0 {
            self.text(ABSTRACT_);
        }
        if (modifiers & MOD_OVERRIDE) != 0 {
            self.text(OVERRIDE_);
        }
        if (modifiers & MOD_READONLY) != 0 {
            self.text(READONLY_);
        }
        self.print(self.n.at(n + 8))?;
        if (head & F_ACCESSOR) != 0 {
            self.text(ACCESSOR_);
        }
        self.print_key(n)?;
        if (head & F_OPTIONAL) != 0 {
            self.text(QUESTION);
        }
        if (head & F_DEFINITE) != 0 {
            self.text(BANG);
        }
        self.print_type_annotation_property(self.n.at(n + 7))?;
        Ok(())
    }

    pub(crate) fn print_class_property(&mut self, n: i32) -> R<()> {
        // an abstract property has no value
        self.print_assignment(
            n,
            if (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & MOD_ABSTRACT) != 0 {
                0
            } else {
                self.n.at(n + 5)
            },
            EQ,
            0,
        )?;
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }
}
