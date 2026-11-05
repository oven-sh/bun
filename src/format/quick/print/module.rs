//! import and export declarations (module.js).

use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_EXTRA, F_SHORTHAND, IK_MASK, IK_SHIFT, IK_TYPE, P_DEFER, P_MASK, P_MODULE, P_SOURCE, k,
};
use crate::options::TRAILING_COMMA_NONE;
use crate::print::statics::{
    _AS_, _ASSERT_, _STAR, _WITH_, BRACES, COMMA, COMMA_SPACE, DEFER_, EXPORT, EXPORT_DEFAULT,
    FROM, IMPORT, LBRACE, MODULE_, RBRACE, SEMI, SOURCE_, SPACE, STAR_AS_,
};
use crate::{Quick, R, Words};

pub(crate) fn is_standalone(k: i32) -> bool {
    return k == k::ExportNamespaceSpecifier
        || k == k::ImportNamespaceSpecifier
        || k == k::ImportDefaultSpecifier;
}

impl Quick {
    pub(crate) fn print_module_specifiers(&mut self, specifiers: i32) -> R<()> {
        let count = self.n.at(specifiers);
        self.text(SPACE);
        if count == 0 {
            self.text(BRACES);
            return Ok(());
        }
        let mut standalone: i32 = 0;
        let mut grouped: i32 = 0;
        let mut any_comment = false;
        let mut i: i32 = 1;
        while i <= count {
            let specifier = self.n.at(specifiers + i);
            if is_standalone(self.n.at(specifier) & 0xff) {
                standalone += 1;
            } else {
                grouped += 1;
            }
            if self.has_comment(specifier) {
                any_comment = true;
            }
            i += 1;
        }
        let mut printed: i32 = 0;
        let mut i: i32 = 1;
        while i <= count {
            'c2: {
                let specifier = self.n.at(specifiers + i);
                if !is_standalone(self.n.at(specifier) & 0xff) {
                    break 'c2;
                }
                if ({
                    let v0 = printed;
                    printed += 1;
                    v0
                }) > 0
                {
                    self.text(COMMA_SPACE);
                }
                self.print(specifier)?;
            }
            i += 1;
        }
        if grouped == 0 {
            return Ok(());
        }
        if standalone > 0 {
            self.text(COMMA_SPACE);
        }
        if grouped > 1 || standalone > 0 || any_comment {
            let g = self.group_open();
            self.text(LBRACE);
            self.indent_open();
            if self.options.bracket_spacing {
                self.line();
            } else {
                self.softline();
            }
            printed = 0;
            let mut i: i32 = 1;
            while i <= count {
                'c4: {
                    let specifier = self.n.at(specifiers + i);
                    if is_standalone(self.n.at(specifier) & 0xff) {
                        break 'c4;
                    }
                    if ({
                        let v1 = printed;
                        printed += 1;
                        v1
                    }) > 0
                    {
                        self.text(COMMA);
                        self.line();
                    }
                    self.print(specifier)?;
                }
                i += 1;
            }
            if self.options.trailing_comma != TRAILING_COMMA_NONE {
                self.if_break_text(COMMA, 0, 0);
            }
            if self.options.bracket_spacing {
                self.dedent_line();
            } else {
                self.dedent_softline();
            }
            self.text(RBRACE);
            self.group_close(g);
            return Ok(());
        }
        self.text(LBRACE);
        if self.options.bracket_spacing {
            self.text(SPACE);
        }
        let mut i: i32 = 1;
        while i <= count {
            if !is_standalone(self.n.at(self.n.at(specifiers + i)) & 0xff) {
                self.print(self.n.at(specifiers + i))?;
            }
            i += 1;
        }
        if self.options.bracket_spacing {
            self.text(SPACE);
        }
        self.text(RBRACE);
        Ok(())
    }

    pub(crate) fn is_single_type_import_attributes(&self, attributes: i32) -> bool {
        if self.n.at(attributes) != 1 {
            return false;
        }
        let attribute = self.n.at(attributes + 1);
        let key = self.n.at(attribute + 4);
        let value = self.n.at(attribute + 5);
        let key_is_type = self.is_identifier_named(key, b"type")
            || (self.is_string_literal(key)
                && self.n.at(key + 2) - self.n.at(key + 1) == 6
                && self.t.at(self.n.at(key + 1) + 1) == 116
                && self.t.at(self.n.at(key + 1) + 2) == 121
                && self.t.at(self.n.at(key + 1) + 3) == 112
                && self.t.at(self.n.at(key + 1) + 4) == 101);
        return key_is_type
            && self.is_string_literal(value)
            && !self.has_comment(attribute)
            && !self.has_comment(key)
            && !self.has_comment(value);
    }

    pub(crate) fn print_import_attributes(
        &mut self,
        n: i32,
        source: i32,
        attributes: i32,
    ) -> R<()> {
        if source == 0 {
            return Ok(());
        }
        let count = self.n.at(attributes);
        if count == 0 {
            // `with {}` stays
            let c = self.next_significant_char(self.n.at(source + 2));
            if (c != 119 && c != 97) || self.n.at(n + 2) <= self.n.at(source + 2) {
                return Ok(());
            }
            self.text(if (self.n.at(n) & F_EXTRA) != 0 {
                _ASSERT_
            } else {
                _WITH_
            });
            let g = self.group_open();
            self.text(LBRACE);
            self.print_dangling_comments_in_list(n);
            self.text(RBRACE);
            self.group_close(g);
            return Ok(());
        }
        self.text(if (self.n.at(n) & F_EXTRA) != 0 {
            _ASSERT_
        } else {
            _WITH_
        });
        let first = self.n.at(attributes + 1);
        let should_break = self.options.object_wrap_preserve
            && self.has_newline_in_range(
                self.last_index_of_outside_comments(123, self.n.at(first + 1)),
                self.n.at(first + 1),
            );
        let single = self.is_single_type_import_attributes(attributes);
        if single {
            self.remove_lines_open();
        }
        self.print_members(n, attributes, should_break, true)?;
        if single {
            self.remove_lines_close();
        }
        Ok(())
    }

    pub(crate) fn print_import_declaration(&mut self, n: i32) -> R<()> {
        let source = self.n.at(n + 4);
        let specifiers = self.n.at(n + 5);
        let attributes = self.n.at(n + 6);
        self.text(IMPORT);
        match ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & P_MASK {
            P_DEFER => {
                self.text(SPACE);
                self.text(DEFER_);
            }
            P_SOURCE => {
                self.text(SPACE);
                self.text(SOURCE_);
            }
            P_MODULE => {
                self.text(SPACE);
                self.text(MODULE_);
            }
            _ => {}
        }
        let has_phase = (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & P_MASK) != 0;
        self.print_import_or_export_kind(n, false);
        let should_print_specifiers = self.n.at(specifiers) > 0
            || (self.n.at(n) & F_SHORTHAND) != 0
            || (((((self.n.at(n) as u32) >> SUB_SHIFT) as i32) >> IK_SHIFT) & IK_MASK) == IK_TYPE;
        if should_print_specifiers {
            if has_phase {
                self.print_module_specifiers_after_phase(specifiers)?;
            } else {
                self.print_module_specifiers(specifiers)?;
            }
            self.text(FROM);
        } else {
            self.text(SPACE);
        }
        self.print(source)?;
        self.print_import_attributes(n, source, attributes)?;
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    /// The phase was printed with a space behind it already.
    pub(crate) fn print_module_specifiers_after_phase(&mut self, specifiers: i32) -> R<()> {
        let mut i: i32 = 1;
        while i <= self.n.at(specifiers) {
            if i > 1 {
                self.text(COMMA_SPACE);
            }
            self.print(self.n.at(specifiers + i))?;
            i += 1;
        }
        Ok(())
    }
}
pub(crate) fn omits_semicolon_in_flow(k: i32) -> bool {
    match k {
        k::ComponentDeclaration
        | k::DeclareClass
        | k::DeclareComponent
        | k::DeclareFunction
        | k::DeclareHook
        | k::HookDeclaration
        | k::EnumDeclaration => {
            return true;
        }
        _ => {}
    }
    return false;
}

impl Quick {
    pub(crate) fn print_export_declaration(&mut self, n: i32) -> R<()> {
        let k = self.n.at(n) & 0xff;
        self.print_decorators_before_export(n)?;
        self.print_declare_token(n);
        self.text(if k == k::ExportDefaultDeclaration {
            EXPORT_DEFAULT
        } else {
            EXPORT
        });
        if self.has_dangling_comment(n) {
            self.text(SPACE);
            self.print_dangling_comments(n);
            if !self.is_block_comment(self.last_dangling_comment(n)) {
                self.hardline();
            }
        }
        if k == k::ExportDefaultDeclaration {
            let declaration = self.n.at(n + 4);
            self.text(SPACE);
            self.print(declaration)?;
            let dk = self.n.at(declaration) & 0xff;
            if self.options.semi
                && dk != k::ClassDeclaration
                && dk != k::FunctionDeclaration
                && dk != k::InterfaceDeclaration
                && dk != k::TSDeclareFunction
                && !omits_semicolon_in_flow(dk)
            {
                self.text(SEMI);
            }
            return Ok(());
        }
        if k == k::ExportAllDeclaration {
            self.print_import_or_export_kind(n, false);
            self.text(_STAR);
            if self.n.at(n + 4) != 0 {
                self.text(_AS_);
                self.print(self.n.at(n + 4))?;
            }
            self.text(FROM);
            self.print(self.n.at(n + 5))?;
            self.print_import_attributes(n, self.n.at(n + 5), self.n.at(n + 6))?;
            if self.options.semi {
                self.text(SEMI);
            }
            return Ok(());
        }
        let declaration = self.n.at(n + 4);
        if declaration != 0 {
            self.text(SPACE);
            self.print(declaration)?;
            return Ok(());
        }
        self.print_import_or_export_kind(n, false);
        self.print_module_specifiers(self.n.at(n + 6))?;
        let source = self.n.at(n + 5);
        if source != 0 {
            self.text(FROM);
            self.print(source)?;
            self.print_import_attributes(n, source, self.n.at(n + 7))?;
        }
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    pub(crate) fn print_module_specifier(&mut self, n: i32) -> R<()> {
        let k = self.n.at(n) & 0xff;
        match k {
            k::ImportNamespaceSpecifier | k::ExportNamespaceSpecifier => {
                self.text(STAR_AS_);
                self.print(self.n.at(n + 4))?;
                return Ok(());
            }
            k::ImportDefaultSpecifier => {
                self.print(self.n.at(n + 4))?;
                return Ok(());
            }
            _ => {}
        }
        let left = self.n.at(n + 4);
        let right = self.n.at(n + 5);
        self.print_import_or_export_kind(n, true);
        self.print(left)?;
        // without `as` the second name is a copy of the first
        if self.n.at(right + 1) != self.n.at(left + 1) {
            self.text(_AS_);
            self.print(right)?;
        }
        Ok(())
    }
}
