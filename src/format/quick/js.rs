//! From the text to the document: which parser reads the file, and the stages in their order.

use crate::ast::{F_PAREN, k};
use crate::jsx_guess::is_probably_jsx;
use crate::lang::lang;
use crate::parse::core::{TYPED_FLOW, TYPED_TS};
use crate::{Quick, R, Stop, Words, why};

/// What a host has said about an expression.
pub(crate) struct Host {
    /// WRAP_*
    pub(crate) wrap: i32,
    /// What is printed in front of the expression on its line, and behind it.
    pub(crate) before: Vec<u8>,
    pub(crate) after: Vec<u8>,
    pub(crate) has_vue_filters: bool,
    /// Prettier's `__isInHtmlAttribute`: see `single_quote` of options.rs.
    pub(crate) is_in_attribute: bool,
    /// The expression is `<$>`, JSX of MDX and `</$>`: what is between the two is printed.
    pub(crate) is_mdx_jsx: bool,
}
impl Host {
    pub(crate) fn new() -> Self {
        Self {
            wrap: WRAP_NONE,
            before: Vec::new(),
            after: Vec::new(),
            has_vue_filters: false,
            is_in_attribute: false,
            is_mdx_jsx: false,
        }
    }
}
/// The text is a program.
pub(crate) const WRAP_NONE: i32 = 0;
/// The expression and nothing around it.
pub(crate) const WRAP_BARE: i32 = 1;
/// group(doc)
pub(crate) const WRAP_GROUP: i32 = 2;
/// printExpand(doc)
pub(crate) const WRAP_EXPAND: i32 = 3;
/// The one or the other: shouldHugJsExpression()
pub(crate) const WRAP_BY_KIND: i32 = 4;

impl Quick {
    /// is_flow_file() of parse/babel.js: the name ends in .js.flow, or @flow or @noflow stands in the comments before the first token.
    pub(crate) fn is_flow_file(&self) -> bool {
        if self.options.name_ends_in_js_flow {
            return true;
        }
        let mut p = self.text.src_start;
        if self.t.at(p) == 35 && self.t.at(p + 1) == 33 {
            while p < self.text.src_end && self.t.at(p) != 10 && self.t.at(p) != 13 {
                p += 1;
            }
        }
        loop {
            let c = self.t.at(p);
            if c == 32 || c == 9 || c == 10 || c == 13 {
                p += 1;
                continue;
            }
            if c != 47 || (self.t.at(p + 1) != 47 && self.t.at(p + 1) != 42) {
                return false;
            }
            let is_block = self.t.at(p + 1) == 42;
            p += 2;
            'l2: while p < self.text.src_end {
                'c3: {
                    let d = self.t.at(p);
                    if if is_block {
                        d == 42 && self.t.at(p + 1) == 47
                    } else {
                        d == 10 || d == 13
                    } {
                        break 'l2;
                    }
                    if d != 64 {
                        break 'c3;
                    }
                    let q = if self.t.at(p + 1) == 110 && self.t.at(p + 2) == 111 {
                        p + 3
                    } else {
                        p + 1
                    };
                    if self.t.at(q) != 102
                        || self.t.at(q + 1) != 108
                        || self.t.at(q + 2) != 111
                        || self.t.at(q + 3) != 119
                    {
                        break 'c3;
                    }
                    let after = self.t.at(q + 4);
                    if !((after >= 48 && after <= 57)
                        || (after >= 65 && after <= 90)
                        || (after >= 97 && after <= 122)
                        || after == 95)
                    {
                        return true;
                    }
                }
                p += 1;
            }
            if p >= self.text.src_end {
                return false;
            }
            if is_block {
                p += 2;
            }
        }
    }
}

impl Quick {
    /// What has to happen before a new file is looked at.
    pub(crate) fn begin_root(&mut self, language: i32) {
        self.set_verified(0, 0);
        self.set_comment_window(0, 0);
        self.reset_comments();
        self.reset_key_cache();
        self.reset_embed();
        self.print_member.known = 0;
        self.print_ternary.known = 0;
        self.print.line_break_at = -1;
        self.lang.lang = language;
        self.lang.depth = 0;
        self.lang.guest_column = 0;
    }

    /// TypeScript: whether `<a>` is an element or a type assertion depends on the name of the file. Without one, both are tried.
    fn parse_type_script(&mut self) -> R<i32> {
        if let Some(jsx) = self.dialect.jsx {
            self.set_parser_mode(TYPED_TS, jsx);
            return self.parse_program();
        }
        let jsx = is_probably_jsx(self.t.sub(self.text.src_start, self.text.src_end));
        let comments = self.lexer.c_count;
        self.set_parser_mode(TYPED_TS, jsx);
        match self.parse_program() {
            Err(Stop) if self.why.get() == why::SYNTAX => {
                self.set_comment_window(self.lexer.c_base, comments);
                self.set_parser_mode(TYPED_TS, !jsx);
                self.parse_program()
            }
            result => result,
        }
    }

    /// The language of this run: files of Flow are read as Babel reads Flow.
    fn mode_of_run(&self) -> i32 {
        if self.lang.lang == lang::Babel && self.is_flow_file() {
            lang::BabelFlow
        } else {
            self.lang.lang
        }
    }

    fn parse_once(&mut self) -> R<i32> {
        self.set_parser_mode(0, true);
        self.set_is_common_js(self.dialect.common_js);
        self.set_flow_comments(self.mode.js_mode_language == lang::BabelFlow);
        self.set_type_script_spaces(self.lang.lang == lang::TypeScript);
        self.set_lenient_jsx_text(false);
        if self.mode.js_mode_language == lang::BabelFlow || self.lang.lang == lang::Flow {
            self.set_parser_mode(TYPED_FLOW, true);
            return self.parse_program();
        }
        if self.lang.lang == lang::TypeScript {
            return self.parse_type_script();
        }
        self.parse_program()
    }

    /// validateImportExport() of language-markdown/mdx.js
    fn assert_only_imports_and_exports(&self, program: i32) -> R<()> {
        if self.n.at(self.n.at(program + 4)) != 0 {
            return Err(self.text_refuse());
        }
        let body = self.n.at(program + 5);
        let mut i: i32 = 1;
        while i <= self.n.at(body) {
            let statement = self.n.at(body + i);
            if (self.n.at(statement) & 0xff) != k::ReadyComment {
                let kind = self.statement_kind(statement);
                if kind != k::ImportDeclaration
                    && kind != k::ExportDefaultDeclaration
                    && kind != k::ExportNamedDeclaration
                {
                    return Err(self.text_refuse());
                }
                // `export * as a from "b"` is not for here, whatever kind of node it is.
                if kind == k::ExportNamedDeclaration {
                    let mut p = self.n.at(statement + 1) + 6;
                    while self.t.at(p) == 32 || (self.t.at(p) >= 9 && self.t.at(p) <= 13) {
                        p += 1;
                    }
                    if self.t.at(p) == 42 || self.t.at(p) == 47 {
                        return Err(self.text_refuse());
                    }
                }
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn format_js(&mut self) -> R<()> {
        let mode = self.mode_of_run();
        self.set_js_mode(mode);
        let root = self.parse_once()?;
        if self.options.is_mdx_es_syntax {
            self.assert_only_imports_and_exports(root)?;
        }
        self.nothing_lost()?;
        self.stage(0);
        self.attach_comments(root)?;
        if self.comments.trailing_count == 0 {
            self.set_suffix_possible(false);
        }
        self.nothing_lost()?;
        self.stage(1);
        if self.host.wrap != WRAP_NONE {
            return self.print_expression(root);
        }
        self.print(root)?;
        self.check_that_comments_are_written()
    }

    /// The text is `(`, an expression, a line break and `)`, which is how one expression is read as a program. Prints the expression, with what the
    /// host has around it.
    fn print_expression(&mut self, program: i32) -> R<()> {
        let body = self.n.at(program + 5);
        let statement = self.n.at(body + 1);
        let expression = self.n.at(statement + 4);
        if self.n.at(self.n.at(program + 4)) != 0
            || self.n.at(body) != 1
            || (self.n.at(statement) & 0xff) != k::ExpressionStatement
            // `a) + (b`
            || (self.n.at(expression) & F_PAREN) == 0
            // Where a comment goes depends on more than is known here.
            || self.lexer.c_count != self.lexer.c_base
        {
            return Err(self.text_refuse());
        }
        self.n.put(expression, self.n.at(expression) & !F_PAREN);
        let root = self.node1(
            k::JsExpressionRoot,
            self.text.src_start,
            self.text.src_end,
            expression,
        );
        // shouldHugJsExpression() of language-html/embed/utilities.js
        let kind = self.n.at(expression) & 0xff;
        let hugs = match self.host.wrap {
            WRAP_GROUP => true,
            WRAP_BY_KIND => {
                kind == k::ObjectExpression
                    || kind == k::ArrayExpression
                    || ((kind == k::TemplateLiteral || kind == k::StringLiteral)
                        && self.mode.has_vue_filters)
            }
            _ => false,
        };
        let before = std::mem::take(&mut self.host.before);
        let from = self.text.gen_pos;
        self.gen_string(&before);
        self.host.before = before;
        self.slice_any(from, self.text.gen_pos);
        if self.host.wrap == WRAP_BARE {
            self.print(root)?;
        } else {
            let value = self.group_open();
            if hugs {
                let inner = self.group_open();
                self.print(root)?;
                self.group_close(inner);
            } else {
                self.indent_softline();
                self.print(root)?;
                self.dedent_softline();
            }
            self.group_close(value);
        }
        let after = std::mem::take(&mut self.host.after);
        let from = self.text.gen_pos;
        self.gen_string(&after);
        self.host.after = after;
        self.slice_any(from, self.text.gen_pos);
        Ok(())
    }
}
