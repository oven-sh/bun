//! Flow: its types and its declarations, as `flow-parser` reads them (`Dialect::flow`).
//!
//! The HIR has no node of its own for any of it. Only a formatter gets such a file
//! (`FileIn::is_flow`), and it prints from the nodes of TypeScript, which are used like this:
//!
//! | Flow | HIR |
//! | --- | --- |
//! | `mixed`, `empty`, `*` | `Ref` with that name |
//! | `boolean`, `bool` | `Ref` with the name `boolean`: Prettier writes the one for the other |
//! | `?T` | `JSDoc { Nullable, is_postfix: false }` |
//! | `T?.[K]` | `IndexedAccess`. The token after `T` is the `?.` |
//! | `renders T`, `renders? T`, `renders* T` | `Unique(T)`, which starts with the operator |
//! | `A => B`, `(A, b: B, ...C) => D` | `Fn`. A parameter without a name has no `pat` |
//! | `hook (A) => B`, `component(a: A, ...B) renders C` | `Fn`, which starts with the word. `ret` is the `renders C` |
//! | `{\| a: A \|}` | `Object`, which starts with `{\|` |
//! | `...T`, and `...` at the end of an object type | `Member { Property, no key, REST }`, the latter without `ty` |
//! | `[K]: V`, `[k: K]: V` | `IndexSignature`, whose parameter has a `pat` or none |
//! | `[[slot]]: T`, `[[slot]](): T` | `Property` or `Method` with `COMPUTED_NAME` |
//! | `[K in T]: V` in an object type | `Member { Property, no key }` whose `ty` is a `Mapped` with the span of the member |
//! | `+`, `-`, `in`, `out`, `readonly`, `writeonly`, `static`, `proto` | a `Modifier` at the token. A word that TypeScript has no flag for has none |
//! | `interface extends A { }` as a type | `Intersection` of `A` and the `Object`, which starts with `interface` |
//! | `[+a: A, b?: B, ...C, ...]` | `Tuple`. An element starts at its variance. The last `...` has no `ty` |
//! | `x is T`, `implies x is T` | `Predicate`, the latter with `asserts` |
//! | `: T %checks` | `Predicate { param: "%checks", ty: T }` as the return type |
//! | `: T %checks(e)` | `Typeof` without a name, with `e` as `expr` and `T` as `args` |
//! | `<T: Bound = Default>` | `TypeParam`. The token after the name is the `:` or `extends` |
//! | `(e: T)` | `As`, whose span is that of the parentheses |
//! | `opaque type A: B = C`, `opaque type A super B extends C = D` | `Interface` with the modifier `opaque`, the bounds as `extends` and the type as `other_heritage` |
//! | `declare class A mixins B` | `Class`, `AMBIENT`, with `B` in `other_implements` and the members of an object type |
//! | `declare function f(A): B` | `Fn` without a body, with the parameters of a function type |
//! | `declare module.exports: T` | `TypeAlias` with the name `module.exports` |
//! | `declare export default T` | `TypeAlias` whose name is the `default` |
//! | `declare export { a }`, `declare export * from "a"` | the export, with `declare` among its modifiers |
//! | `declare export var a: T`, and so on | the declaration. Among its modifiers the `declare` has no flag |
//! | `component A(a: T, 'b' as c: U) renders V { }`, `hook useA() { }` | `Fn` with the word as its last modifier. A parameter starts at its outer name |
//! | `enum A of string { B = "b", ... }` | `Enum`. The token after the name is the `of`. The `...` is a member without a name |
//! | `import typeof A`, `import { typeof A }` | `type_only`. The word is at `clause_start`, at `ImportSpec::start` |
//! | `match (a) { b => { } }` as a statement | `Switch`, whose `expr` is the call `match (a)`. The `test` of a case is its pattern, its body the block |
//! | `match (a) { b => c }` as an expression | `New` that starts with its `callee`, the call `match (a)`. Its argument is an `Object`: a case is a property whose computed key is the pattern |
//! | `R { a: 1 }`, `R<T> { a: 1 }` | `New` that starts with its `callee`, with the `Object` as its argument |
//! | a pattern | an expression. `a \| b`: `BitOr`. `a as b`: `In`. `a if (b)`: `And`. `const a`: `Unary(Void)`, which starts with the keyword. `...`: a spread of `Missing`. `const a` in an object pattern: a property without a key. `A { b: c }`: as `R { a: 1 }` |
//! | `record A implements B { a: T = b, c() { } }` | `Class` with the word as its last modifier. A property ends before its `,` |
//!
//! There is no second parser here to compare with. What is right is what Prettier 3.9.9 prints with
//! `--parser flow` (flow-parser 0.322) and `--parser babel-flow`: its tests in `tests/format/flow`,
//! and real files through the npm package.

use super::stmt::Start;
use super::{Parser, ctx, take_span};
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

/// Which members an object type can have.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Body {
    /// `{ }` as a type
    Type,
    /// Of an interface
    Interface,
    /// Of `declare class`: `static` and `proto` are modifiers.
    Class,
}

impl Parser<'_> {
    // ───────────────────────────── tokens ─────────────────────────────

    /// Whether the token is the name `word`, which is no keyword of TypeScript's.
    #[inline]
    fn is_word(&self, word: &[u8]) -> bool {
        self.token() == T::Identifier && !self.lx.has_escape && self.lx.text() == word
    }

    /// Reads the first byte of the token as the token `first`.
    #[inline]
    fn split_token(&mut self, first: T) {
        self.lx.token = first;
        self.lx.end = self.lx.start + 1;
    }

    /// Whether the token is directly followed by `byte`.
    #[inline]
    fn is_directly_before(&self, byte: u8) -> bool {
        self.lx.src.get(self.lx.end as usize) == Some(&byte)
    }

    /// Pushes the token on the stack of modifiers.
    fn modifier_token(&mut self, flag: Flags) {
        let kind = ModifierKind::Keyword(flag);
        self.s.modifiers.push(Modifier {
            kind,
            pos: self.pos(),
        });
        self.next();
    }

    /// Any word, which is consumed: its text, its start and its end.
    fn word(&mut self) -> (Atom, u32, u32) {
        let end = self.lx.end;
        let (name, pos) = self.identifier_name();
        (name, pos, end)
    }

    // ───────────────────────────── types ─────────────────────────────

    /// A type.
    pub(crate) fn flow_type(&mut self) -> TypeNodeId {
        self.flow_type_in(0)
    }

    /// A type, in the context `context` beside that of all types.
    fn flow_type_in(&mut self, context: u32) -> TypeNodeId {
        if self.is_too_deep() {
            return TypeNodeId::NONE;
        }
        let cleared = ctx::YIELD
            | ctx::AWAIT
            | ctx::DISALLOW_CONDITIONAL_TYPES
            | ctx::NO_ANONYMOUS_FUNCTION_TYPE;
        let saved = self.enter_context(ctx::TYPE | context, cleared);
        let start = self.pos();
        let mut ty = self.flow_union_type();
        if self.eat(T::Extends) {
            // `A extends infer B extends C ? D : E` is `A extends (infer B extends C) ? D : E`.
            let outer = self.enter_context(ctx::DISALLOW_CONDITIONAL_TYPES, 0);
            let extends = self.flow_union_type();
            self.context = outer;
            self.expect(T::Question);
            let yes = self.flow_type();
            self.expect(T::Colon);
            let no = self.flow_type();
            let kind = TypeNodeKind::Cond {
                check: ty,
                extends,
                yes,
                no,
            };
            ty = self.finish_type(kind, start);
        }
        self.context = saved;
        ty
    }

    /// Whether the token is the `|` of a union: not that of `|}`.
    #[inline]
    fn is_at_union_operator(&self) -> bool {
        self.token() == T::Bar && !self.is_directly_before(b'}')
    }

    fn flow_union_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        if self.is_at_union_operator() {
            self.next();
        }
        let first = self.flow_intersection_type();
        if !self.is_at_union_operator() {
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.is_at_union_operator() {
            self.next();
            let member = self.flow_intersection_type();
            self.s.ids.push(member.0);
        }
        let members = self.take_ids(base);
        self.finish_type(TypeNodeKind::Union(members), start)
    }

    fn flow_intersection_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.eat(T::Ampersand);
        let first = self.flow_function_type_without_parentheses();
        if self.token() != T::Ampersand {
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.eat(T::Ampersand) {
            let member = self.flow_function_type_without_parentheses();
            self.s.ids.push(member.0);
        }
        let members = self.take_ids(base);
        self.finish_type(TypeNodeKind::Intersection(members), start)
    }

    /// `A`, `A => B`
    fn flow_function_type_without_parentheses(&mut self) -> TypeNodeId {
        let start = self.start();
        let ty = self.flow_prefix_type();
        if self.token() != T::EqualsGreaterThan || self.has_context(ctx::NO_ANONYMOUS_FUNCTION_TYPE)
        {
            return ty;
        }
        let base = self.s.params.len();
        self.push_unnamed_parameter(start, ty, Flags::empty());
        let params = take_span!(self, params, base);
        self.flow_function_type_rest(start.pos, Span::EMPTY, (ParamId::NONE, params), start.pos)
    }

    /// A parameter of a function type that is only the type `ty`.
    fn push_unnamed_parameter(&mut self, start: Start, ty: TypeNodeId, flags: Flags) {
        self.s.params.push(Param {
            pat: PatId::NONE,
            ty,
            default: ExprId::NONE,
            flags,
            pos: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
        });
    }

    /// From the `=>` of a function type that starts at `start`. `anchor`: the `(` of its parameters.
    fn flow_function_type_rest(
        &mut self,
        start: u32,
        type_params: Span<TypeParamId>,
        (this_param, params): (ParamId, Span<ParamId>),
        anchor: u32,
    ) -> TypeNodeId {
        self.expect(T::EqualsGreaterThan);
        let ret = self.flow_return_type(self.context & ctx::NO_ANONYMOUS_FUNCTION_TYPE);
        let func = self.f.add_fn(Func {
            kind: FnKind::FunctionType,
            flags: Flags::empty(),
            name: Atom::NONE,
            name_pos: start,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor,
            start,
        });
        self.finish_type(TypeNodeKind::Fn(func), start)
    }

    /// `T`, `x is T`, `implies x is T`, `asserts x`, `asserts x is T`
    fn flow_return_type(&mut self, context: u32) -> TypeNodeId {
        let start = self.pos();
        let is_name = |p: &Self| p.token() == T::This || p.is_identifier();
        let has_prefix = (self.token() == T::Asserts || self.is_word(b"implies"))
            && self.look_ahead(|p| {
                p.next();
                is_name(p)
            });
        let is_guard = has_prefix || is_name(self) && self.peek() == T::Is;
        if !is_guard {
            return self.flow_type_in(context);
        }
        if has_prefix {
            self.next();
        }
        let (param, ..) = self.word();
        let ty = match self.eat(T::Is) {
            true => self.flow_type_in(context),
            false => TypeNodeId::NONE,
        };
        let kind = TypeNodeKind::Predicate {
            param,
            ty,
            asserts: has_prefix,
        };
        self.finish_type(kind, start)
    }

    /// What follows the `:` after the parameters of a function with a body, of an arrow function
    /// (`context`: no function type without parentheses) or of `declare function`.
    fn flow_return_type_and_predicate(&mut self, context: u32) -> TypeNodeId {
        let start = self.pos();
        let ty = match self.token() {
            T::Percent => TypeNodeId::NONE,
            _ => self.flow_return_type(context),
        };
        if self.token() != T::Percent {
            return ty;
        }
        self.next();
        if !self.is_word(b"checks") {
            self.fail();
        }
        self.next();
        if self.token() != T::OpenParen {
            let kind = TypeNodeKind::Predicate {
                param: self.atom(b"%checks"),
                ty,
                asserts: false,
            };
            return self.finish_type(kind, start);
        }
        self.next();
        let saved = self.enter_context(0, ctx::TYPE | ctx::DISALLOW_IN);
        let expr = self.assignment_expression();
        self.context = saved;
        self.expect(T::CloseParen);
        let args = match ty.is_some() {
            true => self.f.list(&[ty]),
            false => IdList::EMPTY,
        };
        let kind = TypeNodeKind::Typeof {
            name: Span::EMPTY,
            args,
            has_type_arguments: false,
            expr,
        };
        self.finish_type(kind, start)
    }

    /// The return type of a function with a body.
    pub(crate) fn flow_return_type_of_function(&mut self) -> TypeNodeId {
        self.flow_return_type_and_predicate(0)
    }

    /// The return type of an arrow function: in `(a): B => c` it is `B`.
    pub(crate) fn flow_return_type_of_arrow_function(&mut self) -> TypeNodeId {
        self.flow_return_type_and_predicate(ctx::NO_ANONYMOUS_FUNCTION_TYPE)
    }

    /// `?T`
    fn flow_prefix_type(&mut self) -> TypeNodeId {
        if self.is_too_deep() {
            return TypeNodeId::NONE;
        }
        if self.token() == T::QuestionQuestion {
            self.split_token(T::Question);
        }
        if self.token() != T::Question {
            return self.flow_postfix_type();
        }
        let start = self.pos();
        self.next();
        let ty = self.flow_prefix_type();
        let kind = TypeNodeKind::JSDoc {
            ty,
            kind: JSDocTypeKind::Nullable,
            is_postfix: false,
        };
        self.finish_type(kind, start)
    }

    /// `T[]`, `T[K]`, `T?.[K]`
    fn flow_postfix_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let mut ty = self.flow_primary_type();
        while matches!(self.token(), T::OpenBracket | T::QuestionDot) && !self.newline_before() {
            let is_optional = self.eat(T::QuestionDot);
            self.expect(T::OpenBracket);
            if !is_optional && self.eat(T::CloseBracket) {
                ty = self.finish_type(TypeNodeKind::Array(ty), start);
                continue;
            }
            let index = self.flow_type();
            self.expect(T::CloseBracket);
            ty = self.finish_type(TypeNodeKind::IndexedAccess { obj: ty, index }, start);
        }
        ty
    }

    fn flow_primary_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let keyword = match self.token() {
            T::Any => Keyword::Any,
            T::Unknown => Keyword::Unknown,
            T::Never => Keyword::Never,
            T::Undefined => Keyword::Undefined,
            T::NumberKeyword => Keyword::Number,
            T::StringKeyword => Keyword::String,
            T::Symbol => Keyword::Symbol,
            T::BigIntKeyword => Keyword::BigInt,
            T::Void => Keyword::Void,
            T::Null => Keyword::Null,
            T::This => Keyword::This,
            T::True => return self.token_type(TypeNodeKind::BoolLit(true)),
            T::False => return self.token_type(TypeNodeKind::BoolLit(false)),
            T::String => return self.token_type(TypeNodeKind::StringLit(self.lx.atom)),
            T::Number => {
                let number = self.f.number(self.lx.number);
                return self.token_type(TypeNodeKind::NumberLit(number));
            }
            T::BigInt => {
                let kind = TypeNodeKind::BigIntLit {
                    text: self.lx.atom,
                    negative: false,
                };
                return self.token_type(kind);
            }
            T::Minus => return self.negative_literal_type(),
            T::Asterisk => return self.flow_type_called(b"*"),
            T::Boolean => return self.flow_type_called(b"boolean"),
            T::Identifier if self.is_word(b"bool") => return self.flow_type_called(b"boolean"),
            T::LessThan | T::LessThanLessThan => {
                let type_params = self.flow_type_parameters();
                let anchor = self.pos();
                let params = self.flow_function_type_parameters();
                return self.flow_function_type_rest(start, type_params, params, anchor);
            }
            T::OpenParen => return self.flow_function_type_or_group(),
            T::OpenBrace => {
                let members = self.flow_object_type_members(Body::Type);
                return self.finish_type(TypeNodeKind::Object(members), start);
            }
            T::OpenBracket => return self.flow_tuple_type(),
            T::TypeOf => return self.type_query(),
            T::Interface => return self.flow_interface_type(),
            T::KeyOf => {
                self.next();
                let operand = self.flow_prefix_type();
                return self.finish_type(TypeNodeKind::Keyof(operand), start);
            }
            T::Infer => return self.flow_infer_type(),
            T::Identifier if self.is_word(b"renders") => return self.flow_renders_type(false),
            T::Identifier if self.is_word(b"component") => return self.flow_component_type(),
            T::Identifier
                if self.is_word(b"hook") && matches!(self.peek(), T::OpenParen | T::LessThan) =>
            {
                self.next();
                let type_params = self.type_parameters();
                let anchor = self.pos();
                let params = self.flow_function_type_parameters();
                return self.flow_function_type_rest(start, type_params, params, anchor);
            }
            _ => return self.flow_generic_type(),
        };
        self.token_type(TypeNodeKind::Keyword(keyword))
    }

    /// `renders T`, `renders? T`, `renders* T`. `is_of_declaration`: after the parameters of a
    /// component that is declared, where `T` can be a union.
    fn flow_renders_type(&mut self, is_of_declaration: bool) -> TypeNodeId {
        let start = self.pos();
        let has_mark = self.is_directly_before(b'?') || self.is_directly_before(b'*');
        self.next();
        if has_mark {
            if self.token() == T::QuestionQuestion {
                self.split_token(T::Question);
            }
            self.next();
        }
        let operand = match is_of_declaration {
            true => self.flow_type(),
            false => self.flow_prefix_type(),
        };
        self.finish_type(TypeNodeKind::Unique(operand), start)
    }

    /// `infer A`, `infer A extends B`
    fn flow_infer_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let (name, pos) = self.identifier();
        let constraint = match self.token() {
            T::Extends => self.try_parse(|p| {
                p.next();
                let constraint = p.flow_union_type();
                // In `infer A extends B ? C : D` it is the `extends` of the conditional type.
                let is_constraint =
                    p.has_context(ctx::DISALLOW_CONDITIONAL_TYPES) || p.token() != T::Question;
                is_constraint.then_some(constraint)
            }),
            _ => None,
        };
        let param = self.f.add_type_param(TypeParam {
            name,
            pos,
            start: pos,
            end: self.prev_end(),
            constraint: constraint.unwrap_or(TypeNodeId::NONE),
            default: TypeNodeId::NONE,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
        });
        self.finish_type(TypeNodeKind::Infer(param), start)
    }

    /// The token as a reference to the type `name`.
    fn flow_type_called(&mut self, name: &[u8]) -> TypeNodeId {
        let name = self.atom(name);
        let name = self.f.entity_name([(name, self.pos())].into_iter());
        let args = IdList::EMPTY;
        self.token_type(TypeNodeKind::Ref { name, args })
    }

    /// `A.B<C>`
    fn flow_generic_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let base = self.s.names.len();
        loop {
            let name = self.identifier_name();
            self.s.names.push(name);
            if !self.eat(T::Dot) {
                break;
            }
        }
        let names = self.s.names.get(base..).unwrap_or_default();
        let name = self.f.entity_name(names.iter().copied());
        self.s.names.truncate(base);
        let args = match self.token() {
            T::LessThan | T::LessThanLessThan => self.flow_type_arguments(),
            _ => IdList::EMPTY,
        };
        self.finish_type(TypeNodeKind::Ref { name, args }, start)
    }

    /// `A, B<C>` after `extends`, `mixins` or `implements`.
    fn flow_heritage(&mut self) -> IdList<TypeNodeId> {
        let base = self.s.ids.len();
        loop {
            let ty = self.flow_generic_type();
            self.s.ids.push(ty.0);
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.take_ids(base)
    }

    /// `interface { }`, `interface extends A { }`
    fn flow_interface_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let base = self.s.ids.len();
        if self.eat(T::Extends) {
            loop {
                let ty = self.flow_generic_type();
                self.s.ids.push(ty.0);
                if !self.eat(T::Comma) {
                    break;
                }
            }
        }
        let open = self.pos();
        let members = self.flow_object_type_members(Body::Interface);
        let body = self.finish_type(TypeNodeKind::Object(members), open);
        self.s.ids.push(body.0);
        let parts = self.take_ids(base);
        self.finish_type(TypeNodeKind::Intersection(parts), start)
    }

    /// Type arguments, at the `<`.
    pub(crate) fn flow_type_arguments(&mut self) -> IdList<TypeNodeId> {
        if self.token() == T::LessThanLessThan {
            self.split_token(T::LessThan);
        }
        self.expect(T::LessThan);
        let base = self.s.ids.len();
        while self.is_in_list(T::GreaterThan) {
            let ty = self.flow_type();
            self.s.ids.push(ty.0);
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.expect(T::GreaterThan);
        self.take_ids(base)
    }

    /// The type arguments of a call or of a record expression, at the `<`, if that is what it is.
    /// `is_in_new`: of a `new` expression, which needs no arguments.
    pub(crate) fn flow_type_arguments_in_expression(
        &mut self,
        is_in_new: bool,
    ) -> Option<IdList<TypeNodeId>> {
        // flow-parser takes `async<T>(` for the start of an arrow function, which this is not.
        if !self.options.dialect.babel
            && let Some(&Expr {
                kind: ExprKind::Ident(name),
                end,
                ..
            }) = self.f.exprs.last()
            && end == self.prev_end()
            && self.lx.text_of(name) == b"async"
        {
            self.fail();
            return None;
        }
        self.try_parse(|p| {
            let type_arguments = p.flow_type_arguments();
            let is_before_braces = p.token() == T::OpenBrace && !p.newline_before();
            (is_in_new || p.token() == T::OpenParen || is_before_braces).then_some(type_arguments)
        })
    }

    /// Type parameters, at the `<`.
    pub(crate) fn flow_type_parameters(&mut self) -> Span<TypeParamId> {
        if self.token() == T::LessThanLessThan {
            self.split_token(T::LessThan);
        }
        self.expect(T::LessThan);
        let base = self.s.type_params.len();
        loop {
            self.flow_type_parameter();
            if !self.eat(T::Comma) || self.token() == T::GreaterThan {
                break;
            }
        }
        self.expect(T::GreaterThan);
        take_span!(self, type_params, base)
    }

    fn flow_type_parameter(&mut self) {
        let start = self.pos();
        let first_modifier = self.s.modifiers.len();
        let mut flags = Flags::empty();
        if self.token() == T::Const {
            flags |= Flags::CONST;
            self.modifier_token(Flags::CONST);
        }
        let variance = match self.token() {
            T::Plus => Flags::OUT,
            T::Minus => Flags::IN,
            // Each can be the name.
            T::In | T::Out
                if self.peek().is_identifier_or_keyword() && self.peek() != T::Extends =>
            {
                match self.token() {
                    T::In => Flags::IN,
                    _ => Flags::OUT,
                }
            }
            _ => Flags::empty(),
        };
        if !variance.is_empty() {
            flags |= variance;
            self.modifier_token(variance);
        }
        let (name, pos) = self.identifier_name();
        let constraint = match self.token() {
            T::Colon | T::Extends => {
                self.next();
                self.flow_type()
            }
            _ => TypeNodeId::NONE,
        };
        let default = match self.eat(T::Equals) {
            true => self.flow_type(),
            false => TypeNodeId::NONE,
        };
        let end = self.prev_end();
        let modifiers = self.take_modifiers(first_modifier);
        self.s.type_params.push(TypeParam {
            name,
            pos,
            start,
            end,
            constraint,
            default,
            flags,
            modifiers,
        });
    }

    /// Whether the token is a name that a `:` or `?:` follows: that of a parameter of a function
    /// type, of an element of a tuple, of an indexer.
    fn is_at_label(&mut self) -> bool {
        self.token().is_identifier_or_keyword()
            && self.token() != T::PrivateIdentifier
            && self.look_ahead(|p| {
                p.next();
                p.eat(T::Question);
                p.token() == T::Colon
            })
    }

    /// A parameter of a function type: `T`, `name: T`, `name?: T`, and each after `...`.
    fn flow_function_type_parameter(&mut self) {
        let start = self.start();
        let mut flags = Flags::empty();
        if self.eat(T::DotDotDot) {
            flags |= Flags::REST;
        }
        if !self.is_at_label() {
            let ty = self.flow_type();
            return self.push_unnamed_parameter(start, ty, flags);
        }
        let (name, pos, end) = self.word();
        let pat = self.f.pat(PatKind::Ident(name), pos, end);
        if self.eat(T::Question) {
            flags |= Flags::OPTIONAL;
        }
        self.expect(T::Colon);
        let ty = self.flow_type();
        self.s.params.push(Param {
            pat,
            ty,
            default: ExprId::NONE,
            flags,
            pos: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
        });
    }

    /// Takes the parameters on the stack from `base` on: the `this` parameter, and the others.
    fn take_function_type_parameters(&mut self, base: usize) -> (ParamId, Span<ParamId>) {
        let list: Span<ParamId> = take_span!(self, params, base);
        let first = self
            .f
            .params
            .get(list.start as usize)
            .filter(|_| !list.is_empty());
        let name = first.and_then(|first| self.f.pats.get(first.pat.idx()));
        match name {
            Some(Pat {
                kind: PatKind::Ident(known::this),
                ..
            }) => (ParamId(list.start), Span::new(list.start + 1, list.len - 1)),
            _ => (ParamId::NONE, list),
        }
    }

    /// The parameters of a function type, at the `(`.
    fn flow_function_type_parameters(&mut self) -> (ParamId, Span<ParamId>) {
        self.expect(T::OpenParen);
        let base = self.s.params.len();
        self.flow_function_type_parameter_list();
        self.expect(T::CloseParen);
        self.take_function_type_parameters(base)
    }

    /// Pushes the parameters up to the `)`.
    fn flow_function_type_parameter_list(&mut self) {
        while self.is_in_list(T::CloseParen) {
            self.flow_function_type_parameter();
            if !self.eat(T::Comma) {
                break;
            }
        }
    }

    /// `(T)`, `(A, b: B) => C`
    fn flow_function_type_or_group(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let base = self.s.params.len();
        let allows_function = !self.has_context(ctx::NO_ANONYMOUS_FUNCTION_TYPE);
        let mut is_function =
            matches!(self.token(), T::CloseParen | T::DotDotDot) || self.is_at_label();
        if !is_function {
            let first = self.start();
            let ty = self.flow_type();
            is_function = allows_function
                && match self.token() {
                    T::Comma => true,
                    T::CloseParen => self.peek() == T::EqualsGreaterThan,
                    _ => false,
                };
            if !is_function {
                self.expect(T::CloseParen);
                return ty;
            }
            self.push_unnamed_parameter(first, ty, Flags::empty());
            self.eat(T::Comma);
        }
        self.flow_function_type_parameter_list();
        self.expect(T::CloseParen);
        let params = self.take_function_type_parameters(base);
        self.flow_function_type_rest(start, Span::EMPTY, params, start)
    }

    /// `[A, b: B, +c?: C, ...D, ...]`
    fn flow_tuple_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let base = self.s.tuple_elems.len();
        while self.is_in_list(T::CloseBracket) {
            self.flow_tuple_element();
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.expect(T::CloseBracket);
        let elements = take_span!(self, tuple_elems, base);
        self.finish_type(TypeNodeKind::Tuple(elements), start)
    }

    fn flow_tuple_element(&mut self) {
        let start = self.pos();
        let has_dots = self.eat(T::DotDotDot);
        let (mut name, mut optional, mut ty) = (Atom::NONE, false, TypeNodeId::NONE);
        if !has_dots {
            let is_variance =
                matches!(self.token(), T::Plus | T::Minus) || self.is_at_variance_keyword();
            if is_variance {
                self.next();
            }
        }
        if self.is_at_label() {
            (name, ..) = self.word();
            optional = self.eat(T::Question);
            if optional && has_dots {
                self.fail();
            }
            self.expect(T::Colon);
        }
        // `...` alone: there can be more elements.
        if !(has_dots && name.is_none() && self.token() == T::CloseBracket) {
            ty = self.flow_type();
        }
        self.s.tuple_elems.push(TupleElem {
            ty,
            written: ty,
            member_type: TupleMemberType::Plain,
            name,
            optional,
            rest: has_dots,
            has_dots,
            start,
            end: self.prev_end(),
        });
    }

    /// Whether the token is `readonly` or `writeonly` before the name of a property, of an element
    /// of a tuple, or before an indexer.
    fn is_at_variance_keyword(&mut self) -> bool {
        (self.token() == T::Readonly || self.is_word(b"writeonly")) && {
            let next = self.peek();
            next.is_identifier_or_keyword()
                || matches!(next, T::String | T::Number | T::BigInt | T::OpenBracket)
        }
    }

    /// The `+` or `-` before the name of a member of a class, which is no method.
    pub(crate) fn flow_variance(&mut self) {
        self.flow_variance_token();
        let is_before_method = self.look_ahead_parsing(|p| {
            p.property_name();
            matches!(p.token(), T::OpenParen | T::LessThan)
        });
        if is_before_method {
            self.fail();
        }
    }

    /// Pushes `+`, `-`, `readonly` or `writeonly` on the stack of modifiers, if the token is one.
    fn flow_variance_token(&mut self) {
        match self.token() {
            T::Plus => self.modifier_token(Flags::OUT),
            T::Minus => self.modifier_token(Flags::IN),
            T::Readonly if self.is_at_variance_keyword() => self.modifier_token(Flags::READONLY),
            T::Identifier if self.is_at_variance_keyword() => self.modifier_token(Flags::empty()),
            _ => {}
        }
    }

    // ───────────────────────────── object types ─────────────────────────────

    /// The members of an object type, at the `{`.
    fn flow_object_type_members(&mut self, body: Body) -> Span<MemberId> {
        if self.is_too_deep() {
            return Span::EMPTY;
        }
        let is_exact = self.is_directly_before(b'|');
        self.expect(T::OpenBrace);
        let base = self.s.members.len();
        match self.token() {
            // `{||}`
            T::BarBar if is_exact => self.split_token(T::Bar),
            _ => {}
        }
        if is_exact {
            self.expect(T::Bar);
        }
        let saved = self.enter_context(ctx::TYPE, 0);
        while self.is_in_list(T::CloseBrace) && self.token() != T::Bar {
            let member = self.flow_object_type_member(body);
            self.s.members.push(member);
            if !matches!(self.token(), T::Comma | T::Semicolon) {
                break;
            }
            self.next();
        }
        self.context = saved;
        if is_exact {
            self.expect(T::Bar);
        }
        self.expect(T::CloseBrace);
        take_span!(self, members, base)
    }

    /// From the type parameters of a method, an accessor or a call property to its return type.
    fn flow_method_signature(
        &mut self,
        kind: FnKind,
        flags: Flags,
        name: Atom,
        name_pos: u32,
        start: u32,
    ) -> FnId {
        let type_params = self.type_parameters();
        let anchor = self.pos();
        let (this_param, params) = self.flow_function_type_parameters();
        self.expect(T::Colon);
        let ret = self.flow_return_type(0);
        self.f.add_fn(Func {
            kind,
            flags,
            name,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor,
            start,
        })
    }

    /// The name of a property of an object type. `@@iterator` is one.
    fn flow_property_name(&mut self, member: &mut Member) {
        if self.token() == T::At && self.is_directly_before(b'@') {
            let start = self.pos();
            self.next();
            self.next();
            let end = self.lx.end;
            self.identifier_name();
            let text = self
                .lx
                .src
                .get(start as usize..end as usize)
                .unwrap_or_default();
            (member.key, member.name_pos) = (PropKey::Name(self.atom(text)), start);
            return;
        }
        if self.token() == T::OpenBracket {
            return self.fail();
        }
        let (key, name_kind, name_pos) = self.property_name();
        (member.key, member.name_pos) = (key, name_pos);
        match name_kind {
            NameKind::StringLiteral => member.flags |= Flags::STRING_NAME,
            NameKind::NumericLiteral => member.flags |= Flags::LITERAL_NAME,
            _ => {}
        }
    }

    fn flow_object_type_member(&mut self, body: Body) -> Member {
        let start = self.start();
        let mut member = Member {
            kind: MemberKind::Property,
            key: PropKey::None,
            flags: Flags::empty(),
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            name_pos: start.pos,
            start: start.pos,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        };
        let first_modifier = self.s.modifiers.len();
        self.flow_object_type_member_rest(body, start, &mut member);
        // No method, accessor or call property has a variance.
        let is_variance = |it: &Modifier| match it.kind {
            ModifierKind::Keyword(flag) if flag.is_empty() => {
                self.lx.src.get(it.pos as usize) == Some(&b'w')
            }
            ModifierKind::Keyword(flag) => {
                flag.intersects(Flags::IN | Flags::OUT | Flags::READONLY)
            }
            ModifierKind::Decorator(_) => false,
        };
        let written = self.s.modifiers.get(first_modifier..).unwrap_or_default();
        if member.func.is_some()
            && member.kind != MemberKind::IndexSignature
            && written.iter().any(is_variance)
        {
            self.fail();
        }
        member.modifiers = self.take_modifiers(first_modifier);
        member.loc = TextRange {
            pos: start.full,
            end: self.prev_end(),
        };
        member
    }

    fn flow_object_type_member_rest(&mut self, body: Body, start: Start, member: &mut Member) {
        if self.eat(T::DotDotDot) {
            member.flags |= Flags::REST;
            // `...` alone: there can be more properties.
            if !matches!(
                self.token(),
                T::Comma | T::Semicolon | T::CloseBrace | T::Bar
            ) {
                member.ty = self.flow_type();
            }
            return;
        }
        // `static` and `proto` are names before these, and everywhere but in `declare class`
        // before the parameters of a method.
        let is_static = self.token() == T::Static;
        if is_static || self.is_word(b"proto") {
            let is_modifier = match self.peek() {
                T::Colon | T::Question => false,
                T::OpenParen | T::LessThan => body == Body::Class && is_static,
                _ => true,
            };
            if is_modifier && is_static {
                member.flags |= Flags::STATIC;
                self.modifier_token(Flags::STATIC);
            } else if is_modifier {
                self.modifier_token(Flags::empty());
            }
        }
        self.flow_variance_token();
        match self.token() {
            T::OpenBracket => return self.flow_bracketed_member(start, member),
            T::OpenParen | T::LessThan => {
                member.kind = MemberKind::CallSignature;
                let kind = FnKind::CallSignature;
                member.func = self.flow_method_signature(
                    kind,
                    member.flags,
                    Atom::NONE,
                    start.pos,
                    start.pos,
                );
                return;
            }
            _ => {}
        }
        let mut fn_kind = FnKind::Method;
        if matches!(self.token(), T::Get | T::Set)
            && !matches!(
                self.peek(),
                T::Colon | T::Question | T::OpenParen | T::LessThan
            )
        {
            (member.kind, fn_kind) = match self.token() {
                T::Get => (MemberKind::Getter, FnKind::Getter),
                _ => (MemberKind::Setter, FnKind::Setter),
            };
            self.next();
        }
        self.flow_property_name(member);
        if member.kind != MemberKind::Property || matches!(self.token(), T::OpenParen | T::LessThan)
        {
            if member.kind == MemberKind::Property {
                member.kind = MemberKind::Method;
            }
            let name = member.key.name().unwrap_or(Atom::NONE);
            let flags = member.flags - Flags::LITERAL_NAME;
            member.func =
                self.flow_method_signature(fn_kind, flags, name, member.name_pos, start.pos);
            return;
        }
        if self.eat(T::Question) {
            member.flags |= Flags::OPTIONAL;
        }
        self.expect(T::Colon);
        member.ty = self.flow_type();
    }

    /// `[[slot]]: T`, `[K]: V`, `[k: K]: V`, `[K in T]: V`, at the `[`.
    fn flow_bracketed_member(&mut self, start: Start, member: &mut Member) {
        let bracket = self.pos();
        self.next();
        if self.eat(T::OpenBracket) {
            let (name, name_pos) = self.identifier_name();
            self.expect(T::CloseBracket);
            self.expect(T::CloseBracket);
            (member.key, member.name_pos) = (PropKey::Name(name), name_pos);
            member.flags |= Flags::COMPUTED_NAME;
            if matches!(self.token(), T::OpenParen | T::LessThan) {
                member.kind = MemberKind::Method;
                member.func = self.flow_method_signature(
                    FnKind::Method,
                    member.flags,
                    name,
                    name_pos,
                    start.pos,
                );
                return;
            }
            if self.eat(T::Question) {
                member.flags |= Flags::OPTIONAL;
            }
            self.expect(T::Colon);
            member.ty = self.flow_type();
            return;
        }
        if self.token().is_identifier_or_keyword() && self.peek() == T::In {
            member.ty = self.flow_mapped_type_property(start.pos);
            return;
        }
        let base = self.s.params.len();
        self.flow_function_type_parameter();
        let params = take_span!(self, params, base);
        self.expect(T::CloseBracket);
        self.expect(T::Colon);
        let ty = self.flow_type();
        member.kind = MemberKind::IndexSignature;
        member.ty = ty;
        member.func = self.f.add_fn(Func {
            kind: FnKind::IndexSignature,
            flags: member.flags,
            name: Atom::NONE,
            name_pos: bracket,
            type_params: Span::EMPTY,
            params,
            this_param: ParamId::NONE,
            ret: ty,
            body: FnBody::None,
            anchor: bracket,
            start: start.pos,
        });
    }

    /// `[K in T]: V`, `[K in T]?: V`, at the `K`. `start`: of the member.
    fn flow_mapped_type_property(&mut self, start: u32) -> TypeNodeId {
        let (name, pos) = self.identifier_name();
        self.expect(T::In);
        let constraint = self.flow_type();
        let param_end = self.prev_end();
        self.expect(T::CloseBracket);
        let (mut optional, mut is_optional_with_plus) = (MappedModifier::None, false);
        match self.token() {
            T::Question => optional = MappedModifier::Add,
            T::Plus => {
                self.next();
                (optional, is_optional_with_plus) = (MappedModifier::Add, true);
            }
            T::Minus => {
                self.next();
                optional = MappedModifier::Remove;
            }
            _ => {}
        }
        if optional != MappedModifier::None {
            self.expect(T::Question);
        }
        self.expect(T::Colon);
        let ty = self.flow_type();
        let param = self.f.add_type_param(TypeParam {
            name,
            pos,
            start: pos,
            end: param_end,
            constraint,
            default: TypeNodeId::NONE,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
        });
        let mapped = self.f.add_mapped(Mapped {
            param,
            name_ty: TypeNodeId::NONE,
            ty,
            readonly: MappedModifier::None,
            optional,
            is_readonly_with_plus: false,
            is_optional_with_plus,
            members: Span::EMPTY,
        });
        self.finish_type(TypeNodeKind::Mapped(mapped), start)
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `(e: T)`, at the `:`. `open`: the position of the `(`.
    pub(crate) fn flow_type_cast(&mut self, open: u32, expr: ExprId) -> ExprId {
        self.next();
        let ty = self.flow_type();
        self.expect(T::CloseParen);
        self.finish_expr(ExprKind::As { expr, ty }, open)
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// Whether the token is a word that starts a declaration of Flow's and that is a name for
    /// TypeScript: `opaque type`, `component A`, `hook useA`.
    pub(crate) fn flow_is_at_declaration_word(&mut self) -> bool {
        if self.token() != T::Identifier {
            return false;
        }
        match self.lx.text() {
            b"opaque" => self.peek() == T::Type,
            b"component" | b"hook" | b"record" => self.look_ahead(|p| {
                p.next();
                p.is_identifier() && !p.newline_before()
            }),
            _ => false,
        }
    }

    /// What starts at `start` with `expression`, after which the token cannot end a statement: a
    /// declaration, if the expression is one of the words that start one.
    pub(crate) fn flow_declaration_after_expression(
        &mut self,
        start: Start,
        expression: ExprId,
    ) -> StmtId {
        if self.token() == T::OpenBrace
            && !self.newline_before()
            && self.flow_is_match_head(expression)
        {
            return self.flow_match_statement(start, expression);
        }
        let word = match self.f.exprs.last() {
            Some(&Expr {
                kind: ExprKind::Ident(word),
                pos,
                ..
            }) if pos == start.pos && expression.idx() + 1 == self.f.exprs.len() => word,
            _ => Atom::NONE,
        };
        let base = self.s.modifiers.len();
        let is_before_word = self.flow_is_at_declaration_word();
        let (flag, first) = match self.lx.text_of(word) {
            b"async" if is_before_word => (Flags::ASYNC, None),
            b"opaque" => (Flags::empty(), Some(b'o')),
            b"component" => (Flags::empty(), Some(b'c')),
            b"hook" => (Flags::empty(), Some(b'h')),
            b"record" => (Flags::empty(), Some(b'r')),
            _ => {
                self.fail();
                return StmtId::NONE;
            }
        };
        self.f.exprs.pop();
        self.s.modifiers.push(Modifier {
            kind: ModifierKind::Keyword(flag),
            pos: start.pos,
        });
        match first {
            Some(_) => self.flow_declaration_after_modifiers(start, base, Flags::empty(), first),
            None => self.flow_declaration_at_word(start, base, Flags::ASYNC),
        }
    }

    /// A declaration whose modifiers, which are on the stack from `base` on, are followed by a word
    /// for which `flow_is_at_declaration_word` holds.
    pub(crate) fn flow_declaration_at_word(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        if !self.flow_is_at_declaration_word() {
            self.fail();
            return StmtId::NONE;
        }
        let first = self.lx.text().first().copied();
        self.modifier_token(Flags::empty());
        self.flow_declaration_after_modifiers(start, base, flags, first)
    }

    /// `first`: the first letter of the word, which is the last of the modifiers.
    fn flow_declaration_after_modifiers(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
        first: Option<u8>,
    ) -> StmtId {
        let is_ambient = flags.contains(Flags::AMBIENT) || self.has_context(ctx::AMBIENT);
        match first {
            Some(b'o') => self.flow_opaque_type(start, base, flags),
            Some(b'c') => self.flow_component(start, base, flags),
            Some(b'r') => self.flow_record(start, base, flags),
            _ if is_ambient => self.flow_declare_function_rest(start, base, flags),
            _ => {
                let (name, name_pos) = self.identifier();
                let fn_flags = flags & (Flags::EXPORT | Flags::DEFAULT | Flags::ASYNC);
                let func = self.function_rest(FnKind::Decl, fn_flags, name, name_pos, start.pos);
                let modifiers = self.take_modifiers(base);
                self.add_stmt(StmtKind::Fn(func), start, modifiers)
            }
        }
    }

    /// The modifiers on the stack from `base` on are before what has no decorators.
    pub(crate) fn flow_refuse_decorators(&mut self, base: usize) {
        let is_decorator = |it: &Modifier| matches!(it.kind, ModifierKind::Decorator(_));
        let written = self.s.modifiers.get(base..).unwrap_or_default();
        if written.iter().any(is_decorator) {
            self.fail();
        }
    }

    /// The modifiers on the stack from `base` on, whose flags are `flags`, are not all JavaScript's.
    /// `declare` before `export` belongs to the `export`, not to what is exported: it gets no flag.
    pub(crate) fn flow_declare_before_export(&mut self, base: usize, flags: Flags) {
        if flags.contains(Flags::AMBIENT | Flags::EXPORT)
            && let Some(first) = self.s.modifiers.get_mut(base)
            && first.kind == ModifierKind::Keyword(Flags::AMBIENT)
        {
            first.kind = ModifierKind::Keyword(Flags::empty());
        }
    }

    /// The name of a type that is declared, which is not that of a type of the language.
    fn flow_type_name(&mut self) -> (Atom, u32) {
        if matches!(
            self.lx.text(),
            b"any"
                | b"bigint"
                | b"bool"
                | b"boolean"
                | b"empty"
                | b"extends"
                | b"false"
                | b"interface"
                | b"mixed"
                | b"null"
                | b"number"
                | b"static"
                | b"string"
                | b"symbol"
                | b"true"
                | b"typeof"
                | b"void"
        ) {
            self.fail();
        }
        self.identifier()
    }

    /// `type A<T> = B`, at `type`.
    pub(crate) fn flow_type_alias(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.next();
        let (name, name_pos) = self.flow_type_name();
        let type_params = self.type_parameters();
        self.expect(T::Equals);
        let ty = self.flow_type();
        self.semicolon();
        self.add_alias(start, base, flags, (name, name_pos), type_params, ty)
    }

    fn add_alias(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
        (name, name_pos): (Atom, u32),
        type_params: Span<TypeParamId>,
        ty: TypeNodeId,
    ) -> StmtId {
        let alias = self.f.add_alias(Alias {
            name,
            name_pos,
            flags: flags | self.ambient(),
            type_params,
            ty,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::TypeAlias(alias), start, modifiers);
        self.f[alias].stmt = statement;
        statement
    }

    fn add_interface(&mut self, start: Start, base: usize, interface: Interface) -> StmtId {
        let interface = self.f.add_interface(interface);
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::Interface(interface), start, modifiers);
        self.f[interface].stmt = statement;
        statement
    }

    /// `opaque type A<T>: B = C`, at `type`.
    fn flow_opaque_type(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.expect(T::Type);
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
        let bounds = self.s.ids.len();
        if self.eat(T::Super) {
            let saved = self.enter_context(ctx::TYPE, 0);
            let lower = self.flow_union_type();
            self.context = saved;
            self.s.ids.push(lower.0);
        }
        if self.eat(T::Extends) || self.s.ids.len() == bounds && self.eat(T::Colon) {
            let upper = self.flow_type();
            self.s.ids.push(upper.0);
        }
        let extends = self.take_ids(bounds);
        let other_heritage = match self.eat(T::Equals) {
            true => {
                let ty = self.flow_type();
                self.f.list(&[ty])
            }
            false => IdList::EMPTY,
        };
        self.semicolon();
        let interface = Interface {
            name,
            name_pos,
            flags: flags | self.ambient(),
            type_params,
            extends,
            other_heritage,
            members: Span::EMPTY,
            stmt: StmtId::NONE,
        };
        self.add_interface(start, base, interface)
    }

    /// `interface A<T> extends B { }`, at `interface`.
    pub(crate) fn flow_interface(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.next();
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
        let extends = match self.eat(T::Extends) {
            true => self.flow_heritage(),
            false => IdList::EMPTY,
        };
        let members = self.flow_object_type_members(Body::Interface);
        let interface = Interface {
            name,
            name_pos,
            flags: flags | self.ambient(),
            type_params,
            extends,
            other_heritage: IdList::EMPTY,
            members,
            stmt: StmtId::NONE,
        };
        self.add_interface(start, base, interface)
    }

    /// `declare class A<T> extends B<T> mixins C implements D { }`, at `class`.
    pub(crate) fn flow_declare_class(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.flow_refuse_decorators(base);
        if flags.contains(Flags::ABSTRACT) {
            self.fail();
        }
        self.next();
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
        let (mut extends, mut extends_args) = (ExprId::NONE, IdList::EMPTY);
        if self.eat(T::Extends) {
            let first = self.pos();
            loop {
                let (name, name_pos, end) = self.word();
                let kind = match extends.is_none() {
                    true => ExprKind::Ident(name),
                    false => ExprKind::Dot {
                        obj: extends,
                        name,
                        name_pos,
                        chain: Chain::No,
                    },
                };
                extends = self.add_expr(kind, first, end);
                if !self.eat(T::Dot) {
                    break;
                }
            }
            if self.token() == T::LessThan {
                extends_args = self.flow_type_arguments();
            }
        }
        let mut other_implements = IdList::EMPTY;
        if self.is_word(b"mixins") {
            self.next();
            other_implements = self.flow_heritage();
        }
        let implements = match self.eat(T::Implements) {
            true => self.flow_heritage(),
            false => IdList::EMPTY,
        };
        let members = self.flow_object_type_members(Body::Class);
        let modifiers = self.take_modifiers(base);
        let class = self.f.add_class(Class {
            name,
            name_pos,
            flags: Flags::AMBIENT | flags & (Flags::EXPORT | Flags::DEFAULT),
            type_params,
            extends,
            extends_args,
            other_extends: IdList::EMPTY,
            implements,
            other_implements,
            members,
            start: start.pos,
            modifiers,
        });
        self.add_stmt(StmtKind::Class(class), start, modifiers)
    }

    /// `declare function f<T>(A, b: B): C %checks(e);`, at `function`.
    pub(crate) fn flow_declare_function(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        self.next();
        self.flow_declare_function_rest(start, base, flags)
    }

    /// From the name of a function or a hook that is declared.
    fn flow_declare_function_rest(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
        let anchor = self.pos();
        let saved = self.enter_context(ctx::TYPE, 0);
        let (this_param, params) = self.flow_function_type_parameters();
        self.context = saved;
        self.expect(T::Colon);
        let ret = self.flow_return_type_and_predicate(0);
        self.semicolon();
        let func = self.f.add_fn(Func {
            kind: FnKind::Decl,
            flags: Flags::AMBIENT | flags & (Flags::EXPORT | Flags::DEFAULT),
            name,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor,
            start: start.pos,
        });
        let modifiers = self.take_modifiers(base);
        self.add_stmt(StmtKind::Fn(func), start, modifiers)
    }

    /// `declare module.exports: T;`, at `module`.
    pub(crate) fn flow_declare_module_exports(&mut self, start: Start, base: usize) -> StmtId {
        let name_pos = self.pos();
        self.next();
        self.expect(T::Dot);
        if !self.is_word(b"exports") {
            self.fail();
        }
        self.next();
        self.expect(T::Colon);
        let ty = self.flow_type();
        self.semicolon();
        let name = (self.atom(b"module.exports"), name_pos);
        self.add_alias(start, base, Flags::AMBIENT, name, Span::EMPTY, ty)
    }

    /// `declare export default T;`, at the `default`. `export` is not among the modifiers yet.
    pub(crate) fn flow_declare_export_default_type(
        &mut self,
        start: Start,
        base: usize,
        export: u32,
    ) -> StmtId {
        self.s.modifiers.push(Modifier {
            kind: ModifierKind::Keyword(Flags::EXPORT),
            pos: export,
        });
        self.flow_declare_before_export(base, Flags::AMBIENT | Flags::EXPORT);
        let name = (known::default, self.pos());
        self.modifier_token(Flags::DEFAULT);
        let ty = self.flow_type();
        self.semicolon();
        let flags = Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT;
        self.add_alias(start, base, flags, name, Span::EMPTY, ty)
    }

    /// `enum A of string { B = "b", ... }`, at `enum`.
    pub(crate) fn flow_enum(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.next();
        let (name, name_pos) = self.identifier();
        if self.eat(T::Of) {
            self.identifier_name();
        }
        self.expect(T::OpenBrace);
        let members = self.s.enum_members.len();
        while self.is_in_list(T::CloseBrace) {
            let member = self.start();
            let (mut name, mut init) = (Atom::NONE, ExprId::NONE);
            if !self.eat(T::DotDotDot) {
                (name, _) = self.identifier_name();
                init = self.optional_initializer();
            }
            self.s.enum_members.push(EnumMember {
                name,
                name_kind: NameKind::Identifier,
                computed_name: ExprId::NONE,
                init,
                pos: member.pos,
                loc: TextRange {
                    pos: member.full,
                    end: self.prev_end(),
                },
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.expect(T::CloseBrace);
        let members = take_span!(self, enum_members, members);
        let declaration = self.f.add_enum(Enum {
            name,
            name_pos,
            flags: self.ambient() | flags & Flags::EXPORT,
            members,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::Enum(declaration), start, modifiers);
        self.f[declaration].stmt = statement;
        statement
    }

    // ───────────────────────────── components ─────────────────────────────

    /// `component A<T>(a: B, 'c' as d: E = 1, ...f: G) renders H { }`, at the name.
    fn flow_component(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        let is_ambient = flags.contains(Flags::AMBIENT) || self.has_context(ctx::AMBIENT);
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
        let anchor = self.pos();
        let params = match is_ambient {
            true => self.flow_component_type_parameters(),
            false => self.flow_component_parameters(),
        };
        let ret = match self.is_word(b"renders") {
            true => self.flow_renders_type(true),
            false => TypeNodeId::NONE,
        };
        let context = match flags.contains(Flags::ASYNC) {
            true => ctx::AWAIT,
            false => 0,
        };
        // Where everything is declared, like in a `.js.flow` file, it has no body either.
        let (body, open) = match self.token() {
            T::OpenBrace if !is_ambient => self.function_block(context),
            _ => {
                self.semicolon();
                (FnBody::None, 0)
            }
        };
        let kept = Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT | Flags::ASYNC;
        let func = self.f.add_fn(Func {
            kind: FnKind::Decl,
            flags: flags & kept,
            name,
            name_pos,
            type_params,
            params,
            this_param: ParamId::NONE,
            ret,
            body,
            anchor,
            start: start.pos,
        });
        if matches!(body, FnBody::Block(_)) {
            self.f.body_starts.push((func, open));
        }
        let modifiers = self.take_modifiers(base);
        self.add_stmt(StmtKind::Fn(func), start, modifiers)
    }

    /// The parameters of a component with a body, at the `(`.
    fn flow_component_parameters(&mut self) -> Span<ParamId> {
        self.expect(T::OpenParen);
        let base = self.s.params.len();
        while self.is_in_list(T::CloseParen) {
            let start = self.start();
            let mut flags = Flags::empty();
            if self.eat(T::DotDotDot) {
                flags |= Flags::REST;
            } else if self.token() == T::String || self.peek() == T::As {
                // The name that the caller gives it.
                self.next();
                self.expect(T::As);
            }
            let pat = self.identifier_or_pattern();
            if self.eat(T::Question) {
                flags |= Flags::OPTIONAL;
            }
            let ty = self.type_annotation();
            let default = self.optional_initializer();
            self.s.params.push(Param {
                pat,
                ty,
                default,
                flags,
                pos: start.pos,
                loc: TextRange {
                    pos: start.full,
                    end: self.prev_end(),
                },
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.expect(T::CloseParen);
        take_span!(self, params, base)
    }

    /// The parameters of a component type, or of a component that is declared, at the `(`:
    /// `a: A`, `'b'?: B`, `...C`, `...c: C`.
    fn flow_component_type_parameters(&mut self) -> Span<ParamId> {
        self.expect(T::OpenParen);
        let base = self.s.params.len();
        let saved = self.enter_context(ctx::TYPE, 0);
        while self.is_in_list(T::CloseParen) {
            if self.token() != T::String {
                self.flow_function_type_parameter();
            } else {
                let start = self.start();
                self.next();
                let flags = match self.eat(T::Question) {
                    true => Flags::OPTIONAL,
                    false => Flags::empty(),
                };
                self.expect(T::Colon);
                let ty = self.flow_type();
                self.push_unnamed_parameter(start, ty, flags);
            }
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        self.expect(T::CloseParen);
        take_span!(self, params, base)
    }

    /// `component<T>(a: A, ...B) renders C`
    fn flow_component_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let type_params = self.type_parameters();
        let anchor = self.pos();
        let params = self.flow_component_type_parameters();
        let ret = match self.is_word(b"renders") {
            true => self.flow_renders_type(false),
            false => TypeNodeId::NONE,
        };
        let func = self.f.add_fn(Func {
            kind: FnKind::FunctionType,
            flags: Flags::empty(),
            name: Atom::NONE,
            name_pos: start,
            type_params,
            params,
            this_param: ParamId::NONE,
            ret,
            body: FnBody::None,
            anchor,
            start,
        });
        self.finish_type(TypeNodeKind::Fn(func), start)
    }

    // ───────────────────────────── match ─────────────────────────────

    /// Whether `e`, which was just parsed, is `match (a)`, `match (a, b)`.
    fn flow_is_match_head(&self, e: ExprId) -> bool {
        let Some(&Expr {
            kind: ExprKind::Call(call),
            ..
        }) = self.f.exprs.get(e.idx())
        else {
            return false;
        };
        let Some(call) = self.f.calls.get(call.idx()) else {
            return false;
        };
        let is_match = |it: &Expr| match it.kind {
            ExprKind::Ident(name) => it.end - it.pos == 5 && self.lx.text_of(name) == b"match",
            _ => false,
        };
        let is_spread = |i| {
            let argument: ExprId = self.f.id_at(call.args, i);
            matches!(
                self.f.exprs.get(argument.idx()).map(|it| it.kind),
                Some(ExprKind::Spread(_))
            )
        };
        call.chain == Chain::No
            && call.type_args.is_empty()
            && !call.args.is_empty()
            && !(0..call.args.len()).any(is_spread)
            && self.f.exprs.get(call.callee.idx()).is_some_and(is_match)
            && !self.is_parenthesized(e)
    }

    /// At a `{` after `expression`, which starts at `start`: the match expression or the record
    /// expression that the two are. `None`: the `{` is not part of the expression.
    pub(crate) fn flow_braces_after_expression(
        &mut self,
        start: u32,
        expression: ExprId,
    ) -> Option<ExprId> {
        if self.newline_before() || self.has_context(ctx::NO_RECORD) {
            return None;
        }
        if self.flow_is_match_head(expression) {
            // That is a statement.
            if start == self.flow_statement_start {
                return None;
            }
            return Some(self.flow_match_expression(start, expression));
        }
        if self.is_parenthesized(expression) {
            return None;
        }
        let is_constructor = |p: &Self, e: ExprId| match p.f.exprs.get(e.idx()).map(|it| it.kind) {
            Some(ExprKind::Ident(name)) => !p
                .lx
                .text_of(name)
                .first()
                .is_none_or(u8::is_ascii_lowercase),
            Some(
                ExprKind::Dot {
                    chain: Chain::No, ..
                }
                | ExprKind::Index {
                    chain: Chain::No, ..
                },
            ) => true,
            _ => false,
        };
        let (mut constructor, mut type_args) = (expression, IdList::EMPTY);
        if expression.idx() + 1 == self.f.exprs.len()
            && let Some(&Expr {
                kind:
                    ExprKind::Instantiation {
                        expr,
                        type_args: written,
                    },
                ..
            }) = self.f.exprs.last()
        {
            if !is_constructor(self, expr) {
                return None;
            }
            self.f.exprs.pop();
            (constructor, type_args) = (expr, written);
        } else if !is_constructor(self, expression) {
            return None;
        }
        let properties = self.object_literal();
        Some(self.flow_expression_with_braces(start, constructor, type_args, properties))
    }

    /// `head { }`
    fn flow_expression_with_braces(
        &mut self,
        start: u32,
        head: ExprId,
        type_args: IdList<TypeNodeId>,
        braces: ExprId,
    ) -> ExprId {
        let base = self.s.ids.len();
        self.s.ids.push(braces.0);
        let args = self.take_ids(base);
        let call = self.f.add_call(Call {
            callee: head,
            args,
            type_args,
            close_pos: u32::MAX,
            chain: Chain::No,
            template: ExprId::NONE,
        });
        self.finish_expr(ExprKind::New(call), start)
    }

    /// `match (a, b)` is `match ((a, b))`: the argument of `head`, which was just parsed, is one
    /// expression.
    fn flow_match_head(&mut self, head: ExprId) -> ExprId {
        let Some(&Expr {
            kind: ExprKind::Call(call),
            pos,
            end,
        }) = self.f.exprs.last()
        else {
            return head;
        };
        let args = self
            .f
            .calls
            .get(call.idx())
            .map_or(IdList::EMPTY, |it| it.args);
        if args.len() < 2 || head.idx() + 1 != self.f.exprs.len() {
            return head;
        }
        self.f.exprs.pop();
        let mut left: ExprId = self.f.id_at(args, 0);
        let start = self.f.exprs.get(left.idx()).map_or(pos, |it| it.pos);
        for i in 1..args.len() {
            let right: ExprId = self.f.id_at(args, i);
            let end = self.f.exprs.get(right.idx()).map_or(end, |it| it.end);
            let op = BinOp::Comma;
            left = self.add_expr(ExprKind::Binary { op, left, right }, start, end);
        }
        let base = self.s.ids.len();
        self.s.ids.push(left.0);
        let argument = self.take_ids(base);
        if let Some(call) = self.f.calls.get_mut(call.idx()) {
            call.args = argument;
        }
        self.add_expr(ExprKind::Call(call), pos, end)
    }

    /// `match (a) { b => c, d if (e) => f }`, at the `{`. `head`: the `match (a)`.
    fn flow_match_expression(&mut self, start: u32, head: ExprId) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let head = self.flow_match_head(head);
        let open = self.pos();
        self.next();
        let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR | ctx::NO_RECORD);
        let base = self.s.props.len();
        while self.is_in_list(T::CloseBrace) {
            let pos = self.pos();
            let pattern = self.flow_match_pattern_and_guard();
            self.expect(T::EqualsGreaterThan);
            let value = self.assignment_expression();
            self.s.props.push(Prop {
                kind: PropKind::Init,
                key: PropKey::Computed(pattern),
                name_kind: NameKind::Identifier,
                value,
                pos,
                start: pos,
                end: self.prev_end(),
                postfix_token: 0,
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        self.expect(T::CloseBrace);
        let cases = take_span!(self, props, base);
        let cases = self.finish_expr(ExprKind::Object(cases), open);
        self.flow_expression_with_braces(start, head, IdList::EMPTY, cases)
    }

    /// `match (a) { b => { } c if (d) => { } }`, at the `{`. `head`: the `match (a)`.
    fn flow_match_statement(&mut self, start: Start, head: ExprId) -> StmtId {
        let head = self.flow_match_head(head);
        self.next();
        let base = self.s.cases.len();
        while self.is_in_list(T::CloseBrace) {
            let pos = self.pos();
            let test = self.flow_match_pattern_and_guard();
            self.expect(T::EqualsGreaterThan);
            if self.token() != T::OpenBrace {
                self.fail();
                break;
            }
            let ids = self.s.ids.len();
            let block = self.block();
            self.s.ids.push(block.0);
            let body = self.take_ids(ids);
            self.s.cases.push(Case {
                test,
                body,
                pos,
                end: self.prev_end(),
            });
            self.eat(T::Comma);
        }
        self.expect(T::CloseBrace);
        let cases = take_span!(self, cases, base);
        self.add_stmt(StmtKind::Switch { expr: head, cases }, start, Span::EMPTY)
    }

    /// `pattern`, `pattern if (guard)`
    fn flow_match_pattern_and_guard(&mut self) -> ExprId {
        let start = self.pos();
        let left = self.flow_match_pattern();
        if !self.eat(T::If) {
            return left;
        }
        self.expect(T::OpenParen);
        let right = self.expression_allowing_in();
        self.expect(T::CloseParen);
        let op = BinOp::And;
        self.finish_expr(ExprKind::Binary { op, left, right }, start)
    }

    /// `a`, `a | b`, `| a | b`, `a as b`, `a | b as const c`
    fn flow_match_pattern(&mut self) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let start = self.pos();
        self.eat(T::Bar);
        let mut left = self.flow_match_subpattern();
        while self.eat(T::Bar) {
            let (op, right) = (BinOp::BitOr, self.flow_match_subpattern());
            left = self.finish_expr(ExprKind::Binary { op, left, right }, start);
        }
        if self.eat(T::As) {
            let right = match self.token() {
                T::Const | T::Var | T::Let => self.flow_match_binding(),
                _ => self.flow_match_name(),
            };
            let op = BinOp::In;
            left = self.finish_expr(ExprKind::Binary { op, left, right }, start);
        }
        left
    }

    /// A name that a pattern binds, or that it starts with.
    fn flow_match_name(&mut self) -> ExprId {
        let end = self.lx.end;
        let (name, pos) = self.identifier();
        self.add_expr(ExprKind::Ident(name), pos, end)
    }

    /// `const a`, at the keyword.
    fn flow_match_binding(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let (op, operand) = (UnOp::Void, self.flow_match_name());
        self.finish_expr(ExprKind::Unary { op, operand }, start)
    }

    /// `...`, `...const a`, at the `...`: what is after the dots.
    fn flow_match_rest(&mut self) -> ExprId {
        self.next();
        match self.token() {
            T::Const | T::Var | T::Let => self.flow_match_binding(),
            _ => {
                let end = self.prev_end();
                self.add_expr(ExprKind::Missing, end, end)
            }
        }
    }

    fn flow_match_subpattern(&mut self) -> ExprId {
        let start = self.pos();
        match self.token() {
            T::Null | T::True | T::False | T::Number | T::BigInt | T::String => {
                self.primary_expression()
            }
            T::Plus | T::Minus => {
                let op = match self.token() {
                    T::Plus => UnOp::Plus,
                    _ => UnOp::Minus,
                };
                self.next();
                if !matches!(self.token(), T::Number | T::BigInt) {
                    self.fail();
                    return ExprId::NONE;
                }
                let operand = self.primary_expression();
                self.finish_expr(ExprKind::Unary { op, operand }, start)
            }
            T::Const | T::Var | T::Let => self.flow_match_binding(),
            T::OpenParen => {
                self.next();
                let pattern = self.flow_match_pattern();
                self.expect(T::CloseParen);
                pattern
            }
            T::OpenBrace => self.flow_match_object_pattern(),
            T::OpenBracket => {
                self.next();
                let base = self.s.ids.len();
                while self.is_in_list(T::CloseBracket) {
                    if self.token() == T::DotDotDot {
                        let dots = self.pos();
                        let rest = self.flow_match_rest();
                        let rest = self.finish_expr(ExprKind::Spread(rest), dots);
                        self.s.ids.push(rest.0);
                        break;
                    }
                    let element = self.flow_match_pattern();
                    self.s.ids.push(element.0);
                    if !self.eat(T::Comma) {
                        break;
                    }
                }
                self.expect(T::CloseBracket);
                let elements = self.take_ids(base);
                self.finish_expr(ExprKind::Array(elements), start)
            }
            _ => {
                let mut pattern = self.flow_match_name();
                loop {
                    let (obj, chain) = (pattern, Chain::No);
                    if self.eat(T::Dot) {
                        let (name, name_pos) = self.identifier_name();
                        let kind = ExprKind::Dot {
                            obj,
                            name,
                            name_pos,
                            chain,
                        };
                        pattern = self.finish_expr(kind, start);
                    } else if self.eat(T::OpenBracket) {
                        if !matches!(self.token(), T::Number | T::BigInt | T::String) {
                            self.fail();
                            return ExprId::NONE;
                        }
                        let index = self.primary_expression();
                        self.expect(T::CloseBracket);
                        pattern = self.finish_expr(ExprKind::Index { obj, index, chain }, start);
                    } else {
                        break;
                    }
                }
                if self.token() != T::OpenBrace {
                    return pattern;
                }
                let properties = self.flow_match_object_pattern();
                self.flow_expression_with_braces(start, pattern, IdList::EMPTY, properties)
            }
        }
    }

    /// `{ a: b, const c, ...const d }`, at the `{`.
    fn flow_match_object_pattern(&mut self) -> ExprId {
        let open = self.pos();
        self.next();
        let base = self.s.props.len();
        while self.is_in_list(T::CloseBrace) {
            let pos = self.pos();
            let mut prop = Prop {
                kind: PropKind::Init,
                key: PropKey::None,
                name_kind: NameKind::Identifier,
                value: ExprId::NONE,
                pos,
                start: pos,
                end: 0,
                postfix_token: 0,
            };
            match self.token() {
                T::DotDotDot => {
                    prop.kind = PropKind::Spread;
                    prop.value = self.flow_match_rest();
                }
                T::Const | T::Var | T::Let => prop.value = self.flow_match_binding(),
                T::OpenBracket | T::PrivateIdentifier => self.fail(),
                _ => {
                    (prop.key, prop.name_kind, _) = self.property_name();
                    self.expect(T::Colon);
                    prop.value = self.flow_match_pattern();
                }
            }
            prop.end = self.prev_end();
            self.s.props.push(prop);
            if prop.kind == PropKind::Spread || !self.eat(T::Comma) {
                break;
            }
        }
        self.expect(T::CloseBrace);
        let properties = take_span!(self, props, base);
        self.finish_expr(ExprKind::Object(properties), open)
    }

    // ───────────────────────────── records ─────────────────────────────

    /// `record A<T> implements B { a: T = b, static c: U = d, e() { } }`, after `record`, which is
    /// the last of the modifiers.
    fn flow_record(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.flow_refuse_decorators(base);
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
        let implements = match self.eat(T::Implements) {
            true => self.flow_heritage(),
            false => IdList::EMPTY,
        };
        self.expect(T::OpenBrace);
        self.classes_around += 1;
        let first = self.s.members.len();
        while self.is_in_list(T::CloseBrace) {
            self.flow_record_member();
        }
        self.classes_around -= 1;
        self.expect(T::CloseBrace);
        let members = take_span!(self, members, first);
        let modifiers = self.take_modifiers(base);
        let class = self.f.add_class(Class {
            name,
            name_pos,
            flags: flags & (Flags::EXPORT | Flags::DEFAULT),
            type_params,
            extends: ExprId::NONE,
            extends_args: IdList::EMPTY,
            other_extends: IdList::EMPTY,
            implements,
            other_implements: IdList::EMPTY,
            members,
            start: start.pos,
            modifiers,
        });
        self.add_stmt(StmtKind::Class(class), start, modifiers)
    }

    /// Whether the token, `static` or `async`, is a modifier and not a name.
    fn flow_is_at_modifier_in_record(&mut self) -> bool {
        !matches!(
            self.peek(),
            T::Colon | T::LessThan | T::OpenParen | T::CloseBrace | T::Eof
        )
    }

    fn flow_record_member(&mut self) {
        let start = self.start();
        let first_modifier = self.s.modifiers.len();
        let mut flags = Flags::empty();
        for (token, flag) in [(T::Static, Flags::STATIC), (T::Async, Flags::ASYNC)] {
            if self.token() == token && self.flow_is_at_modifier_in_record() {
                flags |= flag;
                self.modifier_token(flag);
            }
        }
        let is_generator = self.eat(T::Asterisk);
        if matches!(self.token(), T::OpenBracket | T::PrivateIdentifier) {
            return self.fail();
        }
        let name_token = self.token();
        let (mut key, name_kind, name_pos) = self.property_name();
        match (name_token, name_kind) {
            (T::BigInt, _) => {
                key = PropKey::None;
                flags |= Flags::LITERAL_NAME;
            }
            (_, NameKind::StringLiteral) => flags |= Flags::STRING_NAME | Flags::LITERAL_NAME,
            (_, NameKind::NumericLiteral) => flags |= Flags::LITERAL_NAME,
            _ => {}
        }
        let mut member = Member {
            kind: MemberKind::Property,
            key,
            flags,
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            name_pos,
            start: start.pos,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        };
        let mut end = 0;
        if self.token() == T::Colon && !is_generator && !flags.contains(Flags::ASYNC) {
            member.ty = self.type_annotation();
            let cleared = ctx::YIELD | ctx::AWAIT | ctx::DISALLOW_IN | ctx::TOP_LEVEL;
            let saved = self.enter_context(0, cleared);
            member.init = self.optional_initializer();
            self.context = saved;
            end = self.prev_end();
            if self.token() != T::CloseBrace {
                self.expect(T::Comma);
            }
        } else if matches!(self.token(), T::OpenParen | T::LessThan) {
            member.kind = MemberKind::Method;
            let fn_flags = match is_generator {
                true => flags | Flags::GENERATOR,
                false => flags,
            };
            let name = key.name().unwrap_or(Atom::NONE);
            member.func = self.function_rest(FnKind::Method, fn_flags, name, name_pos, start.pos);
            end = self.prev_end();
        } else {
            self.fail();
        }
        member.loc = TextRange {
            pos: start.full,
            end,
        };
        member.modifiers = self.take_modifiers(first_modifier);
        self.s.members.push(member);
    }
}
