//! Classes.

use super::stmt::Start;
use super::{Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

impl Parser<'_> {
    /// `parseClassDeclaration`
    pub(crate) fn class_declaration(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        let class_flags =
            self.ambient() | flags & (Flags::ABSTRACT | Flags::EXPORT | Flags::DEFAULT);
        let class = self.class(start.pos, base, class_flags);
        let is_unnamed = |it: &Class| it.name.is_none() && !it.flags.contains(Flags::DEFAULT);
        if self.f.classes.get(class.idx()).is_some_and(is_unnamed) {
            self.report();
        }
        let modifiers = self.f.classes.get(class.idx()).map(|it| it.modifiers);
        self.add_stmt(StmtKind::Class(class), start, modifiers.unwrap_or_default())
    }

    /// `parseClassExpression`
    pub(crate) fn class_expression(&mut self) -> ExprId {
        let start = self.pos();
        let base = self.s.modifiers.len();
        let class = self.class(start, base, Flags::empty());
        self.finish_expr(ExprKind::Class(class), start)
    }

    /// `parseDecoratedExpression`
    pub(crate) fn decorated_expression(&mut self) -> ExprId {
        let start = self.pos();
        let base = self.s.modifiers.len();
        let flags = self.modifiers(true, false, false);
        if self.token() != T::Class {
            self.fail();
            return ExprId::NONE;
        }
        let keyword = self.pos();
        let class = self.class(start, base, flags & Flags::ABSTRACT);
        self.finish_expr(ExprKind::Class(class), keyword)
    }

    /// `parseClassDeclarationOrExpression`, at `class`. Its modifiers are on the stack from `base`
    /// on.
    fn class(&mut self, start: u32, base: usize, flags: Flags) -> ClassId {
        if self.is_too_deep() {
            return ClassId::NONE;
        }
        // A default export without a name is placed at `export`.
        let is_export = |it: &&Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
        let modifiers = self.s.modifiers.get(base..).unwrap_or_default();
        let unnamed_at = match modifiers.iter().find(is_export) {
            Some(export) if flags.contains(Flags::DEFAULT) => export.pos,
            _ => self.pos(),
        };
        self.next();
        // `GetContainingClass`: its heritage clauses are inside it too.
        self.classes_around += 1;
        // `parseNameOfClassDeclarationOrExpression`
        let (mut name, mut name_pos) = (Atom::NONE, unnamed_at);
        if self.is_binding_identifier() && !self.is_implements_clause() {
            (name, name_pos) = (self.lx.atom, self.pos());
            self.note_identifier(name, name_pos);
            self.next();
        }
        let type_params = self.type_parameters();
        let (mut extends, mut extends_args) = (ExprId::NONE, IdList::EMPTY);
        if self.eat(T::Extends) {
            // `isListElement`
            if !self.is_start_of_left_hand_side_expression() {
                self.fail();
            }
            // `parseExpressionWithTypeArguments`
            extends = self.left_hand_side_expression();
            if extends.idx() + 1 == self.f.exprs.len()
                && let Some(&Expr {
                    kind: ExprKind::Instantiation { expr, type_args },
                    ..
                }) = self.f.exprs.last()
                && self.f.parens.last().is_none_or(|last| last.0 != extends)
            {
                self.f.exprs.pop();
                (extends, extends_args) = (expr, type_args);
            } else if self.token() == T::LessThan {
                extends_args = self.type_arguments();
            }
            if self.token() == T::Comma {
                self.refuse(Refusal::Reported);
            }
        }
        let mut implements = IdList::EMPTY;
        if self.eat(T::Implements) {
            self.typescript_only();
            implements = self.heritage_types();
        }
        if matches!(self.token(), T::Extends | T::Implements) {
            self.refuse(Refusal::Reported);
        }
        self.expect(T::OpenBrace);
        let members = self.s.members.len();
        let decorators = self.s.decorators.len();
        while self.is_in_list(T::CloseBrace) {
            // A `SemicolonClassElement` is not a member.
            if self.eat(T::Semicolon) {
                continue;
            }
            self.class_element(members);
        }
        self.expect(T::CloseBrace);
        self.classes_around -= 1;
        let members: Span<MemberId> = take_span!(self, members, members);
        for index in decorators..self.s.decorators.len() {
            let (member, decorator) = self.s.decorators[index];
            let owner = DecoratorOwner::Member(members.at(member as usize));
            self.f.decorators.push((owner, decorator));
        }
        self.s.decorators.truncate(decorators);
        let first_decorator = self.f.decorators.len();
        for modifier in self.s.modifiers.get(base..).unwrap_or_default() {
            if let ModifierKind::Decorator(decorator) = modifier.kind {
                let owner = DecoratorOwner::Class(ClassId(self.f.classes.len() as u32));
                self.f.decorators.push((owner, decorator));
            }
        }
        debug_assert!(first_decorator <= self.f.decorators.len());
        let modifiers = self.take_modifiers(base);
        self.f.add_class(Class {
            name,
            name_pos,
            flags,
            type_params,
            extends,
            extends_args,
            other_extends: IdList::EMPTY,
            implements,
            other_implements: IdList::EMPTY,
            members,
            start,
            modifiers,
        })
    }

    /// `isImplementsClause`
    fn is_implements_clause(&mut self) -> bool {
        self.token() == T::Implements && self.peek().is_identifier_or_keyword()
    }

    /// `parseClassElement`: pushes it on the stack of members, of which the class's start at
    /// `base`.
    fn class_element(&mut self, base: usize) {
        let start = self.start();
        let first_modifier = self.s.modifiers.len();
        let token = self.token();
        let mut flags = match token.is_modifier() || token == T::At {
            true => self.modifiers(true, true, true),
            false => Flags::empty(),
        };
        let index = (self.s.members.len() - base) as u32;
        for modifier in first_modifier..self.s.modifiers.len() {
            if let ModifierKind::Decorator(decorator) = self.s.modifiers[modifier].kind {
                self.s.decorators.push((index, decorator));
            }
        }
        if flags.intersects(Flags::CONST | Flags::EXPORT | Flags::DEFAULT | Flags::IN | Flags::OUT) {
            self.refuse(Refusal::Reported);
        }
        if flags.intersects(!(Flags::STATIC | Flags::ASYNC | Flags::ACCESSOR)) {
            self.typescript_only();
        }
        if self.token() == T::Static && self.peek() == T::OpenBrace {
            return self.class_static_block(start, first_modifier);
        }
        let is_parent_ambient = self.has_context(ctx::AMBIENT);
        let mut kind = MemberKind::Property;
        if matches!(self.token(), T::Get | T::Set) {
            // `parseContextualModifier`
            let accessor = self.token();
            let mark = self.lx.mark();
            self.next();
            if self.can_follow_accessor_keyword() {
                kind = match accessor {
                    T::Get => MemberKind::Getter,
                    _ => MemberKind::Setter,
                };
            } else {
                self.lx.reset(mark);
            }
        }
        if kind == MemberKind::Property && self.token() == T::OpenBracket && self.is_index_signature()
        {
            self.typescript_only();
            let modifiers = self.take_modifiers(first_modifier);
            let mut member = self.index_signature(start, flags, modifiers);
            if is_parent_ambient {
                member.flags |= Flags::AMBIENT;
                self.f[member.func].flags |= Flags::AMBIENT;
            }
            return self.s.members.push(member);
        }
        // `parseClassElement`: its own `declare` makes a property or a method ambient.
        let saved = self.context;
        if flags.contains(Flags::AMBIENT) && kind == MemberKind::Property {
            self.context |= ctx::AMBIENT;
        }
        flags |= self.ambient();
        let is_generator = kind == MemberKind::Property && self.eat(T::Asterisk);
        let name_token = self.token();
        let (key, name_kind, name_pos) = self.property_name();
        match name_kind {
            NameKind::StringLiteral => flags |= Flags::STRING_NAME | Flags::LITERAL_NAME,
            NameKind::NumericLiteral => flags |= Flags::LITERAL_NAME,
            NameKind::ComputedString if matches!(key, PropKey::Name(_)) => {
                flags |= Flags::STRING_NAME | Flags::COMPUTED_NAME;
            }
            _ if name_token == T::OpenBracket => flags |= Flags::COMPUTED_NAME,
            _ => {}
        }
        if self.eat(T::Question) {
            self.typescript_only();
            flags |= Flags::OPTIONAL;
        }
        let mut member = Member {
            kind,
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
        if kind != MemberKind::Property
            || is_generator
            || matches!(self.token(), T::OpenParen | T::LessThan)
        {
            // `tryParseConstructorDeclaration`: the keyword, or a string literal with the same
            // text. After `*` it is the name of a method.
            let is_constructor = kind == MemberKind::Property
                && !is_generator
                && key == PropKey::Name(known::constructor)
                && (name_token == T::Constructor
                    || name_token == T::String && self.token() == T::OpenParen);
            let fn_kind = match kind {
                MemberKind::Getter => FnKind::Getter,
                MemberKind::Setter => FnKind::Setter,
                _ if is_constructor => {
                    member.kind = MemberKind::Constructor;
                    FnKind::Constructor
                }
                _ => {
                    member.kind = MemberKind::Method;
                    FnKind::Method
                }
            };
            // `parseClassElement`: `declare` does not make an accessor or a constructor ambient.
            if member.kind == MemberKind::Constructor
                && self.s.decorators.last().is_some_and(|last| last.0 == index)
            {
                self.typescript_only();
            }
            if member.kind != MemberKind::Method {
                self.context = saved;
                member.flags.set(Flags::AMBIENT, is_parent_ambient);
                if member.flags.contains(Flags::ASYNC) {
                    self.refuse(Refusal::Reported);
                }
            }
            let mut fn_flags = member.flags;
            if is_generator {
                fn_flags |= Flags::GENERATOR;
            }
            let name = key.name().unwrap_or(Atom::NONE);
            member.func = self.function_rest(fn_kind, fn_flags, name, name_pos, start.pos);
        } else {
            // `tryParseConstructorDeclaration` takes the keyword whatever follows it.
            if name_token == T::Constructor || flags.contains(Flags::ASYNC) {
                self.report();
            }
            // `parsePropertyDeclaration`
            if !flags.contains(Flags::OPTIONAL)
                && self.token() == T::Exclamation
                && !self.newline_before()
            {
                self.typescript_only();
                self.next();
                member.flags |= Flags::DEFINITE;
            }
            member.ty = self.type_annotation();
            let cleared = ctx::YIELD | ctx::AWAIT | ctx::DISALLOW_IN | ctx::TOP_LEVEL;
            let inner = self.enter_context(0, cleared);
            member.init = self.optional_initializer();
            self.context = inner;
            self.semicolon();
        }
        self.context = saved;
        member.loc = TextRange {
            pos: start.full,
            end: self.prev_end(),
        };
        member.modifiers = self.take_modifiers(first_modifier);
        self.s.members.push(member);
    }

    /// `parseClassStaticBlockDeclaration`, at `static`.
    fn class_static_block(&mut self, start: Start, first_modifier: usize) {
        if self.s.modifiers.len() > first_modifier {
            self.refuse(Refusal::Reported);
        }
        self.next();
        let open = self.pos();
        // `parseClassStaticBlockBody`
        let (body, _) = self.function_block(ctx::AWAIT);
        let func = self.f.add_fn(Func {
            kind: FnKind::StaticBlock,
            flags: Flags::STATIC,
            name: Atom::NONE,
            name_pos: open,
            type_params: Span::EMPTY,
            params: Span::EMPTY,
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body,
            anchor: open,
            start: start.pos,
        });
        self.s.members.push(Member {
            kind: MemberKind::StaticBlock,
            key: PropKey::None,
            flags: Flags::STATIC,
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func,
            name_pos: open,
            start: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
            modifiers: Span::EMPTY,
        });
    }
}
