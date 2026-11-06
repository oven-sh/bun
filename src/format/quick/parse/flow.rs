//! Flow: types, declarations, components, hooks, enums, records and `match`. The tree is the one that flow-parser builds, as
//! far as Prettier looks at it, with the kinds of TypeScript wherever Prettier prints the two alike.

use crate::arena::SUB_SHIFT;
use crate::ast::{
    EB_BIGINT, EB_BOOLEAN, EB_NONE, EB_NUMBER, EB_STRING, EB_SYMBOL, F_ASYNC, F_CHAIN, F_CONST,
    F_EXACT, F_EXT, F_EXTENDS_BOUND, F_GENERATOR, F_INEXACT, F_METHOD, F_OPTIONAL, F_PROTO, F_REST,
    F_SHORTHAND, F_STATIC, F_THIS, IK_SHIFT, IK_TYPE, IK_TYPEOF, M_GET, M_METHOD, M_SET, MK_MODULE,
    MK_NAMESPACE, MOD_DECLARE, MT_MINUS, MT_NONE, MT_PLAIN, MT_PLUS, NT_NULLABLE, TO_KEYOF,
    TO_RENDERS, TO_RENDERS_MAYBE, TO_RENDERS_STAR, TP_ASSERTS, TP_IMPLIES, V_CONST, V_LET, V_VAR,
    VA_IN, VA_MINUS, VA_OUT, VA_PLUS, VA_READONLY, VA_WRITEONLY, k, type_keyword,
};
use crate::lexer::{C_START, C_STRIDE, kw, tk};
use crate::parse::core::SCOPE_FUNCTION;
use crate::words::w;
use crate::{Quick, R, Words, rare};

pub(crate) struct ParseFlow {
    /// `A => B` without parentheses is not a function type here: in the return type of an arrow function
    pub(crate) no_anon_function_type: i32,
    pub(crate) flow_no_conditional_types: i32,
    /// The `%checks` behind the return type that was parsed last.
    pub(crate) flow_predicate: i32,
    /// The type arguments that are parsed next are those of a type: there may be none between the `<` and the `>`.
    pub(crate) may_be_empty: bool,
    /// A type parameter has been read that the long way takes for none where a function could be an element of JSX: see
    /// try_parse_generic_arrow().
    pub(crate) has_odd_type_parameter: bool,
}
impl ParseFlow {
    pub(crate) fn new() -> Self {
        Self {
            no_anon_function_type: 0,
            flow_no_conditional_types: 0,
            flow_predicate: 0,
            may_be_empty: false,
            has_odd_type_parameter: false,
        }
    }
}

impl Quick {
    pub(crate) fn flow_take_predicate(&mut self) -> i32 {
        let predicate = self.parse_flow.flow_predicate;
        self.parse_flow.flow_predicate = 0;
        return predicate;
    }

    pub(crate) fn flow_reset_context(&mut self) {
        self.parse_flow.flow_predicate = 0;
        self.parse_flow.flow_no_conditional_types = 0;
        self.parse_flow.no_anon_function_type = 0;
        self.parse_flow.may_be_empty = false;
    }

    /// Called where syntax starts that flow-parser knows and Babel does not. (Where this is a trial, Babel goes on with something
    /// else, and the long way does not.)
    pub(crate) fn not_in_babel(&self) -> R<()> {
        if self.mode.is_babel_flow {
            return Err(self.text_refuse());
        }
        Ok(())
    }

    /// `|}`, which is one token in Flow.
    pub(crate) fn is_exact_end(&self) -> bool {
        return self.lexer.tok == tk::BitOr && self.t.at(self.lexer.tok_end) == 125;
    }

    // ------------------------------------------------------------------------------------------------------------- types
    pub(crate) fn flow_keyword(&mut self, which: i32) -> R<i32> {
        let n = self.node0(
            k::KeywordType | (which << SUB_SHIFT),
            self.lexer.tok_start,
            self.lexer.tok_end,
        );
        self.next()?;
        return Ok(n);
    }

    pub(crate) fn flow_parse_type(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        let type_ = self.flow_parse_union()?;
        if self.parse_flow.flow_no_conditional_types == 0 && self.lexer.tok == tk::Extends {
            self.not_in_babel()?;
            self.next()?;
            self.parse_flow.flow_no_conditional_types = 1;
            let extends_type = self.flow_parse_union()?;
            self.parse_flow.flow_no_conditional_types = 0;
            self.expect(tk::Question)?;
            let true_type = self.flow_parse_type()?;
            self.expect(tk::Colon)?;
            let false_type = self.flow_parse_type()?;
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

    pub(crate) fn flow_parse_union(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let has_leading_operator = self.lexer.tok == tk::BitOr && !self.is_exact_end();
        if has_leading_operator {
            self.next()?;
        }
        let first = self.flow_parse_intersection()?;
        if self.lexer.tok != tk::BitOr || self.is_exact_end() {
            // (for the long way there is a union, which is what comments next to it are given to)
            if has_leading_operator {
                return Err(self.rare(rare::FLOW));
            }
            return Ok(first);
        }
        let list_mark = self.arena.ls_pos;
        self.list_push(first);
        while self.lexer.tok == tk::BitOr && !self.is_exact_end() {
            self.next()?;
            let v0 = self.flow_parse_intersection()?;
            self.list_push(v0);
        }
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(list_mark);
        return Ok(self.node_l(k::UnionType, start, v1, v2));
    }

    pub(crate) fn flow_parse_intersection(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let has_leading_operator = self.eat(tk::BitAnd)?;
        let first = self.flow_parse_anon_function_without_parens()?;
        if self.lexer.tok != tk::BitAnd {
            if has_leading_operator {
                return Err(self.rare(rare::FLOW));
            }
            return Ok(first);
        }
        let list_mark = self.arena.ls_pos;
        self.list_push(first);
        while self.eat(tk::BitAnd)? {
            let v0 = self.flow_parse_anon_function_without_parens()?;
            self.list_push(v0);
        }
        let v1 = self.lexer.prev_end;
        let v2 = self.list_finish(list_mark);
        return Ok(self.node_l(k::IntersectionType, start, v1, v2));
    }

    pub(crate) fn flow_type_as_param(&mut self, type_: i32) -> i32 {
        return self.node2(
            k::FunctionTypeParam,
            self.n.at(type_ + 1),
            self.n.at(type_ + 2),
            0,
            type_,
        );
    }

    pub(crate) fn flow_parse_anon_function_without_parens(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let param = self.flow_parse_prefix()?;
        if self.parse_flow.no_anon_function_type == 0 && self.lexer.tok == tk::Arrow {
            self.next()?;
            let list_mark = self.arena.ls_pos;
            let v0 = self.flow_type_as_param(param);
            self.list_push(v0);
            let params = self.list_finish(list_mark);
            let return_type = self.flow_parse_return_type_of_function_type()?;
            return Ok(self.function_node(
                k::FunctionType,
                start,
                self.lexer.prev_end,
                0,
                0,
                params,
                0,
                0,
                return_type,
            ));
        }
        return Ok(param);
    }

    /// What stands behind the `=>` of a function type: a type or a type guard.
    pub(crate) fn flow_parse_return_type_of_function_type(&mut self) -> R<i32> {
        return self.flow_parse_type_or_guard();
    }

    pub(crate) fn flow_parse_type_or_guard(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        if self.lexer.tok == tk::Name || self.lexer.tok == tk::This {
            let mut kind: i32 = 0;
            let m = self.mark();
            let w = self.word();
            if w == w::Implies || w == w::Asserts {
                self.next()?;
                if (self.lexer.tok == tk::Name || self.lexer.tok == tk::This)
                    && self.lexer.tok_nl == 0
                    && self.word() != w::Is
                {
                    kind = if w == w::Implies {
                        TP_IMPLIES
                    } else {
                        TP_ASSERTS
                    };
                } else if self.word() == w::Is
                    || self.lexer.tok == tk::Name
                    || self.lexer.tok == tk::This
                {
                    // `asserts is A`; a name on the next line, which the long way takes for what is asserted
                    return Err(self.text_refuse());
                } else {
                    self.rewind(m);
                }
            }
            if self.lexer.tok == tk::Name || self.lexer.tok == tk::This {
                let name = self.identifier()?;
                // (on the next line: a guard for some parsers, a name for others)
                if self.word() == w::Is && self.lexer.tok_nl != 0 {
                    return Err(self.text_refuse());
                }
                if self.word() == w::Is {
                    self.not_in_babel()?;
                    self.next()?;
                    self.unmark(m);
                    let type_ = self.flow_parse_type()?;
                    return Ok(self.node2(
                        k::TypePredicate | (kind << SUB_SHIFT),
                        start,
                        self.lexer.prev_end,
                        name,
                        type_,
                    ));
                }
                if kind == TP_ASSERTS {
                    self.unmark(m);
                    return Ok(self.node2(
                        k::TypePredicate | (kind << SUB_SHIFT),
                        start,
                        self.lexer.prev_end,
                        name,
                        0,
                    ));
                }
            }
            self.rewind(m);
        }
        return self.flow_parse_type();
    }

    pub(crate) fn flow_parse_prefix(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        if self.lexer.tok == tk::Question {
            self.next()?;
            let type_ = self.flow_parse_prefix()?;
            return Ok(self.node1(
                k::NullableType | (NT_NULLABLE << SUB_SHIFT),
                start,
                self.lexer.prev_end,
                type_,
            ));
        }
        if self.lexer.tok == tk::Name {
            let w = self.word();
            if w == w::Keyof && self.flow_next_starts_type()? {
                self.not_in_babel()?;
                self.next()?;
                let type_ = self.flow_parse_prefix()?;
                return Ok(self.node1(
                    k::TypeOperator | (TO_KEYOF << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    type_,
                ));
            }
            if w == w::Renders && self.flow_next_starts_type()? {
                return self.flow_parse_renders();
            }
            if w == w::Infer && self.peek()? == tk::Name {
                self.not_in_babel()?;
                self.next()?;
                let name_start = self.lexer.tok_start;
                let name = self.identifier()?;
                let mut bound: i32 = 0;
                let mut flags: i32 = 0;
                if self.lexer.tok == tk::Extends {
                    // `infer T extends U ? a : b` is a conditional type with `infer T` in front, unless none can stand here
                    let m = self.mark();
                    self.next()?;
                    let bound_start = self.lexer.tok_start;
                    let saved = self.parse_flow.flow_no_conditional_types;
                    self.parse_flow.flow_no_conditional_types = 1;
                    let type_ = self.flow_parse_union()?;
                    self.parse_flow.flow_no_conditional_types = saved;
                    if saved == 0 && self.lexer.tok == tk::Question {
                        self.rewind(m);
                    } else {
                        self.unmark(m);
                        bound =
                            self.node1(k::TypeAnnotation, bound_start, self.lexer.prev_end, type_);
                        flags = F_EXTENDS_BOUND;
                    }
                }
                let parameter = self.node4(
                    k::TypeParameter | flags,
                    name_start,
                    self.lexer.prev_end,
                    name,
                    bound,
                    0,
                    0,
                );
                return Ok(self.node1(k::InferType, start, self.lexer.prev_end, parameter));
            }
            // an operator without an operand
            if w == w::Keyof || w == w::Renders || w == w::Infer {
                return Err(self.text_refuse());
            }
        }
        return self.flow_parse_postfix();
    }

    pub(crate) fn flow_next_starts_type(&mut self) -> R<bool> {
        match self.peek()? {
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
            | tk::BraceL
            | tk::BracketL
            | tk::ParenL
            | tk::Question
            | tk::Mul
            | tk::Sub
            | tk::Function
            | tk::Class
            | tk::Import => {
                return Ok(true);
            }
            _ => {}
        }
        return Ok(false);
    }

    /// `renders T`, `renders? T`, `renders* T`. The current token is `renders`.
    pub(crate) fn flow_parse_renders(&mut self) -> R<i32> {
        self.not_in_babel()?;
        let start = self.lexer.tok_start;
        let end = self.lexer.tok_end;
        self.next()?;
        let mut operator = TO_RENDERS;
        if self.lexer.tok_start == end && self.lexer.tok == tk::Question {
            operator = TO_RENDERS_MAYBE;
            self.next()?;
        } else if self.lexer.tok_start == end && self.lexer.tok == tk::Mul {
            operator = TO_RENDERS_STAR;
            self.next()?;
        }
        let type_ = self.flow_parse_prefix()?;
        return Ok(self.node1(
            k::TypeOperator | (operator << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            type_,
        ));
    }

    pub(crate) fn flow_parse_postfix(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut type_ = self.flow_parse_primary()?;
        let mut chain: i32 = 0;
        while (self.lexer.tok == tk::BracketL || self.lexer.tok == tk::QuestionDot)
            && self.lexer.tok_nl == 0
        {
            let optional = if self.eat(tk::QuestionDot)? {
                F_OPTIONAL
            } else {
                0
            };
            if optional != 0 {
                chain = F_CHAIN;
            }
            self.expect(tk::BracketL)?;
            if optional == 0 && self.lexer.tok == tk::BracketR {
                self.next()?;
                type_ = self.node1(k::ArrayType, start, self.lexer.prev_end, type_);
            } else {
                let saved = self.parse_flow.no_anon_function_type;
                self.parse_flow.no_anon_function_type = 0;
                let index = self.flow_parse_type()?;
                self.parse_flow.no_anon_function_type = saved;
                self.expect(tk::BracketR)?;
                type_ = self.node2(
                    k::IndexedAccessType | chain | optional,
                    start,
                    self.lexer.prev_end,
                    type_,
                    index,
                );
            }
        }
        return Ok(type_);
    }

    pub(crate) fn flow_parse_qualified(&mut self, _kind_of_first: i32) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut name = if self.is_word() {
            self.parse_ident_name()?
        } else {
            return Err(self.unexpected());
        };
        while self.lexer.tok == tk::Dot {
            self.next()?;
            let right = self.parse_ident_name()?;
            name = self.node2(k::QualifiedName, start, self.lexer.prev_end, name, right);
        }
        return Ok(name);
    }

    pub(crate) fn flow_parse_generic(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let name = self.flow_parse_qualified(0)?;
        let type_arguments = if self.lexer.tok == tk::Lt || self.lexer.tok == tk::Shl {
            self.flow_parse_type_arguments_in_type()?
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

    pub(crate) fn flow_parse_type_arguments_in_type(&mut self) -> R<i32> {
        let saved = self.parse_flow.no_anon_function_type;
        let saved_conditional = self.parse_flow.flow_no_conditional_types;
        self.parse_flow.flow_no_conditional_types = 0;
        self.parse_flow.no_anon_function_type = 0;
        self.parse_flow.may_be_empty = true;
        let type_arguments = self.ts_parse_type_arguments()?;
        self.parse_flow.no_anon_function_type = saved;
        self.parse_flow.flow_no_conditional_types = saved_conditional;
        return Ok(type_arguments);
    }

    pub(crate) fn flow_parse_function_type_param(&mut self, is_first: bool) -> R<i32> {
        let start = self.lexer.tok_start;
        if self.is_word() {
            let after = self.peek()?;
            if after == tk::Colon || after == tk::Question {
                let is_this = self.lexer.tok == tk::This && is_first;
                let name = self.parse_ident_name()?;
                let flags = if self.eat(tk::Question)? {
                    F_OPTIONAL
                } else {
                    0
                };
                self.expect(tk::Colon)?;
                let type_ = self.flow_parse_type()?;
                if is_this {
                    // (Prettier gives it parentheses)
                    if (self.n.at(type_) & 0xff) == k::FunctionType {
                        return Err(self.rare(rare::UNLIKE_PRETTIER));
                    }
                    return Ok(self.node2(
                        k::FunctionTypeParam | F_THIS,
                        start,
                        self.lexer.prev_end,
                        0,
                        type_,
                    ));
                }
                return Ok(self.node2(
                    k::FunctionTypeParam | flags,
                    start,
                    self.lexer.prev_end,
                    name,
                    type_,
                ));
            }
        }
        let type_ = self.flow_parse_type()?;
        return Ok(self.node2(k::FunctionTypeParam, start, self.lexer.prev_end, 0, type_));
    }

    /// The parameters of a function type up to the `)`, which stays. Those on the list stack from `list_mark` on come first.
    pub(crate) fn flow_parse_function_type_params(&mut self, list_mark: i32) -> R<i32> {
        let saved = self.parse_flow.no_anon_function_type;
        let saved_conditional = self.parse_flow.flow_no_conditional_types;
        self.parse_flow.flow_no_conditional_types = 0;
        self.parse_flow.no_anon_function_type = 0;
        while self.lexer.tok != tk::ParenR {
            if self.lexer.tok == tk::Ellipsis {
                self.next()?;
                // (`...this: A`: the long way drops the dots)
                if self.lexer.tok == tk::This {
                    return Err(self.rare(rare::UNLIKE_PRETTIER));
                }
                let rest = self.flow_parse_function_type_param(false)?;
                self.n.put(rest, self.n.at(rest) | F_REST);
                self.list_push(rest);
                self.eat(tk::Comma)?;
                break;
            }
            let v0 = self.flow_parse_function_type_param(self.arena.ls_pos == list_mark)?;
            self.list_push(v0);
            if self.lexer.tok != tk::ParenR {
                self.expect(tk::Comma)?;
            }
        }
        self.parse_flow.no_anon_function_type = saved;
        self.parse_flow.flow_no_conditional_types = saved_conditional;
        return Ok(self.list_finish(list_mark));
    }

    /// `<T>(params): return_type`, the type of a method or of a declared function. `start` is where the node starts.
    pub(crate) fn flow_parse_methodish_type(&mut self, start: i32, kind: i32) -> R<i32> {
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let open = self.lexer.tok_start;
        self.expect(tk::ParenL)?;
        let params = self.flow_parse_function_type_params(self.arena.ls_pos)?;
        let close = self.lexer.tok_start;
        self.expect(tk::ParenR)?;
        self.expect(tk::Colon)?;
        let return_type = self.flow_parse_type_or_guard()?;
        // The type starts where the member starts, so that a comment before or behind the parameters has two nodes to go to; and one
        // among them too, if the member starts before its key.
        let is_static = self.text_is(start, start + 6, b"static");
        let mut c = self.lexer.c_count - 1;
        while c >= self.lexer.c_base && self.lexer.c.at(c * C_STRIDE + C_START) >= start {
            let at = self.lexer.c.at(c * C_STRIDE + C_START);
            if at < open || (at < self.lexer.prev_end && (at > close || is_static)) {
                return Err(self.rare(rare::COMMENT));
            }
            c -= 1;
        }
        return Ok(self.function_node(
            kind,
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

    pub(crate) fn flow_parse_variance(&mut self) -> R<i32> {
        let which: i32;
        if self.lexer.tok == tk::Add {
            which = VA_PLUS;
        } else if self.lexer.tok == tk::Sub {
            which = VA_MINUS;
        } else if self.lexer.tok == tk::In || self.lexer.tok == tk::Name {
            let w = self.word();
            if self.lexer.tok == tk::In {
                which = VA_IN;
            } else if w == w::Readonly {
                which = VA_READONLY;
            } else if w == w::Writeonly {
                which = VA_WRITEONLY;
            } else if w == w::Out {
                which = VA_OUT;
            } else {
                return Ok(0);
            }
            if self.mode.is_babel_flow {
                return Ok(0);
            }
            // a keyword only before a key
            let after = self.peek()?;
            if !(after == tk::Name
                || after == tk::String
                || after == tk::Num
                || after == tk::BracketL
                || (after >= tk::In && after != tk::EOF && self.is_keyword_token(after)?))
            {
                return Ok(0);
            }
        } else {
            return Ok(0);
        }
        let n = self.node0(
            k::Variance | (which << SUB_SHIFT),
            self.lexer.tok_start,
            self.lexer.tok_end,
        );
        self.next()?;
        return Ok(n);
    }

    /// `+` or `-` before the key of a class property.
    pub(crate) fn flow_parse_variance_of_member(&mut self) -> R<i32> {
        if self.lexer.tok != tk::Add && self.lexer.tok != tk::Sub {
            return Ok(0);
        }
        return self.flow_parse_variance();
    }

    pub(crate) fn is_keyword_token(&mut self, t: i32) -> R<bool> {
        let saved = self.save();
        self.next()?;
        let result = self.lexer.tok == t && self.is_word();
        self.restore(saved);
        return Ok(result);
    }

    /// `[K in`. The current token is the `[`.
    fn flow_is_at_mapped_type(&mut self) -> R<bool> {
        let saved = self.save();
        self.next()?;
        let result = self.is_word() && self.peek()? == tk::In;
        self.restore(saved);
        return Ok(result);
    }

    pub(crate) fn flow_object_type_semicolon(&mut self) -> R<()> {
        if self.lexer.tok == tk::Semi || self.lexer.tok == tk::Comma {
            if self.lexer.tok_nl != 0 {
                return Err(self.rare(rare::SEMICOLON));
            }
            self.next()?;
        } else if self.lexer.tok != tk::BraceR && !self.is_exact_end() {
            return Err(self.unexpected());
        }
        Ok(())
    }

    /// `{ .. }` or `{| .. |}`. `kind`: K.TypeLiteral, or K.InterfaceBody for the body of an interface or a declared class.
    pub(crate) fn flow_parse_object_type(
        &mut self,
        kind: i32,
        allow_static: bool,
        allow_proto: bool,
    ) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut flags: i32 = 0;
        if self.lexer.tok != tk::BraceL {
            return Err(self.unexpected());
        }
        if self.t.at(self.lexer.tok_end) == 124 {
            flags = F_EXACT;
            self.set_pos(self.lexer.tok_end + 1);
        }
        self.next()?;
        let saved = self.parse_flow.no_anon_function_type;
        let saved_conditional = self.parse_flow.flow_no_conditional_types;
        self.parse_flow.flow_no_conditional_types = 0;
        self.parse_flow.no_anon_function_type = 0;
        let list_mark = self.arena.ls_pos;
        self.enter_list();
        while self.lexer.tok != tk::BraceR && !self.is_exact_end() {
            if self.lexer.tok == tk::EOF {
                return Err(self.unexpected());
            }
            if kind == k::TypeLiteral
                && (self.lexer.tok == tk::Name
                    || self.lexer.tok == tk::Add
                    || self.lexer.tok == tk::Sub)
                && self.parse_ready_type_properties()?
            {
                self.flow_object_type_semicolon()?;
                continue;
            }
            let member_start = self.lexer.tok_start;
            let mut head: i32 = 0;
            // One of the two at most. `proto` is the name of a method before `(` and `<`, `static` a modifier of a call property.
            if allow_proto && self.word() == w::Proto {
                let after = self.peek()?;
                if after != tk::Colon
                    && after != tk::Question
                    && after != tk::ParenL
                    && after != tk::Lt
                {
                    self.next()?;
                    head |= F_PROTO;
                }
            } else if allow_static && self.is_kw(kw::Static) {
                let after = self.peek()?;
                if after != tk::Colon && after != tk::Question {
                    self.next()?;
                    head |= F_STATIC;
                }
            }
            let variance = self.flow_parse_variance()?;
            // What only the long way prints: `proto` in front of anything but a property, a variance in front of `[[a]]`, a modifier
            // in front of `[K in T]`.
            if (head | variance) != 0 && self.lexer.tok == tk::BracketL {
                let after = self.peek()?;
                if (head & F_PROTO) != 0
                    || (variance != 0 && after == tk::BracketL)
                    || (head != 0 && self.flow_is_at_mapped_type()?)
                {
                    return Err(self.text_refuse());
                }
            }
            // `+` and `-` stand in front of a property or an indexer
            if variance != 0
                && (self.lexer.tok == tk::ParenL
                    || self.lexer.tok == tk::Lt
                    || self.lexer.tok == tk::Ellipsis)
            {
                return Err(self.unexpected());
            }
            // `in` and `out` are for type parameters
            if variance != 0 && ((self.n.at(variance) as u32) >> SUB_SHIFT) as i32 >= VA_IN {
                return Err(self.text_refuse());
            }
            if self.lexer.tok == tk::BracketL {
                self.next()?;
                if self.lexer.tok == tk::BracketL {
                    // [[slot]]
                    self.next()?;
                    let id = self.parse_ident_name()?;
                    self.expect(tk::BracketR)?;
                    self.expect(tk::BracketR)?;
                    let value: i32;
                    if self.lexer.tok == tk::Lt || self.lexer.tok == tk::ParenL {
                        head |= F_METHOD;
                        value = self.flow_parse_methodish_type(member_start, k::FunctionType)?;
                    } else {
                        if self.eat(tk::Question)? {
                            head |= F_OPTIONAL;
                        }
                        self.expect(tk::Colon)?;
                        value = self.flow_parse_type()?;
                    }
                    let v0 = self.node2(
                        k::ObjectTypeInternalSlot | head,
                        member_start,
                        self.lexer.prev_end,
                        id,
                        value,
                    );
                    self.list_push(v0);
                } else if self.is_word() && self.peek()? == tk::In {
                    // [K in T]: a mapped type
                    self.not_in_babel()?;
                    let name = self.identifier()?;
                    let parameter = self.node4(
                        k::TypeParameter,
                        self.n.at(name + 1),
                        self.n.at(name + 2),
                        name,
                        0,
                        0,
                        0,
                    );
                    self.expect(tk::In)?;
                    let source = self.flow_parse_type()?;
                    self.expect(tk::BracketR)?;
                    let mut optional = MT_NONE;
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
                    self.expect(tk::Colon)?;
                    let type_ = self.flow_parse_type()?;
                    let v1 = self.node4(
                        k::ObjectTypeMappedTypeProperty | (optional << SUB_SHIFT),
                        member_start,
                        self.lexer.prev_end,
                        parameter,
                        source,
                        type_,
                        variance,
                    );
                    self.list_push(v1);
                } else {
                    let mut id: i32 = 0;
                    if self.is_word() && self.peek()? == tk::Colon {
                        id = self.parse_ident_name()?;
                        self.next()?;
                    }
                    let key = self.flow_parse_type()?;
                    self.expect(tk::BracketR)?;
                    self.expect(tk::Colon)?;
                    let value = self.flow_parse_type()?;
                    let v2 = self.node4(
                        k::ObjectTypeIndexer | head,
                        member_start,
                        self.lexer.prev_end,
                        id,
                        key,
                        value,
                        variance,
                    );
                    self.list_push(v2);
                }
            } else if self.lexer.tok == tk::ParenL || self.lexer.tok == tk::Lt {
                let value = self.flow_parse_methodish_type(member_start, k::FunctionType)?;
                let v3 = self.node1(
                    k::ObjectTypeCallProperty | head,
                    member_start,
                    self.lexer.prev_end,
                    value,
                );
                self.list_push(v3);
            } else if self.lexer.tok == tk::Ellipsis {
                self.next()?;
                if self.lexer.tok == tk::BraceR
                    || self.is_exact_end()
                    || self.lexer.tok == tk::Comma
                    || self.lexer.tok == tk::Semi
                {
                    flags |= F_INEXACT;
                    if self.lexer.tok == tk::Comma || self.lexer.tok == tk::Semi {
                        self.next()?;
                    }
                    // the last thing in a type that is an object, and nothing else is printed alike by all
                    if kind != k::TypeLiteral
                        || (self.lexer.tok != tk::BraceR && !self.is_exact_end())
                    {
                        return Err(self.text_refuse());
                    }
                    continue;
                }
                // The long way does not read `...| A | B`; a spread in an interface or a declared class is printed in ways of its own.
                if self.lexer.tok == tk::BitOr || kind != k::TypeLiteral {
                    return Err(self.text_refuse());
                }
                let argument = self.flow_parse_type()?;
                let v4 = self.node1(
                    k::ObjectTypeSpreadProperty,
                    member_start,
                    self.lexer.prev_end,
                    argument,
                );
                self.list_push(v4);
            } else {
                let mut method = M_METHOD;
                if self.lexer.tok == tk::Name
                    && (self.lexer.tok_kw == kw::Get || self.lexer.tok_kw == kw::Set)
                {
                    let after = self.peek()?;
                    if after != tk::Colon
                        && after != tk::Question
                        && after != tk::ParenL
                        && after != tk::Lt
                    {
                        method = if self.lexer.tok_kw == kw::Get {
                            M_GET
                        } else {
                            M_SET
                        };
                        self.next()?;
                    }
                }
                let key: i32;
                if self.lexer.tok == tk::At {
                    // @@iterator
                    let key_start = self.lexer.tok_start;
                    self.next()?;
                    self.expect(tk::At)?;
                    if self.lexer.tok_start != key_start + 2 {
                        return Err(self.unexpected());
                    }
                    // (the long way drops `get` and `set` in front of it, and moves a comment from there behind the member)
                    if method != M_METHOD
                        || (self.lexer.c_count > self.lexer.c_base
                            && self
                                .lexer
                                .c
                                .at((self.lexer.c_count - 1) * C_STRIDE + C_START)
                                >= member_start)
                    {
                        return Err(self.rare(rare::UNLIKE_PRETTIER));
                    }
                    key = self.parse_ident_name()?;
                    self.n.put(key + 1, key_start);
                } else {
                    key = if self.lexer.tok == tk::String {
                        self.string_literal()?
                    } else {
                        if self.lexer.tok == tk::Num {
                            self.leaf(k::NumericLiteral)?
                        } else {
                            if self.lexer.tok == tk::BigInt {
                                self.leaf(k::BigIntLiteral)?
                            } else {
                                self.parse_ident_name()?
                            }
                        }
                    };
                }
                let value: i32;
                if self.lexer.tok == tk::Lt || self.lexer.tok == tk::ParenL {
                    if variance != 0 {
                        return Err(self.unexpected());
                    }
                    if method == M_METHOD {
                        head |= F_METHOD;
                    }
                    // (`"new"(): A`: the long way keeps the quotes)
                    if (self.n.at(key) & 0xff) == k::StringLiteral
                        && self.text_is(self.n.at(key + 1) + 1, self.n.at(key + 2) - 1, b"new")
                    {
                        return Err(self.rare(rare::UNLIKE_PRETTIER));
                    }
                    value = self.flow_parse_methodish_type(member_start, k::FunctionType)?;
                } else {
                    // `get a: A`
                    if method != M_METHOD {
                        return Err(self.unexpected());
                    }
                    if self.eat(tk::Question)? {
                        head |= F_OPTIONAL;
                    }
                    self.expect(tk::Colon)?;
                    value = self.flow_parse_type()?;
                }
                let v5 = self.node3(
                    k::ObjectTypeProperty | head | (method << SUB_SHIFT),
                    member_start,
                    self.lexer.prev_end,
                    key,
                    value,
                    variance,
                );
                self.list_push(v5);
            }
            self.flow_object_type_semicolon()?;
        }
        self.leave_list();
        self.parse_flow.no_anon_function_type = saved;
        self.parse_flow.flow_no_conditional_types = saved_conditional;
        // `{|` goes with `|}`
        if self.is_exact_end() != ((flags & F_EXACT) != 0) {
            return Err(self.unexpected());
        }
        if self.is_exact_end() {
            self.next()?;
        }
        self.next()?;
        let v6 = kind | flags;
        let v7 = self.lexer.prev_end;
        let v8 = self.list_finish(list_mark);
        return Ok(self.node_l(v6, start, v7, v8));
    }

    pub(crate) fn flow_parse_tuple(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::BracketL)?;
        let saved = self.parse_flow.no_anon_function_type;
        let saved_conditional = self.parse_flow.flow_no_conditional_types;
        self.parse_flow.flow_no_conditional_types = 0;
        self.parse_flow.no_anon_function_type = 0;
        let mut flags: i32 = 0;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BracketR {
            let element_start = self.lexer.tok_start;
            if self.lexer.tok == tk::Ellipsis {
                self.not_in_babel()?;
                self.next()?;
                if self.lexer.tok == tk::BracketR {
                    flags = F_INEXACT;
                    break;
                }
                let mut label: i32 = 0;
                if self.is_word() && self.peek()? == tk::Colon {
                    label = self.parse_ident_name()?;
                    self.next()?;
                }
                let type_ = self.flow_parse_type()?;
                let v0 = self.node2(
                    k::RestType,
                    element_start,
                    self.lexer.prev_end,
                    type_,
                    label,
                );
                self.list_push(v0);
            } else {
                let mut variance: i32 = 0;
                if self.lexer.tok == tk::Add || self.lexer.tok == tk::Sub {
                    let after = self.peek()?;
                    if after == tk::Name {
                        variance = self.flow_parse_variance()?;
                    } else if self.lexer.tok == tk::Sub {
                        // (the long way takes the sign for a variance and drops it)
                        return Err(self.rare(rare::UNLIKE_PRETTIER));
                    }
                } else if self.lexer.tok == tk::Name
                    && (self.word() == w::Readonly || self.word() == w::Writeonly)
                {
                    let after = self.peek()?;
                    if after == tk::Name {
                        variance = self.flow_parse_variance()?;
                    } else if after == tk::BracketL {
                        // (`[readonly []]`: the long way takes the word for a variance and drops it)
                        return Err(self.rare(rare::UNLIKE_PRETTIER));
                    }
                }
                let mut is_labeled = variance != 0;
                if !is_labeled && self.is_word() {
                    let saved = self.save();
                    self.next()?;
                    if self.lexer.tok == tk::Question {
                        self.next()?;
                    }
                    is_labeled = self.lexer.tok == tk::Colon;
                    self.restore(saved);
                }
                if is_labeled {
                    self.not_in_babel()?;
                    let label = self.parse_ident_name()?;
                    let optional = if self.eat(tk::Question)? {
                        F_OPTIONAL
                    } else {
                        0
                    };
                    self.expect(tk::Colon)?;
                    let type_ = self.flow_parse_type()?;
                    let v1 = self.node3(
                        k::NamedTupleMember | optional,
                        element_start,
                        self.lexer.prev_end,
                        label,
                        type_,
                        variance,
                    );
                    self.list_push(v1);
                } else {
                    let v2 = self.flow_parse_type()?;
                    self.list_push(v2);
                }
            }
            if self.lexer.tok != tk::BracketR {
                self.expect(tk::Comma)?;
            }
        }
        self.parse_flow.no_anon_function_type = saved;
        self.parse_flow.flow_no_conditional_types = saved_conditional;
        self.next()?;
        let v3 = k::TupleType | flags;
        let v4 = self.lexer.prev_end;
        let v5 = self.list_finish(list_mark);
        return Ok(self.node_l(v3, start, v4, v5));
    }

    pub(crate) fn flow_parse_typeof(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        let name = self.flow_parse_qualified(0)?;
        let type_arguments = if self.lexer.tok == tk::Lt && self.lexer.tok_nl == 0 {
            self.flow_parse_type_arguments_in_type()?
        } else {
            0
        };
        if type_arguments != 0 && self.n.at(self.n.at(type_arguments + 4)) == 0 {
            return Err(self.text_refuse());
        }
        return Ok(self.node2(
            k::TypeQuery,
            start,
            self.lexer.prev_end,
            name,
            type_arguments,
        ));
    }

    pub(crate) fn flow_parse_heritage_list(&mut self) -> R<i32> {
        let list_mark = self.arena.ls_pos;
        loop {
            let start = self.lexer.tok_start;
            if self.lexer.tok != tk::Name {
                return Err(self.unexpected());
            }
            // (the long way writes `boolean`)
            if self.word() == w::Bool {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            let id = self.flow_parse_qualified(0)?;
            let type_arguments = if self.lexer.tok == tk::Lt {
                self.flow_parse_type_arguments_in_type()?
            } else {
                0
            };
            // (of three names, the long way breaks the line before a `.` and drops `<>`; to it, `a.b<>` has no type arguments)
            if (self.n.at(id) & 0xff) == k::QualifiedName
                && ((self.n.at(self.n.at(id + 4)) & 0xff) == k::QualifiedName
                    || (type_arguments != 0 && self.n.at(self.n.at(type_arguments + 4)) == 0))
            {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            let v0 = self.node2(k::Heritage, start, self.lexer.prev_end, id, type_arguments);
            self.list_push(v0);
            if !self.eat(tk::Comma)? {
                break;
            }
        }
        return Ok(self.list_finish(list_mark));
    }

    /// `(params) => type`, the `(` being the current token or just eaten with some parameters read already.
    pub(crate) fn flow_finish_function_type(
        &mut self,
        start: i32,
        type_parameters: i32,
        list_mark: i32,
        kind: i32,
    ) -> R<i32> {
        let params = self.flow_parse_function_type_params(list_mark)?;
        self.expect(tk::ParenR)?;
        self.expect(tk::Arrow)?;
        let return_type = self.flow_parse_return_type_of_function_type()?;
        return Ok(self.function_node(
            kind,
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

    pub(crate) fn flow_parse_component_type(&mut self, start: i32) -> R<i32> {
        self.not_in_babel()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        self.expect(tk::ParenL)?;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::ParenR {
            let param_start = self.lexer.tok_start;
            if self.lexer.tok == tk::Ellipsis {
                self.next()?;
                let mut name: i32 = 0;
                let mut flags = F_REST;
                if self.is_word() {
                    let after = self.peek()?;
                    if after == tk::Colon || after == tk::Question {
                        name = self.parse_ident_name()?;
                        if self.eat(tk::Question)? {
                            flags |= F_OPTIONAL;
                        }
                        self.expect(tk::Colon)?;
                    }
                }
                let type_ = self.flow_parse_type_fresh()?;
                let v0 = self.node2(
                    k::ComponentTypeParameter | flags,
                    param_start,
                    self.lexer.prev_end,
                    name,
                    type_,
                );
                self.list_push(v0);
                // the last one, without a comma
                if self.lexer.tok != tk::ParenR {
                    return Err(self.unexpected());
                }
            } else {
                let name = if self.lexer.tok == tk::String {
                    self.string_literal()?
                } else {
                    self.parse_ident_name()?
                };
                let flags = if self.eat(tk::Question)? {
                    F_OPTIONAL
                } else {
                    0
                };
                self.expect(tk::Colon)?;
                let type_ = self.flow_parse_type_fresh()?;
                let v1 = self.node2(
                    k::ComponentTypeParameter | flags,
                    param_start,
                    self.lexer.prev_end,
                    name,
                    type_,
                );
                self.list_push(v1);
            }
            if self.lexer.tok != tk::ParenR {
                self.expect(tk::Comma)?;
            }
        }
        self.next()?;
        let params = self.list_finish(list_mark);
        let renders = if self.word() == w::Renders {
            self.flow_parse_renders()?
        } else {
            0
        };
        return Ok(self.function_node(
            k::ComponentTypeAnnotation,
            start,
            self.lexer.prev_end,
            0,
            0,
            params,
            0,
            type_parameters,
            renders,
        ));
    }

    pub(crate) fn flow_parse_primary(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        match self.lexer.tok {
            tk::BraceL => {
                return self.flow_parse_object_type(k::TypeLiteral, false, false);
            }
            tk::BracketL => {
                return self.flow_parse_tuple();
            }
            tk::Lt => {
                let type_parameters = self.ts_parse_type_parameters()?;
                self.expect(tk::ParenL)?;
                return self.flow_finish_function_type(
                    start,
                    type_parameters,
                    self.arena.ls_pos,
                    k::FunctionType,
                );
            }
            tk::ParenL => {
                {
                    self.next()?;
                    let list_mark = self.arena.ls_pos;
                    if self.lexer.tok != tk::ParenR && self.lexer.tok != tk::Ellipsis {
                        let mut is_grouped_type = true;
                        if self.is_word() {
                            let after = self.peek()?;
                            is_grouped_type = after != tk::Question && after != tk::Colon;
                        }
                        if is_grouped_type {
                            let saved = self.parse_flow.no_anon_function_type;
                            let saved_conditional = self.parse_flow.flow_no_conditional_types;
                            self.parse_flow.flow_no_conditional_types = 0;
                            self.parse_flow.no_anon_function_type = 0;
                            let type_ = self.flow_parse_type()?;
                            self.parse_flow.no_anon_function_type = saved;
                            self.parse_flow.flow_no_conditional_types = saved_conditional;
                            // a `,` or `) =>` means that this was the first parameter of a function type
                            if self.parse_flow.no_anon_function_type != 0
                                || !(self.lexer.tok == tk::Comma
                                    || (self.lexer.tok == tk::ParenR && self.peek()? == tk::Arrow))
                            {
                                self.expect(tk::ParenR)?;
                                return Ok(type_);
                            }
                            self.eat(tk::Comma)?;
                            let v0 = self.flow_type_as_param(type_);
                            self.list_push(v0);
                        }
                    }
                    return self.flow_finish_function_type(start, 0, list_mark, k::FunctionType);
                }
            }
            tk::String => {
                let v1 = self.leaf(k::StringLiteral)?;
                return Ok(self.literal_type(v1));
            }
            tk::Num => {
                let v2 = self.leaf(k::NumericLiteral)?;
                return Ok(self.literal_type(v2));
            }
            tk::BigInt => {
                let v3 = self.leaf(k::BigIntLiteral)?;
                return Ok(self.literal_type(v3));
            }
            tk::True | tk::False => {
                let v4 = self.leaf(k::BooleanLiteral)?;
                return Ok(self.literal_type(v4));
            }
            tk::Sub => {
                {
                    self.next()?;
                    if self.lexer.tok != tk::Num && self.lexer.tok != tk::BigInt {
                        return Err(self.unexpected());
                    }
                    if self.lexer.tok_start != start + 1 {
                        return Err(self.text_refuse());
                    }
                    // one literal with the sign
                    let literal = self.node0(
                        if self.lexer.tok == tk::Num {
                            k::NumericLiteral
                        } else {
                            k::BigIntLiteral
                        },
                        start,
                        self.lexer.tok_end,
                    );
                    self.next()?;
                    return Ok(self.literal_type(literal));
                }
            }
            tk::Void => {
                return self.flow_keyword(type_keyword::Void);
            }
            tk::Null => {
                return self.flow_keyword(type_keyword::Null);
            }
            tk::This => {
                return self.flow_keyword(type_keyword::This);
            }
            tk::Mul => {
                return self.flow_keyword(type_keyword::All);
            }
            tk::Typeof => {
                return self.flow_parse_typeof();
            }
            tk::Name => {
                match self.word() {
                    w::Any => {
                        return self.flow_keyword_or_generic(type_keyword::Any);
                    }
                    w::Bool | w::Boolean => {
                        return self.flow_keyword_or_generic(type_keyword::Boolean);
                    }
                    w::Mixed => {
                        return self.flow_keyword_or_generic(type_keyword::Mixed);
                    }
                    w::Empty => {
                        return self.flow_keyword_or_generic(type_keyword::Empty);
                    }
                    w::Number => {
                        return self.flow_keyword_or_generic(type_keyword::Number);
                    }
                    w::String => {
                        return self.flow_keyword_or_generic(type_keyword::String);
                    }
                    w::Symbol => {
                        return self.flow_keyword_or_generic(type_keyword::Symbol);
                    }
                    w::Bigint => {
                        return self.flow_keyword_or_generic(type_keyword::BigInt);
                    }
                    w::Never => {
                        return self.flow_keyword_or_generic(type_keyword::Never);
                    }
                    w::Undefined => {
                        return self.flow_keyword_or_generic(type_keyword::Undefined);
                    }
                    w::Unknown => {
                        return self.flow_keyword_or_generic(type_keyword::Unknown);
                    }
                    w::Interface => {
                        let after = self.peek()?;
                        if after == tk::BraceL || after == tk::Extends {
                            self.next()?;
                            let extended = if self.eat(tk::Extends)? {
                                self.flow_parse_heritage_list()?
                            } else {
                                0
                            };
                            let body = self.flow_parse_object_type(k::TypeLiteral, false, false)?;
                            let n = self.class_node(
                                k::InterfaceType,
                                start,
                                self.lexer.prev_end,
                                0,
                                0,
                                body,
                                0,
                            );
                            self.set_list(n, 11, extended);
                            return Ok(n);
                        }
                        return Err(self.text_refuse());
                    }
                    w::Component => {
                        let after = self.peek()?;
                        if after == tk::ParenL || after == tk::Lt {
                            self.next()?;
                            return self.flow_parse_component_type(start);
                        }
                        return Err(self.text_refuse());
                    }
                    w::Hook => {
                        let after = self.peek()?;
                        if after == tk::ParenL || after == tk::Lt {
                            self.not_in_babel()?;
                            self.next()?;
                            let hook_start = self.lexer.tok_start;
                            let type_parameters = if self.lexer.tok == tk::Lt {
                                self.ts_parse_type_parameters()?
                            } else {
                                0
                            };
                            self.expect(tk::ParenL)?;
                            return self.flow_finish_function_type(
                                hook_start,
                                type_parameters,
                                self.arena.ls_pos,
                                k::HookTypeAnnotation,
                            );
                        }
                    }
                    _ => {}
                }
                return self.flow_parse_generic();
            }
            _ => {}
        }
        if self.is_word() {
            return self.flow_parse_generic();
        }
        return Err(self.unexpected());
    }

    pub(crate) fn flow_keyword_or_generic(&mut self, which: i32) -> R<i32> {
        let after = self.peek()?;
        // `number.a`, `number<A>`
        if after == tk::Dot || after == tk::Lt {
            return Err(self.text_refuse());
        }
        return self.flow_keyword(which);
    }

    pub(crate) fn flow_parse_type_parameter(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let mut flags: i32 = 0;
        if self.lexer.tok == tk::Const {
            self.not_in_babel()?;
            flags |= F_CONST;
            self.next()?;
        }
        let mut variance: i32 = 0;
        if self.lexer.tok == tk::Add
            || self.lexer.tok == tk::Sub
            || self.lexer.tok == tk::In
            || (self.word() == w::Out && self.peek()? == tk::Name)
        {
            if self.lexer.tok != tk::Add && self.lexer.tok != tk::Sub {
                self.not_in_babel()?;
            }
            let which = if self.lexer.tok == tk::Add {
                VA_PLUS
            } else {
                if self.lexer.tok == tk::Sub {
                    VA_MINUS
                } else {
                    if self.lexer.tok == tk::In {
                        VA_IN
                    } else {
                        VA_OUT
                    }
                }
            };
            variance = self.node0(
                k::Variance | (which << SUB_SHIFT),
                self.lexer.tok_start,
                self.lexer.tok_end,
            );
            self.next()?;
        }
        if variance != 0 || self.lexer.tok != tk::Name || self.lexer.tok_kw == kw::Enum {
            self.parse_flow.has_odd_type_parameter = true;
        }
        let name = self.parse_ident_name()?;
        let mut bound: i32 = 0;
        let mut default_type: i32 = 0;
        if self.lexer.tok == tk::Colon {
            let bound_start = self.lexer.tok_start;
            self.next()?;
            let type_ = self.flow_parse_type()?;
            // (the long way breaks the parameters of a function type in this place, Prettier what it returns)
            if (self.n.at(type_) & 0xff) == k::FunctionType {
                return Err(self.rare(rare::FLOW));
            }
            bound = self.node1(k::TypeAnnotation, bound_start, self.lexer.prev_end, type_);
        } else if self.lexer.tok == tk::Extends {
            // (Babel does not note the difference, and the long way does)
            if self.mode.is_babel_flow {
                return Err(self.text_refuse());
            }
            self.next()?;
            let bound_start = self.lexer.tok_start;
            let type_ = self.flow_parse_type()?;
            bound = self.node1(k::TypeAnnotation, bound_start, self.lexer.prev_end, type_);
            flags |= F_EXTENDS_BOUND;
        }
        if self.eat(tk::Eq)? {
            default_type = self.flow_parse_type()?;
        }
        return Ok(self.node4(
            k::TypeParameter | flags,
            start,
            self.lexer.prev_end,
            name,
            bound,
            default_type,
            variance,
        ));
    }

    /// `%checks` or `%checks(expression)`. The current token is `%`; `start` is where the node starts.
    pub(crate) fn flow_parse_predicate(&mut self, start: i32) -> R<i32> {
        self.expect(tk::Mod)?;
        if self.word() != w::Checks {
            return Err(self.unexpected());
        }
        self.next()?;
        let mut value: i32 = 0;
        // (on whatever line the `(` stands)
        if self.lexer.tok == tk::ParenL {
            self.next()?;
            value = self.parse_maybe_assign()?;
            self.expect(tk::ParenR)?;
        }
        return Ok(self.node1(k::Predicate, start, self.lexer.prev_end, value));
    }

    /// `: type`, `: type %checks`, `: %checks` behind the parameters of a function; `is_arrow`: of an arrow function.
    pub(crate) fn flow_parse_return_type(&mut self, is_arrow: bool) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::Colon)?;
        self.parse_flow.flow_predicate = 0;
        if self.lexer.tok == tk::Mod {
            self.parse_flow.flow_predicate = self.flow_parse_predicate(start)?;
            return Ok(0);
        }
        let saved = self.parse_flow.no_anon_function_type;
        let saved_conditional = self.parse_flow.flow_no_conditional_types;
        self.parse_flow.no_anon_function_type = if is_arrow { 1 } else { 0 };
        self.parse_flow.flow_no_conditional_types = 0;
        let type_ = self.flow_parse_type_or_guard()?;
        self.parse_flow.no_anon_function_type = saved;
        self.parse_flow.flow_no_conditional_types = saved_conditional;
        let annotation = self.node1(k::TypeAnnotation, start, self.lexer.prev_end, type_);
        if self.lexer.tok == tk::Mod {
            self.parse_flow.flow_predicate = self.flow_parse_predicate(self.lexer.tok_start)?;
        }
        return Ok(annotation);
    }

    /// Runs flow_parse_type() as at the start of an annotation: nothing of the context around it matters.
    pub(crate) fn flow_parse_type_fresh(&mut self) -> R<i32> {
        let saved = self.parse_flow.no_anon_function_type;
        let saved_conditional = self.parse_flow.flow_no_conditional_types;
        self.parse_flow.flow_no_conditional_types = 0;
        self.parse_flow.no_anon_function_type = 0;
        let type_ = self.flow_parse_type()?;
        self.parse_flow.no_anon_function_type = saved;
        self.parse_flow.flow_no_conditional_types = saved_conditional;
        return Ok(type_);
    }

    // ------------------------------------------------------------------------------------------------------ declarations
    pub(crate) fn flow_parse_type_alias(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.next()?;
        // not the name of a type that is there already
        match self.word() {
            w::Any
            | w::Bool
            | w::Boolean
            | w::Bigint
            | w::Empty
            | w::Interface
            | w::Mixed
            | w::Number
            | w::Static
            | w::String
            | w::Symbol => {
                return Err(self.text_refuse());
            }
            _ => {}
        }
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        self.expect(tk::Eq)?;
        let type_ = self.flow_parse_type_fresh()?;
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

    /// The current token is `opaque`.
    /// `a.b.c`
    fn is_reference_with_dots(&self, n: i32) -> bool {
        let name = self.n.at(n + 4);
        (self.n.at(n) & 0xff) == k::TypeReference
            && (self.n.at(name) & 0xff) == k::QualifiedName
            && (self.n.at(self.n.at(name + 4)) & 0xff) == k::QualifiedName
    }

    pub(crate) fn flow_parse_opaque_type(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.next()?;
        self.next()?;
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let mut supertype: i32 = 0;
        let mut lower: i32 = 0;
        let mut upper: i32 = 0;
        let mut impl_: i32 = 0;
        if self.eat(tk::Colon)? {
            // (`| A`, `(| A)`: the long way writes `extends` for the `:` then)
            if self.lexer.tok == tk::BitOr || self.lexer.tok == tk::ParenL {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            supertype = self.flow_parse_type_fresh()?;
        }
        if self.lexer.tok == tk::Super || self.lexer.tok == tk::Extends {
            self.not_in_babel()?;
        }
        if self.eat(tk::Super)? {
            self.parse_flow.flow_no_conditional_types = 1;
            lower = self.flow_parse_union()?;
            self.parse_flow.flow_no_conditional_types = 0;
        }
        if self.eat(tk::Extends)? {
            upper = self.flow_parse_type_fresh()?;
        }
        if self.eat(tk::Eq)? {
            impl_ = self.flow_parse_type_fresh()?;
        }
        // (the long way breaks the line before a `.`)
        if self.is_reference_with_dots(supertype) || self.is_reference_with_dots(impl_) {
            return Err(self.rare(rare::UNLIKE_PRETTIER));
        }
        self.semicolon()?;
        let n = self.node_raw(
            k::OpaqueType | (modifiers << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            6,
        );
        self.set_child(n, 4, id);
        self.set_child(n, 5, type_parameters);
        self.set_child(n, 6, supertype);
        self.set_child(n, 7, lower);
        self.set_child(n, 8, upper);
        self.set_child(n, 9, impl_);
        return Ok(n);
    }

    /// The current token is `interface` or, for a declared class, `class`.
    pub(crate) fn flow_parse_interfaceish(
        &mut self,
        start: i32,
        kind: i32,
        modifiers: i32,
    ) -> R<i32> {
        self.next()?;
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let is_class = kind == k::DeclareClass;
        let extended = if self.eat(tk::Extends)? {
            self.flow_parse_heritage_list()?
        } else {
            0
        };
        // a class has one superclass
        if is_class && extended != 0 && self.n.at(extended) > 1 {
            return Err(self.text_refuse());
        }
        let mut mixins: i32 = 0;
        let mut implemented: i32 = 0;
        if is_class {
            if self.word() == w::Mixins {
                self.next()?;
                mixins = self.flow_parse_heritage_list()?;
            }
            if self.word() == w::Implements {
                self.next()?;
                implemented = self.flow_parse_heritage_list()?;
            }
        }
        let body = self.flow_parse_object_type(k::InterfaceBody, is_class, is_class)?;
        let n = self.class_node(
            kind | (modifiers << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            0,
            body,
            0,
        );
        self.set_list(n, 8, implemented);
        self.set_child(n, 9, type_parameters);
        self.set_list(n, 11, extended);
        self.set_list(n, 12, mixins);
        return Ok(n);
    }

    /// `implements A, B<C>` of a class, or nothing: the list.
    pub(crate) fn flow_parse_class_implements(&mut self) -> R<i32> {
        if self.word() != w::Implements {
            return Ok(0);
        }
        self.next()?;
        let list = self.flow_parse_heritage_list()?;
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            if (self.n.at(self.n.at(self.n.at(list + i) + 4)) & 0xff) == k::QualifiedName {
                return Err(self.rare(rare::FLOW));
            }
            i += 1;
        }
        return Ok(list);
    }

    /// The current token is `enum`.
    pub(crate) fn flow_parse_enum(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.next()?;
        let id = self.parse_ident()?;
        let body_start = self.lexer.tok_start;
        let mut explicit_type = EB_NONE;
        if self.is_kw(kw::Of) {
            self.next()?;
            match self.word() {
                w::Boolean => {
                    explicit_type = EB_BOOLEAN;
                }
                w::Number => {
                    explicit_type = EB_NUMBER;
                }
                w::Bigint => {
                    explicit_type = EB_BIGINT;
                }
                w::String => {
                    explicit_type = EB_STRING;
                }
                w::Symbol => {
                    explicit_type = EB_SYMBOL;
                }
                _ => {
                    return Err(self.unexpected());
                }
            }
            self.next()?;
        }
        self.expect(tk::BraceL)?;
        let mut flags: i32 = 0;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            if self.lexer.tok == tk::Ellipsis {
                self.next()?;
                flags = F_INEXACT;
                break;
            }
            let member_start = self.lexer.tok_start;
            let key = self.parse_ident_name()?;
            let init = if self.eat(tk::Eq)? {
                self.parse_maybe_assign()?
            } else {
                0
            };
            let v0 = self.node2(k::EnumMember, member_start, self.lexer.prev_end, key, init);
            self.list_push(v0);
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.expect(tk::BraceR)?;
        let v1 = k::EnumBody | flags | (explicit_type << SUB_SHIFT);
        let v2 = self.lexer.prev_end;
        let v3 = self.list_finish(list_mark);
        let body = self.node_l(v1, body_start, v2, v3);
        return Ok(self.node2(
            k::EnumDeclaration | (modifiers << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            body,
        ));
    }

    /// The parameters of a component declaration; the current token is `(`.
    pub(crate) fn flow_parse_component_params(&mut self) -> R<i32> {
        self.expect(tk::ParenL)?;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::ParenR {
            if self.lexer.tok == tk::Ellipsis {
                let v0 = self.parse_binding_element()?;
                self.list_push(v0);
                self.eat(tk::Comma)?;
                break;
            }
            let start = self.lexer.tok_start;
            if self.lexer.tok == tk::At {
                return Err(self.unexpected());
            }
            if self.lexer.tok == tk::String || (self.is_word() && self.peek_is_as()?) {
                let name = if self.lexer.tok == tk::String {
                    self.string_literal()?
                } else {
                    self.parse_ident_name()?
                };
                if !self.is_kw(kw::As) {
                    return Err(self.unexpected());
                }
                self.next()?;
                if self.lexer.tok == tk::This {
                    return Err(self.unexpected());
                }
                let local = self.parse_binding_element()?;
                let v1 = self.node2(
                    k::ComponentParameter,
                    start,
                    self.lexer.prev_end,
                    name,
                    local,
                );
                self.list_push(v1);
            } else {
                if self.lexer.tok == tk::This {
                    return Err(self.unexpected());
                }
                let name = self.node0(k::Identifier, self.lexer.tok_start, self.lexer.tok_end);
                let local = self.parse_binding_element()?;
                let v2 = self.node2(
                    k::ComponentParameter | F_SHORTHAND,
                    start,
                    self.lexer.prev_end,
                    name,
                    local,
                );
                self.list_push(v2);
            }
            if self.lexer.tok != tk::ParenR {
                self.expect(tk::Comma)?;
            }
        }
        self.expect(tk::ParenR)?;
        return Ok(self.list_finish(list_mark));
    }

    /// Is each of the parameters of a component a name with a type, as in the type of a component? To the long way those of a
    /// declared component are types: no other name for the inside, no pattern, no default value.
    fn flow_are_declared_parameters(&self, params: i32) -> bool {
        let mut i: i32 = 1;
        while i <= self.n.at(params) {
            let parameter = self.n.at(params + i);
            let head = self.n.at(parameter);
            let local = match head & 0xff {
                k::ComponentParameter if (head & F_SHORTHAND) != 0 => self.n.at(parameter + 5),
                k::RestElement => self.n.at(parameter + 4),
                _ => return false,
            };
            if (self.n.at(local) & (0xff | F_EXT)) != (k::Identifier | F_EXT) {
                return false;
            }
            // (the type of a function is laid out like that of a parameter by one way and like that of a property by the other)
            let annotation = self.n.at(local + 4);
            if (self.n.at(self.n.at(annotation + 4)) & 0xff) == k::FunctionType {
                return false;
            }
            i += 1;
        }
        return true;
    }

    pub(crate) fn peek_is_as(&mut self) -> R<bool> {
        let saved = self.save();
        self.next()?;
        let result = self.is_kw(kw::As);
        self.restore(saved);
        return Ok(result);
    }

    /// The current token is `component`.
    pub(crate) fn flow_parse_component(&mut self, start: i32, mut kind: i32, head: i32) -> R<i32> {
        self.not_in_babel()?;
        self.next()?;
        if self.is_kw(kw::As) {
            return Err(self.text_refuse());
        }
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let suspensions = self.parse.suspensions;
        let params = self.flow_parse_component_params()?;
        // `await` and `yield` among the parameters
        if self.parse.suspensions != suspensions {
            return Err(self.text_refuse());
        }
        let renders = if self.word() == w::Renders {
            self.flow_parse_renders()?
        } else {
            0
        };
        let mut body: i32 = 0;
        if kind == k::ComponentDeclaration && self.lexer.tok == tk::BraceL {
            let outer_scope = self.parse.place.scope;
            self.parse.place.scope = SCOPE_FUNCTION;
            body = self.parse_function_body(head & F_ASYNC)?;
            self.parse.place.scope = outer_scope;
            if self.n.at(self.n.at(body + 4)) != 0
                && self.has_use_strict(body)
                && !self.flow_are_declared_parameters(params)
            {
                return Err(self.text_refuse());
            }
        } else {
            // without a body it is declared, with or without the word
            kind = k::DeclareComponent;
            if !self.flow_are_declared_parameters(params) {
                return Err(self.text_refuse());
            }
            self.semicolon()?;
        }
        return Ok(self.function_node(
            kind | head,
            start,
            self.lexer.prev_end,
            id,
            body,
            params,
            0,
            type_parameters,
            renders,
        ));
    }

    /// The current token is `hook`.
    pub(crate) fn flow_parse_hook(&mut self, start: i32, flags: i32) -> R<i32> {
        self.not_in_babel()?;
        self.next()?;
        if self.is_kw(kw::As) {
            return Err(self.text_refuse());
        }
        let id = self.parse_ident()?;
        return self.parse_method_rest(k::HookDeclaration | flags, start, id, 0);
    }

    /// `name<T>(params): type`, as a name with the type of a function for its annotation.
    pub(crate) fn flow_parse_declared_function_name(&mut self, kind: i32) -> R<i32> {
        let id = self.parse_ident()?;
        let type_start = self.lexer.tok_start;
        let type_ = self.flow_parse_methodish_type(type_start, kind)?;
        let annotation = self.node1(k::TypeAnnotation, type_start, self.lexer.prev_end, type_);
        self.n.put(id, self.n.at(id) | F_EXT);
        self.set_child(id, 4, annotation);
        self.n.put(id + 2, self.lexer.prev_end);
        return Ok(id);
    }

    pub(crate) fn flow_parse_declare_function(&mut self, start: i32, modifiers: i32) -> R<i32> {
        self.next()?;
        let id = self.flow_parse_declared_function_name(k::FunctionType)?;
        let mut predicate: i32 = 0;
        if self.lexer.tok == tk::Mod {
            predicate = self.flow_parse_predicate(self.lexer.tok_start)?;
        }
        self.semicolon()?;
        return Ok(self.node2(
            k::DeclareFunction | (modifiers << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
            predicate,
        ));
    }

    pub(crate) fn flow_parse_declare_variable(
        &mut self,
        start: i32,
        kind: i32,
        modifiers: i32,
    ) -> R<i32> {
        let declaration = self.parse_var_statement(start, kind)?;
        self.n.put(
            declaration,
            self.n.at(declaration) | (modifiers << SUB_SHIFT),
        );
        return Ok(declaration);
    }

    /// What can follow `declare`, or `declare export` (then `modifiers` is 0). 0 if it is nothing of the kind.
    pub(crate) fn flow_parse_declared(&mut self, start: i32, modifiers: i32) -> R<i32> {
        match self.lexer.tok {
            tk::Class => {
                return self.flow_parse_interfaceish(start, k::DeclareClass, modifiers);
            }
            tk::Function => {
                return self.flow_parse_declare_function(start, modifiers);
            }
            tk::Var => {
                return self.flow_parse_declare_variable(start, V_VAR, modifiers);
            }
            tk::Const => {
                self.not_in_babel()?;
                return self.flow_parse_declare_variable(start, V_CONST, modifiers);
            }
            _ => {}
        }
        if self.is_kw(kw::Let) {
            self.not_in_babel()?;
            return self.flow_parse_declare_variable(start, V_LET, modifiers);
        }
        match self.word() {
            w::Type => {
                self.flow_check_same_line()?;
                return self.flow_parse_type_alias(start, modifiers);
            }
            w::Opaque => {
                self.flow_check_same_line()?;
                if !self.peek_is_word(w::Type)? {
                    return Err(self.unexpected());
                }
                return self.flow_parse_opaque_type(start, modifiers);
            }
            w::Interface => {
                self.flow_check_same_line()?;
                return self.flow_parse_interfaceish(start, k::InterfaceDeclaration, modifiers);
            }
            w::Enum => {
                self.not_in_babel()?;
                self.flow_check_same_line()?;
                return self.flow_parse_enum(start, modifiers);
            }
            w::Component => {
                self.flow_check_same_line()?;
                return self.flow_parse_component(
                    start,
                    k::DeclareComponent,
                    modifiers << SUB_SHIFT,
                );
            }
            w::Hook => {
                self.not_in_babel()?;
                self.flow_check_same_line()?;
                self.next()?;
                let id = self.flow_parse_declared_function_name(k::HookTypeAnnotation)?;
                self.semicolon()?;
                return Ok(self.node1(
                    k::DeclareHook | (modifiers << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    id,
                ));
            }
            _ => {}
        }
        return Ok(0);
    }

    /// The current token is the `export` behind `declare`.
    pub(crate) fn flow_parse_declare_export(&mut self, start: i32) -> R<i32> {
        self.next()?;
        let declare = MOD_DECLARE << SUB_SHIFT;
        if self.eat(tk::Default)? {
            if self.is_second_default_export(start) {
                return Err(self.text_refuse());
            }
            let declaration: i32;
            if self.lexer.tok == tk::Class
                || self.lexer.tok == tk::Function
                || (self.word() == w::Component && self.peek()? == tk::Name)
                || (self.word() == w::Hook && self.peek()? == tk::Name)
            {
                declaration = self.flow_parse_declared(self.lexer.tok_start, 0)?;
            } else {
                // (the long way expects a declaration behind `interface`)
                if self.word() == w::Interface {
                    return Err(self.text_refuse());
                }
                declaration = self.flow_parse_type_fresh()?;
                // (`A => B`: the long way does not break its parameters)
                if (self.n.at(declaration) & 0xff) == k::FunctionType
                    && self
                        .has_one_simple_type_as_parameters(declaration, self.n.at(declaration + 6))
                {
                    return Err(self.rare(rare::FLOW));
                }
                self.semicolon()?;
            }
            return Ok(self.node1(
                k::ExportDefaultDeclaration | declare,
                start,
                self.lexer.prev_end,
                declaration,
            ));
        }
        if self.lexer.tok == tk::Mul {
            self.next()?;
            let mut exported: i32 = 0;
            if self.is_kw(kw::As) {
                self.next()?;
                if self.is_default_name() && self.is_second_default_export(self.lexer.tok_start) {
                    return Err(self.text_refuse());
                }
                exported = self.parse_ident_name()?;
            }
            if !self.is_kw(kw::From) {
                return Err(self.unexpected());
            }
            self.next()?;
            let source = self.string_literal()?;
            self.semicolon()?;
            let n = self.node_raw(
                k::ExportAllDeclaration | declare,
                start,
                self.lexer.prev_end,
                3,
            );
            self.set_child(n, 4, exported);
            self.set_child(n, 5, source);
            self.n.put(n + 6, 0);
            return Ok(n);
        }
        if self.lexer.tok == tk::BraceL {
            self.next()?;
            let list_mark = self.arena.ls_pos;
            let mut needs_from = false;
            while self.lexer.tok != tk::BraceR {
                let spec_start = self.lexer.tok_start;
                needs_from |= self.lexer.tok != tk::Name || self.is_kw(kw::Enum);
                let mut is_default = self.is_default_name();
                let local = self.parse_ident_name()?;
                let exported: i32;
                if self.is_kw(kw::As) {
                    self.next()?;
                    is_default = self.is_default_name();
                    exported = self.parse_ident_name()?;
                } else {
                    exported =
                        self.node0(self.n.at(local), self.n.at(local + 1), self.n.at(local + 2));
                }
                if is_default && self.is_second_default_export(self.n.at(exported + 1)) {
                    return Err(self.text_refuse());
                }
                let v0 = self.node2(
                    k::ExportSpecifier,
                    spec_start,
                    self.lexer.prev_end,
                    local,
                    exported,
                );
                self.list_push(v0);
                if self.lexer.tok != tk::BraceR {
                    self.expect(tk::Comma)?;
                }
            }
            self.next()?;
            let specifiers = self.list_finish(list_mark);
            let mut source: i32 = 0;
            if self.is_kw(kw::From) {
                self.next()?;
                source = self.string_literal()?;
            } else if needs_from {
                return Err(self.text_refuse());
            }
            self.semicolon()?;
            let n = self.node_raw(
                k::ExportNamedDeclaration | declare | F_SHORTHAND,
                start,
                self.lexer.prev_end,
                4,
            );
            self.n.put(n + 4, 0);
            self.set_child(n, 5, source);
            self.set_list(n, 6, specifiers);
            self.n.put(n + 7, 0);
            return Ok(n);
        }
        let declaration = self.flow_parse_declared(self.lexer.tok_start, 0)?;
        if declaration == 0 {
            return Err(self.unexpected());
        }
        let n = self.node_raw(
            k::ExportNamedDeclaration | declare,
            start,
            self.lexer.prev_end,
            4,
        );
        self.set_child(n, 4, declaration);
        self.n.put(n + 7, 0);
        self.n.put(n + 6, 0);
        self.n.put(n + 5, 0);
        return Ok(n);
    }

    /// Babel: "Only declares and type imports are allowed inside declare module."
    pub(crate) fn flow_check_declare_module_body(&self, body: i32) -> R<()> {
        let list = self.n.at(body + 5);
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            'c1: {
                let statement = self.n.at(list + i);
                let sub = ((self.n.at(statement) as u32) >> SUB_SHIFT) as i32;
                match self.n.at(statement) & 0xff {
                    k::DeclareModuleExports => {
                        break 'c1;
                    }
                    k::ImportDeclaration => {
                        if ((sub >> IK_SHIFT) & 3) != 0 {
                            break 'c1;
                        }
                    }
                    _ => {
                        if sub >= MOD_DECLARE {
                            break 'c1;
                        }
                    }
                }
                return Err(self.unexpected());
            }
            i += 1;
        }
        Ok(())
    }

    fn flow_has_statement_of_kind(&self, body: i32, kind: i32) -> bool {
        let list = self.n.at(body + 5);
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let mut statement = self.n.at(list + i);
            if (self.n.at(statement) & 0xff) == k::ExportNamedDeclaration
                || (self.n.at(statement) & 0xff) == k::ExportDefaultDeclaration
            {
                statement = self.n.at(statement + 4);
            }
            if (self.n.at(statement) & 0xff) == kind {
                return true;
            }
            i += 1;
        }
        return false;
    }

    /// In a declared module or namespace a component has no body, and a string at the start is a directive for some.
    fn flow_check_ambient_body(&self, body: i32) -> R<()> {
        let first = self.n.at(self.n.at(body + 5) + 1);
        if self.flow_has_statement_of_kind(body, k::ComponentDeclaration)
            || ((self.n.at(first) & 0xff) == k::ExpressionStatement
                && (self.n.at(self.n.at(first + 4)) & 0xff) == k::StringLiteral)
        {
            return Err(self.text_refuse());
        }
        Ok(())
    }

    /// The current token is `declare`. 0 if it is just a name here.
    pub(crate) fn flow_parse_declare(&mut self, start: i32) -> R<i32> {
        let m = self.mark();
        self.next()?;
        if self.lexer.tok_nl != 0 {
            self.rewind(m);
            return Ok(0);
        }
        let result: i32;
        if self.lexer.tok == tk::Export {
            result = self.flow_parse_declare_export(start)?;
        } else if self.word() == w::Module {
            self.next()?;
            if self.lexer.tok == tk::Dot {
                self.next()?;
                if self.word() != w::Exports {
                    return Err(self.unexpected());
                }
                self.next()?;
                let annotation_start = self.lexer.tok_start;
                self.expect(tk::Colon)?;
                let type_ = self.flow_parse_type_fresh()?;
                let annotation = self.node1(
                    k::TypeAnnotation,
                    annotation_start,
                    self.lexer.prev_end,
                    type_,
                );
                self.semicolon()?;
                result = self.node1(
                    k::DeclareModuleExports,
                    start,
                    self.lexer.prev_end,
                    annotation,
                );
            } else {
                let id = if self.lexer.tok == tk::String {
                    self.string_literal()?
                } else {
                    self.parse_ident()?
                };
                // (what a declared module exports is not counted)
                let outer_default = self.parse.default_export_at;
                self.parse.default_export_at = -1;
                let body = self.parse_block_of_nodes()?;
                self.parse.default_export_at = outer_default;
                // (an empty one is printed in more than one way)
                if self.n.at(self.n.at(body + 5)) == 0 {
                    return Err(self.text_refuse());
                }
                if self.mode.is_babel_flow {
                    self.flow_check_declare_module_body(body)?;
                }
                self.flow_check_ambient_body(body)?;
                result = self.node2(
                    k::ModuleDeclaration | ((MOD_DECLARE | MK_MODULE) << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    id,
                    body,
                );
            }
        } else if self.word() == w::Namespace {
            self.not_in_babel()?;
            self.flow_check_same_line()?;
            self.next()?;
            let id = self.parse_ident()?;
            let body = self.parse_block()?;
            // (a class in there is declared, and printed in ways of its own)
            if self.flow_has_statement_of_kind(body, k::ClassDeclaration) {
                return Err(self.text_refuse());
            }
            self.flow_check_ambient_body(body)?;
            result = self.node2(
                k::ModuleDeclaration | ((MOD_DECLARE | MK_NAMESPACE) << SUB_SHIFT),
                start,
                self.lexer.prev_end,
                id,
                body,
            );
        } else {
            result = self.flow_parse_declared(start, MOD_DECLARE)?;
        }
        if result == 0 {
            self.rewind(m);
        } else {
            self.unmark(m);
        }
        return Ok(result);
    }

    // ------------------------------------------------------------------------------------------------------------ records
    /// The current token is `record`.
    pub(crate) fn flow_parse_record(&mut self, start: i32) -> R<i32> {
        self.not_in_babel()?;
        self.next()?;
        if self.is_kw(kw::As) {
            return Err(self.text_refuse());
        }
        let id = self.parse_ident()?;
        let type_parameters = if self.lexer.tok == tk::Lt {
            self.ts_parse_type_parameters()?
        } else {
            0
        };
        let implemented = self.flow_parse_class_implements()?;
        let body_start = self.lexer.tok_start;
        self.expect(tk::BraceL)?;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            let member_start = self.lexer.tok_start;
            let mut head: i32 = 0;
            if self.is_kw(kw::Static) {
                let after = self.peek()?;
                if after != tk::Colon && after != tk::ParenL && after != tk::Lt {
                    self.next()?;
                    head |= F_STATIC;
                }
            }
            if self.is_kw(kw::Async) {
                let after = self.peek_on_same_line()?;
                if after != tk::Colon && after != tk::ParenL && after != tk::Lt && after != tk::EOF
                {
                    self.next()?;
                    head |= F_ASYNC;
                }
            }
            if self.eat(tk::Mul)? {
                head |= F_GENERATOR;
            }
            if self.lexer.tok == tk::BracketL || self.lexer.tok == tk::PrivateName {
                return Err(self.unexpected());
            }
            let key = self.parse_property_name()?;
            if self.lexer.tok == tk::ParenL || self.lexer.tok == tk::Lt {
                let v0 = self.parse_method_rest(k::ClassMethod | head, member_start, key, 0)?;
                self.list_push(v0);
                continue;
            }
            if (head & (F_ASYNC | F_GENERATOR)) != 0 {
                return Err(self.unexpected());
            }
            let annotation_start = self.lexer.tok_start;
            self.expect(tk::Colon)?;
            let type_ = self.flow_parse_type_fresh()?;
            let annotation = self.node1(
                k::TypeAnnotation,
                annotation_start,
                self.lexer.prev_end,
                type_,
            );
            let value = self.parse_class_property_value()?;
            let v1 = self.node3(
                k::RecordDeclarationProperty | head,
                member_start,
                self.lexer.prev_end,
                key,
                annotation,
                value,
            );
            self.list_push(v1);
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.next()?;
        let v2 = self.lexer.prev_end;
        let v3 = self.list_finish(list_mark);
        let body = self.node_l(k::RecordDeclarationBody, body_start, v2, v3);
        let n = self.class_node(
            k::RecordDeclaration,
            start,
            self.lexer.prev_end,
            id,
            0,
            body,
            0,
        );
        self.set_list(n, 8, implemented);
        self.set_child(n, 9, type_parameters);
        return Ok(n);
    }

    // -------------------------------------------------------------------------------------------------------------- match
    pub(crate) fn flow_parse_match_binding(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let kind = if self.lexer.tok == tk::Const {
            V_CONST
        } else {
            if self.lexer.tok == tk::Var {
                V_VAR
            } else {
                V_LET
            }
        };
        self.next()?;
        let id = self.parse_ident()?;
        return Ok(self.node1(
            k::MatchBindingPattern | (kind << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            id,
        ));
    }

    pub(crate) fn is_match_binding_start(&mut self) -> R<bool> {
        return Ok(self.lexer.tok == tk::Const
            || self.lexer.tok == tk::Var
            || (self.is_kw(kw::Let) && self.peek()? == tk::Name));
    }

    pub(crate) fn flow_parse_match_rest(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.next()?;
        let argument = if self.is_match_binding_start()? {
            self.flow_parse_match_binding()?
        } else {
            0
        };
        return Ok(self.node1(k::MatchRestPattern, start, self.lexer.prev_end, argument));
    }

    pub(crate) fn flow_parse_match_object(&mut self, kind: i32) -> R<i32> {
        let start = self.lexer.tok_start;
        self.expect(tk::BraceL)?;
        let mut rest: i32 = 0;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            if self.lexer.tok == tk::Ellipsis {
                rest = self.flow_parse_match_rest()?;
                break;
            }
            let property_start = self.lexer.tok_start;
            if self.is_match_binding_start()? {
                let pattern = self.flow_parse_match_binding()?;
                let id = self.n.at(pattern + 4);
                let key = self.node0(k::Identifier, self.n.at(id + 1), self.n.at(id + 2));
                let v0 = self.node2(
                    k::MatchObjectPatternProperty | F_SHORTHAND,
                    property_start,
                    self.lexer.prev_end,
                    key,
                    pattern,
                );
                self.list_push(v0);
            } else {
                let key = if self.lexer.tok == tk::String {
                    self.string_literal()?
                } else {
                    if self.lexer.tok == tk::Num {
                        self.leaf(k::NumericLiteral)?
                    } else {
                        if self.lexer.tok == tk::BigInt {
                            self.leaf(k::BigIntLiteral)?
                        } else {
                            self.parse_ident_name()?
                        }
                    }
                };
                self.expect(tk::Colon)?;
                let pattern = self.flow_parse_match_pattern()?;
                let v1 = self.node2(
                    k::MatchObjectPatternProperty,
                    property_start,
                    self.lexer.prev_end,
                    key,
                    pattern,
                );
                self.list_push(v1);
            }
            if self.lexer.tok != tk::BraceR {
                self.expect(tk::Comma)?;
            }
        }
        self.expect(tk::BraceR)?;
        let v2 = self.lexer.prev_end;
        let v3 = self.list_finish(list_mark);
        return Ok(self.node1_l(kind, start, v2, rest, v3));
    }

    pub(crate) fn flow_parse_match_primary(&mut self) -> R<i32> {
        self.stack()?;
        let start = self.lexer.tok_start;
        match self.lexer.tok {
            tk::String => {
                let v0 = self.lexer.tok_end;
                let v1 = self.leaf(k::StringLiteral)?;
                return Ok(self.node1(k::MatchLiteralPattern, start, v0, v1));
            }
            tk::Num => {
                let v2 = self.lexer.tok_end;
                let v3 = self.leaf(k::NumericLiteral)?;
                return Ok(self.node1(k::MatchLiteralPattern, start, v2, v3));
            }
            tk::BigInt => {
                let v4 = self.lexer.tok_end;
                let v5 = self.leaf(k::BigIntLiteral)?;
                return Ok(self.node1(k::MatchLiteralPattern, start, v4, v5));
            }
            tk::True | tk::False => {
                let v6 = self.lexer.tok_end;
                let v7 = self.leaf(k::BooleanLiteral)?;
                return Ok(self.node1(k::MatchLiteralPattern, start, v6, v7));
            }
            tk::Null => {
                let v8 = self.lexer.tok_end;
                let v9 = self.leaf(k::NullLiteral)?;
                return Ok(self.node1(k::MatchLiteralPattern, start, v8, v9));
            }
            tk::Add | tk::Sub => {
                let operator = self.lexer.tok;
                self.next()?;
                if self.lexer.tok != tk::BigInt && self.lexer.tok != tk::Num {
                    return Err(self.unexpected());
                }
                let argument = self.leaf(if self.lexer.tok == tk::BigInt {
                    k::BigIntLiteral
                } else {
                    k::NumericLiteral
                })?;
                return Ok(self.node1(
                    k::MatchUnaryPattern | (operator << SUB_SHIFT),
                    start,
                    self.lexer.prev_end,
                    argument,
                ));
            }
            tk::ParenL => {
                self.next()?;
                let pattern = self.flow_parse_match_pattern()?;
                self.expect(tk::ParenR)?;
                return Ok(pattern);
            }
            tk::BraceL => {
                return self.flow_parse_match_object(k::MatchObjectPattern);
            }
            tk::BracketL => {
                self.next()?;
                let mut rest: i32 = 0;
                let list_mark = self.arena.ls_pos;
                while self.lexer.tok != tk::BracketR {
                    if self.lexer.tok == tk::Ellipsis {
                        rest = self.flow_parse_match_rest()?;
                        break;
                    }
                    let v10 = self.flow_parse_match_pattern()?;
                    self.list_push(v10);
                    if self.lexer.tok != tk::BracketR {
                        self.expect(tk::Comma)?;
                    }
                }
                self.expect(tk::BracketR)?;
                let v11 = self.lexer.prev_end;
                let v12 = self.list_finish(list_mark);
                return Ok(self.node1_l(k::MatchArrayPattern, start, v11, rest, v12));
            }
            _ => {}
        }
        if self.is_match_binding_start()? {
            return self.flow_parse_match_binding();
        }
        if self.lexer.tok == tk::Name
            && self.lexer.tok_end - self.lexer.tok_start == 1
            && self.t.at(self.lexer.tok_start) == 95
        {
            self.next()?;
            return Ok(self.node0(k::MatchWildcardPattern, start, self.lexer.prev_end));
        }
        if self.is_kw(kw::Let) {
            return Err(self.text_refuse());
        }
        let id = self.parse_ident()?;
        let mut pattern = self.node1(k::MatchIdentifierPattern, start, self.lexer.prev_end, id);
        loop {
            // (`a.b.c`, `a[1]`: the long way breaks them like the members of an expression)
            if (self.lexer.tok == tk::Dot && (self.n.at(pattern) & 0xff) == k::MatchMemberPattern)
                || self.lexer.tok == tk::BracketL
            {
                return Err(self.rare(rare::UNLIKE_PRETTIER));
            }
            if self.lexer.tok == tk::Dot {
                self.next()?;
                let property = self.parse_ident_name()?;
                pattern = self.node2(
                    k::MatchMemberPattern,
                    start,
                    self.lexer.prev_end,
                    pattern,
                    property,
                );
            } else {
                break;
            }
        }
        if self.lexer.tok == tk::BraceL {
            let properties = self.flow_parse_match_object(k::MatchInstanceObjectPattern)?;
            return Ok(self.node2(
                k::MatchInstancePattern,
                start,
                self.lexer.prev_end,
                pattern,
                properties,
            ));
        }
        return Ok(pattern);
    }

    pub(crate) fn flow_parse_match_pattern(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        self.eat(tk::BitOr)?;
        let mut pattern = self.flow_parse_match_primary()?;
        if self.lexer.tok == tk::BitOr {
            let list_mark = self.arena.ls_pos;
            self.list_push(pattern);
            while self.eat(tk::BitOr)? {
                let v0 = self.flow_parse_match_primary()?;
                self.list_push(v0);
            }
            let v1 = self.lexer.prev_end;
            let v2 = self.list_finish(list_mark);
            pattern = self.node_l(k::MatchOrPattern, start, v1, v2);
        }
        if self.is_kw(kw::As) {
            self.next()?;
            let target = if self.is_match_binding_start()? {
                self.flow_parse_match_binding()?
            } else {
                if self.is_kw(kw::Let) {
                    return Err(self.text_refuse());
                }
                self.parse_ident()?
            };
            pattern = self.node2(
                k::MatchAsPattern,
                start,
                self.lexer.prev_end,
                pattern,
                target,
            );
        }
        return Ok(pattern);
    }

    /// `match (argument) { cases }`, if that is what starts at the current token, which is `match`; else 0.
    pub(crate) fn flow_try_parse_match(&mut self, is_statement: bool) -> R<i32> {
        if self.mode.is_babel_flow {
            return Ok(0);
        }
        let start = self.lexer.tok_start;
        if self.peek_on_same_line()? != tk::ParenL {
            return Ok(0);
        }
        // is there a `{` on the line of the closing parenthesis?
        let m = self.mark();
        self.next()?;
        let mut depth: i32 = 0;
        loop {
            if self.lexer.tok == tk::ParenL {
                depth += 1;
            } else if self.lexer.tok == tk::ParenR {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            } else if self.lexer.tok == tk::EOF {
                self.rewind(m);
                return Ok(0);
            }
            self.next()?;
        }
        self.next()?;
        let is_match = self.lexer.tok == tk::BraceL && self.lexer.tok_nl == 0;
        self.rewind(m);
        if !is_match {
            return Ok(0);
        }
        // a call behind `new` and `extends`
        if self.parse.is_operand
            || self.text_is(self.lexer.prev_end - 3, self.lexer.prev_end, b"new")
        {
            return Err(self.text_refuse());
        }
        self.next()?;
        self.next()?;
        let argument = self.parse_expression()?;
        self.expect(tk::ParenR)?;
        self.expect(tk::BraceL)?;
        let list_mark = self.arena.ls_pos;
        while self.lexer.tok != tk::BraceR {
            let case_start = self.lexer.tok_start;
            let pattern = self.flow_parse_match_pattern()?;
            let mut guard: i32 = 0;
            if self.eat(tk::If)? {
                self.expect(tk::ParenL)?;
                guard = self.parse_expression()?;
                // (`if (a, b)`: Prettier gives it parentheses of its own)
                if (self.n.at(guard) & 0xff) == k::SequenceExpression {
                    return Err(self.rare(rare::UNLIKE_PRETTIER));
                }
                self.expect(tk::ParenR)?;
            }
            self.expect(tk::Arrow)?;
            if is_statement {
                let body = self.parse_block()?;
                let v0 = self.node3(
                    k::MatchStatementCase,
                    case_start,
                    self.lexer.prev_end,
                    pattern,
                    guard,
                    body,
                );
                self.list_push(v0);
                self.eat(tk::Comma)?;
            } else {
                let body = self.parse_maybe_assign()?;
                let end = self.lexer.prev_end;
                if self.lexer.tok != tk::BraceR {
                    self.expect(tk::Comma)?;
                }
                let v1 = self.node3(
                    k::MatchExpressionCase,
                    case_start,
                    end,
                    pattern,
                    guard,
                    body,
                );
                self.list_push(v1);
            }
        }
        self.next()?;
        let v2 = if is_statement {
            k::MatchStatement
        } else {
            k::MatchExpression
        };
        let v3 = self.lexer.prev_end;
        let v4 = self.list_finish(list_mark);
        return Ok(self.node1_l(v2, start, v3, argument, v4));
    }

    // --------------------------------------------------------------------------------------------------------- statements
    /// A statement that only Flow has, if one starts at the current token, which is a name; else 0.
    /// The current token is a word that starts a declaration if another word follows. If that one stands on the next line, the parsers do not agree on what this is.
    fn flow_check_same_line(&mut self) -> R<()> {
        let saved = self.save();
        self.next()?;
        let is_on_new_line = self.lexer.tok_nl != 0;
        self.restore(saved);
        if is_on_new_line {
            return Err(self.text_refuse());
        }
        Ok(())
    }

    pub(crate) fn flow_parse_statement(&mut self, start: i32) -> R<i32> {
        match self.word() {
            w::Type => {
                let v0 = self.peek()?;
                if self.is_word_token(v0)? {
                    self.flow_check_same_line()?;
                    return self.flow_parse_type_alias(start, 0);
                }
            }
            w::Opaque => {
                if self.peek_is_word(w::Type)? {
                    self.flow_check_same_line()?;
                    return self.flow_parse_opaque_type(start, 0);
                }
            }
            w::Interface => {
                let v1 = self.peek()?;
                if self.is_word_token(v1)? {
                    self.flow_check_same_line()?;
                    return self.flow_parse_interfaceish(start, k::InterfaceDeclaration, 0);
                }
                // `interface {}`
                if v1 == tk::BraceL {
                    return Err(self.text_refuse());
                }
            }
            w::Declare => {
                self.flow_check_same_line()?;
                return self.flow_parse_declare(start);
            }
            w::Enum => {
                if self.peek()? == tk::Name {
                    return self.flow_parse_enum(start, 0);
                }
            }
            w::Component => {
                if self.peek_on_same_line()? == tk::Name {
                    return self.flow_parse_component(start, k::ComponentDeclaration, 0);
                }
            }
            w::Hook => {
                if self.peek_on_same_line()? == tk::Name {
                    return self.flow_parse_hook(start, 0);
                }
            }
            w::Record => {
                if self.peek_on_same_line()? == tk::Name {
                    return self.flow_parse_record(start);
                }
            }
            w::Match => {
                return self.flow_try_parse_match(true);
            }
            w::Module | w::Namespace => {
                // `module as A`: a declaration for TypeScript's parser, which reads every file first
                if self.peek_on_same_line()? == tk::Name {
                    return Err(self.text_refuse());
                }
            }
            w::Async => {
                // async component
                let m = self.mark();
                self.next()?;
                if self.lexer.tok_nl == 0
                    && self.word() == w::Component
                    && self.peek_on_same_line()? == tk::Name
                {
                    self.unmark(m);
                    return self.flow_parse_component(start, k::ComponentDeclaration, F_ASYNC);
                }
                if self.lexer.tok_nl == 0
                    && self.word() == w::Hook
                    && self.peek_on_same_line()? == tk::Name
                {
                    self.unmark(m);
                    return self.flow_parse_hook(start, F_ASYNC);
                }
                self.rewind(m);
            }
            _ => {}
        }
        return Ok(0);
    }

    pub(crate) fn is_word_token(&mut self, t: i32) -> R<bool> {
        return Ok(t == tk::Name || self.is_keyword_token(t)?);
    }

    pub(crate) fn peek_is_word(&mut self, w: i32) -> R<bool> {
        let saved = self.save();
        self.next()?;
        let result = self.word() == w;
        self.restore(saved);
        return Ok(result);
    }

    /// What can follow `export` in Flow only: the declaration; 0 if there is nothing of the kind; -1 after having skipped the `type` of
    /// `export type {` or `export type *`.
    pub(crate) fn flow_parse_export_declaration(&mut self) -> R<i32> {
        if self.word() == w::Type {
            let saved = self.save();
            self.next()?;
            if self.lexer.tok == tk::BraceL || self.lexer.tok == tk::Mul {
                return Ok(-1);
            }
            // `export type as = A`
            if self.is_kw(kw::As) {
                return Err(self.text_refuse());
            }
            self.restore(saved);
        }
        if self.word() == w::Declare || self.word() == w::Match {
            return Ok(0);
        }
        return self.flow_parse_statement(self.lexer.tok_start);
    }

    /// The kind of an import, if `type` or `typeof` stands behind `import` as a keyword: skips it. Else 0.
    pub(crate) fn flow_parse_import_kind(&mut self) -> R<i32> {
        let kind = if self.lexer.tok == tk::Typeof {
            IK_TYPEOF
        } else {
            if self.word() == w::Type { IK_TYPE } else { 0 }
        };
        if kind == 0 {
            return Ok(0);
        }
        let saved = self.save();
        self.next()?;
        // `import type from "x"`, `import type, {a} from "x"`
        let mut is_kind = self.lexer.tok == tk::BraceL
            || self.lexer.tok == tk::Mul
            || (self.lexer.tok == tk::Name && !self.is_kw(kw::From));
        if self.is_kw(kw::From) {
            // `import type from from "x"`
            let m = self.mark();
            self.next()?;
            is_kind = self.is_kw(kw::From);
            self.rewind(m);
        }
        if is_kind {
            if self.lexer.tok == tk::Mul && kind == IK_TYPE {
                self.not_in_babel()?;
            }
            return Ok(kind);
        }
        self.restore(saved);
        return Ok(0);
    }

    /// `type a`, `typeof a as b` .. in the braces of an import. The current token is `type` or `typeof`.
    pub(crate) fn flow_parse_import_specifier(&mut self) -> R<i32> {
        let start = self.lexer.tok_start;
        let kind_if_any = if self.lexer.tok == tk::Typeof {
            IK_TYPEOF
        } else {
            IK_TYPE
        };
        let mut kind: i32 = 0;
        let mut imported = self.parse_ident_name()?;
        let mut local: i32 = 0;
        if self.is_kw(kw::As) {
            let as_ = self.parse_ident_name()?;
            if self.is_kw(kw::As) {
                // { type as as ..? }
                let second_as = self.parse_ident_name()?;
                if self.is_word() {
                    kind = kind_if_any;
                    imported = as_;
                    local = self.parse_ident_name()?;
                } else {
                    local = second_as;
                }
            } else if self.is_word() {
                // { type as x }
                local = self.parse_ident_name()?;
            } else {
                // { type as }
                kind = kind_if_any;
                imported = as_;
            }
        } else if self.is_word() || self.lexer.tok == tk::String {
            kind = kind_if_any;
            imported = if self.lexer.tok == tk::String {
                self.string_literal()?
            } else {
                self.parse_ident_name()?
            };
            if self.is_kw(kw::As) {
                self.next()?;
                local = self.parse_ident_name()?;
            }
        }
        if local == 0 {
            local = self.node0(
                self.n.at(imported),
                self.n.at(imported + 1),
                self.n.at(imported + 2),
            );
        }
        // what is bound is a name
        let word = self.keyword_at(
            self.n.at(local + 1),
            self.n.at(local + 2) - self.n.at(local + 1),
        );
        if (self.n.at(local) & 0xff) != k::Identifier
            || (word & 255) > tk::Name
            || (word >> 8) == kw::Enum
        {
            return Err(self.text_refuse());
        }
        return Ok(self.node2(
            k::ImportSpecifier | (kind << IK_SHIFT << SUB_SHIFT),
            start,
            self.lexer.prev_end,
            imported,
            local,
        ));
    }
}
