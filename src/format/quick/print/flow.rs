//! The nodes that only Flow has (flow.js, component.js, hook.js, match.js, opaque-type.js and the Flow half of mapped-type.js).

use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_ASYNC, F_METHOD, F_OPTIONAL, F_PROTO, F_SHORTHAND, F_STATIC, F_THIS, FN_RETURN_TYPE,
    FN_TYPE_PARAMETERS, M_GET, M_MASK, M_SET, MT_MINUS, MT_NONE, MT_PLUS, V_CONST, V_LET, VA_IN,
    VA_MINUS, VA_OUT, VA_PLUS, VA_READONLY, k,
};
use crate::print::statics::{
    _ARROW, _AS_, _BAR_, _IN_, ASYNC_, BAR_, CHECKS, COLON, COLON_SPACE, COMMA, COMPONENT, CONST,
    DECLARE_MODULE_EXPORTS, DOT, ELLIPSIS, EQ_SPACES, EXTENDS_, FUNCTION, GET_, HOOK, IF_LPAREN,
    IN_, LBRACE, LBRACKET, LET, LPAREN, MATCH_LPAREN, MINUS, OPAQUE_TYPE_, OPERATOR, OUT_, PLUS,
    PROTO_, QUESTION, RBRACE, RBRACKET, RBRACKET_COLON_, READONLY_, RPAREN, SEMI, SET_, SPACE,
    STATIC_, SUPER_, THIS, UNDERSCORE, VAR, WRITEONLY_,
};
use crate::{Quick, R, Words};

impl Quick {
    pub(crate) fn print_variance(&mut self, n: i32) -> R<()> {
        match ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 {
            VA_PLUS => {
                self.text(PLUS)?;
            }
            VA_MINUS => {
                self.text(MINUS)?;
            }
            VA_READONLY => {
                self.text(READONLY_)?;
            }
            VA_IN => {
                self.text(IN_)?;
            }
            VA_OUT => {
                self.text(OUT_)?;
            }
            _ => {
                self.text(WRITEONLY_)?;
            }
        }
        Ok(())
    }

    pub(crate) fn print_component(&mut self, n: i32, k: i32) -> R<()> {
        self.print_declare_token(n)?;
        if (self.n.at(n) & F_ASYNC) != 0 {
            self.text(ASYNC_)?;
        }
        self.text(COMPONENT)?;
        if self.n.at(n + 4) != 0 {
            self.text(SPACE)?;
            self.print(self.n.at(n + 4))?;
        }
        self.print(self.n.at(n + FN_TYPE_PARAMETERS))?;
        let g = self.group_open();
        self.print_function_parameters(n, false, false)?;
        if self.n.at(n + FN_RETURN_TYPE) != 0 {
            self.text(SPACE)?;
            self.print(self.n.at(n + FN_RETURN_TYPE))?;
        }
        self.group_close(g);
        if self.n.at(n + 5) != 0 {
            self.text(SPACE)?;
            self.print(self.n.at(n + 5))?;
        }
        if k == k::DeclareComponent && self.options.semi {
            self.text(SEMI)?;
        }
        Ok(())
    }

    pub(crate) fn print_opaque_type(&mut self, n: i32) -> R<()> {
        self.print_declare_token(n)?;
        self.text(OPAQUE_TYPE_)?;
        self.print(self.n.at(n + 4))?;
        self.print(self.n.at(n + 5))?;
        if self.n.at(n + 6) != 0 {
            self.text(COLON_SPACE)?;
            self.print(self.n.at(n + 6))?;
        }
        if self.n.at(n + 7) != 0 || self.n.at(n + 8) != 0 {
            let g = self.group_open();
            if self.n.at(n + 7) != 0 {
                self.indent_line()?;
                self.text(SUPER_)?;
                self.print(self.n.at(n + 7))?;
                self.indent_close();
            }
            if self.n.at(n + 8) != 0 {
                self.indent_line()?;
                self.text(EXTENDS_)?;
                self.print(self.n.at(n + 8))?;
                self.indent_close();
            }
            self.group_close(g);
        }
        if self.n.at(n + 9) != 0 {
            self.text(EQ_SPACES)?;
            self.print(self.n.at(n + 9))?;
        }
        if self.options.semi {
            self.text(SEMI)?;
        }
        Ok(())
    }

    // -------------------------------------------------------------------------------------------------------------- match
    pub(crate) fn print_match(&mut self, n: i32) -> R<()> {
        let g = self.group_open();
        self.text(MATCH_LPAREN)?;
        self.indent_softline();
        self.print(self.n.at(n + 4))?;
        self.dedent_softline();
        self.text(RPAREN)?;
        self.group_close(g);
        self.text(SPACE)?;
        self.text(LBRACE)?;
        let cases = self.n.at(n + 5);
        let count = self.n.at(cases);
        if count > 0 {
            self.indent_open();
            let mut i: i32 = 1;
            while i <= count {
                self.reserve();
                self.hardline();
                let c = self.n.at(cases + i);
                self.print(c)?;
                if i < count && self.is_next_line_empty(c) {
                    self.hardline();
                }
                i += 1;
            }
            self.indent_close();
        }
        self.hardline();
        self.text(RBRACE)?;
        Ok(())
    }

    pub(crate) fn print_match_case(&mut self, n: i32, k: i32) -> R<()> {
        self.print(self.n.at(n + 4))?;
        if self.n.at(n + 5) != 0 {
            let g = self.group_open();
            self.indent_line()?;
            self.text(IF_LPAREN)?;
            self.print(self.n.at(n + 5))?;
            self.text(RPAREN)?;
            self.indent_close();
            self.group_close(g);
        }
        let g = self.group_open();
        self.text(_ARROW)?;
        if self.has_dangling_comment(n) {
            self.text(SPACE)?;
            self.print_dangling_comments(n)?;
        }
        if k == k::MatchStatementCase {
            self.text(SPACE)?;
            self.print(self.n.at(n + 6))?;
        } else {
            self.indent_line()?;
            self.print(self.n.at(n + 6))?;
            self.text(COMMA)?;
            self.indent_close();
        }
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_match_list(&mut self, n: i32, open: i32, close: i32) -> R<()> {
        let rest = self.n.at(n + 4);
        let list = self.n.at(n + 5);
        let count = self.n.at(list);
        let g = self.group_open();
        self.text(open)?;
        self.indent_softline();
        let mut i: i32 = 1;
        while i <= count {
            if i > 1 {
                self.text(COMMA)?;
                self.line()?;
            }
            self.print(self.n.at(list + i))?;
            i += 1;
        }
        if rest != 0 {
            if count > 0 {
                self.text(COMMA)?;
                self.line()?;
            }
            self.print(rest)?;
        }
        if rest == 0 {
            self.if_break_text(COMMA, 0, 0)?;
        }
        self.dedent_softline();
        self.text(close)?;
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn is_simple_match_pattern(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return k == k::MatchWildcardPattern
            || k == k::MatchLiteralPattern
            || k == k::MatchUnaryPattern
            || k == k::MatchIdentifierPattern;
    }

    pub(crate) fn should_hug_match_or_pattern(&self, n: i32) -> bool {
        let list = self.n.at(n + 4);
        let mut object_pattern: i32 = 0;
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let pattern = self.n.at(list + i);
            if self.has_comment(pattern) {
                return false;
            }
            if object_pattern == 0 && (self.n.at(pattern) & 0xff) == k::MatchObjectPattern {
                object_pattern = pattern;
            }
            i += 1;
        }
        if object_pattern == 0 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let pattern = self.n.at(list + i);
            if pattern != object_pattern && !self.is_simple_match_pattern(pattern) {
                return false;
            }
            i += 1;
        }
        return true;
    }

    pub(crate) fn print_match_or_patterns(&mut self, n: i32, should_hug: bool) -> R<()> {
        let list = self.n.at(n + 4);
        if !should_hug {
            self.if_break_text(BAR_, 0, 0)?;
        }
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let pattern = self.n.at(list + i);
            if i > 1 {
                if should_hug {
                    self.text(_BAR_)?;
                } else {
                    self.line()?;
                    self.text(BAR_)?;
                }
            }
            self.print_leading_comments(pattern)?;
            if !should_hug {
                self.align_open(2);
            }
            self.print(pattern)?;
            if !should_hug {
                self.indent_close();
            }
            self.print_trailing_comments(pattern)?;
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn print_match_or_pattern(&mut self, n: i32) -> R<()> {
        if self.should_hug_match_or_pattern(n) {
            self.print_match_or_patterns(n, true)?;
            return Ok(());
        }
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        let g = self.group_open();
        if self.needs_parens(n)? {
            self.indent_open();
            let h = self.if_break_open(0);
            self.softline();
            self.if_break_else(h);
            self.if_break_close(h);
            self.print_match_or_patterns(n, false)?;
            self.dedent_softline();
        } else if pk == k::MatchArrayPattern && self.n.at(self.n.at(parent + 5)) > 1 {
            self.indent_open();
            let h = self.if_break_open(0);
            self.text(LPAREN)?;
            self.softline();
            self.if_break_else(h);
            self.if_break_close(h);
            self.print_match_or_patterns(n, false)?;
            self.dedent_softline();
            self.if_break_text(RPAREN, 0, 0)?;
        } else {
            let should_indent = pk != k::MatchStatementCase
                && pk != k::MatchExpressionCase
                && pk != k::MatchArrayPattern
                && pk != k::MatchObjectPatternProperty
                && !self.has_leading_own_line_comment(n);
            if should_indent {
                self.indent_open();
            }
            self.print_match_or_patterns(n, false)?;
            if should_indent {
                self.indent_close();
            }
        }
        self.group_close(g);
        Ok(())
    }

    /// Prints a node of a kind that only Flow has. False if the kind is none of them.
    pub(crate) fn print_flow(&mut self, n: i32, k: i32) -> R<bool> {
        match k {
            k::ObjectTypeProperty => {
                let head = self.n.at(n);
                let position = self.member_position();
                if (head & F_PROTO) != 0 {
                    self.text(PROTO_)?;
                } else if (head & F_STATIC) != 0 {
                    self.text(STATIC_)?;
                }
                let method = ((head as u32) >> SUB_SHIFT) as i32 & M_MASK;
                if method == M_GET {
                    self.text(GET_)?;
                } else if method == M_SET {
                    self.text(SET_)?;
                }
                self.print(self.n.at(n + 6))?;
                self.print_key(n)?;
                if (head & F_OPTIONAL) != 0 {
                    self.text(QUESTION)?;
                }
                if (head & F_METHOD) == 0 && method != M_GET && method != M_SET {
                    self.text(COLON_SPACE)?;
                }
                self.print(self.n.at(n + 5))?;
                self.print_class_member_semicolon(n, position)?;
                return Ok(true);
            }
            k::ObjectTypeIndexer => {
                let position = self.member_position();
                if (self.n.at(n) & F_STATIC) != 0 {
                    self.text(STATIC_)?;
                }
                self.print(self.n.at(n + 7))?;
                self.text(LBRACKET)?;
                if self.n.at(n + 4) != 0 {
                    self.print(self.n.at(n + 4))?;
                    self.text(COLON_SPACE)?;
                }
                self.print(self.n.at(n + 5))?;
                self.text(RBRACKET_COLON_)?;
                self.print(self.n.at(n + 6))?;
                self.print_class_member_semicolon(n, position)?;
                return Ok(true);
            }
            k::ObjectTypeCallProperty => {
                let position = self.member_position();
                if (self.n.at(n) & F_STATIC) != 0 {
                    self.text(STATIC_)?;
                }
                self.print(self.n.at(n + 4))?;
                self.print_class_member_semicolon(n, position)?;
                return Ok(true);
            }
            k::ObjectTypeInternalSlot => {
                let position = self.member_position();
                if (self.n.at(n) & F_STATIC) != 0 {
                    self.text(STATIC_)?;
                }
                self.text(LBRACKET)?;
                self.text(LBRACKET)?;
                self.print(self.n.at(n + 4))?;
                self.text(RBRACKET)?;
                self.text(RBRACKET)?;
                if (self.n.at(n) & F_OPTIONAL) != 0 {
                    self.text(QUESTION)?;
                }
                if (self.n.at(n) & F_METHOD) == 0 {
                    self.text(COLON_SPACE)?;
                }
                self.print(self.n.at(n + 5))?;
                self.print_class_member_semicolon(n, position)?;
                return Ok(true);
            }
            k::ObjectTypeSpreadProperty => {
                self.text(ELLIPSIS)?;
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::ObjectTypeMappedTypeProperty => {
                let position = self.member_position();
                let g = self.group_open();
                self.print(self.n.at(n + 7))?;
                let kg = self.group_open();
                self.text(LBRACKET)?;
                self.indent_softline();
                self.print(self.n.at(n + 4))?;
                self.text(_IN_)?;
                self.print(self.n.at(n + 5))?;
                self.dedent_softline();
                self.text(RBRACKET)?;
                self.group_close(kg);
                let optional = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
                if optional != MT_NONE {
                    if optional == MT_PLUS {
                        self.text(PLUS)?;
                    } else if optional == MT_MINUS {
                        self.text(MINUS)?;
                    }
                    self.text(QUESTION)?;
                }
                self.text(COLON_SPACE)?;
                self.print(self.n.at(n + 6))?;
                self.group_close(g);
                self.print_class_member_semicolon(n, position)?;
                return Ok(true);
            }
            k::FunctionTypeParam => {
                let has_name = self.n.at(n + 4) != 0 || (self.n.at(n) & F_THIS) != 0;
                if self.n.at(n + 4) != 0 {
                    self.print(self.n.at(n + 4))?;
                } else if (self.n.at(n) & F_THIS) != 0 {
                    self.text(THIS)?;
                }
                if (self.n.at(n) & F_OPTIONAL) != 0 {
                    self.text(QUESTION)?;
                }
                if has_name {
                    self.text(COLON_SPACE)?;
                }
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::Variance => {
                self.print_variance(n)?;
                return Ok(true);
            }
            k::TypeCastExpression => {
                self.text(LPAREN)?;
                self.print(self.n.at(n + 4))?;
                self.print_type_annotation_property(self.n.at(n + 5))?;
                self.text(RPAREN)?;
                return Ok(true);
            }
            k::Predicate => {
                let parent = self.n.at(n + 3);
                self.text(
                    if (self.n.at(parent) & 0xff) != k::DeclareFunction
                        && self.n.at(parent + FN_RETURN_TYPE) == 0
                    {
                        COLON_SPACE
                    } else {
                        SPACE
                    },
                )?;
                self.text(CHECKS)?;
                if self.n.at(n + 4) != 0 {
                    self.text(LPAREN)?;
                    self.print(self.n.at(n + 4))?;
                    self.text(RPAREN)?;
                }
                return Ok(true);
            }
            k::OpaqueType => {
                self.print_opaque_type(n)?;
                return Ok(true);
            }
            k::DeclareFunction => {
                self.print_declare_token(n)?;
                self.text(FUNCTION)?;
                self.text(SPACE)?;
                self.print(self.n.at(n + 4))?;
                self.print(self.n.at(n + 5))?;
                if self.options.semi {
                    self.text(SEMI)?;
                }
                return Ok(true);
            }
            k::DeclareModuleExports => {
                self.text(DECLARE_MODULE_EXPORTS)?;
                self.print_type_annotation_property(self.n.at(n + 4))?;
                if self.options.semi {
                    self.text(SEMI)?;
                }
                return Ok(true);
            }
            k::ComponentDeclaration | k::DeclareComponent | k::ComponentTypeAnnotation => {
                self.print_component(n, k)?;
                return Ok(true);
            }
            k::ComponentParameter => {
                if (self.n.at(n) & F_SHORTHAND) == 0 {
                    self.print(self.n.at(n + 4))?;
                    self.text(_AS_)?;
                }
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::ComponentTypeParameter => {
                if self.n.at(n + 4) != 0 {
                    self.print(self.n.at(n + 4))?;
                    if (self.n.at(n) & F_OPTIONAL) != 0 {
                        self.text(QUESTION)?;
                    }
                    self.text(COLON_SPACE)?;
                }
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::DeclareHook => {
                self.print_declare_token(n)?;
                self.text(HOOK)?;
                self.text(SPACE)?;
                self.print(self.n.at(n + 4))?;
                if self.options.semi {
                    self.text(SEMI)?;
                }
                return Ok(true);
            }
            k::HookTypeAnnotation => {
                let g = self.group_open();
                let is_declared = self.n.at(self.n.at(self.n.at(n + 3) + 3) + 3) != 0
                    && (self.n.at(self.n.at(self.n.at(self.n.at(n + 3) + 3) + 3)) & 0xff)
                        == k::DeclareHook;
                if !is_declared {
                    self.text(HOOK)?;
                    self.text(SPACE)?;
                }
                self.print_parameters_and_return_type(n, false, true, false, false)?;
                self.group_close(g);
                return Ok(true);
            }
            k::MatchExpression | k::MatchStatement => {
                self.print_match(n)?;
                return Ok(true);
            }
            k::MatchExpressionCase | k::MatchStatementCase => {
                self.print_match_case(n, k)?;
                return Ok(true);
            }
            k::MatchOrPattern => {
                self.print_match_or_pattern(n)?;
                return Ok(true);
            }
            k::MatchAsPattern => {
                self.print(self.n.at(n + 4))?;
                self.text(_AS_)?;
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::MatchWildcardPattern => {
                self.text(UNDERSCORE)?;
                return Ok(true);
            }
            k::MatchLiteralPattern | k::MatchIdentifierPattern => {
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::MatchUnaryPattern => {
                self.text(OPERATOR.at(((self.n.at(n) as u32) >> SUB_SHIFT) as i32))?;
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::MatchMemberPattern => {
                let g = self.group_open();
                self.print(self.n.at(n + 4))?;
                let property = self.n.at(n + 5);
                if (self.n.at(property) & 0xff) == k::Identifier {
                    self.text(DOT)?;
                    self.print(property)?;
                } else {
                    self.text(LBRACKET)?;
                    self.indent_softline();
                    self.print(property)?;
                    self.dedent_softline();
                    self.text(RBRACKET)?;
                }
                self.group_close(g);
                return Ok(true);
            }
            k::MatchBindingPattern => {
                let kind = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
                self.text(if kind == V_CONST {
                    CONST
                } else {
                    if kind == V_LET { LET } else { VAR }
                })?;
                self.text(SPACE)?;
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::MatchObjectPattern | k::MatchInstanceObjectPattern => {
                self.print_match_list(n, LBRACE, RBRACE)?;
                return Ok(true);
            }
            k::MatchArrayPattern => {
                self.print_match_list(n, LBRACKET, RBRACKET)?;
                return Ok(true);
            }
            k::MatchInstancePattern => {
                let g = self.group_open();
                self.print(self.n.at(n + 4))?;
                self.text(SPACE)?;
                self.print(self.n.at(n + 5))?;
                self.group_close(g);
                return Ok(true);
            }
            k::MatchObjectPatternProperty => {
                if (self.n.at(n) & F_SHORTHAND) != 0 {
                    self.print(self.n.at(n + 5))?;
                    return Ok(true);
                }
                let g = self.group_open();
                self.print(self.n.at(n + 4))?;
                self.text(COLON)?;
                self.indent_line()?;
                self.print(self.n.at(n + 5))?;
                self.indent_close();
                self.group_close(g);
                return Ok(true);
            }
            k::MatchRestPattern => {
                self.text(ELLIPSIS)?;
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::RecordExpression => {
                self.print(self.n.at(n + 4))?;
                self.print(self.n.at(n + 5))?;
                self.text(SPACE)?;
                self.print(self.n.at(n + 6))?;
                return Ok(true);
            }
            k::RecordDeclarationProperty => {
                if (self.n.at(n) & F_STATIC) != 0 {
                    self.text(STATIC_)?;
                }
                self.print_key(n)?;
                self.print_type_annotation_property(self.n.at(n + 5))?;
                if self.n.at(n + 6) != 0 {
                    self.text(EQ_SPACES)?;
                    self.print(self.n.at(n + 6))?;
                }
                return Ok(true);
            }
            _ => {}
        }
        return Ok(false);
    }
}
