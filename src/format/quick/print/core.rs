//! print_node: comments, parentheses and decorators around a node, and the dispatch on its kind
//! (src/main/ast-to-doc.js, src/language-js/print/index.js and estree.js).

use crate::arena::SUB_SHIFT;
use crate::ast::{
    CL_TYPE_PARAMETERS, EXT_AT, F_ANY_WIDTH, F_COMMENTS, F_DECIDED, F_DEFINITE, F_DELEGATE,
    F_ESCAPE, F_EXT, F_EXTRA, F_IGNORED, F_LEADING, F_LINES, F_OPTIONAL, F_PAREN, F_PREFIX,
    F_SLOW_TEXT, F_TRAILING, k,
};
use crate::lexer::tk;
use crate::options::EOL_LF;
use crate::print::statics::{
    AT, AWAIT, BANG, DEBUGGER, DOT, ELLIPSIS, EQ_SPACES, LPAREN, OPERATOR, QUESTION, RPAREN, SEMI,
    SPACE, YIELD, YIELD_STAR,
};
use crate::print::util::NEEDS_CARE;
use crate::{Quick, R, Words};

pub(crate) struct Print {
    /// A printer that finds that its node cannot be printed the way it was asked to sets this and returns at once
    /// (ArgExpansionBailout). Whoever asked resets it.
    pub(crate) bailout: bool,
}
impl Print {
    pub(crate) fn new() -> Self {
        Self { bailout: false }
    }
}

// what a parent can ask of a child
pub(crate) const ARG_EXPAND_FIRST: i32 = 1;
pub(crate) const ARG_EXPAND_LAST: i32 = 2;
/// this node gets printed more than once: print what does not vary once, and share it
pub(crate) const ARG_SHARE: i32 = 4;
pub(crate) const ARG_LAYOUT_SHIFT: i32 = 4;
pub(crate) const ARG_LAYOUT_MASK: i32 = 15 << ARG_LAYOUT_SHIFT;
impl Quick {
    pub(crate) fn set_bailout(&mut self, value: bool) {
        self.print.bailout = value;
    }

    pub(crate) fn is_iife_callee_or_tag(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        if k != k::FunctionExpression && k != k::ArrowFunctionExpression {
            return false;
        }
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        return (pk == k::CallExpression || pk == k::TaggedTemplateExpression)
            && self.n.at(parent + 4) == n;
    }

    pub(crate) fn should_expression_statement_print_own_comments(&self, n: i32) -> R<bool> {
        if !self.expression_statement_needs_leading_semicolon(n)? {
            return Ok(false);
        }
        let last = self.last_leading_comment(n);
        return Ok(last >= 0 && self.is_type_cast_comment_at(last));
    }

    pub(crate) fn will_print_own_comments(&self, n: i32, k: i32) -> R<bool> {
        let parent = self.n.at(n + 3);
        match self.n.at(parent) & 0xff {
            k::JSXSpreadAttribute | k::JSXSpreadChild => {
                return Ok(true);
            }
            k::UnionType => {
                return Ok(true);
            }
            k::ClassDeclaration | k::ClassExpression => {
                if self.n.at(parent + 4) == n
                    || self.n.at(parent + 5) == n
                    || self.n.at(parent + CL_TYPE_PARAMETERS) == n
                {
                    return Ok(true);
                }
            }
            k::InterfaceDeclaration | k::DeclareClass => {
                if self.n.at(parent + 4) == n || self.n.at(parent + CL_TYPE_PARAMETERS) == n {
                    return Ok(true);
                }
            }
            k::MatchOrPattern => {
                return Ok(true);
            }
            k::CallExpression | k::TaggedTemplateExpression => {
                if self.is_iife_callee_or_tag(n) {
                    return Ok(true);
                }
            }
            _ => {}
        }
        if self.has_ignore_comment(n) {
            return Ok(false);
        }
        if k == k::ExpressionStatement {
            return self.should_expression_statement_print_own_comments(n);
        }
        if k == k::UnionType {
            return Ok(self.should_union_type_print_own_comments(n));
        }
        return Ok(k == k::JSXElement || k == k::JSXFragment);
    }

    pub(crate) fn print_node(&mut self, n: i32, args: i32) -> R<()> {
        self.stack()?;
        if n == 0 {
            return Ok(());
        }
        self.reserve();
        let head = self.n.at(n);
        if (head
            & (0xff
                | F_COMMENTS
                | F_ESCAPE
                | F_SLOW_TEXT
                | F_EXTRA
                | F_EXT
                | F_OPTIONAL
                | F_DEFINITE
                | F_PAREN))
            == k::Identifier
        {
            // four nodes in ten
            self.slice(self.n.at(n + 1), self.n.at(n + 2));
            self.set_label(0);
            return Ok(());
        }
        let k = head & 0xff;
        if (head & (F_COMMENTS | F_IGNORED)) == 0 {
            if NEEDS_CARE.at(k) == 0 {
                self.dispatch(n, k, args)?;
                self.set_label(0);
                // (for what the nodes around this one write behind it: none of them asks again)
                self.reserve();
                return Ok(());
            }
            let ignored =
                (k == k::JSXElement || k == k::JSXFragment) && self.has_jsx_ignore_comment(n);
            if ignored {
                self.mark_comments_printed(self.n.at(n + 1), self.n.at(n + 2));
            }
            self.print_with_parens(n, k, args, ignored)?;
            self.reserve();
            return Ok(());
        }
        let ignored = self.has_ignore_comment(n)
            || ((k == k::JSXElement || k == k::JSXFragment) && self.has_jsx_ignore_comment(n));
        if ignored {
            self.mark_comments_printed(self.n.at(n + 1), self.n.at(n + 2));
        }
        if self.will_print_own_comments(n, k)? {
            self.print_with_parens(n, k, args, ignored)?;
            self.reserve();
            return Ok(());
        }
        if n == self.print_binaryish.skip_leading_comments_of {
            self.clear_skip_leading_comments();
        } else {
            self.print_leading_comments(n);
        }
        self.print_with_parens(n, k, args, ignored)?;
        self.print_trailing_comments(n);
        self.reserve();
        Ok(())
    }

    pub(crate) fn print(&mut self, n: i32) -> R<()> {
        self.print_node(n, 0)?;
        Ok(())
    }

    /// print() for a statement, a member or a property: many of them are texts already.
    pub(crate) fn print_item(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        if (head & (0xff | F_COMMENTS)) == k::Ready {
            self.reserve();
            if (head & F_LINES) != 0 {
                self.standing(
                    self.n.at(n + 4),
                    self.n.at(n + 5),
                    self.n.at(n + 6),
                    self.n.at(n + 7),
                    (head & F_DECIDED) != 0,
                );
            } else {
                self.fitted(
                    self.n.at(n + 4),
                    self.n.at(n + 5),
                    if ((head as u32) >> SUB_SHIFT) as i32 == k::ObjectProperty
                        || ((head as u32) >> SUB_SHIFT) as i32 == k::ObjectTypeProperty
                    {
                        1
                    } else {
                        0
                    },
                );
            }
        } else if (head & (0xff | F_COMMENTS)) == k::ReadyComment {
            self.print_comment_at(self.n.at(n + 1), self.n.at(n + 2), self.n.at(n + 4));
        } else {
            self.print_node(n, 0)?;
        }
        Ok(())
    }

    /// `?`, `!` and `: type` behind a name or a pattern.
    pub(crate) fn print_binding_suffix(&mut self, n: i32, k: i32) -> R<()> {
        let head = self.n.at(n);
        if (head & F_OPTIONAL) != 0 && !(k == k::Identifier && self.is_key_of_parent(n)) {
            self.text(QUESTION);
        }
        if k == k::Identifier && (head & F_DEFINITE) != 0 {
            self.text(BANG);
        }
        if (head & F_EXT) != 0 {
            self.print_type_annotation_property(self.n.at(n + EXT_AT.at(k)))?;
        }
        Ok(())
    }

    pub(crate) fn is_key_of_parent(&self, n: i32) -> bool {
        let parent = self.n.at(n + 3);
        match self.n.at(parent) & 0xff {
            k::ObjectProperty
            | k::ObjectMethod
            | k::ClassMethod
            | k::ClassProperty
            | k::PropertySignature
            | k::MethodSignature => {
                return self.n.at(parent + 4) == n;
            }
            _ => {}
        }
        return false;
    }

    /// Prints `n` once, out of line, however often this is called for it.
    pub(crate) fn print_shared(&mut self, n: i32) -> R<()> {
        let mut doc = self.cache_get(n);
        if doc == 0 {
            let h = self.detach_open();
            self.print_node(n, 0)?;
            doc = self.detach_close(h);
            self.cache_set(n, doc);
        }
        self.call(doc);
        Ok(())
    }

    pub(crate) fn print_ignored(&mut self, n: i32, k: i32) -> R<()> {
        let is_decorated_class_expression =
            k == k::ClassExpression && self.n.at(self.n.at(n + 7)) > 0;
        if is_decorated_class_expression {
            self.indent_softline();
        }
        let leading_semicolon = !(self.options.semi && self.should_ignored_node_print_semicolon(n))
            && k == k::ExpressionStatement
            && self.expression_statement_needs_leading_semicolon(n)?;
        if leading_semicolon {
            self.text(SEMI);
        }
        self.slice_any(self.n.at(n + 1), self.n.at(n + 2));
        if self.options.semi && self.should_ignored_node_print_semicolon(n) {
            self.text(SEMI);
        }
        if is_decorated_class_expression {
            self.dedent_softline();
        }
        Ok(())
    }

    pub(crate) fn print_with_parens(&mut self, n: i32, k: i32, args: i32, ignored: bool) -> R<()> {
        if k == k::ClassMethod || k == k::ClassProperty {
            if ignored {
                self.print_ignored(n, k)?;
            } else {
                self.dispatch(n, k, args)?;
            }
            self.set_label(0);
            return Ok(());
        }
        let parens = self.needs_parens(n)?;
        if parens {
            self.text(LPAREN);
        }
        let mut decorators: i32 = 0;
        if k == k::ClassDeclaration {
            decorators = self.n.at(n + 7);
        } else if (self.n.at(n) & F_EXT) != 0 || k == k::ParameterProperty {
            decorators = if k == k::ParameterProperty {
                self.n.at(n + 5)
            } else {
                if EXT_AT.at(k) != 0 {
                    self.n.at(n + EXT_AT.at(k) + 1)
                } else {
                    0
                }
            };
        }
        let decorated = decorators != 0 && self.n.at(decorators) > 0;
        let mut g: i32 = 0;
        if decorated {
            g = self.group_open();
            self.print_decorators(n, decorators)?;
        }
        let own_comments =
            (self.n.at(n) & (F_LEADING | F_TRAILING)) != 0 && self.is_iife_callee_or_tag(n);
        if own_comments {
            self.indent_softline();
            self.print_leading_comments(n);
        }
        if ignored {
            self.print_ignored(n, k)?;
        } else {
            self.dispatch(n, k, args)?;
        }
        if k != k::CallExpression
            && k != k::MemberExpression
            && k != k::TemplateLiteral
            && k != k::TaggedTemplateExpression
        {
            self.set_label(0);
        }
        if own_comments {
            self.print_trailing_comments(n);
            self.dedent_softline();
        }
        if decorated {
            self.group_close(g);
        }
        if parens {
            self.text(RPAREN);
        }
        Ok(())
    }

    /// An identifier with `\u` escapes is printed decoded, like Babel's `name`.
    pub(crate) fn print_escaped_name(&mut self, start: i32, end: i32) {
        self.reserve_gen(end - start);
        let from = self.text.gen_pos;
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if c != 92 {
                self.gen_byte(c);
                p += 1;
                continue;
            }
            let mut cp: i32 = 0;
            if self.t.at(p + 2) == 123 {
                p += 3;
                while self.t.at(p) != 125 {
                    cp = cp * 16 + print_hex_value(self.t.at(p));
                    p += 1;
                }
                p += 1;
            } else {
                let mut i: i32 = 2;
                while i < 6 {
                    cp = cp * 16 + print_hex_value(self.t.at(p + i));
                    i += 1;
                }
                p += 6;
            }
            if cp < 0x80 {
                self.gen_byte(cp);
            } else if cp < 0x800 {
                self.gen_byte(0xc0 | (cp >> 6));
                self.gen_byte(0x80 | (cp & 63));
            } else if cp < 0x10000 {
                self.gen_byte(0xe0 | (cp >> 12));
                self.gen_byte(0x80 | ((cp >> 6) & 63));
                self.gen_byte(0x80 | (cp & 63));
            } else {
                self.gen_byte(0xf0 | (cp >> 18));
                self.gen_byte(0x80 | ((cp >> 12) & 63));
                self.gen_byte(0x80 | ((cp >> 6) & 63));
                self.gen_byte(0x80 | (cp & 63));
            }
        }
        self.slice_any(from, self.text.gen_pos);
    }
}
pub(crate) fn print_hex_value(c: i32) -> i32 {
    if c <= 57 {
        return c - 48;
    }
    return (c | 32) - 87;
}

impl Quick {
    pub(crate) fn print_name(&mut self, n: i32) {
        let head = self.n.at(n);
        if (head & (F_SLOW_TEXT | F_ESCAPE)) == 0 {
            self.slice(self.n.at(n + 1), self.n.at(n + 2));
        } else if (head & F_ESCAPE) != 0 {
            self.print_escaped_name(self.n.at(n + 1), self.n.at(n + 2));
        } else {
            self.slice_any(self.n.at(n + 1), self.n.at(n + 2));
        }
    }

    pub(crate) fn print_await_expression(&mut self, n: i32) -> R<()> {
        let argument = self.n.at(n + 4);
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        if argument != 0
            && (pk == k::CallExpression || pk == k::MemberExpression)
            && self.n.at(parent + 4) == n
        {
            // an await that is called or read from: (await x).y
            let mut ancestor = parent;
            while ancestor != 0 {
                let ak = self.n.at(ancestor) & 0xff;
                if ak == k::AwaitExpression || ak == k::BlockStatement {
                    break;
                }
                ancestor = self.n.at(ancestor + 3);
            }
            let mut should_group = true;
            if ancestor != 0 && (self.n.at(ancestor) & 0xff) == k::AwaitExpression {
                let top = self.climb_left_spine(n);
                if top == self.n.at(ancestor + 4) {
                    should_group = false;
                }
            }
            let g = if should_group { self.group_open() } else { 0 };
            self.indent_softline();
            self.text(AWAIT);
            self.text(SPACE);
            self.print(argument)?;
            self.dedent_softline();
            if should_group {
                self.group_close(g);
            }
            return Ok(());
        }
        self.text(AWAIT);
        if argument != 0 {
            self.text(SPACE);
            self.print(argument)?;
        }
        Ok(())
    }

    pub(crate) fn dispatch(&mut self, n: i32, k: i32, args: i32) -> R<()> {
        match k {
            k::Identifier => {
                if (self.n.at(n) & (F_EXT | F_OPTIONAL | F_DEFINITE)) != 0 {
                    self.print_typed_name(n)?;
                    return Ok(());
                }
                self.print_name(n);
                return Ok(());
            }
            k::JSXIdentifier => {
                self.print_name(n);
                return Ok(());
            }
            k::PrivateName => {
                self.print_name(n);
                return Ok(());
            }
            k::StringLiteral => {
                self.print_string_literal(n);
                return Ok(());
            }
            k::NumericLiteral => {
                self.print_numeric_literal(n);
                return Ok(());
            }
            k::BigIntLiteral => {
                self.print_big_int_literal(n);
                return Ok(());
            }
            k::BooleanLiteral | k::NullLiteral | k::ThisExpression | k::Super => {
                self.slice(self.n.at(n + 1), self.n.at(n + 2));
                return Ok(());
            }
            k::RegExpLiteral => {
                self.print_reg_exp_literal(n);
                return Ok(());
            }
            k::DirectiveLiteral => {
                self.print_directive_literal(n);
                return Ok(());
            }
            k::TemplateElement => {
                self.slice_with_newlines(self.n.at(n + 1), self.n.at(n + 2));
                return Ok(());
            }
            k::ExpressionStatement => {
                self.print_expression_statement(n)?;
                return Ok(());
            }
            k::ParenthesizedExpression => {
                let expression = self.n.at(n + 4);
                if !self.has_comment(expression) && self.is_object_or_array_expression(expression) {
                    self.text(LPAREN);
                    self.print(expression)?;
                    self.text(RPAREN);
                    return Ok(());
                }
                let g = self.group_open();
                self.text(LPAREN);
                self.indent_softline();
                self.print(expression)?;
                self.dedent_softline();
                self.text(RPAREN);
                self.group_close(g);
                return Ok(());
            }
            k::AssignmentExpression => {
                self.print_assignment_expression(n)?;
                return Ok(());
            }
            k::VariableDeclarator => {
                self.print_variable_declarator(n)?;
                return Ok(());
            }
            k::BinaryExpression | k::LogicalExpression => {
                self.print_binaryish_expression(n)?;
                return Ok(());
            }
            k::AssignmentPattern => {
                self.print(self.n.at(n + 4))?;
                self.text(EQ_SPACES);
                self.print(self.n.at(n + 5))?;
                return Ok(());
            }
            k::MemberExpression => {
                self.print_member_expression(n)?;
                return Ok(());
            }
            k::MetaProperty => {
                self.print(self.n.at(n + 4))?;
                self.text(DOT);
                self.print(self.n.at(n + 5))?;
                return Ok(());
            }
            k::SpreadElement | k::RestElement => {
                self.text(ELLIPSIS);
                self.print(self.n.at(n + 4))?;
                if (self.n.at(n) & F_EXT) != 0 {
                    self.print_binding_suffix(n, k)?;
                }
                return Ok(());
            }
            k::FunctionDeclaration
            | k::FunctionExpression
            | k::TSDeclareFunction
            | k::HookDeclaration => {
                self.print_function(n, args)?;
                return Ok(());
            }
            k::ArrowFunctionExpression => {
                self.print_arrow_function(n, args)?;
                return Ok(());
            }
            k::YieldExpression => {
                self.text(if (self.n.at(n) & F_DELEGATE) != 0 {
                    YIELD_STAR
                } else {
                    YIELD
                });
                if self.n.at(n + 4) != 0 {
                    self.text(SPACE);
                    self.print(self.n.at(n + 4))?;
                }
                return Ok(());
            }
            k::AwaitExpression => {
                self.print_await_expression(n)?;
                return Ok(());
            }
            k::ExportDefaultDeclaration | k::ExportNamedDeclaration | k::ExportAllDeclaration => {
                self.print_export_declaration(n)?;
                return Ok(());
            }
            k::ImportDeclaration => {
                self.print_import_declaration(n)?;
                return Ok(());
            }
            k::ImportSpecifier
            | k::ExportSpecifier
            | k::ImportNamespaceSpecifier
            | k::ExportNamespaceSpecifier
            | k::ImportDefaultSpecifier => {
                self.print_module_specifier(n)?;
                return Ok(());
            }
            k::ImportAttribute | k::ObjectProperty => {
                self.print_property(n)?;
                return Ok(());
            }
            k::Program | k::BlockStatement | k::StaticBlock | k::ModuleBlock => {
                self.print_block(n)?;
                return Ok(());
            }
            k::ClassBody | k::InterfaceBody | k::TypeLiteral | k::RecordDeclarationBody => {
                self.print_class_body(n)?;
                return Ok(());
            }
            k::ThrowStatement | k::ReturnStatement => {
                self.print_return_or_throw_statement(n)?;
                return Ok(());
            }
            k::NewExpression | k::ImportExpression | k::CallExpression => {
                self.print_call_expression(n)?;
                return Ok(());
            }
            k::ObjectExpression | k::ObjectPattern | k::EnumBody => {
                self.print_object(n)?;
                return Ok(());
            }
            k::ObjectMethod => {
                self.print_method(n)?;
                return Ok(());
            }
            k::Decorator => {
                self.text(AT);
                self.print(self.n.at(n + 4))?;
                return Ok(());
            }
            k::ArrayExpression | k::ArrayPattern | k::TupleType => {
                self.print_array(n)?;
                return Ok(());
            }
            k::SequenceExpression => {
                self.print_sequence_expression(n)?;
                return Ok(());
            }
            k::Directive => {
                self.print(self.n.at(n + 4))?;
                if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(());
            }
            k::UnaryExpression => {
                let o = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
                self.text(OPERATOR.at(o));
                if o >= tk::In {
                    self.text(SPACE);
                }
                let argument = self.n.at(n + 4);
                if self.has_comment(argument) {
                    let g = self.group_open();
                    self.text(LPAREN);
                    self.indent_softline();
                    self.print(argument)?;
                    self.dedent_softline();
                    self.text(RPAREN);
                    self.group_close(g);
                } else {
                    self.print(argument)?;
                }
                return Ok(());
            }
            k::UpdateExpression => {
                let o = OPERATOR.at(((self.n.at(n) as u32) >> SUB_SHIFT) as i32);
                if (self.n.at(n) & F_PREFIX) != 0 {
                    self.text(o);
                }
                self.print(self.n.at(n + 4))?;
                if (self.n.at(n) & F_PREFIX) == 0 {
                    self.text(o);
                }
                return Ok(());
            }
            k::ConditionalExpression | k::ConditionalType => {
                self.print_ternary(n, args)?;
                return Ok(());
            }
            k::VariableDeclaration => {
                self.print_variable_declaration(n)?;
                return Ok(());
            }
            k::IfStatement => {
                self.print_if_statement(n)?;
                return Ok(());
            }
            k::ForStatement => {
                self.print_for_statement(n)?;
                return Ok(());
            }
            k::WithStatement | k::WhileStatement => {
                self.print_while_statement(n)?;
                return Ok(());
            }
            k::DoWhileStatement => {
                self.print_do_while_statement(n)?;
                return Ok(());
            }
            k::ForInStatement | k::ForOfStatement => {
                self.print_for_x_statement(n)?;
                return Ok(());
            }
            k::BreakStatement | k::ContinueStatement => {
                self.print_break_or_continue(n)?;
                return Ok(());
            }
            k::LabeledStatement => {
                self.print_labeled_statement(n)?;
                return Ok(());
            }
            k::TryStatement => {
                self.print_try_statement(n)?;
                return Ok(());
            }
            k::CatchClause => {
                self.print_catch_clause(n)?;
                return Ok(());
            }
            k::SwitchStatement => {
                self.print_switch_statement(n)?;
                return Ok(());
            }
            k::SwitchCase => {
                self.print_switch_case(n)?;
                return Ok(());
            }
            k::DebuggerStatement => {
                self.text(DEBUGGER);
                if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(());
            }
            k::ClassDeclaration
            | k::ClassExpression
            | k::InterfaceDeclaration
            | k::DeclareClass
            | k::InterfaceType
            | k::RecordDeclaration => {
                self.print_class(n)?;
                return Ok(());
            }
            k::ClassMethod => {
                self.print_class_method(n)?;
                return Ok(());
            }
            k::ClassProperty => {
                self.print_class_property(n)?;
                return Ok(());
            }
            k::TemplateLiteral | k::TemplateLiteralType => {
                self.print_template_literal(n)?;
                return Ok(());
            }
            k::TaggedTemplateExpression => {
                self.print_tagged_template_expression(n)?;
                return Ok(());
            }
            k::EmptyStatement => {
                if self.is_meaningful_empty_statement(n) {
                    self.text(SEMI);
                }
                return Ok(());
            }
            k::Ready => {
                if (self.n.at(n) & F_LINES) != 0 {
                    self.standing(
                        self.n.at(n + 4),
                        self.n.at(n + 5),
                        self.n.at(n + 6),
                        self.n.at(n + 7),
                        (self.n.at(n) & F_DECIDED) != 0,
                    );
                    return Ok(());
                }
                // behind a property stands a comma
                self.fitted(
                    self.n.at(n + 4),
                    self.n.at(n + 5),
                    if ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == k::ObjectProperty
                        || ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == k::ObjectTypeProperty
                    {
                        1
                    } else {
                        0
                    },
                );
                return Ok(());
            }
            k::ReadyComment => {
                self.print_comment_at(self.n.at(n + 1), self.n.at(n + 2), self.n.at(n + 4));
                return Ok(());
            }
            k::ReadyLines => {
                if self.options.end_of_line == EOL_LF {
                    self.slice_lines_at_margin(self.n.at(n + 1), self.n.at(n + 2), 0);
                } else {
                    self.slice_with_newlines(self.n.at(n + 1), self.n.at(n + 2));
                }
                return Ok(());
            }
            k::ReadyWrap => {
                let blocks = self.n.at(n + 4);
                let count = self.n.at(blocks);
                let mut i: i32 = 0;
                while i < count {
                    if i == 0 && (self.n.at(n) & F_LINES) != 0 {
                        self.standing(
                            self.n.at(n + 5),
                            self.n.at(n + 6),
                            self.n.at(n + 7 + count * 2),
                            self.n.at(n + 8 + count * 2),
                            true,
                        );
                    } else if i == 0 && (self.n.at(n) & F_ANY_WIDTH) != 0 {
                        self.slice(self.n.at(n + 5), self.n.at(n + 5) + self.n.at(n + 6));
                    } else {
                        self.fitted(self.n.at(n + 5 + i * 2), self.n.at(n + 6 + i * 2), 1);
                    }
                    self.print(self.n.at(blocks + 1 + i))?;
                    i += 1;
                }
                let start = self.n.at(n + 5 + count * 2);
                self.slice(start, start + self.n.at(n + 6 + count * 2));
                return Ok(());
            }
            _ => {
                if !self.print_typed(n, k, args)? {
                    self.print_jsx(n, k)?;
                }
            }
        }
        Ok(())
    }

    /// A name with `?`, `!` or a type behind it: the range of the node holds all of that.
    pub(crate) fn print_typed_name(&mut self, n: i32) -> R<()> {
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        self.n.put(n + 1, self.name_start(n));
        self.n.put(n + 2, self.print_name_end(n));
        self.print_name(n);
        self.n.put(n + 1, start);
        self.n.put(n + 2, end);
        self.print_binding_suffix(n, k::Identifier)?;
        Ok(())
    }

    /// Where the name of an Identifier starts: behind its decorators.
    pub(crate) fn name_start(&self, n: i32) -> i32 {
        if (self.n.at(n) & F_EXT) != 0 {
            let decorators = self.n.at(n + 5);
            if self.n.at(decorators) > 0 {
                return self.next_significant_index(
                    self.n.at(self.n.at(decorators + self.n.at(decorators)) + 2),
                );
            }
        }
        return self.n.at(n + 1);
    }

    /// Where the name of an Identifier ends.
    pub(crate) fn print_name_end(&self, n: i32) -> i32 {
        let end = self.n.at(n + 2);
        if (self.n.at(n) & (F_EXT | F_OPTIONAL | F_DEFINITE)) == 0 {
            return end;
        }
        let mut p = self.name_start(n);
        while p < end {
            let c = self.t.at(p);
            if c == 92 && self.t.at(p + 2) == 123 {
                // \u{..}
                while self.t.at(p) != 125 {
                    p += 1;
                }
            } else if c < 128
                && !((c >= 97 && c <= 122)
                    || (c >= 65 && c <= 90)
                    || (c >= 48 && c <= 57)
                    || c == 95
                    || c == 36
                    || c == 92)
            {
                break;
            }
            p += 1;
        }
        return p;
    }
}
