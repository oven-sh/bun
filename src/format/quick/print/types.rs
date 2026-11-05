//! Types, and the declarations and expressions that only TypeScript and Flow have (typescript.js, flow.js, type-annotation.js,
//! type-parameters.js, union-type.js, intersection-type.js, function-type.js, mapped-type.js, enum.js .. of Prettier).

use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_ASSERTS, F_CONST, F_EXTENDS_BOUND, F_EXTRA, F_IN, F_OPTIONAL, F_OUT, F_REST, F_STATIC,
    F_THIS, FN_RETURN_TYPE, IK_MASK, IK_SHIFT, IK_TYPE, IK_TYPEOF, M_GET, M_MASK, M_SET, MK_GLOBAL,
    MK_MODULE, MOD_ABSTRACT, MOD_ACCESSIBILITY, MOD_DECLARE, MOD_OVERRIDE, MOD_PRIVATE,
    MOD_PROTECTED, MOD_PUBLIC, MOD_READONLY, MT_MINUS, MT_NONE, MT_PLUS, NT_NON_NULLABLE,
    NT_NON_NULLABLE_POSTFIX, NT_NULLABLE, SHAPE, TO_KEYOF, TO_READONLY, TO_RENDERS,
    TO_RENDERS_MAYBE, TP_ASSERTS, TP_IMPLIES, k, type_keyword,
};
use crate::options::TRAILING_COMMA_NONE;
use crate::print::assignment::LAYOUT_BREAK_AFTER_OPERATOR;
use crate::print::comments::{DANGLING_LINE, DANGLING_NO_MARKER};
use crate::print::core::{ARG_LAYOUT_MASK, ARG_LAYOUT_SHIFT};
use crate::print::jsx::KIND_AND_SUB;
use crate::print::statics::{
    _AMP, _AMP_, _AS_, _BAR_, _EXTENDS, _EXTENDS_, _IN_, _IS_, _SATISFIES_, _TYPE, _TYPEOF,
    ABSTRACT_, AMP_, ARROW_, ASSERTS_, BANG, BAR_, BRACKETS_EMPTY, COLON_SPACE, COMMA, COMMA_SPACE,
    CONST, CONST_, DECLARE_, DOT, ELLIPSIS, ENUM_, EQ, EQ_SPACES, EXPORT_AS_NAMESPACE_, EXPORT_EQ_,
    GET_, GT, IMPLIES_, IMPORT_, IN_, INFER_, KEYOF_, LBRACE, LBRACKET, LPAREN, LT, MINUS, MODULE_,
    NAMESPACE_, NEW_, OUT_, OVERRIDE_, PLUS, PRIVATE_, PROTECTED_, PUBLIC_, QUESTION, QUESTION_DOT,
    RBRACE, RBRACKET, READONLY, READONLY_, RENDERS_, RENDERS_MAYBE_, RENDERS_STAR_, RPAREN, SEMI,
    SET_, SPACE, STATIC_, TYPE_, TYPEOF_, UNIQUE_,
};
use crate::{Quick, R, Words, rare};

pub(crate) struct PrintTypes {
    /// What the printer of a body tells the printer of a member: is it the last one, and which one follows. A member reads this
    /// before it prints anything of its own.
    pub(crate) member_is_last: bool,
    pub(crate) member_next: i32,
}
impl PrintTypes {
    pub(crate) fn new() -> Self {
        Self {
            member_is_last: false,
            member_next: 0,
        }
    }
}

impl Quick {
    // --------------------------------------------------------------------------------------------------- kinds of types
    pub(crate) fn is_object_type(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return k == k::TypeLiteral || k == k::MappedType;
    }

    pub(crate) fn is_simple_type(&self, n: i32) -> bool {
        match self.n.at(n) & 0xff {
            k::KeywordType => {
                return (((self.n.at(n) as u32) >> SUB_SHIFT) as i32) < type_keyword::All;
            }
            k::LiteralType | k::TemplateLiteralType => {
                return true;
            }
            k::TypeReference => {
                return self.n.at(n + 5) == 0;
            }
            _ => {}
        }
        return false;
    }

    pub(crate) fn is_void_type(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::KeywordType {
            return false;
        }
        let which = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
        return which == type_keyword::Void || which == type_keyword::Null;
    }

    pub(crate) fn should_hug_union_type(&self, n: i32) -> bool {
        let types = self.n.at(n + 4);
        let count = self.n.at(types);
        let mut object_type: i32 = 0;
        let mut i: i32 = 1;
        while i <= count {
            let type_ = self.n.at(types + i);
            if self.has_comment(type_) {
                return false;
            }
            let k = self.n.at(type_) & 0xff;
            if object_type == 0 && (k == k::TypeLiteral || k == k::TypeReference) {
                object_type = type_;
            }
            i += 1;
        }
        if object_type == 0 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= count {
            let type_ = self.n.at(types + i);
            if type_ != object_type && !self.is_void_type(type_) {
                return false;
            }
            i += 1;
        }
        return true;
    }

    /// Flow: `boolean`, `mixed`, `empty` or `*`, and `null` or `void` for the rest. The long way hugs such a union as if the keyword were the
    /// name of a type. What it prints is what Prettier prints as long as nothing in or around the union breaks.
    pub(crate) fn is_hugged_by_the_long_way_only(&self, n: i32) -> bool {
        if !self.mode.is_flow || (self.n.at(n) & 0xff) != k::UnionType {
            return false;
        }
        let types = self.n.at(n + 4);
        let mut found = false;
        let mut i: i32 = 1;
        while i <= self.n.at(types) {
            let type_ = self.n.at(types + i);
            if self.has_comment(type_) {
                return false;
            }
            if !self.is_void_type(type_) {
                if found
                    || (self.n.at(type_) & 0xff) != k::KeywordType
                    || !matches!(
                        ((self.n.at(type_) as u32) >> SUB_SHIFT) as i32,
                        type_keyword::Boolean
                            | type_keyword::Mixed
                            | type_keyword::Empty
                            | type_keyword::All
                    )
                {
                    return false;
                }
                found = true;
            }
            i += 1;
        }
        found
    }

    pub(crate) fn should_hug_type(&self, n: i32) -> bool {
        if self.is_simple_type(n) || self.is_object_type(n) {
            return true;
        }
        return (self.n.at(n) & 0xff) == k::UnionType && self.should_hug_union_type(n);
    }
}
// --------------------------------------------------------------------------------------------------- type annotations
pub(crate) const TOKEN_NONE: i32 = 0;
pub(crate) const TOKEN_COLON: i32 = 1;
pub(crate) const TOKEN_ARROW: i32 = 2;
impl Quick {
    pub(crate) fn type_annotation_first_token(&self, annotation: i32) -> i32 {
        let parent = self.n.at(annotation + 3);
        match self.n.at(parent) & 0xff {
            k::FunctionType | k::ConstructorType => {
                if self.mode.is_type_script && self.n.at(parent + FN_RETURN_TYPE) == annotation {
                    return TOKEN_ARROW;
                }
            }
            k::TypePredicate => {
                return TOKEN_NONE;
            }
            k::Identifier => {
                // declare function f(): void
                let gk = self.n.at(self.n.at(parent + 3)) & 0xff;
                if gk == k::DeclareFunction || gk == k::DeclareHook {
                    return TOKEN_NONE;
                }
            }
            k::TypeParameter => {
                if (self.n.at(parent) & F_EXTENDS_BOUND) != 0 {
                    return TOKEN_NONE;
                }
            }
            _ => {}
        }
        return TOKEN_COLON;
    }

    /// print_type_annotation_property: the field of some node that holds `: type`, or 0.
    pub(crate) fn print_type_annotation_property(&mut self, annotation: i32) -> R<()> {
        if annotation == 0 {
            return Ok(());
        }
        if (self.n.at(annotation) & 0xff) == k::TypeAnnotation {
            let token = self.type_annotation_first_token(annotation);
            if token == TOKEN_ARROW
                || (token == TOKEN_COLON && self.has_leading_comment(annotation))
            {
                self.text(SPACE);
            }
        }
        self.print(annotation)?;
        Ok(())
    }

    pub(crate) fn has_function_type(&self, n: i32) -> R<bool> {
        return self.any_descendant(n, k::FunctionType, false);
    }

    /// Is `n`, or something below it, of the kind `kind` (and, if `with_function_type`, holds a function type)?
    pub(crate) fn any_descendant(&self, n: i32, kind: i32, with_function_type: bool) -> R<bool> {
        self.stack()?;
        if n == 0 {
            return Ok(false);
        }
        let k = self.n.at(n) & 0xff;
        if k == kind && (!with_function_type || self.has_function_type(n)?) {
            return Ok(true);
        }
        // a member of an object type that fast.rs has read says whether there is the type of a function in it
        if k == k::Ready {
            return Ok(kind == k::FunctionType && (self.n.at(n) & F_EXTRA) != 0);
        }
        let shape = SHAPE.at(k);
        let mut f = n + 4;
        let mut round: i32 = 0;
        while round < 2 {
            let mut i = shape.wrapping_shr((round * 8) as u32) & 15;
            while i > 0 {
                if self.any_descendant(self.n.at(f), kind, with_function_type)? {
                    return Ok(true);
                }
                f += 1;
                i -= 1;
            }
            let mut i = shape.wrapping_shr((round * 8 + 4) as u32) & 15;
            while i > 0 {
                let l = self.n.at(f);
                f += 1;
                let mut j: i32 = 1;
                while j <= self.n.at(l) {
                    if self.any_descendant(self.n.at(l + j), kind, with_function_type)? {
                        return Ok(true);
                    }
                    j += 1;
                }
                i -= 1;
            }
            round += 1;
        }
        return Ok(false);
    }

    pub(crate) fn print_type_annotation(&mut self, n: i32) -> R<()> {
        let token = self.type_annotation_first_token(n);
        if token == TOKEN_COLON {
            self.text(COLON_SPACE);
        } else if token == TOKEN_ARROW {
            self.text(ARROW_);
        }
        let type_ = self.n.at(n + 4);
        if self.mode.is_flow && self.needs_parens_as_return_type_of_arrow(type_)? {
            self.text(LPAREN);
            self.print(type_)?;
            self.text(RPAREN);
            return Ok(());
        }
        self.print(type_)?;
        Ok(())
    }

    /// Flow: the return type of an arrow function that has an object type with a function type in it. needs_parens() does not know this
    /// rule, which holds for types of all kinds: the annotation prints the parentheses.
    pub(crate) fn needs_parens_as_return_type_of_arrow(&self, type_: i32) -> R<bool> {
        let annotation = self.n.at(type_ + 3);
        if (self.n.at(annotation) & 0xff) != k::TypeAnnotation {
            return Ok(false);
        }
        let fn_ = self.n.at(annotation + 3);
        return Ok((self.n.at(fn_) & 0xff) == k::ArrowFunctionExpression
            && self.n.at(fn_ + FN_RETURN_TYPE) == annotation
            && !self.needs_parens(type_)?
            && !((self.n.at(type_) & 0xff) == k::NullableType
                && self.needs_parens(self.n.at(type_ + 4))?)
            && self.any_descendant(type_, k::TypeLiteral, true)?);
    }

    // --------------------------------------------------------------------------------------------------- type parameters
    pub(crate) fn is_arrow_function_variable_declarator(&self, n: i32) -> bool {
        return (self.n.at(n) & 0xff) == k::VariableDeclarator
            && (self.n.at(self.n.at(n + 5)) & 0xff) == k::ArrowFunctionExpression;
    }

    pub(crate) fn parameter_comments_forbid_inlining(&self, params: i32) -> bool {
        let mut i: i32 = 1;
        while i <= self.n.at(params) {
            'c1: {
                let node = self.n.at(params + i);
                if !self.has_comment(node) {
                    break 'c1;
                }
                let mut last: i32 = -1;
                let mut c = self.first_comment(node);
                while c >= 0 {
                    'c3: {
                        if self.is_dangling(c) {
                            break 'c3;
                        }
                        if !self.is_block_comment(c) {
                            return true;
                        }
                        last = c;
                    }
                    c = self.next_comment(c);
                }
                if last >= 0 && self.has_newline(self.comment_end(last)) {
                    return true;
                }
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn print_type_parameters(&mut self, n: i32) -> R<()> {
        let params = self.n.at(n + 4);
        let count = self.n.at(params);
        let parent = self.n.at(n + 3);
        let grandparent = self.n.at(parent + 3);
        let mut should_inline = count == 0;
        if !should_inline {
            let first = self.n.at(params + 1);
            let mut is_arrow_function_variable = false;
            if !(count == 1 && self.is_object_type(first))
                && (self.n.at(grandparent) & 0xff) == k::TypeAnnotation
            {
                let identifier = self.n.at(grandparent + 3);
                is_arrow_function_variable = (self.n.at(identifier) & 0xff) == k::Identifier
                    && self.is_arrow_function_variable_declarator(self.n.at(identifier + 3));
            }
            should_inline = !is_arrow_function_variable
                && (self.is_test_call(grandparent, 0)?
                    || (count == 1
                        && ((self.mode.is_flow && (self.n.at(first) & 0xff) == k::NullableType)
                            || self.should_hug_type(first))))
                && !self.parameter_comments_forbid_inlining(params);
        }
        if should_inline {
            self.text(LT);
            let mut i: i32 = 1;
            while i <= count {
                if i > 1 {
                    self.text(COMMA_SPACE);
                }
                self.print(self.n.at(params + i))?;
                i += 1;
            }
            if self.has_dangling_comment(n) {
                let has_line = self.has_dangling_matching(n, DANGLING_LINE);
                self.print_dangling_comments_filtered(n, DANGLING_NO_MARKER, has_line);
                if has_line {
                    self.hardline();
                }
            }
            self.text(GT);
            return Ok(());
        }
        // `a<interface {}>`: an object type for the long way, which hugs it, and which lays out what is around a call by it.
        let is_interface = self.mode.is_flow
            && count == 1
            && (self.n.at(self.n.at(params + 1)) & 0xff) == k::InterfaceType;
        if is_interface
            && matches!(
                self.n.at(parent) & 0xff,
                k::CallExpression | k::NewExpression
            )
        {
            return Err(self.rare(rare::FLOW));
        }
        let g = self.group_open();
        self.text(LT);
        self.indent_softline();
        let mut i: i32 = 1;
        while i <= count {
            self.reserve();
            if i > 1 {
                self.text(COMMA);
                self.line();
            }
            self.print(self.n.at(params + i))?;
            i += 1;
        }
        self.indent_close();
        if (self.n.at(n) & 0xff) == k::TypeParameterInstantiation && self.mode.is_type_script {
            // no trailing comma
        } else if self.mode.is_type_script
            && count == 1
            && self.n.at(self.n.at(params + 1) + 5) == 0
            && (self.n.at(parent) & 0xff) == k::ArrowFunctionExpression
            && !self.options.name_ends_in_ts
        {
            self.text(COMMA);
        } else if self.options.trailing_comma != TRAILING_COMMA_NONE {
            self.if_break_text(COMMA, 0, 0);
        }
        self.softline();
        self.text(GT);
        self.group_close(g);
        // (`a<*>`: the long way does not break it)
        if count == 1
            && self.mode.is_flow
            && (is_interface
                || self.is_hugged_by_the_long_way_only(self.n.at(params + 1))
                || (self.n.at(self.n.at(params + 1)) & KIND_AND_SUB)
                    == (k::KeywordType | (type_keyword::All << SUB_SHIFT)))
        {
            // (on the left of a `=`, whether it can break decides about the right side)
            let mut ancestor = grandparent;
            while matches!(
                self.n.at(ancestor) & 0xff,
                k::ArrayType
                    | k::NullableType
                    | k::UnionType
                    | k::IntersectionType
                    | k::TupleType
                    | k::TypeReference
                    | k::TypeParameterInstantiation
            ) {
                ancestor = self.n.at(ancestor + 3);
            }
            if (self.n.at(ancestor) & 0xff) == k::TypeAnnotation {
                let owner = self.n.at(ancestor + 3);
                if (self.n.at(owner) & 0xff) == k::ClassProperty
                    || (self.n.at(self.n.at(owner + 3)) & 0xff) == k::VariableDeclarator
                {
                    return Err(self.rare(rare::FLOW));
                }
            }
            self.gives_up_where_broken(g)?;
        }
        Ok(())
    }

    pub(crate) fn print_fluid_part(&mut self, keyword: i32, node: i32) -> R<()> {
        let id = self.new_group_id();
        self.text(keyword);
        let g = self.group_open();
        self.indent_line();
        self.indent_close();
        self.group_close_with(g, false, id);
        self.line_suffix_boundary();
        self.indent_if_break_open(id, false);
        self.print(node)?;
        self.indent_close();
        Ok(())
    }

    pub(crate) fn print_type_parameter(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let g = self.group_open();
        if (head & F_CONST) != 0 {
            self.text(CONST_);
        }
        if self.n.at(n + 7) != 0 {
            self.print(self.n.at(n + 7))?;
        }
        if (head & F_IN) != 0 {
            self.text(IN_);
        }
        if (head & F_OUT) != 0 {
            self.text(OUT_);
        }
        self.print(self.n.at(n + 4))?;
        if self.mode.is_flow {
            if (head & F_EXTENDS_BOUND) != 0 {
                self.text(_EXTENDS_);
            }
            self.print_type_annotation_property(self.n.at(n + 5))?;
        } else if self.n.at(n + 5) != 0 {
            self.print_fluid_part(_EXTENDS, self.n.at(n + 5))?;
        }
        if self.n.at(n + 6) != 0 {
            self.print_fluid_part(EQ, self.n.at(n + 6))?;
        }
        self.group_close(g);
        Ok(())
    }

    // ------------------------------------------------------------------------------------------ unions and intersections
    pub(crate) fn is_multiple_tuple_type_element(&self, n: i32) -> bool {
        let parent = self.n.at(n + 3);
        return (self.n.at(parent) & 0xff) == k::TupleType && self.n.at(self.n.at(parent + 4)) > 1;
    }

    pub(crate) fn should_union_type_print_own_comments(&self, n: i32) -> bool {
        let pk = self.n.at(self.n.at(n + 3)) & 0xff;
        return !(self.should_hug_union_type(n)
            || pk == k::UnionType
            || pk == k::IntersectionType
            || self.is_multiple_tuple_type_element(n));
    }

    pub(crate) fn should_indent_union_type(&self, n: i32) -> bool {
        let parent = self.n.at(n + 3);
        match self.n.at(parent) & 0xff {
            k::TypeAssertion => {
                return self.n.at(parent + 4) != n;
            }
            k::TupleType | k::TypeParameterInstantiation => {
                return false;
            }
            k::ConditionalType => {
                return !(self.n.at(parent + 6) == n || self.n.at(parent + 7) == n);
            }
            k::FunctionTypeParam => {
                if self.n.at(parent + 4) == 0 && (self.n.at(parent) & F_THIS) == 0 {
                    return false;
                }
                let fn_ = self.n.at(parent + 3);
                if (self.n.at(fn_) & 0xff) == k::FunctionType
                    && (self.n.at(parent) & (F_THIS | F_REST)) == 0
                    && (self.n.at(self.n.at(fn_ + 3)) & 0xff) == k::ObjectTypeProperty
                    && self.is_flow_object_type_property_a_function(self.n.at(fn_ + 3))
                {
                    return false;
                }
            }
            _ => {}
        }
        return true;
    }

    pub(crate) fn print_union_members(&mut self, n: i32) -> R<()> {
        let types = self.n.at(n + 4);
        let count = self.n.at(types);
        let g = self.group_open();
        let mut i: i32 = 1;
        while i <= count {
            self.reserve();
            let type_ = self.n.at(types + i);
            if i == 1 {
                self.if_break_text(BAR_, 0, 0);
            } else {
                self.line();
                self.text(BAR_);
            }
            if self.has_leading_comment(type_) {
                self.align_open(2);
                self.print_leading_comments(type_);
                self.print(type_)?;
                self.print_trailing_comments(type_);
                self.indent_close();
            } else {
                self.align_open(2);
                self.print(type_)?;
                self.indent_close();
                self.print_trailing_comments(type_);
            }
            i += 1;
        }
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_union_with_comments(&mut self, n: i32) -> R<()> {
        if self.has_comment(n) && self.should_union_type_print_own_comments(n) {
            self.print_leading_comments(n);
            self.print_union_members(n)?;
            self.print_trailing_comments(n);
        } else {
            self.print_union_members(n)?;
        }
        Ok(())
    }

    pub(crate) fn print_union_type(&mut self, n: i32, args: i32) -> R<()> {
        if self.should_hug_union_type(n) {
            let types = self.n.at(n + 4);
            let mut i: i32 = 1;
            while i <= self.n.at(types) {
                if i > 1 {
                    self.text(_BAR_);
                }
                self.print(self.n.at(types + i))?;
                i += 1;
            }
            return Ok(());
        }
        let is_hugged_elsewhere = self.is_hugged_by_the_long_way_only(n);
        if self.needs_parens(n)?
            || (self.mode.is_flow && self.needs_parens_as_return_type_of_arrow(n)?)
        {
            let g = self.group_open();
            self.indent_softline();
            self.print_union_with_comments(n)?;
            self.dedent_softline();
            self.group_close(g);
            if is_hugged_elsewhere {
                self.gives_up_where_broken(g)?;
            }
            return Ok(());
        }
        if self.is_multiple_tuple_type_element(n) {
            let g = self.group_open();
            self.indent_open();
            let h = self.if_break_open(0);
            self.text(LPAREN);
            self.softline();
            self.if_break_else(h);
            self.if_break_close(h);
            self.print_union_with_comments(n)?;
            self.dedent_softline();
            self.if_break_text(RPAREN, 0, 0);
            self.group_close(g);
            if is_hugged_elsewhere {
                self.gives_up_where_broken(g)?;
            }
            return Ok(());
        }
        if ((args & ARG_LAYOUT_MASK) >> ARG_LAYOUT_SHIFT) == LAYOUT_BREAK_AFTER_OPERATOR
            || !self.should_indent_union_type(n)
        {
            // (the group that breaks is somebody else's)
            if is_hugged_elsewhere {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            self.print_union_with_comments(n)?;
            return Ok(());
        }
        let g = self.group_open();
        self.indent_softline();
        self.print_union_with_comments(n)?;
        self.indent_close();
        self.group_close(g);
        // `a<B | C extends d ? e : f>`, `type A = B | C extends d ? e : f`: the line break of the union follows that of the type arguments
        // or of the `=`. The long way writes one for the two.
        let parent = self.n.at(n + 3);
        if is_hugged_elsewhere
            || ((self.n.at(parent) & 0xff) == k::ConditionalType && self.n.at(parent + 4) == n)
        {
            self.gives_up_where_broken(g)?;
        }
        Ok(())
    }

    pub(crate) fn print_intersection_type(&mut self, n: i32) -> R<()> {
        let types = self.n.at(n + 4);
        let count = self.n.at(types);
        if self.mode.is_flow {
            // (`interface {} & A`: the long way takes what follows for what the interface extends)
            let mut i: i32 = 1;
            while i <= count {
                if (self.n.at(self.n.at(types + i)) & 0xff) == k::InterfaceType {
                    return Err(self.rare(rare::UNLIKE_PRETTIER));
                }
                i += 1;
            }
        }
        let mut was_indented = false;
        let g = self.group_open();
        let mut i: i32 = 1;
        while i <= count {
            'c1: {
                self.reserve();
                let type_ = self.n.at(types + i);
                if i == 1 {
                    self.print(type_)?;
                    break 'c1;
                }
                let current_is_object = self.is_object_type(type_);
                let previous_is_object = self.is_object_type(self.n.at(types + i - 1));
                if previous_is_object && current_is_object {
                    self.text(_AMP_);
                    if was_indented {
                        self.indent_open();
                    }
                    self.print(type_)?;
                    if was_indented {
                        self.indent_close();
                    }
                } else if (!previous_is_object && !current_is_object)
                    || self.has_leading_own_line_comment(type_)
                {
                    self.indent_open();
                    if self.options.operator_position_start {
                        self.line();
                        self.text(AMP_);
                    } else {
                        self.text(_AMP);
                        self.line();
                    }
                    self.print(type_)?;
                    self.indent_close();
                } else {
                    // from an object to something else or the other way round: on the same line
                    if i > 2 {
                        was_indented = true;
                    }
                    self.text(_AMP_);
                    if i > 2 {
                        self.indent_open();
                    }
                    self.print(type_)?;
                    if i > 2 {
                        self.indent_close();
                    }
                }
            }
            i += 1;
        }
        self.group_close(g);
        Ok(())
    }

    // ---------------------------------------------------------------------------------------- function types, signatures
    pub(crate) fn print_accessibility(&mut self, head: i32) {
        match ((head as u32) >> SUB_SHIFT) as i32 & MOD_ACCESSIBILITY {
            MOD_PUBLIC => {
                self.text(PUBLIC_);
            }
            MOD_PROTECTED => {
                self.text(PROTECTED_);
            }
            MOD_PRIVATE => {
                self.text(PRIVATE_);
            }
            _ => {}
        }
    }

    pub(crate) fn print_function_type(&mut self, n: i32, k: i32) -> R<()> {
        let is_signature = k == k::CallSignature || k == k::ConstructSignature;
        let semicolon = if is_signature {
            self.member_position()
        } else {
            0
        };
        let g = self.group_open();
        if (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & MOD_ABSTRACT) != 0 {
            self.text(ABSTRACT_);
        }
        if k == k::ConstructorType || k == k::ConstructSignature {
            self.text(NEW_);
        }
        self.print_parameters_and_return_type(n, false, true, false, false)?;
        self.group_close(g);
        if is_signature {
            self.print_class_member_semicolon(n, semicolon);
        }
        Ok(())
    }

    pub(crate) fn print_method_signature(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let position = self.member_position();
        let g = self.group_open();
        self.print_accessibility(head);
        let method = ((head as u32) >> SUB_SHIFT) as i32 & M_MASK;
        if method == M_GET {
            self.text(GET_);
        } else if method == M_SET {
            self.text(SET_);
        }
        self.print_key(n)?;
        if (head & F_OPTIONAL) != 0 {
            self.text(QUESTION);
        }
        self.print_parameters_and_return_type(n, false, true, false, true)?;
        self.group_close(g);
        self.print_class_member_semicolon(n, position);
        Ok(())
    }

    pub(crate) fn set_member_position(&mut self, is_last: bool, following: i32) {
        self.print_types.member_is_last = is_last;
        self.print_types.member_next = following;
    }

    /// The two in one number: the next member, or -1 for the last one.
    pub(crate) fn member_position(&self) -> i32 {
        return if self.print_types.member_is_last {
            -1
        } else {
            self.print_types.member_next
        };
    }

    pub(crate) fn print_property_signature(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let position = self.member_position();
        if (((head as u32) >> SUB_SHIFT) as i32 & MOD_READONLY) != 0 {
            self.text(READONLY_);
        }
        self.print_key(n)?;
        if (head & F_OPTIONAL) != 0 {
            self.text(QUESTION);
        }
        self.print_type_annotation_property(self.n.at(n + 5))?;
        self.print_class_member_semicolon(n, position);
        Ok(())
    }

    pub(crate) fn print_index_signature(&mut self, n: i32) -> R<()> {
        let head = self.n.at(n);
        let position = self.member_position();
        let parameters = self.n.at(n + 5);
        let count = self.n.at(parameters);
        if (head & F_STATIC) != 0 && (self.n.at(self.n.at(n + 3)) & 0xff) == k::ClassBody {
            self.text(STATIC_);
        }
        if (((head as u32) >> SUB_SHIFT) as i32 & MOD_READONLY) != 0 {
            self.text(READONLY_);
        }
        self.text(LBRACKET);
        let g = self.group_open();
        self.indent_softline();
        let mut i: i32 = 1;
        while i <= count {
            if i > 1 {
                self.text(COMMA_SPACE);
                self.softline();
            }
            self.print(self.n.at(parameters + i))?;
            i += 1;
        }
        if count > 1 && self.options.trailing_comma != TRAILING_COMMA_NONE {
            self.if_break_text(COMMA, 0, 0);
        }
        self.dedent_softline();
        self.group_close(g);
        self.text(RBRACKET);
        self.print_type_annotation_property(self.n.at(n + 4))?;
        self.print_class_member_semicolon(n, position);
        Ok(())
    }

    // --------------------------------------------------------------------------------------------------------- the rest
    pub(crate) fn print_mapped_type_modifier(&mut self, which: i32, keyword: i32) {
        if which == MT_PLUS {
            self.text(PLUS);
        } else if which == MT_MINUS {
            self.text(MINUS);
        }
        self.text(keyword);
    }

    pub(crate) fn print_mapped_type(&mut self, n: i32) -> R<()> {
        let sub = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
        let readonly = sub & 3;
        let optional = (sub >> 2) & 3;
        let mut should_break = false;
        if self.options.object_wrap_preserve {
            let start = self.n.at(n + 1) + 1;
            should_break = self.has_newline_in_range(start, self.next_significant_index(start));
        }
        let g = self.group_open();
        self.text(LBRACE);
        self.indent_open();
        if self.options.bracket_spacing {
            self.line();
        } else {
            self.softline();
        }
        if self.has_dangling_comment(n) {
            // all but the last as they come, the last in a group with the line behind it
            let last = self.last_dangling_comment(n);
            let mut first = true;
            let mut c = self.first_comment(n);
            while c >= 0 {
                'c1: {
                    if !self.is_dangling(c) {
                        break 'c1;
                    }
                    if !first {
                        self.hardline();
                    }
                    first = false;
                    if c != last {
                        self.print_comment(c);
                        break 'c1;
                    }
                    let cg = self.group_open();
                    self.print_comment(c);
                    if !self.is_block_comment(c) || self.has_newline(self.comment_end(c)) {
                        self.hardline();
                    } else {
                        self.line();
                    }
                    self.group_close(cg);
                }
                c = self.next_comment(c);
            }
        }
        if readonly != MT_NONE {
            self.print_mapped_type_modifier(readonly, READONLY);
            self.text(SPACE);
        }
        let kg = self.group_open();
        self.text(LBRACKET);
        self.indent_softline();
        self.print(self.n.at(n + 4))?;
        self.text(_IN_);
        self.print(self.n.at(n + 5))?;
        if self.n.at(n + 6) != 0 {
            self.text(_AS_);
            self.print(self.n.at(n + 6))?;
        }
        self.dedent_softline();
        self.text(RBRACKET);
        self.group_close(kg);
        if optional != MT_NONE {
            self.print_mapped_type_modifier(optional, QUESTION);
        }
        if self.n.at(n + 7) != 0 {
            self.text(COLON_SPACE);
            self.print(self.n.at(n + 7))?;
        }
        if self.options.semi {
            self.if_break_text(SEMI, 0, 0);
        }
        self.indent_close();
        if self.options.bracket_spacing {
            self.line();
        } else {
            self.softline();
        }
        self.text(RBRACE);
        self.group_close_with(g, should_break, 0);
        self.stays_expanded(g);
        Ok(())
    }
}
pub(crate) static KEYWORD_TEXT: [i32; 32] = [
    0, 8790114, 8814786, 8863970, 8921378, 8994978, 4210818, 9035970, 9085122, 9134274, 9183426,
    9232674, 9306338, 4636802, 4530306, 9363618, 9404578, 344127, 516159, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
];
impl Quick {
    pub(crate) fn print_binary_cast_expression(&mut self, n: i32, k: i32) -> R<()> {
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        let wrap = (pk == k::CallExpression || pk == k::NewExpression || pk == k::MemberExpression)
            && self.n.at(parent + 4) == n;
        let g = if wrap { self.group_open() } else { 0 };
        if wrap {
            self.indent_softline();
        }
        self.print(self.n.at(n + 4))?;
        self.text(if k == k::SatisfiesExpression {
            _SATISFIES_
        } else {
            _AS_
        });
        if self.n.at(n + 5) == 0 {
            self.text(CONST);
        } else {
            self.print(self.n.at(n + 5))?;
        }
        if wrap {
            self.dedent_softline();
            self.group_close(g);
        }
        Ok(())
    }

    pub(crate) fn print_type_assertion(&mut self, n: i32) -> R<()> {
        let type_ = self.n.at(n + 4);
        let expression = self.n.at(n + 5);
        // (the long way never breaks it)
        if self.text_is(self.n.at(type_ + 1), self.n.at(type_ + 2), b"const") {
            return Err(self.rare(rare::ASSERTION));
        }
        if self.is_object_or_array_expression(expression) {
            let g = self.group_open();
            self.print_cast_group(type_)?;
            self.print(expression)?;
            self.group_close(g);
            return Ok(());
        }
        let mut h = self.detach_open();
        self.print_cast_group(type_)?;
        let cast = self.detach_close(h);
        h = self.detach_open();
        self.print(expression)?;
        let printed = self.detach_close(h);
        if self.doc_will_break(printed) || self.doc_will_break(cast) {
            return Err(self.rare(rare::ASSERTION));
        }
        let c = self.cond_open();
        let mut st = self.state_open();
        self.call(cast);
        self.call(printed);
        self.state_close(st);
        st = self.state_open();
        self.call(cast);
        let g = self.group_open();
        self.if_break_text(LPAREN, 0, 0);
        self.indent_softline();
        self.call(printed);
        self.dedent_softline();
        self.if_break_text(RPAREN, 0, 0);
        self.group_close_with(g, true, 0);
        self.state_close(st);
        st = self.state_open();
        self.call(cast);
        self.call(printed);
        self.state_close(st);
        self.cond_close(c, false);
        Ok(())
    }

    pub(crate) fn print_cast_group(&mut self, type_: i32) -> R<()> {
        let g = self.group_open();
        self.text(LT);
        self.indent_softline();
        self.print(type_)?;
        self.dedent_softline();
        self.text(GT);
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_declare_token(&mut self, n: i32) {
        if (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & MOD_DECLARE) != 0 {
            self.text(DECLARE_);
        }
    }

    /// " type", " typeof" or nothing; with the space behind it if `space_behind`.
    pub(crate) fn print_import_or_export_kind(&mut self, n: i32, space_behind: bool) {
        let kind = ((((self.n.at(n) as u32) >> SUB_SHIFT) as i32) >> IK_SHIFT) & IK_MASK;
        if kind == IK_TYPE {
            self.text(if space_behind { TYPE_ } else { _TYPE });
        } else if kind == IK_TYPEOF {
            self.text(if space_behind { TYPEOF_ } else { _TYPEOF });
        }
    }

    /// Everything of a type alias up to the `=`.
    pub(crate) fn print_type_alias_left(&mut self, n: i32) -> R<()> {
        self.print_declare_token(n);
        self.text(TYPE_);
        self.print(self.n.at(n + 4))?;
        self.print(self.n.at(n + 5))?;
        Ok(())
    }

    /// Prints a node of one of the kinds from K.TypeAnnotation on. False if the kind is not one of them.
    pub(crate) fn print_typed(&mut self, n: i32, k: i32, args: i32) -> R<bool> {
        match k {
            k::TypeAnnotation => {
                self.print_type_annotation(n)?;
                return Ok(true);
            }
            k::KeywordType => {
                self.text(KEYWORD_TEXT.at(((self.n.at(n) as u32) >> SUB_SHIFT) as i32));
                return Ok(true);
            }
            k::TypeReference | k::Heritage | k::InstantiationExpression => {
                self.print(self.n.at(n + 4))?;
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::QualifiedName => {
                self.print(self.n.at(n + 4))?;
                self.text(DOT);
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::UnionType => {
                self.print_union_type(n, args)?;
                return Ok(true);
            }
            k::IntersectionType => {
                self.print_intersection_type(n)?;
                return Ok(true);
            }
            k::ArrayType => {
                self.print(self.n.at(n + 4))?;
                self.text(BRACKETS_EMPTY);
                return Ok(true);
            }
            k::NamedTupleMember => {
                if self.n.at(n + 6) != 0 {
                    self.print(self.n.at(n + 6))?;
                }
                self.print(self.n.at(n + 4))?;
                if (self.n.at(n) & F_OPTIONAL) != 0 {
                    self.text(QUESTION);
                }
                self.text(COLON_SPACE);
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::RestType => {
                self.text(ELLIPSIS);
                if self.n.at(n + 5) != 0 {
                    self.print(self.n.at(n + 5))?;
                    self.text(COLON_SPACE);
                }
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::OptionalType => {
                self.print(self.n.at(n + 4))?;
                self.text(QUESTION);
                return Ok(true);
            }
            k::NullableType => {
                let which = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
                if which == NT_NULLABLE {
                    self.text(QUESTION);
                } else if which == NT_NON_NULLABLE {
                    self.text(BANG);
                }
                self.print(self.n.at(n + 4))?;
                if which == NT_NON_NULLABLE_POSTFIX {
                    self.text(BANG);
                }
                return Ok(true);
            }
            k::FunctionType | k::ConstructorType | k::CallSignature | k::ConstructSignature => {
                self.print_function_type(n, k)?;
                return Ok(true);
            }
            k::MethodSignature => {
                self.print_method_signature(n)?;
                return Ok(true);
            }
            k::PropertySignature => {
                self.print_property_signature(n)?;
                return Ok(true);
            }
            k::IndexSignature => {
                self.print_index_signature(n)?;
                return Ok(true);
            }
            k::MappedType => {
                self.print_mapped_type(n)?;
                return Ok(true);
            }
            k::TypeOperator => {
                let operator = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
                if operator >= TO_RENDERS {
                    self.text(if operator == TO_RENDERS {
                        RENDERS_
                    } else {
                        if operator == TO_RENDERS_MAYBE {
                            RENDERS_MAYBE_
                        } else {
                            RENDERS_STAR_
                        }
                    });
                } else {
                    self.text(if operator == TO_KEYOF {
                        KEYOF_
                    } else {
                        if operator == TO_READONLY {
                            READONLY_
                        } else {
                            UNIQUE_
                        }
                    });
                }
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::IndexedAccessType => {
                self.print(self.n.at(n + 4))?;
                if (self.n.at(n) & F_OPTIONAL) != 0 {
                    self.text(QUESTION_DOT);
                }
                self.text(LBRACKET);
                self.print(self.n.at(n + 5))?;
                self.text(RBRACKET);
                return Ok(true);
            }
            k::InferType => {
                self.text(INFER_);
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::TypeQuery => {
                self.text(TYPEOF_);
                self.print(self.n.at(n + 4))?;
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::TypePredicate => {
                if !self.mode.is_type_script && self.is_return_type_of_arrow(self.n.at(n + 3)) {
                    return Err(self.rare(rare::FLOW));
                }
                if (self.n.at(n) & F_ASSERTS) != 0
                    || ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == TP_ASSERTS
                {
                    self.text(ASSERTS_);
                } else if ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == TP_IMPLIES {
                    self.text(IMPLIES_);
                }
                self.print(self.n.at(n + 4))?;
                if self.n.at(n + 5) != 0 {
                    self.text(_IS_);
                    self.print_type_annotation_property(self.n.at(n + 5))?;
                }
                return Ok(true);
            }
            k::LiteralType => {
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            k::ImportType => {
                self.print_call_expression(n)?;
                if self.n.at(n + 7) != 0 {
                    self.text(DOT);
                    self.print(self.n.at(n + 7))?;
                }
                self.print(self.n.at(n + 6))?;
                return Ok(true);
            }
            k::ExternalModuleReference => {
                self.print_call_expression(n)?;
                return Ok(true);
            }
            k::TypeParameterDeclaration | k::TypeParameterInstantiation => {
                self.print_type_parameters(n)?;
                return Ok(true);
            }
            k::TypeParameter => {
                self.print_type_parameter(n)?;
                return Ok(true);
            }
            k::AsExpression | k::SatisfiesExpression => {
                self.print_binary_cast_expression(n, k)?;
                return Ok(true);
            }
            k::NonNullExpression => {
                self.print(self.n.at(n + 4))?;
                self.text(BANG);
                return Ok(true);
            }
            k::TypeAssertion => {
                self.print_type_assertion(n)?;
                return Ok(true);
            }
            k::TypeAlias => {
                self.print_assignment(n, self.n.at(n + 6), EQ, 0)?;
                if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(true);
            }
            k::EnumDeclaration => {
                self.print_declare_token(n);
                if (self.n.at(n) & F_CONST) != 0 {
                    self.text(CONST_);
                }
                self.text(ENUM_);
                self.print(self.n.at(n + 4))?;
                self.text(SPACE);
                self.print(self.n.at(n + 5))?;
                return Ok(true);
            }
            k::EnumMember => {
                self.print_key(n)?;
                if self.n.at(n + 5) != 0 {
                    self.text(EQ_SPACES);
                    self.print(self.n.at(n + 5))?;
                }
                return Ok(true);
            }
            k::ModuleDeclaration => {
                self.print_declare_token(n);
                let kind = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & 3;
                if kind != MK_GLOBAL {
                    self.text(if kind == MK_MODULE {
                        MODULE_
                    } else {
                        NAMESPACE_
                    });
                }
                self.print(self.n.at(n + 4))?;
                if self.n.at(n + 5) != 0 {
                    self.text(SPACE);
                    let g = self.group_open();
                    self.print(self.n.at(n + 5))?;
                    self.group_close(g);
                } else if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(true);
            }
            k::ExportAssignment => {
                self.text(EXPORT_EQ_);
                self.print(self.n.at(n + 4))?;
                if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(true);
            }
            k::NamespaceExportDeclaration => {
                self.text(EXPORT_AS_NAMESPACE_);
                self.print(self.n.at(n + 4))?;
                if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(true);
            }
            k::ImportEqualsDeclaration => {
                self.text(IMPORT_);
                self.print_import_or_export_kind(n, true);
                self.print(self.n.at(n + 4))?;
                self.text(EQ_SPACES);
                self.print(self.n.at(n + 5))?;
                if self.options.semi {
                    self.text(SEMI);
                }
                return Ok(true);
            }
            k::ParameterProperty => {
                let head = self.n.at(n);
                self.print_accessibility(head);
                if (head & F_STATIC) != 0 {
                    self.text(STATIC_);
                }
                if (((head as u32) >> SUB_SHIFT) as i32 & MOD_OVERRIDE) != 0 {
                    self.text(OVERRIDE_);
                }
                if (((head as u32) >> SUB_SHIFT) as i32 & MOD_READONLY) != 0 {
                    self.text(READONLY_);
                }
                self.print(self.n.at(n + 4))?;
                return Ok(true);
            }
            _ => {}
        }
        return self.print_flow(n, k);
    }
}
