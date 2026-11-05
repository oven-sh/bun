//! TypeScript: types, declarations, class members with modifiers, and the expressions that hold types. The grammar follows
//! the parser of TypeScript itself, the tree is the one typescript-estree builds from it (as far as Prettier looks at it).
//!
//! What the long way rejects in a TypeScript file is refused: what TypeScript's parser reports, and what typescript-estree throws while it converts the tree (modifiers,
//! bodies, initializers, heritage, parameter properties ..). So is what TypeScript's parser mends in a way that is printed differently. A check stands where the construct
//! is read, on what is known there. It answers `text_refuse()`, which ends the work on the file. Inside of a type it answers `unexpected()`: a type can be read on trial
//! (`a < b`, `a ? (b) : c`), and then the other reading is the valid one. Where TypeScript itself would mend the type and go on with the trial, see `trial_is_doubtful`.
//! fast.rs reads members, heads and statements without coming by here: whatever is checked here is something that it does not take.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    EXT_AT, F_ACCESSOR, F_ASSERTS, F_ASYNC, F_CHAIN, F_COMPUTED, F_CONST, F_DEFINITE, F_ESCAPE,
    F_EXT, F_EXTRA, F_GENERATOR, F_IN, F_OPTIONAL, F_OUT, F_PAREN, F_STATIC, IK_SHIFT, IK_TYPE,
    M_CONSTRUCTOR, M_GET, M_METHOD, M_SET, MK_GLOBAL, MK_MODULE, MK_NAMESPACE, MOD_ABSTRACT,
    MOD_ACCESSIBILITY, MOD_DECLARE, MOD_OVERRIDE, MOD_PRIVATE, MOD_PROTECTED, MOD_PUBLIC,
    MOD_READONLY, MT_MINUS, MT_NONE, MT_PLAIN, MT_PLUS, TO_KEYOF, TO_READONLY, TO_UNIQUE, V_CONST,
    V_LET, V_USING, V_VAR, k, type_keyword,
};
use crate::fast::MEMBER_OF_INTERFACE;
use crate::lexer::{PREC, kw, tk};
use crate::words::w;
use crate::{Quick, R, Stop, Words, why};

pub(crate) struct ParseTypescript {
    /// In the `extends` part of a conditional type another conditional type needs parentheses.
    pub(crate) no_conditional_types: i32,
    /// How many parameters with modifiers or decorators there have been in the file.
    pub(crate) odd_parameters: i32,
    /// The parameters that were read last have modifiers or decorators that only a function with a body can have.
    pub(crate) parameters_need_body: bool,
    /// The class whose members are read is a declaration, not an expression.
    pub(crate) in_class_declaration: bool,
    /// In what stands before the first `;`, `in` or `of` in the head of a `for`, however deep.
    pub(crate) in_head_of_for: bool,
    /// Among the names that are exported is a word of the language behind `type`: only from another module.
    pub(crate) export_needs_from: bool,
    /// Where type arguments were tried, TypeScript may have gone on: behind the parameters of a function type there was no `=>`, but something with which a list of
    /// types can go on, or there was a type of JSDoc.
    pub(crate) trial_is_doubtful: bool,
    /// How many times `T?` was read where it is no element of a tuple: there it is a type of JSDoc.
    pub(crate) stray_optional_types: i32,
    /// What a class extends or implements, or an interface extends, is read.
    pub(crate) in_heritage: bool,
    /// How many lists are open in the type that is read: the members of a tuple or an object type, parameters, type parameters. What a failure leaves behind is not taken
    /// back: only differences count.
    pub(crate) open_type_lists: i32,
}
impl ParseTypescript {
    pub(crate) fn new() -> Self {
        Self {
            no_conditional_types: 0,
            odd_parameters: 0,
            parameters_need_body: false,
            in_class_declaration: false,
            in_head_of_for: false,
            export_needs_from: false,
            trial_is_doubtful: false,
            stray_optional_types: 0,
            in_heritage: false,
            open_type_lists: 0,
        }
    }
}

// Whose parameters are read: what can have parameters with decorators, and parameter properties.
pub(crate) const PARAMETERS_PLAIN: i32 = 0;
/// a method or a setter of a class
pub(crate) const PARAMETERS_OF_METHOD: i32 = 1;
pub(crate) const PARAMETERS_OF_CONSTRUCTOR: i32 = 2;

/// TYPED_FLOW
pub(crate) const FLOW: i32 = 2;
impl Quick {
    pub(crate) fn ts_reset_context(&mut self) {
        self.parse_typescript.no_conditional_types = 0;
        self.parse_typescript.odd_parameters = 0;
        self.parse_typescript.parameters_need_body = false;
        self.parse_typescript.in_class_declaration = false;
        self.parse_typescript.in_head_of_for = false;
        self.parse_typescript.export_needs_from = false;
        self.parse_typescript.stray_optional_types = 0;
        self.parse_typescript.in_heritage = false;
        self.parse_typescript.open_type_lists = 0;
        self.flow_reset_context();
    }

    /// The word that the current token is, if it is a name.
    pub(crate) fn word(&self) -> i32 {
        return if self.lexer.tok == tk::Name && (self.lexer.tok_flags & F_ESCAPE) == 0 {
            self.word_at(self.lexer.tok_start, self.lexer.tok_end)
        } else {
            w::None
        };
    }

    pub(crate) fn starts_with_gt(&self) -> bool {
        return self.lexer.tok == tk::Gt
            || self.lexer.tok == tk::Shr
            || self.lexer.tok == tk::UShr
            || self.lexer.tok == tk::GtEq
            || self.lexer.tok == tk::ShrEq
            || self.lexer.tok == tk::UShrEq;
    }

    /// `>`, also as the first character of `>>` and the like.
    pub(crate) fn expect_gt(&mut self) -> R<()> {
        if self.lexer.tok == tk::Gt {
            self.next()?;
        } else if self.starts_with_gt() {
            self.next_after_first_character()?;
        } else {
            return Err(self.unexpected());
        }
        Ok(())
    }

    pub(crate) fn expect_lt(&mut self) -> R<()> {
        if self.lexer.tok == tk::Lt {
            self.next()?;
        } else if self.lexer.tok == tk::Shl {
            self.next_after_first_character()?;
        } else {
            return Err(self.unexpected());
        }
        Ok(())
    }

    /// A name, a string, a number or `#name`: what can be the key of a member.
    pub(crate) fn is_literal_property_name(&self) -> bool {
        return self.is_word()
            || self.lexer.tok == tk::String
            || self.lexer.tok == tk::Num
            || self.lexer.tok == tk::BigInt
            || self.lexer.tok == tk::PrivateName;
    }

    pub(crate) fn can_follow_modifier(&self) -> bool {
        if self.parse.typed == FLOW && (self.lexer.tok == tk::Add || self.lexer.tok == tk::Sub) {
            // variance
            return true;
        }
        return self.lexer.tok == tk::BracketL
            || self.lexer.tok == tk::BraceL
            || self.lexer.tok == tk::Mul
            || self.lexer.tok == tk::Ellipsis
            || self.is_literal_property_name();
    }

    /// The current token is a word that can be a modifier: is it one here? Leaves the lexer where it is.
    pub(crate) fn next_can_follow_modifier(&mut self, allow_line_break: bool) -> R<bool> {
        self.save();
        self.next()?;
        let result = (allow_line_break || self.lexer.tok_nl == 0) && self.can_follow_modifier();
        self.restore();
        return Ok(result);
    }

    // ------------------------------------------------------------------------------------------------------------- types
    pub(crate) fn ts_parse_type_annotation(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::Colon)?;
        let saved = self.parse_typescript.no_conditional_types;
        self.parse_typescript.no_conditional_types = 0;
        let type_ = if self.parse.typed == FLOW {
            self.flow_parse_type_fresh()?
        } else {
            self.ts_parse_type()?
        };
        self.parse_typescript.no_conditional_types = saved;
        return Ok(self.node1(k::TypeAnnotation, start, self.lexer.prev_end, type_));
    }

    /// `: type` or `: x is type` behind parameters.
    pub(crate) fn ts_parse_return_type(&mut self) -> R<i32> {
        if self.parse.typed == FLOW {
            return self.flow_parse_return_type(false);
        }
        let start = self.lexer.tok_start;
        self.expect(tk::Colon)?;
        let type_ = self.parse_type_or_type_predicate()?;
        return Ok(self.node1(k::TypeAnnotation, start, self.lexer.prev_end, type_));
    }

    /// The same behind the parameters of an arrow function.
    pub(crate) fn ts_parse_arrow_return_type(&mut self) -> R<i32> {
        if self.parse.typed == FLOW {
            return self.flow_parse_return_type(true);
        }
        return self.ts_parse_return_type();
    }

    pub(crate) fn parse_type_or_type_predicate(&mut self) -> R<i32> {
        let saved = self.parse_typescript.no_conditional_types;
        self.parse_typescript.no_conditional_types = 0;
        let mut result: i32 = 0;
        if self.lexer.tok == tk::Name {
            // x is T
            self.save();
            let start = self.lexer.tok_start;
            let name = self.identifier()?;
            if self.lexer.tok_nl == 0 && self.word() == w::Is {
                self.next()?;
                let type_start = self.lexer.tok_start;
                let type_ = self.ts_parse_type()?;
                let v0 = self.lexer.prev_end;
                let v1 = self.node1(k::TypeAnnotation, type_start, self.lexer.prev_end, type_);
                result = self.node2(k::TypePredicate, start, v0, name, v1);
            } else {
                self.restore();
            }
        }
        if result == 0 {
            result = self.ts_parse_type()?;
        }
        self.parse_typescript.no_conditional_types = saved;
        return Ok(result);
    }

    pub(crate) fn ts_parse_type_arguments(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect_lt()?;
        let saved = self.parse_typescript.no_conditional_types;
        self.parse_typescript.no_conditional_types = 0;
        let list_mark = self.arena.ls_pos;
        if self.starts_with_gt() && self.parse.typed != FLOW {
            // `<>`
            return Err(self.unexpected());
        }
        while !self.starts_with_gt() {
            let v0 = self.ts_parse_type()?;
            self.list_push(v0);
            if !self.starts_with_gt() {
                self.expect(tk::Comma)?;
            }
        }
        self.parse_typescript.no_conditional_types = saved;
        let end = self.lexer.tok_start + 1;
        self.expect_gt()?;
        let v1 = self.list_finish(list_mark);
        return Ok(self.node_l(k::TypeParameterInstantiation, start, end, v1));
    }

    /// `has_variance`: of a class, an interface or a type alias, where `in` and `out` can stand.
    pub(crate) fn parse_type_parameter(&mut self, has_variance: bool) -> R<i32> {
        if self.parse.typed == FLOW {
            return self.flow_parse_type_parameter();
        }
        let start = self.lexer.tok_start;
        let mut flags: i32 = 0;
        // const, in, out
        loop {
            let modifier: i32;
            if self.lexer.tok == tk::Const {
                modifier = F_CONST;
            } else if self.lexer.tok == tk::In {
                modifier = F_IN;
            } else if self.lexer.tok == tk::Name {
                let w = self.word();
                if !is_modifier_word(w) || !self.next_can_follow_modifier(w == w::Static)? {
                    break;
                }
                if w != w::Out {
                    return Err(self.text_refuse());
                }
                modifier = F_OUT;
            } else {
                break;
            }
            if (flags & modifier) != 0 || (modifier != F_CONST && !has_variance) {
                return Err(self.text_refuse());
            }
            flags |= modifier;
            self.next()?;
            if self.lexer.tok_nl != 0 {
                return Err(self.text_refuse());
            }
        }
        let name = self.parse_ident()?;
        let mut constraint: i32 = 0;
        let mut default_type: i32 = 0;
        if self.eat(tk::Extends)? {
            constraint = self.ts_parse_type()?;
        }
        if self.eat(tk::Eq)? {
            default_type = self.ts_parse_type()?;
        }
        return Ok(self.node4(
            k::TypeParameter | flags,
            start,
            self.lexer.prev_end,
            name,
            constraint,
            default_type,
            0,
        ));
    }

    pub(crate) fn ts_parse_type_parameters(&mut self) -> R<i32> {
        return self.ts_parse_type_parameters_of(false);
    }

    pub(crate) fn ts_parse_type_parameters_of(&mut self, has_variance: bool) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect_lt()?;
        let saved = self.parse_typescript.no_conditional_types;
        self.parse_typescript.no_conditional_types = 0;
        let list_mark = self.arena.ls_pos;
        if self.starts_with_gt() && self.parse.typed != FLOW {
            // `<>`
            return Err(self.unexpected());
        }
        self.parse_typescript.open_type_lists += 1;
        while !self.starts_with_gt() {
            let v0 = self.parse_type_parameter(has_variance)?;
            self.list_push(v0);
            if !self.starts_with_gt() {
                self.expect(tk::Comma)?;
            }
        }
        self.parse_typescript.open_type_lists -= 1;
        self.parse_typescript.no_conditional_types = saved;
        let end = self.lexer.tok_start + 1;
        self.expect_gt()?;
        let v1 = self.list_finish(list_mark);
        return Ok(self.node_l(k::TypeParameterDeclaration, start, end, v1));
    }

    /// Skips a `[..]` or `{..}` pattern. The current token is the opening bracket.
    pub(crate) fn skip_pattern(&mut self) -> R<bool> {
        let mut depth: i32 = 0;
        loop {
            if self.lexer.tok == tk::BracketL || self.lexer.tok == tk::BraceL {
                depth += 1;
            } else if self.lexer.tok == tk::BracketR || self.lexer.tok == tk::BraceR {
                depth -= 1;
                if depth == 0 {
                    self.next()?;
                    return Ok(true);
                }
            } else if self.lexer.tok == tk::EOF {
                return Ok(false);
            }
            self.next()?;
        }
    }

    /// The current token is `(`: do the parameters of a function type follow?
    pub(crate) fn is_unambiguously_start_of_function_type(&mut self) -> R<bool> {
        let m = self.mark();
        let mut result = false;
        self.next()?;
        if self.lexer.tok == tk::ParenR || self.lexer.tok == tk::Ellipsis {
            result = true;
        } else {
            // skip what starts a parameter
            let mut skipped = false;
            while self.lexer.tok == tk::Name
                && is_parameter_modifier(self.word())
                && self.next_can_follow_modifier(false)?
            {
                self.next()?;
            }
            if self.lexer.tok == tk::Name || self.lexer.tok == tk::This {
                self.next()?;
                skipped = true;
            } else if self.lexer.tok == tk::BracketL || self.lexer.tok == tk::BraceL {
                skipped = self.skip_pattern()?;
            }
            if skipped {
                if self.lexer.tok == tk::Colon
                    || self.lexer.tok == tk::Comma
                    || self.lexer.tok == tk::Question
                    || self.lexer.tok == tk::Eq
                {
                    result = true;
                } else if self.lexer.tok == tk::ParenR {
                    self.next()?;
                    result = self.lexer.tok == tk::Arrow;
                }
            }
        }
        self.rewind(m);
        return Ok(result);
    }

    pub(crate) fn is_start_of_function_or_constructor_type(&mut self) -> R<bool> {
        if self.lexer.tok == tk::Lt || self.lexer.tok == tk::New {
            return Ok(true);
        }
        if self.lexer.tok == tk::ParenL {
            return self.is_unambiguously_start_of_function_type();
        }
        if self.word() == w::Abstract {
            self.save();
            self.next()?;
            let result = self.lexer.tok == tk::New;
            self.restore();
            return Ok(result);
        }
        return Ok(false);
    }

    pub(crate) fn parse_function_or_constructor_type(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut head = k::FunctionType;
        if self.lexer.tok == tk::Name {
            self.next()?;
            head = MOD_ABSTRACT << SUB_SHIFT;
        }
        if self.lexer.tok == tk::New {
            self.next()?;
            head = (head & !0xff) | k::ConstructorType;
        }
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        if self.lexer.tok != tk::ParenL && self.is_start_of_type() {
            // `new A`: TypeScript goes on without the parameters and the `=>`
            self.parse_typescript.trial_is_doubtful = true;
        }
        self.parse_typescript.open_type_lists += 1;
        let params = self.parse_params()?;
        self.parse_typescript.open_type_lists -= 1;
        let arrow_start = self.lexer.tok_start;
        if self.lexer.tok != tk::Arrow
            && (self.lexer.tok == tk::Comma || self.starts_with_gt() || self.is_start_of_type())
        {
            self.parse_typescript.trial_is_doubtful = true;
        }
        self.expect(tk::Arrow)?;
        let type_ = self.parse_type_or_type_predicate()?;
        let return_type = self.node1(k::TypeAnnotation, arrow_start, self.lexer.prev_end, type_);
        return Ok(self.function_node(
            head,
            start,
            self.lexer.prev_end,
            0,
            0,
            params,
            0,
            type_parameters,
            return_type,
        ));
    }

    pub(crate) fn ts_parse_type(&mut self) -> R<i32> {
        self.stack()?;
        if self.parse.typed == FLOW {
            return self.flow_parse_type();
        }
        if self.is_start_of_function_or_constructor_type()? {
            return self.parse_function_or_constructor_type();
        }
        let start = self.lexer.tok_start;
        let type_ = self.parse_union_or_intersection(tk::BitOr)?;
        if self.parse_typescript.no_conditional_types == 0
            && self.lexer.tok_nl == 0
            && self.lexer.tok == tk::Extends
        {
            self.next()?;
            self.parse_typescript.no_conditional_types = 1;
            let extends_type = self.ts_parse_type()?;
            self.parse_typescript.no_conditional_types = 0;
            self.expect(tk::Question)?;
            let true_type = self.ts_parse_type()?;
            self.expect(tk::Colon)?;
            let false_type = self.ts_parse_type()?;
            return Ok(self.node4(
                k::ConditionalType,
                start,
                self.lexer.prev_end,
                type_,
                extends_type,
                true_type,
                false_type,
            ));
        }
        return Ok(type_);
    }

    pub(crate) fn parse_constituent(&mut self, operator: i32) -> R<i32> {
        // a function type needs parentheses here
        if self.is_start_of_function_or_constructor_type()? {
            self.parse_typescript.trial_is_doubtful = true;
            return Err(self.unexpected());
        }
        return Ok(if operator == tk::BitOr {
            self.parse_union_or_intersection(tk::BitAnd)?
        } else {
            self.parse_type_operator_or_higher()?
        });
    }

    pub(crate) fn parse_union_or_intersection(&mut self, operator: i32) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        let has_leading_operator = self.eat(operator)?;
        let first = if has_leading_operator {
            self.parse_constituent(operator)?
        } else {
            if operator == tk::BitOr {
                self.parse_union_or_intersection(tk::BitAnd)?
            } else {
                self.parse_type_operator_or_higher()?
            }
        };
        // Prettier drops a union or intersection of one type
        if self.lexer.tok != operator {
            return Ok(first);
        }
        let list_mark = self.arena.ls_pos;
        self.list_push(first);
        while self.eat(operator)? {
            let v0 = self.parse_constituent(operator)?;
            self.list_push(v0);
        }
        let v1 = if operator == tk::BitOr {
            k::UnionType
        } else {
            k::IntersectionType
        };
        let v2 = self.lexer.prev_end;
        let v3 = self.list_finish(list_mark);
        return Ok(self.node_l(v1, start, v2, v3));
    }

    pub(crate) fn parse_infer_type(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        let name_start = self.lexer.tok_start;
        let name = self.parse_ident()?;
        let mut constraint: i32 = 0;
        if self.lexer.tok == tk::Extends {
            // `infer U extends X ? a : b` in the `extends` part is `(infer U) extends X ? ..` only where a conditional type may stand
            let m = self.mark();
            let list_top = self.arena.ls_pos;
            let depth = self.parse.speculating;
            let saved = self.parse_typescript.no_conditional_types;
            self.set_speculating(depth + 1);
            let v0 = (|| -> R<Option<i32>> {
                self.next()?;
                self.parse_typescript.no_conditional_types = 1;
                constraint = self.ts_parse_type()?;
                self.parse_typescript.no_conditional_types = saved;
                if saved == 0 && self.lexer.tok == tk::Question {
                    constraint = 0;
                }
                Ok(None)
            })();
            let v0 = match v0 {
                Err(Stop) => (|| -> R<Option<i32>> {
                    if !(self.why.get() == why::SYNTAX) {
                        return Err(Stop);
                    }
                    constraint = 0;
                    Ok(None)
                })(),
                ok => ok,
            };
            if let Some(v) = v0? {
                return Ok(v);
            }
            self.set_speculating(depth);
            self.parse_typescript.no_conditional_types = saved;
            if constraint == 0 {
                self.rewind(m);
                self.list_truncate(list_top);
            } else {
                self.unmark(m);
            }
        }
        let parameter = self.node4(
            k::TypeParameter,
            name_start,
            self.lexer.prev_end,
            name,
            constraint,
            0,
            0,
        );
        return Ok(self.node1(k::InferType, start, self.lexer.prev_end, parameter));
    }

    pub(crate) fn parse_type_operator_or_higher(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        if self.lexer.tok == tk::Name {
            let w = self.word();
            let mut operator: i32 = 0;
            if w == w::Keyof {
                operator = TO_KEYOF;
            } else if w == w::Unique {
                operator = TO_UNIQUE;
            } else if w == w::Readonly {
                operator = TO_READONLY;
            }
            if operator != 0 {
                self.next()?;
                let type_ = self.parse_type_operator_or_higher()?;
                return Ok(self.node1(
                    k::TypeOperator | (operator << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    type_,
                ));
            } else if w == w::Infer {
                return self.parse_infer_type();
            }
        }
        let saved = self.parse_typescript.no_conditional_types;
        self.parse_typescript.no_conditional_types = 0;
        let type_ = self.parse_postfix_type_or_higher()?;
        self.parse_typescript.no_conditional_types = saved;
        return Ok(type_);
    }

    pub(crate) fn is_start_of_type(&self) -> bool {
        match self.lexer.tok {
            tk::Name
            | tk::String
            | tk::Num
            | tk::BigInt
            | tk::True
            | tk::False
            | tk::Null
            | tk::Void
            | tk::This
            | tk::Typeof
            | tk::New
            | tk::Import
            | tk::BraceL
            | tk::BracketL
            | tk::ParenL
            | tk::Lt
            | tk::BitOr
            | tk::BitAnd
            | tk::BackQuote
            | tk::Sub
            | tk::Ellipsis
            | tk::Function
            | tk::Mul
            | tk::Question
            | tk::Not => {
                return true;
            }
            _ => {}
        }
        return false;
    }

    pub(crate) fn parse_postfix_type_or_higher(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut type_ = self.parse_non_array_type()?;
        while self.lexer.tok_nl == 0 {
            if self.lexer.tok == tk::BracketL {
                self.next()?;
                if self.lexer.tok == tk::BracketR {
                    self.next()?;
                    type_ = self.node1(k::ArrayType, start, self.lexer.prev_end, type_);
                } else {
                    let index = self.ts_parse_type()?;
                    self.expect(tk::BracketR)?;
                    type_ = self.node2(
                        k::IndexedAccessType,
                        start,
                        self.lexer.prev_end,
                        type_,
                        index,
                    );
                }
            } else if self.lexer.tok == tk::Question {
                // `T?` in a tuple; before the start of a type it belongs to a conditional type
                self.save();
                self.next()?;
                let is_conditional = self.is_start_of_type();
                if is_conditional {
                    self.restore();
                    return Ok(type_);
                }
                type_ = self.node1(k::OptionalType, start, self.lexer.prev_end, type_);
                self.parse_typescript.stray_optional_types += 1;
            } else if self.lexer.tok == tk::Not {
                // a type of JSDoc
                self.next()?;
                if self.lexer.tok == tk::Comma || self.starts_with_gt() {
                    self.parse_typescript.trial_is_doubtful = true;
                }
                return Err(self.unexpected());
            } else {
                break;
            }
        }
        return Ok(type_);
    }

    pub(crate) fn keyword_type(&mut self, which: i32) -> R<i32> {
        // followed by a dot it is the name of a namespace
        self.save();
        let start = self.lexer.tok_start;
        let end = self.lexer.tok_end;
        self.next()?;
        if self.lexer.tok == tk::Dot {
            self.restore();
            return self.parse_type_reference();
        }
        return Ok(self.node0(k::KeywordType | (which << SUB_SHIFT), start, end));
    }

    /// The current token stands behind a dot, on a new line. If it is a word and another word follows on its line, TypeScript takes the two for the start of a statement.
    #[cold]
    pub(crate) fn ts_check_name_on_new_line(&mut self) -> R<()> {
        if self.parse.typed != FLOW
            && self.parse.typed != 0
            && (self.is_word() || self.lexer.tok == tk::PrivateName)
        {
            let after = self.peek_on_same_line()?;
            if after == tk::Name || after >= tk::In {
                return Err(self.text_refuse());
            }
        }
        Ok(())
    }

    /// `a.b.c`; with `allow_this`, `this.a`.
    pub(crate) fn parse_entity_name(&mut self, allow_this: bool) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut name = if allow_this && self.lexer.tok == tk::This {
            self.leaf(k::ThisExpression)?
        } else {
            if self.lexer.tok == tk::Name {
                self.identifier()?
            } else {
                self.parse_ident_name()?
            }
        };
        while self.lexer.tok == tk::Dot {
            self.next()?;
            if self.lexer.tok_nl != 0 {
                self.ts_check_name_on_new_line()?;
            }
            let right = self.parse_ident_name()?;
            name = self.node2(k::QualifiedName, start, self.lexer.prev_end, name, right);
        }
        return Ok(name);
    }

    pub(crate) fn parse_type_reference(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let name = self.parse_entity_name(false)?;
        let type_arguments =
            if self.lexer.tok_nl == 0 && (self.lexer.tok == tk::Lt || self.lexer.tok == tk::Shl) {
                self.ts_parse_type_arguments()?
            } else {
                0
            };
        return Ok(self.node2(
            k::TypeReference,
            start,
            self.lexer.prev_end,
            name,
            type_arguments,
        ));
    }

    pub(crate) fn parse_import_type(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::Import)?;
        self.expect(tk::ParenL)?;
        let list_mark = self.arena.ls_pos;
        if self.lexer.tok != tk::String {
            // any type, for TypeScript's parser
            self.parse_typescript.trial_is_doubtful = true;
        }
        let v0 = self.string_literal()?;
        self.list_push(v0);
        if self.lexer.tok == tk::Comma {
            // `{ with: { .. } }`, and nothing else
            return Err(self.text_refuse());
        }
        self.expect(tk::ParenR)?;
        let args = self.list_finish(list_mark);
        let mut qualifier: i32 = 0;
        if self.eat(tk::Dot)? {
            qualifier = self.parse_entity_name(false)?;
        }
        let type_arguments =
            if self.lexer.tok_nl == 0 && (self.lexer.tok == tk::Lt || self.lexer.tok == tk::Shl) {
                self.ts_parse_type_arguments()?
            } else {
                0
            };
        let n = self.node_raw(k::ImportType, start, self.lexer.prev_end, 4);
        self.n.put(n + 4, 0);
        self.set_list(n, 5, args);
        self.set_child(n, 6, type_arguments);
        self.set_child(n, 7, qualifier);
        return Ok(n);
    }

    pub(crate) fn parse_type_query(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        if self.lexer.tok == tk::Import {
            let type_ = self.parse_import_type()?;
            return Ok(self.node2(k::TypeQuery, start, self.lexer.prev_end, type_, 0));
        }
        let name = self.parse_entity_name(true)?;
        let type_arguments =
            if self.lexer.tok_nl == 0 && (self.lexer.tok == tk::Lt || self.lexer.tok == tk::Shl) {
                self.ts_parse_type_arguments()?
            } else {
                0
            };
        return Ok(self.node2(
            k::TypeQuery,
            start,
            self.lexer.prev_end,
            name,
            type_arguments,
        ));
    }

    pub(crate) fn is_start_of_mapped_type(&mut self) -> R<bool> {
        let m = self.mark();
        self.next()?;
        let mut result = false;
        if self.lexer.tok == tk::Add || self.lexer.tok == tk::Sub {
            self.next()?;
            result = self.word() == w::Readonly;
        } else {
            if self.word() == w::Readonly {
                self.next()?;
            }
            if self.lexer.tok == tk::BracketL {
                self.next()?;
                if self.lexer.tok == tk::Name {
                    self.next()?;
                    result = self.lexer.tok == tk::In;
                }
            }
        }
        self.rewind(m);
        return Ok(result);
    }

    pub(crate) fn parse_mapped_type(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::BraceL)?;
        self.parse_typescript.open_type_lists += 1;
        let mut readonly = MT_NONE;
        let mut optional = MT_NONE;
        if self.lexer.tok == tk::Add || self.lexer.tok == tk::Sub {
            readonly = if self.lexer.tok == tk::Add {
                MT_PLUS
            } else {
                MT_MINUS
            };
            self.next()?;
            if self.word() != w::Readonly {
                return Err(self.unexpected());
            }
            self.next()?;
        } else if self.word() == w::Readonly {
            readonly = MT_PLAIN;
            self.next()?;
        }
        self.expect(tk::BracketL)?;
        let key = self.parse_ident_name()?;
        self.expect(tk::In)?;
        let constraint = self.ts_parse_type()?;
        let mut name_type: i32 = 0;
        if self.is_kw(kw::As) {
            self.next()?;
            name_type = self.ts_parse_type()?;
        }
        self.expect(tk::BracketR)?;
        if self.lexer.tok == tk::Add || self.lexer.tok == tk::Sub {
            optional = if self.lexer.tok == tk::Add {
                MT_PLUS
            } else {
                MT_MINUS
            };
            self.next()?;
            self.expect(tk::Question)?;
        } else if self.eat(tk::Question)? {
            optional = MT_PLAIN;
        }
        let mut type_: i32 = 0;
        if self.eat(tk::Colon)? {
            type_ = self.ts_parse_type()?;
        }
        self.eat(tk::Semi)?;
        self.expect(tk::BraceR)?;
        self.parse_typescript.open_type_lists -= 1;
        return Ok(self.node4(
            k::MappedType | ((readonly | (optional << 2)) << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            key,
            constraint,
            name_type,
            type_,
        ));
    }

    pub(crate) fn is_tuple_element_name(&mut self) -> R<bool> {
        if !self.is_word() {
            return Ok(false);
        }
        self.save();
        self.next()?;
        let mut result = self.lexer.tok == tk::Colon;
        if self.lexer.tok == tk::Question {
            self.next()?;
            result = self.lexer.tok == tk::Colon;
        }
        self.restore();
        return Ok(result);
    }

    pub(crate) fn parse_tuple_element(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let is_rest = self.eat(tk::Ellipsis)?;
        let element: i32;
        if self.is_tuple_element_name()? {
            let label_start = self.lexer.tok_start;
            let label = self.parse_ident_name()?;
            let flags = if self.eat(tk::Question)? {
                F_OPTIONAL
            } else {
                0
            };
            self.expect(tk::Colon)?;
            let type_ = self.ts_parse_type()?;
            if (self.n.at(type_) & 0xff) == k::OptionalType {
                return Err(self.unexpected());
            }
            element = self.node3(
                k::NamedTupleMember | flags,
                label_start,
                self.lexer.prev_end,
                label,
                type_,
                0,
            );
        } else {
            element = self.ts_parse_type()?;
            if (self.n.at(element) & 0xff) == k::OptionalType {
                self.parse_typescript.stray_optional_types -= 1;
            }
        }
        if is_rest {
            return Ok(self.node2(k::RestType, start, self.lexer.prev_end, element, 0));
        }
        return Ok(element);
    }

    pub(crate) fn parse_tuple_type(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::BracketL)?;
        let list_mark = self.arena.ls_pos;
        self.parse_typescript.open_type_lists += 1;
        while self.lexer.tok != tk::BracketR {
            let v0 = self.parse_tuple_element()?;
            self.list_push(v0);
            if self.lexer.tok != tk::BracketR {
                self.expect(tk::Comma)?;
            }
        }
        self.parse_typescript.open_type_lists -= 1;
        self.next()?;
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(list_mark);
        return Ok(self.node_l(k::TupleType, start, v1, v2));
    }

    pub(crate) fn literal_type(&mut self, literal: i32) -> i32 {
        return self.node1(
            k::LiteralType,
            self.n.at(literal + 1),
            self.n.at(literal + 2),
            literal,
        );
    }

    pub(crate) fn parse_asserts_type_predicate(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        let name = if self.lexer.tok == tk::This {
            self.this_type()?
        } else {
            self.identifier()?
        };
        let mut annotation: i32 = 0;
        if self.word() == w::Is {
            if self.lexer.tok_nl != 0 {
                // it belongs to the predicate for TypeScript
                return Err(self.text_refuse());
            }
            self.next()?;
            let type_start = self.lexer.tok_start;
            let type_ = self.ts_parse_type()?;
            annotation = self.node1(k::TypeAnnotation, type_start, self.lexer.prev_end, type_);
        }
        return Ok(self.node2(
            k::TypePredicate | F_ASSERTS,
            start,
            self.lexer.prev_end,
            name,
            annotation,
        ));
    }

    pub(crate) fn this_type(&mut self) -> R<i32> {
        let n = self.node0(
            k::KeywordType | (type_keyword::This << SUB_SHIFT),
            self.lexer.tok_start,
            self.lexer.tok_end,
        );
        self.next()?;
        return Ok(n);
    }

    pub(crate) fn parse_non_array_type(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        match self.lexer.tok {
            tk::Name => {
                match self.word() {
                    w::Any => {
                        return self.keyword_type(type_keyword::Any);
                    }
                    w::Unknown => {
                        return self.keyword_type(type_keyword::Unknown);
                    }
                    w::String => {
                        return self.keyword_type(type_keyword::String);
                    }
                    w::Number => {
                        return self.keyword_type(type_keyword::Number);
                    }
                    w::Bigint => {
                        return self.keyword_type(type_keyword::BigInt);
                    }
                    w::Symbol => {
                        return self.keyword_type(type_keyword::Symbol);
                    }
                    w::Boolean => {
                        return self.keyword_type(type_keyword::Boolean);
                    }
                    w::Undefined => {
                        return self.keyword_type(type_keyword::Undefined);
                    }
                    w::Never => {
                        return self.keyword_type(type_keyword::Never);
                    }
                    w::Object => {
                        return self.keyword_type(type_keyword::Object);
                    }
                    w::Asserts => {
                        self.save();
                        self.next()?;
                        let is_predicate = (self.lexer.tok == tk::Name
                            || self.lexer.tok == tk::This)
                            && self.lexer.tok_nl == 0;
                        self.restore();
                        if is_predicate {
                            return self.parse_asserts_type_predicate();
                        }
                    }
                    _ => {}
                }
                return self.parse_type_reference();
            }
            tk::String => {
                let v0 = self.leaf(k::StringLiteral)?;
                return Ok(self.literal_type(v0));
            }
            tk::Num => {
                let v1 = self.leaf(k::NumericLiteral)?;
                return Ok(self.literal_type(v1));
            }
            tk::BigInt => {
                let v2 = self.leaf(k::BigIntLiteral)?;
                return Ok(self.literal_type(v2));
            }
            tk::True | tk::False => {
                let v3 = self.leaf(k::BooleanLiteral)?;
                return Ok(self.literal_type(v3));
            }
            tk::Null => {
                self.next()?;
                return Ok(self.node0(
                    k::KeywordType | (type_keyword::Null << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                ));
            }
            tk::Void => {
                self.next()?;
                return Ok(self.node0(
                    k::KeywordType | (type_keyword::Void << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                ));
            }
            tk::Sub => {
                self.next()?;
                if self.lexer.tok != tk::Num && self.lexer.tok != tk::BigInt {
                    return Err(self.unexpected());
                }
                let argument = self.leaf(if self.lexer.tok == tk::Num {
                    k::NumericLiteral
                } else {
                    k::BigIntLiteral
                })?;
                let v4 = self.node1(
                    k::UnaryExpression | (tk::Sub << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    argument,
                );
                return Ok(self.literal_type(v4));
            }
            tk::This => {
                let type_ = self.this_type()?;
                if self.lexer.tok_nl == 0 && self.word() == w::Is {
                    self.next()?;
                    let type_start = self.lexer.tok_start;
                    let asserted = self.ts_parse_type()?;
                    let v5 = self.lexer.prev_end;
                    let v6 =
                        self.node1(k::TypeAnnotation, type_start, self.lexer.prev_end, asserted);
                    return Ok(self.node2(k::TypePredicate, start, v5, type_, v6));
                }
                return Ok(type_);
            }
            tk::Typeof => {
                return self.parse_type_query();
            }
            tk::BraceL => {
                if self.is_start_of_mapped_type()? {
                    return self.parse_mapped_type();
                }
                return self.parse_type_members(k::TypeLiteral);
            }
            tk::BracketL => {
                return self.parse_tuple_type();
            }
            tk::ParenL => {
                self.next()?;
                let type_ = self.ts_parse_type()?;
                self.expect(tk::ParenR)?;
                return Ok(type_);
            }
            tk::Import => {
                return self.parse_import_type();
            }
            // the types of JSDoc, which TypeScript parses to complain about them
            tk::Mul | tk::Question | tk::Not => {
                self.parse_typescript.trial_is_doubtful = true;
                return Err(self.unexpected());
            }
            tk::BackQuote => {
                let template = self.parse_template(true)?;
                return Ok(if (self.n.at(template) & 0xff) == k::TemplateLiteral {
                    self.literal_type(template)
                } else {
                    template
                });
            }
            _ => {}
        }
        return Err(self.unexpected());
    }

    // ------------------------------------------------------------------------------------------------------ type members
    pub(crate) fn type_member_semicolon(&mut self) -> R<()> {
        if self.lexer.tok == tk::Comma || self.lexer.tok == tk::Semi {
            self.next()?;
        } else if self.lexer.tok != tk::BraceR && self.lexer.tok_nl == 0 {
            return Err(self.unexpected());
        }
        Ok(())
    }

    /// The current token is `[`: does an index signature start here, and not a computed key?
    pub(crate) fn is_index_signature(&mut self) -> R<bool> {
        let m = self.mark();
        self.next()?;
        let mut result = false;
        if self.lexer.tok == tk::Ellipsis || self.lexer.tok == tk::BracketR {
            result = true;
        } else {
            let mut is_name = self.lexer.tok == tk::Name;
            if is_name && is_parameter_modifier(self.word()) {
                self.next()?;
                if self.lexer.tok == tk::Name {
                    result = true;
                }
                is_name = !result;
            } else if is_name {
                self.next()?;
            }
            if !result && is_name {
                if self.lexer.tok == tk::Colon || self.lexer.tok == tk::Comma {
                    result = true;
                } else if self.lexer.tok == tk::Question {
                    self.next()?;
                    result = self.lexer.tok == tk::Colon
                        || self.lexer.tok == tk::Comma
                        || self.lexer.tok == tk::BracketR;
                }
            }
        }
        self.rewind(m);
        return Ok(result);
    }

    pub(crate) fn parse_index_signature(&mut self, start: i32, head: i32) -> R<i32> {
        self.expect(tk::BracketL)?;
        let list_mark = self.arena.ls_pos;
        let odd = self.parse_typescript.odd_parameters;
        while self.lexer.tok != tk::BracketR {
            let v0 = self.parse_binding_element()?;
            self.list_push(v0);
            if self.lexer.tok != tk::BracketR {
                self.expect(tk::Comma)?;
            }
        }
        if self.parse_typescript.odd_parameters != odd {
            return Err(self.text_refuse());
        }
        self.next()?;
        let parameters = self.list_finish(list_mark);
        let annotation = if self.lexer.tok == tk::Colon {
            self.ts_parse_type_annotation()?
        } else {
            0
        };
        self.type_member_semicolon()?;
        return Ok(self.node1_l(
            k::IndexSignature | head,
            start,
            self.lexer.prev_end,
            annotation,
            parameters,
        ));
    }

    pub(crate) fn parse_signature(&mut self, head: i32, start: i32, key: i32) -> R<i32> {
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let params = self.parse_params()?;
        let return_type = if self.lexer.tok == tk::Colon {
            self.ts_parse_return_type()?
        } else {
            0
        };
        // the body of an accessor is an error that TypeScript reports later
        if self.lexer.tok == tk::BraceL && (((head as u32) >> SUB_SHIFT) as i32 & 3) != M_METHOD {
            return Err(self.text_refuse());
        }
        self.type_member_semicolon()?;
        return Ok(self.function_node(
            head,
            start,
            self.lexer.prev_end,
            key,
            0,
            params,
            0,
            type_parameters,
            return_type,
        ));
    }

    pub(crate) fn parse_type_member(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        if self.lexer.tok == tk::ParenL || self.lexer.tok == tk::Lt {
            return self.parse_signature(k::CallSignature, start, 0);
        }
        if self.lexer.tok == tk::New {
            self.save();
            self.next()?;
            if self.lexer.tok == tk::ParenL || self.lexer.tok == tk::Lt {
                return self.parse_signature(k::ConstructSignature, start, 0);
            }
            self.restore();
        }
        let mut head: i32 = 0;
        let mut method = M_METHOD;
        if self.lexer.tok == tk::Name {
            let w = self.word();
            // (on whatever line the next word stands: where TypeScript looks for the start of a member, it skips these words)
            if is_modifier_word(w) && self.next_can_follow_modifier(true)? {
                // `readonly`, once, is the only modifier here
                if w != w::Readonly || !self.next_can_follow_modifier(false)? {
                    return Err(self.text_refuse());
                }
                head = MOD_READONLY << SUB_SHIFT;
                self.next()?;
                let w = self.word();
                if is_modifier_word(w) && self.next_can_follow_modifier(w == w::Static)? {
                    return Err(self.text_refuse());
                }
            }
        }
        if self.lexer.tok >= tk::In
            && (self.lexer.tok == tk::Export
                || self.lexer.tok == tk::Default
                || self.lexer.tok == tk::In
                || self.lexer.tok == tk::Const)
        {
            self.ts_check_export_before_member()?;
        }
        if self.lexer.tok == tk::Name
            && (self.lexer.tok_kw == kw::Get || self.lexer.tok_kw == kw::Set)
        {
            let kw = self.lexer.tok_kw;
            self.save();
            self.next()?;
            if self.lexer.tok == tk::BracketL || self.is_literal_property_name() {
                method = if kw == kw::Get { M_GET } else { M_SET };
            } else {
                self.restore();
            }
        }
        if self.lexer.tok == tk::BracketL && method == M_METHOD && self.is_index_signature()? {
            return self.parse_index_signature(start, head);
        }
        if self.lexer.tok == tk::BracketL {
            head |= F_COMPUTED;
        }
        let key = self.parse_property_name()?;
        if self.lexer.tok == tk::Question && method == M_METHOD {
            self.next()?;
            head |= F_OPTIONAL;
        }
        if self.lexer.tok == tk::ParenL || self.lexer.tok == tk::Lt {
            if (head & (MOD_READONLY << SUB_SHIFT)) != 0 {
                return Err(self.text_refuse());
            }
            return self.parse_signature(
                k::MethodSignature | head | (method << SUB_SHIFT),
                start,
                key,
            );
        }
        // `get` and `set` announce an accessor
        if method != M_METHOD {
            return Err(self.unexpected());
        }
        let annotation = if self.lexer.tok == tk::Colon {
            self.ts_parse_type_annotation()?
        } else {
            0
        };
        self.type_member_semicolon()?;
        return Ok(self.node2(
            k::PropertySignature | head,
            start,
            self.lexer.prev_end,
            key,
            annotation,
        ));
    }

    /// `{ members }` of a type literal or an interface.
    pub(crate) fn parse_type_members(&mut self, kind: i32) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::BraceL)?;
        let saved = self.parse_typescript.no_conditional_types;
        self.parse_typescript.no_conditional_types = 0;
        let list_mark = self.arena.ls_pos;
        self.enter_list();
        self.parse_typescript.open_type_lists += 1;
        while self.lexer.tok != tk::BraceR {
            if self.lexer.tok == tk::EOF {
                return Err(self.unexpected());
            }
            if kind == k::InterfaceBody
                && self.lexer.tok == tk::Name
                && self.parse_ready_members(MEMBER_OF_INTERFACE)?
            {
                continue;
            }
            let v0 = self.parse_type_member()?;
            self.list_push(v0);
        }
        self.leave_list();
        self.parse_typescript.open_type_lists -= 1;
        self.parse_typescript.no_conditional_types = saved;
        self.next()?;
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(list_mark);
        return Ok(self.node_l(kind, start, v1, v2));
    }
}
// --------------------------------------------------------------------------------------------------------- modifiers
pub(crate) fn is_parameter_modifier(w: i32) -> bool {
    return w == w::Public
        || w == w::Private
        || w == w::Protected
        || w == w::Readonly
        || w == w::Override;
}

/// The words that TypeScript reads as modifiers wherever modifiers can stand, but for `const`, `default`, `export` and `in`, which are no names.
pub(crate) fn is_modifier_word(w: i32) -> bool {
    return member_modifier(w) != 0 || w == w::Accessor || w == w::Async || w == w::Out;
}

/// The bits of a modifier of a class member or type member in the head of the node; 0 if the word is none.
pub(crate) fn member_modifier(w: i32) -> i32 {
    match w {
        w::Public => {
            return MOD_PUBLIC << SUB_SHIFT;
        }
        w::Protected => {
            return MOD_PROTECTED << SUB_SHIFT;
        }
        w::Private => {
            return MOD_PRIVATE << SUB_SHIFT;
        }
        w::Abstract => {
            return MOD_ABSTRACT << SUB_SHIFT;
        }
        w::Override => {
            return MOD_OVERRIDE << SUB_SHIFT;
        }
        w::Readonly => {
            return MOD_READONLY << SUB_SHIFT;
        }
        w::Declare => {
            return MOD_DECLARE << SUB_SHIFT;
        }
        w::Static => {
            return F_STATIC;
        }
        _ => {}
    }
    return 0;
}

impl Quick {
    /// `private readonly` .. before a parameter: the modifiers as a sub-kind, 0 if there are none.
    pub(crate) fn ts_parse_binding_modifiers(&mut self) -> R<i32> {
        let mut modifiers: i32 = 0;
        while self.lexer.tok == tk::Name {
            let w = self.word();
            if !is_parameter_modifier(w) || !self.next_can_follow_modifier(false)? {
                break;
            }
            let modifier = ((member_modifier(w) as u32) >> SUB_SHIFT) as i32;
            if (modifiers
                & (if (modifier & MOD_ACCESSIBILITY) != 0 {
                    MOD_ACCESSIBILITY
                } else {
                    modifier
                }))
                != 0
            {
                return Err(self.text_refuse());
            }
            modifiers |= modifier;
            self.next()?;
        }
        return Ok(modifiers);
    }

    /// Among the parameters from `mark` on in the list at hand, or in what they hold, are some with modifiers or decorators.
    #[cold]
    pub(crate) fn ts_check_parameters(&mut self, mark: i32, owner: i32) -> R<()> {
        let mut i = mark;
        while i < self.arena.ls_pos {
            let parameter = self.arena.ls.at(i);
            let head = self.n.at(parameter);
            let has_decorators: bool;
            if (head & 0xff) == k::ParameterProperty {
                // in a constructor, with a name
                let mut name = self.n.at(parameter + 4);
                if (self.n.at(name) & 0xff) == k::AssignmentPattern {
                    name = self.n.at(name + 4);
                }
                if owner != PARAMETERS_OF_CONSTRUCTOR || (self.n.at(name) & 0xff) != k::Identifier {
                    return Err(self.text_refuse());
                }
                has_decorators = self.n.at(parameter + 5) != 0;
                self.parse_typescript.parameters_need_body = true;
            } else {
                has_decorators =
                    (head & F_EXT) != 0 && self.n.at(parameter + EXT_AT.at(head & 0xff) + 1) != 0;
            }
            if has_decorators {
                // in a method of a class that is a declaration
                if owner == PARAMETERS_PLAIN || !self.parse_typescript.in_class_declaration {
                    return Err(self.text_refuse());
                }
                self.parse_typescript.parameters_need_body = true;
            }
            i += 1;
        }
        Ok(())
    }

    // ----------------------------------------------------------------------------------------------------------- classes
    /// `implements A, B<C>`, or nothing: the list.
    pub(crate) fn ts_parse_class_heritage(&mut self) -> R<i32> {
        if self.word() != w::Implements {
            return Ok(0);
        }
        self.next()?;
        return self.parse_heritage_list();
    }

    /// `a`, `a.b.c`
    pub(crate) fn is_entity_name(&self, mut n: i32) -> bool {
        loop {
            let head = self.n.at(n) & (0xff | F_PAREN | F_COMPUTED | F_CHAIN);
            if head == k::Identifier {
                return true;
            }
            if head != k::MemberExpression || (self.n.at(self.n.at(n + 5)) & 0xff) != k::Identifier
            {
                return false;
            }
            n = self.n.at(n + 4);
        }
    }

    pub(crate) fn parse_heritage_list(&mut self) -> R<i32> {
        let list_mark = self.arena.ls_pos;
        loop {
            let start = self.lexer.tok_start;
            if self.word() == w::Implements {
                return Err(self.text_refuse());
            }
            self.parse_typescript.in_heritage = true;
            let mut expression = self.parse_expr_subscripts()?;
            self.parse_typescript.in_heritage = false;
            let mut type_arguments: i32 = 0;
            if (self.n.at(expression) & (0xff | F_PAREN)) == k::InstantiationExpression {
                type_arguments = self.n.at(expression + 5);
                expression = self.n.at(expression + 4);
            } else if self.lexer.tok == tk::Lt {
                type_arguments = self.ts_parse_type_arguments()?;
            }
            if !self.is_entity_name(expression) {
                return Err(self.text_refuse());
            }
            let v0 = self.node2(
                k::Heritage,
                start,
                self.lexer.prev_end,
                expression,
                type_arguments,
            );
            self.list_push(v0);
            if !self.eat(tk::Comma)? {
                break;
            }
        }
        return Ok(self.list_finish(list_mark));
    }

    pub(crate) fn ts_parse_class_member(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let decorators = if self.lexer.tok == tk::At {
            self.parse_decorators()?
        } else {
            0
        };
        let mut head: i32 = 0;
        let mut method = M_METHOD;
        let is_ts = self.parse.typed != FLOW;
        // modifiers, in any order
        while self.lexer.tok == tk::Name {
            let w = self.word();
            let mut modifier = member_modifier(w);
            if self.mode.is_babel_flow && w != w::Static && w != w::Declare {
                modifier = 0;
            }
            if w == w::Accessor {
                modifier = F_ACCESSOR;
            } else if w == w::Async {
                modifier = F_ASYNC;
            }
            if modifier == 0 {
                break;
            }
            if w == w::Static {
                if (head & F_STATIC) != 0 {
                    // the second one is a name
                    break;
                }
                self.save();
                self.next()?;
                if self.lexer.tok == tk::BraceL {
                    return self.parse_static_block_in_class(start);
                }
                self.restore();
            }
            if !self.next_can_follow_modifier(w == w::Static)? {
                break;
            }
            if is_ts
                && (head
                    & (if (modifier & (MOD_ACCESSIBILITY << SUB_SHIFT)) != 0 {
                        MOD_ACCESSIBILITY << SUB_SHIFT
                    } else {
                        modifier
                    }))
                    != 0
            {
                return Err(self.text_refuse());
            }
            head |= modifier;
            self.next()?;
        }
        if is_ts {
            self.ts_check_word_before_member()?;
        }
        if self.lexer.tok == tk::Mul {
            self.next()?;
            head |= F_GENERATOR;
        }
        let variance = if self.parse.typed == FLOW {
            self.flow_parse_variance_of_member()?
        } else {
            0
        };
        if (head & (F_GENERATOR | F_ASYNC)) == 0
            && self.lexer.tok == tk::Name
            && (self.lexer.tok_kw == kw::Get || self.lexer.tok_kw == kw::Set)
        {
            let kw = self.lexer.tok_kw;
            self.save();
            self.next()?;
            if self.lexer.tok == tk::BracketL || self.is_literal_property_name() {
                method = if kw == kw::Get { M_GET } else { M_SET };
            } else {
                self.restore();
            }
        }
        if self.lexer.tok == tk::BracketL
            && method == M_METHOD
            && (head & F_GENERATOR) == 0
            && is_ts
            && self.is_index_signature()?
        {
            // `static` and `readonly` are all that can stand before it
            if (head & !(F_STATIC | (MOD_READONLY << SUB_SHIFT))) != 0 || decorators != 0 {
                return Err(self.text_refuse());
            }
            return self.parse_index_signature(start, head);
        }
        if self.lexer.tok == tk::BracketL {
            head |= F_COMPUTED;
        }
        let key = self.parse_property_name()?;
        if self.lexer.tok == tk::Question && !self.mode.is_babel_flow {
            self.next()?;
            head |= F_OPTIONAL;
        }
        let is_constructor_key = (head & F_COMPUTED) == 0 && self.is_constructor_key(key);
        if self.lexer.tok == tk::ParenL || self.lexer.tok == tk::Lt {
            if is_constructor_key
                && self.lexer.tok == tk::Lt
                && (self.n.at(key) & 0xff) == k::StringLiteral
                && is_ts
            {
                // a method for TypeScript
                return Err(self.text_refuse());
            }
            if method == M_METHOD && (head & F_STATIC) == 0 && is_constructor_key {
                method = M_CONSTRUCTOR;
            }
            let member = self.parse_method_rest(
                k::ClassMethod | head | (method << SUB_SHIFT),
                start,
                key,
                decorators,
            )?;
            if is_ts
                && ((head
                    & (((MOD_ABSTRACT | MOD_DECLARE | MOD_READONLY) << SUB_SHIFT) | F_ACCESSOR))
                    != 0
                    || decorators != 0
                    || is_constructor_key
                    || method != M_METHOD)
            {
                self.ts_check_method(member, is_constructor_key)?;
            }
            return Ok(member);
        }
        // `*`, `async`, `get` and `set` announce a method
        if (head & (F_GENERATOR | F_ASYNC)) != 0 || method != M_METHOD {
            return Err(self.unexpected());
        }
        if self.lexer.tok == tk::Not && self.lexer.tok_nl == 0 && (head & F_OPTIONAL) == 0 {
            head |= F_DEFINITE;
            self.next()?;
        }
        let annotation = if self.lexer.tok == tk::Colon {
            self.ts_parse_type_annotation()?
        } else {
            0
        };
        let value = self.parse_class_property_value()?;
        self.semicolon()?;
        if is_ts
            && ((head & ((MOD_ABSTRACT << SUB_SHIFT) | F_DEFINITE | F_ACCESSOR)) != 0
                || is_constructor_key)
            && (is_constructor_key
                // (whether the quotes stay is a matter of its own)
                || ((head & ((MOD_ABSTRACT << SUB_SHIFT) | F_ACCESSOR)) != 0
                    && (self.n.at(key) & 0xff) == k::StringLiteral
                    && (head & F_COMPUTED) == 0)
                || ((head & (MOD_ABSTRACT << SUB_SHIFT)) != 0
                    && (value != 0
                        || (head & F_DEFINITE) != 0
                        || (decorators != 0 && !self.parse_typescript.in_class_declaration)))
                || ((head & F_DEFINITE) != 0 && (value != 0 || annotation == 0)))
        {
            return Err(self.text_refuse());
        }
        return Ok(self.class_property_node(
            k::ClassProperty | head,
            start,
            self.lexer.prev_end,
            key,
            value,
            decorators,
            annotation,
            variance,
        ));
    }

    /// A word of the language where the key of a member is expected. `export` and `default` are modifiers for TypeScript if something like a key follows, on whatever line.
    #[inline(always)]
    pub(crate) fn ts_check_word_before_member(&mut self) -> R<()> {
        if self.lexer.tok == tk::Export || self.lexer.tok == tk::Default {
            return self.ts_check_export_before_member();
        }
        Ok(())
    }

    #[cold]
    fn ts_check_export_before_member(&mut self) -> R<()> {
        match self.peek()? {
            tk::ParenL
            | tk::Lt
            | tk::Not
            | tk::Colon
            | tk::Eq
            | tk::Question
            | tk::Semi
            | tk::Comma
            | tk::BraceR => Ok(()),
            _ => Err(self.text_refuse()),
        }
    }

    /// What typescript-estree has to say about a method, an accessor or a constructor of a class.
    #[cold]
    fn ts_check_method(&mut self, member: i32, is_constructor_key: bool) -> R<()> {
        let head = self.n.at(member);
        let method = ((head as u32) >> SUB_SHIFT) as i32 & 3;
        let has_body = self.n.at(member + 5) != 0;
        let has_decorators = self.n.at(member + 7) != 0;
        let is_wrong = (head & (((MOD_DECLARE | MOD_READONLY) << SUB_SHIFT) | F_ACCESSOR)) != 0
            || ((head & (MOD_ABSTRACT << SUB_SHIFT)) != 0 && has_body)
            || (has_decorators && !has_body)
            // an accessor is not optional
            || ((method == M_GET || method == M_SET) && (head & F_OPTIONAL) != 0)
            // before a constructor, static or not: its accessibility
            || (is_constructor_key
                && method != M_GET
                && method != M_SET
                && (has_decorators
                    || (head
                        & (((MOD_ABSTRACT | MOD_OVERRIDE) << SUB_SHIFT)
                            | F_ASYNC
                            | F_GENERATOR
                            | F_OPTIONAL))
                        != 0));
        if is_wrong {
            return Err(self.text_refuse());
        }
        Ok(())
    }

    pub(crate) fn parse_static_block_in_class(&mut self, start: i32) -> R<i32> {
        let context = self.save_context();
        self.restore_context(1);
        let block = self.parse_static_block(start)?;
        self.restore_context(context);
        return Ok(block);
    }

    // ------------------------------------------------------------------------------------------------------ declarations
    pub(crate) fn ts_parse_interface_body(&mut self) -> R<i32> {
        return self.parse_type_members(k::InterfaceBody);
    }

    pub(crate) fn parse_interface(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.next()?;
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters_of(true)?
        } else {
            0
        };
        let extended = if self.eat(tk::Extends)? {
            self.parse_heritage_list()?
        } else {
            0
        };
        let body = self.parse_type_members(k::InterfaceBody)?;
        let n = self.class_node(
            k::InterfaceDeclaration | (modifiers << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            0,
            body,
            0,
        );
        self.set_child(n, 9, type_parameters);
        self.set_list(n, 11, extended);
        return Ok(n);
    }

    pub(crate) fn parse_type_alias(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.next()?;
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters_of(true)?
        } else {
            0
        };
        self.expect(tk::Eq)?;
        let mut type_: i32 = 0;
        if self.word() == w::Intrinsic {
            self.save();
            let type_start = self.lexer.tok_start;
            let type_end = self.lexer.tok_end;
            self.next()?;
            if self.lexer.tok == tk::Dot {
                self.restore();
            } else {
                type_ = self.node0(
                    k::KeywordType | (type_keyword::Intrinsic << SUB_SHIFT),
                    type_start,
                    type_end,
                );
            }
        }
        if type_ == 0 {
            type_ = self.ts_parse_type()?;
        }
        self.semicolon()?;
        return Ok(self.node3(
            k::TypeAlias | (modifiers << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            type_parameters,
            type_,
        ));
    }

    pub(crate) fn parse_enum(&mut self, start: i32, head: i32) -> R<i32> {
        self.next()?;
        let id = self.parse_ident()?;
        let body_start = self.lexer.tok_start;
        self.expect(tk::BraceL)?;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            let member_start = self.lexer.tok_start;
            // a word or a string
            if self.lexer.tok != tk::String && !self.is_word() {
                return Err(self.text_refuse());
            }
            let key = self.parse_property_name()?;
            let initializer = if self.eat(tk::Eq)? {
                self.parse_maybe_assign()?
            } else {
                0
            };
            let v0 = self.node2(
                k::EnumMember,
                member_start,
                self.lexer.prev_end,
                key,
                initializer,
            );
            self.list_push(v0);
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.next()?;
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(list_mark);
        let body = self.node_l(k::EnumBody, body_start, v1, v2);
        return Ok(self.node2(
            k::EnumDeclaration | head,
            start,
            self.lexer.prev_end,
            id,
            body,
        ));
    }

    pub(crate) fn parse_module_block(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::BraceL)?;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            if self.lexer.tok == tk::EOF {
                return Err(self.unexpected());
            }
            let v0 = self.parse_statement()?;
            self.list_push(v0);
        }
        self.next()?;
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(list_mark);
        return Ok(self.node_ll(k::ModuleBlock, start, v1, 0, v2));
    }

    /// The current token is `namespace`, `module` or `global`.
    pub(crate) fn parse_module(&mut self, start: i32, modifiers: i32, kind: i32) -> R<i32> {
        let id: i32;
        if kind == MK_GLOBAL {
            id = self.identifier()?;
        } else {
            self.next()?;
            id = if self.lexer.tok == tk::String {
                self.string_literal()?
            } else {
                self.parse_entity_name(false)?
            };
        }
        let mut body: i32 = 0;
        if self.lexer.tok == tk::BraceL {
            body = self.parse_module_block()?;
        } else if (self.n.at(id) & 0xff) != k::StringLiteral {
            // only `module "a";` has no body
            return Err(self.text_refuse());
        } else {
            self.semicolon()?;
        }
        return Ok(self.node2(
            k::ModuleDeclaration | ((modifiers | kind) << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            body,
        ));
    }

    pub(crate) fn peek(&mut self) -> R<i32> {
        self.save();
        self.next()?;
        let result = self.lexer.tok;
        self.restore();
        return Ok(result);
    }

    /// The token after the current one, if it stands on the same line; else Tk.EOF.
    pub(crate) fn peek_on_same_line(&mut self) -> R<i32> {
        self.save();
        self.next()?;
        let result = if self.lexer.tok_nl == 0 {
            self.lexer.tok
        } else {
            tk::EOF
        };
        self.restore();
        return Ok(result);
    }

    /// A declaration that only TypeScript has, if one starts at the current token (a name, or `const`); else 0.
    /// `start` is where the statement starts: at the token, or at decorators before it.
    pub(crate) fn ts_parse_statement(&mut self, start: i32) -> R<i32> {
        let declaration = self.parse_declaration(start, 0)?;
        if (self.n.at(declaration) & 0xff) == k::ClassDeclaration && self.n.at(declaration + 4) == 0
        {
            // only a default export needs no name
            return Err(self.text_refuse());
        }
        return Ok(declaration);
    }

    /// isValidAssignmentTarget() of typescript-estree
    pub(crate) fn ts_is_valid_target(&self, mut n: i32) -> bool {
        loop {
            let head = self.n.at(n);
            match head & 0xff {
                k::Identifier => {
                    return true;
                }
                k::MemberExpression => {
                    return (head & F_CHAIN) == 0;
                }
                k::AsExpression
                | k::SatisfiesExpression
                | k::NonNullExpression
                | k::InstantiationExpression => {
                    n = self.n.at(n + 4);
                }
                k::TypeAssertion => {
                    n = self.n.at(n + 5);
                }
                _ => {
                    return false;
                }
            }
        }
    }

    /// `init` is what stands first in the head of a `for`; `var_kind` is -1 if it is an expression. `is_for_in_or_of`: `in` or `of` follows.
    pub(crate) fn ts_check_head_of_for(
        &mut self,
        init: i32,
        var_kind: i32,
        is_for_in_or_of: bool,
    ) -> R<()> {
        let is_right: bool;
        if var_kind < 0 {
            let head = self.n.at(init) & (0xff | F_PAREN);
            is_right = !is_for_in_or_of
                || head == k::ObjectExpression
                || head == k::ArrayExpression
                || self.ts_is_valid_target(init);
        } else {
            let list = self.n.at(init + 4);
            let first = self.n.at(list + 1);
            if is_for_in_or_of {
                // one name or pattern, without a type and without a value
                is_right = self.n.at(list) == 1
                    && self.n.at(first + 5) == 0
                    && (self.n.at(self.n.at(first + 4)) & F_EXT) == 0;
            } else if var_kind >= V_USING {
                let mut i: i32 = 1;
                while i <= self.n.at(list) && self.n.at(self.n.at(list + i) + 5) != 0 {
                    i += 1;
                }
                is_right = i > self.n.at(list);
            } else {
                is_right = true;
            }
        }
        if !is_right {
            return Err(self.text_refuse());
        }
        Ok(())
    }

    /// `declaration` stands behind `declare`: a value only for a `const` without a type, no `!`.
    fn ts_check_ambient_variables(&mut self, declaration: i32, kind: i32) -> R<i32> {
        let list = self.n.at(declaration + 4);
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let declarator = self.n.at(list + i);
            let id = self.n.at(declarator + 4);
            if (self.n.at(declarator) & F_DEFINITE) != 0
                || (self.n.at(declarator + 5) != 0
                    && (kind != V_CONST || (self.n.at(id) & F_EXT) != 0))
            {
                return Err(self.text_refuse());
            }
            i += 1;
        }
        return Ok(declaration);
    }

    pub(crate) fn parse_declaration(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.stack()?;
        if self.lexer.tok == tk::Const {
            self.save();
            self.next()?;
            if self.is_kw(kw::Enum) {
                return self.parse_enum(start, F_CONST | (modifiers << SUB_SHIFT));
            }
            self.restore();
            if modifiers == 0 {
                return Ok(0);
            }
            let declaration = self.parse_var_statement(start, V_CONST)?;
            self.n.put(
                declaration,
                self.n.at(declaration) | (modifiers << SUB_SHIFT),
            );
            return self.ts_check_ambient_variables(declaration, V_CONST);
        }
        if modifiers != 0 {
            // behind `declare`
            match self.lexer.tok {
                tk::Var => {
                    let declaration = self.parse_var_statement(start, V_VAR)?;
                    self.n.put(
                        declaration,
                        self.n.at(declaration) | (modifiers << SUB_SHIFT),
                    );
                    return self.ts_check_ambient_variables(declaration, V_VAR);
                }
                tk::Function => {
                    let declaration =
                        self.parse_function(start, k::FunctionDeclaration, modifiers << SUB_SHIFT)?;
                    // no body, and no generator
                    if (self.n.at(declaration) & (0xff | F_GENERATOR)) != k::TSDeclareFunction {
                        return Err(self.text_refuse());
                    }
                    return Ok(declaration);
                }
                tk::Class => {
                    let v0 = k::ClassDeclaration | (modifiers << SUB_SHIFT);
                    let v1 = self.take_pending_decorators();
                    return self.parse_class(start, v0, v1);
                }
                _ => {}
            }
            if self.is_kw(kw::Let) {
                let declaration = self.parse_var_statement(start, V_LET)?;
                self.n.put(
                    declaration,
                    self.n.at(declaration) | (modifiers << SUB_SHIFT),
                );
                return self.ts_check_ambient_variables(declaration, V_LET);
            }
        }
        's1: {
            match self.word() {
                w::Type => {
                    if self.peek_on_same_line()? == tk::Name {
                        return self.parse_type_alias(start, modifiers);
                    }
                }
                w::Interface => {
                    if self.peek_on_same_line()? == tk::Name {
                        return self.parse_interface(start, modifiers);
                    }
                }
                w::Enum => {
                    if self.peek()? == tk::Name {
                        return self.parse_enum(start, modifiers << SUB_SHIFT);
                    }
                }
                w::Namespace => {
                    if self.peek_on_same_line()? == tk::Name {
                        return self.parse_module(start, modifiers, MK_NAMESPACE);
                    }
                }
                w::Module => {
                    let after = self.peek_on_same_line()?;
                    if after == tk::Name || after == tk::String {
                        return self.parse_module(start, modifiers, MK_MODULE);
                    }
                }
                w::Global => {
                    if self.peek_on_same_line()? == tk::BraceL {
                        return self.parse_module(start, modifiers, MK_GLOBAL);
                    }
                    if self.peek()? == tk::BraceL {
                        // on the next line: still the body
                        return Err(self.text_refuse());
                    }
                }
                w::Abstract => {
                    if self.peek_on_same_line()? == tk::Class {
                        self.next()?;
                        let v2 = k::ClassDeclaration | ((modifiers | MOD_ABSTRACT) << SUB_SHIFT);
                        let v3 = self.take_pending_decorators();
                        return self.parse_class(start, v2, v3);
                    }
                    if (modifiers & MOD_ABSTRACT) == 0 && self.peek_on_same_line()? == tk::Name {
                        // abstract declare class
                        let m = self.mark();
                        self.next()?;
                        let declaration = if self.word() == w::Declare {
                            self.parse_declaration(start, modifiers | MOD_ABSTRACT)?
                        } else {
                            0
                        };
                        if declaration != 0
                            && (self.n.at(declaration) & 0xff) == k::ClassDeclaration
                        {
                            self.unmark(m);
                            return Ok(declaration);
                        }
                        self.rewind(m);
                    }
                }
                w::Declare => {
                    if (modifiers & MOD_DECLARE) != 0 {
                        break 's1;
                    }
                    let m = self.mark();
                    self.next()?;
                    if self.lexer.tok_nl == 0 {
                        let declaration = self.parse_declaration(start, modifiers | MOD_DECLARE)?;
                        if declaration != 0 {
                            self.unmark(m);
                            return Ok(declaration);
                        }
                        // `declare` is a name if an expression goes on behind it
                        if (self.is_word()
                            && self.lexer.tok != tk::In
                            && self.lexer.tok != tk::Instanceof
                            && !(self.lexer.tok == tk::Name && self.ts_is_as_or_satisfies()))
                            || self.lexer.tok == tk::BraceL
                            || self.lexer.tok == tk::At
                            || self.lexer.tok == tk::String
                            || self.lexer.tok == tk::Num
                            || self.lexer.tok == tk::BigInt
                            || self.lexer.tok == tk::PrivateName
                        {
                            return Err(self.text_refuse());
                        }
                    }
                    self.rewind(m);
                }
                // a modifier, whatever the line on which a declaration follows
                w::Static => {
                    return Err(self.text_refuse());
                }
                w::Public | w::Private | w::Protected | w::Readonly | w::Accessor => {
                    let after = self.peek_on_same_line()?;
                    if after == tk::Name || after >= tk::In {
                        return Err(self.text_refuse());
                    }
                }
                _ => {}
            }
        }
        return Ok(0);
    }

    /// `import a = require("b")`, `import a = b.c`. The current token is the name.
    pub(crate) fn ts_parse_import_equals(&mut self, start: i32, import_kind: i32) -> R<i32> {
        let id = self.identifier()?;
        self.expect(tk::Eq)?;
        let reference: i32;
        if self.word() == w::Require && self.peek()? == tk::ParenL {
            let reference_start = self.lexer.tok_start;
            self.next()?;
            self.expect(tk::ParenL)?;
            let list_mark = self.arena.ls_pos;
            let v0 = self.string_literal()?;
            self.list_push(v0);
            self.expect(tk::ParenR)?;
            let args = self.list_finish(list_mark);
            reference = self.call_node(
                k::ExternalModuleReference,
                reference_start,
                self.lexer.prev_end,
                0,
                args,
                0,
            );
        } else {
            // an alias cannot be only a type, and no word of the language is part of the name
            if import_kind != 0 {
                return Err(self.text_refuse());
            }
            let reference_start = self.lexer.tok_start;
            let mut name = self.parse_ident()?;
            while self.eat(tk::Dot)? {
                let right = self.parse_ident()?;
                name = self.node2(
                    k::QualifiedName,
                    reference_start,
                    self.lexer.prev_end,
                    name,
                    right,
                );
            }
            reference = name;
        }
        self.semicolon()?;
        return Ok(self.node2(
            k::ImportEqualsDeclaration | (import_kind << IK_SHIFT << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            reference,
        ));
    }

    /// What can follow `export` in TypeScript only. Returns the declaration, or the whole statement for `export =` and
    /// `export as namespace`; 0 if there is nothing of the kind; -1 after having skipped the `type` of `export type {` or `export type *`.
    pub(crate) fn ts_parse_export_declaration(&mut self, start: i32) -> R<i32> {
        if self.lexer.tok == tk::Eq {
            self.next()?;
            let expression = self.parse_maybe_assign()?;
            self.semicolon()?;
            return Ok(self.node1(k::ExportAssignment, start, self.lexer.prev_end, expression));
        }
        if self.lexer.tok == tk::Import {
            // export import a = b.c
            let import_start = self.lexer.tok_start;
            let m = self.mark();
            self.next()?;
            let mut import_kind: i32 = 0;
            if self.word() == w::Type && self.peek()? == tk::Name {
                self.next()?;
                import_kind = IK_TYPE;
            }
            if self.lexer.tok == tk::Name && self.peek()? == tk::Eq {
                self.unmark(m);
                return self.ts_parse_import_equals(import_start, import_kind);
            }
            self.rewind(m);
            return Ok(0);
        }
        if self.is_kw(kw::As) {
            self.save();
            self.next()?;
            if self.word() == w::Namespace {
                self.next()?;
                let id = self.parse_ident()?;
                self.semicolon()?;
                return Ok(self.node1(
                    k::NamespaceExportDeclaration,
                    start,
                    self.lexer.prev_end,
                    id,
                ));
            }
            self.restore();
            return Ok(0);
        }
        if self.word() == w::Type {
            self.save();
            self.next()?;
            if self.lexer.tok == tk::BraceL || self.lexer.tok == tk::Mul {
                return Ok(-1);
            }
            if self.is_kw(kw::As) {
                return Err(self.text_refuse());
            }
            self.restore();
        }
        // a class starts at its decorators, also if they stand before `export`
        return self.ts_parse_statement(if self.parse.pending_decorators != 0 {
            start
        } else {
            self.lexer.tok_start
        });
    }

    /// `type a`, `type a as b`, and a specifier that is called `type`. The current token is `type`.
    pub(crate) fn ts_parse_import_or_export_specifier(&mut self, kind: i32) -> R<i32> {
        let start = self.lexer.tok_start;
        let is_import = kind == k::ImportSpecifier;
        let mut is_type_only = false;
        let mut is_plain = true;
        // `type`
        let mut left = self.identifier()?;
        let mut right: i32 = 0;
        if self.is_kw(kw::As) {
            // { type as ..? }
            let first_as = self.identifier()?;
            if self.is_kw(kw::As) {
                // { type as as ..? }
                let second_as = self.identifier()?;
                if self.is_word() || self.lexer.tok == tk::String {
                    // { type as as something }
                    is_type_only = true;
                    left = first_as;
                    right = if is_import {
                        self.parse_ident_name()?
                    } else {
                        if self.lexer.tok == tk::String {
                            self.string_literal()?
                        } else {
                            self.parse_ident_name()?
                        }
                    };
                } else {
                    // { type as as }
                    right = second_as;
                }
            } else if self.is_word() || self.lexer.tok == tk::String {
                // { type as something }
                right = if is_import {
                    self.parse_ident_name()?
                } else {
                    if self.lexer.tok == tk::String {
                        self.string_literal()?
                    } else {
                        self.parse_ident_name()?
                    }
                };
            } else {
                // { type as }
                is_type_only = true;
                left = first_as;
            }
        } else if self.is_word() || self.lexer.tok == tk::String {
            // { type something ..? }
            is_type_only = true;
            is_plain = self.lexer.tok == tk::Name;
            left = if self.lexer.tok == tk::String {
                self.string_literal()?
            } else {
                self.parse_ident_name()?
            };
            if self.is_kw(kw::As) {
                self.next()?;
                if is_import {
                    is_plain = self.lexer.tok == tk::Name;
                }
                right = if self.lexer.tok == tk::String {
                    self.string_literal()?
                } else {
                    self.parse_ident_name()?
                };
            }
        }
        if !is_plain {
            // a word of the language or a string in the place of a name of this module
            if is_import {
                return Err(self.text_refuse());
            }
            self.parse_typescript.export_needs_from = true;
        }
        if right == 0 {
            right = self.node0(self.n.at(left), self.n.at(left + 1), self.n.at(left + 2));
        }
        return Ok(self.node2(
            kind | (if is_type_only {
                IK_TYPE << IK_SHIFT << SUB_SHIFT
            } else {
                0
            }),
            start,
            self.lexer.prev_end,
            left,
            right,
        ));
    }

    // ------------------------------------------------------------------------------------------------------- expressions
    pub(crate) fn ts_is_as_or_satisfies(&self) -> bool {
        if self.mode.is_babel_flow {
            return false;
        }
        return self.lexer.tok_kw == kw::As
            || (self.lexer.tok_end - self.lexer.tok_start == 9 && self.word() == w::Satisfies);
    }

    /// The current token is `as` or `satisfies`.
    pub(crate) fn ts_parse_as_or_satisfies(&mut self, left: i32, start: i32) -> R<i32> {
        let kind = if self.lexer.tok_kw == kw::As {
            k::AsExpression
        } else {
            k::SatisfiesExpression
        };
        self.next()?;
        let type_: i32;
        if self.lexer.tok == tk::Const && kind == k::AsExpression {
            if self.parse.typed == FLOW {
                // AsConstExpression: there is no node for the `const`
                self.next()?;
                type_ = 0;
            } else {
                let name = self.identifier()?;
                type_ = self.node2(
                    k::TypeReference,
                    self.n.at(name + 1),
                    self.n.at(name + 2),
                    name,
                    0,
                );
            }
        } else {
            type_ = if self.parse.typed == FLOW {
                self.flow_parse_type_fresh()?
            } else {
                self.ts_parse_type()?
            };
        }
        // a name in this place can need parentheses: see needs_parens()
        if (self.n.at(left) & 0xff) == k::Identifier {
            self.n.put(left, self.n.at(left) | F_EXTRA);
        }
        return Ok(self.node2(kind, start, self.lexer.prev_end, left, type_));
    }

    pub(crate) fn is_start_of_expression(&self) -> bool {
        match self.lexer.tok {
            tk::Name
            | tk::PrivateName
            | tk::Num
            | tk::BigInt
            | tk::String
            | tk::BackQuote
            | tk::BraceL
            | tk::ParenL
            | tk::BracketL
            | tk::At
            | tk::Inc
            | tk::Dec
            | tk::Not
            | tk::Tilde
            | tk::Lt
            | tk::Add
            | tk::Sub
            | tk::Div
            | tk::DivEq
            | tk::Typeof
            | tk::Void
            | tk::Delete
            | tk::Class
            | tk::False
            | tk::Function
            | tk::Import
            | tk::New
            | tk::Null
            | tk::Super
            | tk::This
            | tk::True => {
                return true;
            }
            _ => {}
        }
        return false;
    }

    /// Behind `f<T>`: was that a list of type arguments?
    pub(crate) fn can_follow_type_arguments_in_expression(&self) -> bool {
        match self.lexer.tok {
            tk::ParenL | tk::BackQuote => {
                return true;
            }
            tk::Lt
            | tk::Gt
            | tk::Add
            | tk::Sub
            | tk::Shr
            | tk::UShr
            | tk::GtEq
            | tk::ShrEq
            | tk::UShrEq => {
                return false;
            }
            tk::BraceL => {
                // R<T> {a: 1}
                if self.parse.typed == FLOW && self.lexer.tok_nl == 0 {
                    return true;
                }
            }
            _ => {}
        }
        return self.lexer.tok_nl != 0
            || PREC.at(self.lexer.tok) != 0
            || (self.lexer.tok == tk::Name && self.ts_is_as_or_satisfies())
            || !self.is_start_of_expression();
    }

    /// `<T, U>` behind an expression, tried: 0, with the lexer where it was, if `<` is an operator here.
    pub(crate) fn ts_try_parse_type_arguments_in_expression(&mut self) -> R<i32> {
        let m = self.mark();
        let list_top = self.arena.ls_pos;
        let context = self.save_context();
        let depth = self.parse.speculating;
        let saved = self.parse_typescript.no_conditional_types;
        let is_shift = self.lexer.tok == tk::Shl;
        let open_lists = self.parse_typescript.open_type_lists;
        self.parse_typescript.trial_is_doubtful = false;
        self.set_speculating(depth + 1);
        let mut result: i32 = 0;
        // where the type that is read starts, and with which token; 0 between two types
        let mut type_start: i32 = 0;
        let mut type_token: i32 = 0;
        let v0 = (|| -> R<Option<i32>> {
            let start = self.lexer.tok_start;
            self.expect_lt()?;
            self.parse_typescript.no_conditional_types = 0;
            if self.starts_with_gt() && self.parse.typed != FLOW {
                // `a<>`, or nothing at all
                return Err(self.text_refuse());
            }
            while !self.starts_with_gt() {
                type_start = self.lexer.tok_start;
                type_token = self.lexer.tok;
                let v1 = self.ts_parse_type()?;
                type_start = 0;
                self.list_push(v1);
                if !self.starts_with_gt() {
                    self.expect(tk::Comma)?;
                }
            }
            // `>` alone: `a < b >= c` and `a < b >> c` are comparisons
            if self.lexer.tok == tk::Gt {
                self.next()?;
                if self.can_follow_type_arguments_in_expression() {
                    let v2 = self.lexer.prev_end;
                    let v3 = self.list_finish(list_top);
                    result = self.node_l(k::TypeParameterInstantiation, start, v2, v3);
                } else if self.parse.typed != FLOW && !self.parse_typescript.in_heritage {
                    // `a < b > c`: two comparisons, which nobody writes. (`class A extends B<C> {`: whoever reads the head goes on.)
                    return Err(self.text_refuse());
                }
            }
            Ok(None)
        })();
        let v0 = match v0 {
            Err(Stop) => (|| -> R<Option<i32>> {
                if !(self.why.get() == why::SYNTAX) {
                    return Err(Stop);
                }
                result = 0;
                Ok(None)
            })(),
            ok => ok,
        };
        if let Some(v) = v0? {
            return Ok(v);
        }
        self.set_speculating(depth);
        self.parse_typescript.no_conditional_types = saved;
        if result == 0 {
            // Did a type start and break off (`-a` and `(-a` start none), in a list, where TypeScript skips what it does not know, or at a token with which a type can go on?
            // Then TypeScript mends the type, goes on, and may find the end of the arguments: `a < keyof > (b)`, `a < [b + c] > (d)`, `a < (b, c) > (d)`, `a < !b > (c)`.
            let is_doubtful = self.parse_typescript.trial_is_doubtful
                || (type_start != 0
                    && self.lexer.tok_start != type_start
                    && type_token != tk::Sub
                    && !(type_token == tk::ParenL && self.lexer.prev_end == type_start + 1)
                    && (self.parse_typescript.open_type_lists != open_lists
                        || self.starts_with_gt()
                        || matches!(
                            self.lexer.tok,
                            tk::Comma
                                | tk::ParenR
                                | tk::BracketR
                                | tk::BraceR
                                | tk::BracketL
                                | tk::BitOr
                                | tk::BitAnd
                                | tk::Arrow
                                | tk::Colon
                                | tk::Question
                                | tk::Extends
                                | tk::Semi
                                | tk::Eq
                                | tk::Dot
                                | tk::Ellipsis
                        )));
            self.parse_typescript.open_type_lists = open_lists;
            self.rewind(m);
            self.list_truncate(list_top);
            self.restore_context(context);
            if is_doubtful && self.parse.typed != FLOW && self.ts_type_arguments_may_end()? {
                return Err(self.text_refuse());
            }
            if is_shift && self.parse.typed != FLOW {
                // `a << b >> (c)`: TypeScript takes `<b>` for the type parameters of a function type, and goes on without the rest of it
                self.save();
                self.next()?;
                let is_name = self.lexer.tok == tk::Name;
                self.next()?;
                if is_name && self.starts_with_gt() {
                    return Err(self.text_refuse());
                }
                self.restore();
            }
        } else {
            self.unmark(m);
        }
        return Ok(result);
    }

    /// The current token is a `<`. Does a `>` follow, before the end of the statement or of what is open around it, behind which type arguments could have ended?
    /// Leaves the lexer where it is.
    #[cold]
    fn ts_type_arguments_may_end(&mut self) -> R<bool> {
        let m = self.mark();
        let mut depth: i32 = 0;
        let mut count: i32 = 0;
        let mut result = false;
        let mut is_read = false;
        loop {
            if !is_read && self.next().is_err() {
                // (a regular expression, or text of JSX, read as something else)
                if self.why.get() != why::SYNTAX {
                    return Err(Stop);
                }
                self.why.set(why::NONE);
                break;
            }
            is_read = false;
            count += 1;
            match self.lexer.tok {
                tk::ParenL | tk::BracketL | tk::BraceL => {
                    depth += 1;
                }
                tk::ParenR | tk::BracketR | tk::BraceR => {
                    depth -= 1;
                    if depth < 0 {
                        break;
                    }
                }
                tk::EOF => {
                    break;
                }
                tk::Semi => {
                    if depth == 0 {
                        break;
                    }
                }
                tk::Gt => {
                    if self.next().is_err() {
                        if self.why.get() != why::SYNTAX {
                            return Err(Stop);
                        }
                        self.why.set(why::NONE);
                        break;
                    }
                    if self.can_follow_type_arguments_in_expression() {
                        result = true;
                        break;
                    }
                    is_read = true;
                }
                // what is in a template is not read here
                tk::BackQuote => {
                    result = true;
                    break;
                }
                _ => {}
            }
            if count > 200 {
                break;
            }
        }
        self.rewind(m);
        return Ok(result);
    }

    /// `<T>(a: T): T => a`, tried. The current token is `<`.
    pub(crate) fn try_parse_generic_arrow(&mut self, start: i32, flags: i32) -> R<i32> {
        let m = self.mark();
        let list_top = self.arena.ls_pos;
        let context = self.save_context();
        let depth = self.parse.speculating;
        self.set_speculating(depth + 1);
        let mut result: i32 = 0;
        let v0 = (|| -> R<Option<i32>> {
            let type_parameters = self.ts_parse_type_parameters()?;
            let params = self.parse_params()?;
            let return_type = if self.lexer.tok == tk::Colon {
                self.ts_parse_arrow_return_type()?
            } else {
                0
            };
            if self.lexer.tok != tk::Arrow || self.lexer.tok_nl != 0 {
                return Err(self.unexpected());
            }
            self.set_speculating(depth);
            result =
                self.parse_typed_arrow_rest(start, params, flags, type_parameters, return_type)?;
            Ok(None)
        })();
        let v0 = match v0 {
            Err(Stop) => (|| -> R<Option<i32>> {
                if !(self.why.get() == why::SYNTAX) || self.parse.speculating == depth {
                    return Err(Stop);
                }
                result = 0;
                Ok(None)
            })(),
            ok => ok,
        };
        if let Some(v) = v0? {
            return Ok(v);
        }
        self.set_speculating(depth);
        if result == 0 {
            self.rewind(m);
            self.list_truncate(list_top);
            self.restore_context(context);
        } else {
            self.unmark(m);
        }
        return Ok(result);
    }

    /// In a file with JSX: does `<` start the type parameters of an arrow function?
    pub(crate) fn is_generic_arrow_in_jsx(&mut self) -> R<bool> {
        let m = self.mark();
        self.next()?;
        let mut result = false;
        if self.lexer.tok == tk::Const {
            self.next()?;
        }
        if self.lexer.tok == tk::Name {
            self.next()?;
            if self.lexer.tok == tk::Extends {
                self.next()?;
                result = self.lexer.tok != tk::Eq
                    && self.lexer.tok != tk::Gt
                    && self.lexer.tok != tk::Div;
            } else {
                result = self.lexer.tok == tk::Comma || self.lexer.tok == tk::Eq;
            }
        }
        self.rewind(m);
        return Ok(result);
    }

    /// `<` where an expression starts: an arrow function with type parameters, or a type assertion. 0 if it is neither, which
    /// leaves an element of JSX. With F_ASYNC in `flags`, `async` stood before it and only the function will do.
    pub(crate) fn ts_parse_less_than_expression(&mut self, start: i32, flags: i32) -> R<i32> {
        if self.parse.typed == FLOW {
            return self.try_parse_generic_arrow(start, flags);
        }
        if self.parse.jsx_enabled {
            if !self.is_generic_arrow_in_jsx()? {
                return Ok(0);
            }
            let arrow = self.try_parse_generic_arrow(start, flags)?;
            if arrow == 0 {
                return Err(self.text_refuse());
            }
            return Ok(arrow);
        }
        let arrow = self.try_parse_generic_arrow(start, flags)?;
        if arrow != 0 || flags != 0 {
            return Ok(arrow);
        }
        self.next()?;
        let type_ = if self.lexer.tok == tk::Const {
            self.const_type_reference()?
        } else {
            self.ts_parse_type()?
        };
        self.expect_gt()?;
        let expression = self.parse_maybe_unary()?;
        if self.is_bare_arrow(expression) {
            return Err(self.text_refuse());
        }
        // `<T>a++ ()`: nothing goes on behind it but what the operand has taken
        match self.lexer.tok {
            tk::Dot | tk::QuestionDot | tk::ParenL | tk::BracketL | tk::BackQuote | tk::Lt => {
                return Err(self.text_refuse());
            }
            tk::Not => {
                if self.lexer.tok_nl == 0 {
                    return Err(self.text_refuse());
                }
            }
            _ => {}
        }
        return Ok(self.node2(
            k::TypeAssertion,
            start,
            self.lexer.prev_end,
            type_,
            expression,
        ));
    }

    pub(crate) fn const_type_reference(&mut self) -> R<i32> {
        let name = self.identifier()?;
        return Ok(self.node2(
            k::TypeReference,
            self.n.at(name + 1),
            self.n.at(name + 2),
            name,
            0,
        ));
    }
}
