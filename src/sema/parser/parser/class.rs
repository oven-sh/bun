//! Classes.

use super::stmt::{ModifiersOf, Start};
use super::{Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

/// The heritage clauses of a class: see `Class`.
struct Heritage {
    extends: ExprId,
    extends_args: IdList<TypeNodeId>,
    other_extends: IdList<ExprId>,
    implements: IdList<TypeNodeId>,
    other_implements: IdList<TypeNodeId>,
    /// The checker has reported a clause or a second class, and looks no further.
    has_error: bool,
}

impl Parser<'_> {
    /// `parseClassDeclaration`
    pub(crate) fn class_declaration(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        // Only its modifiers say that `default class {}` has `default`.
        let flags = match flags.contains(Flags::EXPORT) {
            true => flags,
            false => flags - Flags::DEFAULT,
        };
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
        let flags = self.modifiers(ModifiersOf::Declaration);
        if self.token() != T::Class {
            self.fail();
            return ExprId::NONE;
        }
        let keyword = self.pos();
        let class = self.class(start, base, flags & Flags::ABSTRACT);
        self.finish_expr(ExprKind::Class(class), keyword)
    }

    /// `parseHeritageClauses` of a class, with what `checkGrammarClassDeclarationHeritageClauses`
    /// reports.
    fn class_heritage(&mut self) -> Heritage {
        let mut heritage = Heritage {
            extends: ExprId::NONE,
            extends_args: IdList::EMPTY,
            other_extends: IdList::EMPTY,
            implements: IdList::EMPTY,
            other_implements: IdList::EMPTY,
            has_error: false,
        };
        let mut other_extends: Vec<ExprId> = Vec::new();
        let mut other_implements: Vec<TypeNodeId> = Vec::new();
        let (mut has_extends, mut has_implements) = (false, false);
        while matches!(self.token(), T::Extends | T::Implements) {
            let keyword = (self.lx.start, self.lx.end);
            let is_extends = self.token() == T::Extends;
            let misplaced = match (is_extends, has_extends, has_implements) {
                (true, true, _) => 1172,
                (true, false, true) => 1173,
                (false, _, true) => 1175,
                _ => 0,
            };
            if misplaced != 0 && !heritage.has_error {
                self.flag(DiagnosticKind::Grammar, misplaced, keyword, &[]);
                heritage.has_error = true;
            }
            self.next();
            // `checkGrammarExpressionWithTypeArguments`, of the first element that has an error.
            let mut element_error = None;
            let base = self.s.ids.len();
            let (count, comma) = match is_extends {
                true => self.heritage_elements(|p, index| {
                    let first_token = (p.lx.start, p.lx.end);
                    // `parseExpressionWithTypeArguments`
                    let saved = p.enter_context(ctx::NO_RECORD, 0);
                    let extended = p.left_hand_side_expression();
                    p.context = saved;
                    if index > 0 || has_extends {
                        // Type arguments that the expression has not taken are in no list.
                        if p.token() == T::LessThan {
                            p.refuse(Refusal::Reported);
                        }
                        other_extends.push(extended);
                        if index == 1 && !heritage.has_error {
                            match p.is_ecmascript {
                                true => p.report(),
                                false => p.flag(DiagnosticKind::Grammar, 1174, first_token, &[]),
                            }
                            heritage.has_error = true;
                        }
                        return;
                    }
                    heritage.extends = extended;
                    if extended.idx() + 1 == p.f.exprs.len()
                        && let Some(&Expr {
                            kind: ExprKind::Instantiation { expr, type_args },
                            ..
                        }) = p.f.exprs.last()
                        && p.f.parens.last().is_none_or(|last| last.0 != extended)
                    {
                        p.f.exprs.pop();
                        (heritage.extends, heritage.extends_args) = (expr, type_args);
                    } else if p.token() == T::LessThan {
                        (heritage.extends_args, element_error) = p.type_arguments_unchecked();
                    }
                    p.check_js_type_arguments(heritage.extends_args);
                }),
                false => {
                    let saved = self.enter_context(ctx::TYPE, 0);
                    let list = self.heritage_elements(|p, _| {
                        let ty = p.heritage_type(!has_implements, 2500);
                        p.s.ids.push(ty.0);
                    });
                    self.context = saved;
                    self.js_error((keyword.0, self.prev_end()), 8005, b"");
                    list
                }
            };
            // `checkGrammarHeritageClause`
            match comma {
                _ if heritage.has_error => {}
                Some(_) if self.is_ecmascript => self.report(),
                Some(comma) => self.flag(DiagnosticKind::Grammar, 1009, comma, &[]),
                None if count == 0 => {
                    let at = (keyword.1, Diagnostic::NO_LENGTH);
                    let keyword: &[u8] = if is_extends {
                        b"extends"
                    } else {
                        b"implements"
                    };
                    self.flag(DiagnosticKind::Grammar, 1097, at, &[keyword]);
                }
                None => {
                    if let Some((at, code)) = element_error {
                        self.flag(DiagnosticKind::Grammar, code, at, &[]);
                    }
                }
            }
            match (is_extends, has_implements) {
                (true, _) => has_extends = true,
                (false, false) => {
                    heritage.implements = self.take_ids(base);
                    has_implements = true;
                }
                (false, true) => {
                    let types = self.s.ids.get(base..).unwrap_or_default();
                    other_implements.extend(types.iter().map(|&ty| TypeNodeId(ty)));
                    self.s.ids.truncate(base);
                }
            }
        }
        heritage.other_extends = self.f.list(&other_extends);
        heritage.other_implements = self.f.list(&other_implements);
        heritage
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
        let unnamed_at = match modifiers.iter().rfind(is_export) {
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
        let less_than = (self.token() == T::LessThan).then(|| self.pos());
        let type_params = self.type_parameters();
        let empty_list = less_than.filter(|_| type_params.is_empty());
        let empty_list = empty_list.map(|less_than| (less_than, self.prev_end()));
        let heritage = self.class_heritage();
        // `checkGrammarClassLikeDeclaration`, which looks at the clauses first. The checker finds the
        // empty list of anything else in the text.
        if let Some(empty_list) = empty_list
            && !heritage.has_error
        {
            self.flag(DiagnosticKind::Grammar, 1098, empty_list, &[]);
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
            extends: heritage.extends,
            extends_args: heritage.extends_args,
            other_extends: heritage.other_extends,
            implements: heritage.implements,
            other_implements: heritage.other_implements,
            members,
            start,
            modifiers,
        })
    }

    /// `isImplementsClause`
    fn is_implements_clause(&mut self) -> bool {
        self.token() == T::Implements && self.peek().is_identifier_or_keyword()
    }

    /// `scanClassMemberStart`, at a modifier: whether the list of members goes on with the token.
    fn scan_class_member_start(&mut self) -> bool {
        let mut last = T::Eof;
        // "Eat up all modifiers, but hold on to the last one in case it is actually an identifier."
        while self.token().is_modifier() {
            last = self.token();
            // `IsClassMemberModifier`: "it is certain that we are starting to parse class member"
            if matches!(
                last,
                T::Public
                    | T::Private
                    | T::Protected
                    | T::Readonly
                    | T::Override
                    | T::Static
                    | T::Accessor
            ) {
                return true;
            }
            self.next();
        }
        if self.token() == T::Asterisk {
            return true;
        }
        if self.is_literal_property_name() {
            last = self.token();
            self.next();
        }
        if self.token() == T::OpenBracket {
            return true;
        }
        // "If we have a non-keyword identifier, or if we have an accessor, then it's safe to parse."
        if last <= T::PrivateIdentifier || matches!(last, T::Get | T::Set) {
            return true;
        }
        matches!(
            self.token(),
            T::OpenParen | T::LessThan | T::Exclamation | T::Colon | T::Equals | T::Question
        ) || self.can_parse_semicolon()
    }

    /// `parseClassElement`: pushes it on the stack of members, of which the class's start at
    /// `base`.
    fn class_element(&mut self, base: usize) {
        let start = self.start();
        let first_modifier = self.s.modifiers.len();
        let token = self.token();
        if token.is_modifier() && !self.look_ahead(Self::scan_class_member_start) {
            self.fail();
        }
        let mut flags = match token.is_modifier() || token == T::At {
            true => self.modifiers(ModifiersOf::ClassMember),
            false => Flags::empty(),
        };
        let index = (self.s.members.len() - base) as u32;
        for modifier in first_modifier..self.s.modifiers.len() {
            if let ModifierKind::Decorator(decorator) = self.s.modifiers[modifier].kind {
                self.s.decorators.push((index, decorator));
            }
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
        if kind == MemberKind::Property
            && self.token() == T::OpenBracket
            && self.is_index_signature()
        {
            // It is placed after its decorators.
            let is_keyword = |it: &&Modifier| matches!(it.kind, ModifierKind::Keyword(_));
            let written = self.s.modifiers.get(first_modifier..).unwrap_or_default();
            let name_pos = written
                .iter()
                .find(is_keyword)
                .map_or_else(|| self.pos(), |it| it.pos);
            let modifiers = self.take_modifiers(first_modifier);
            let mut member = self.index_signature(start, flags, modifiers);
            member.name_pos = name_pos;
            if is_parent_ambient {
                member.flags |= Flags::AMBIENT;
                self.f[member.func].flags |= Flags::AMBIENT;
            }
            if self.options.is_javascript {
                self.check_js_member(&member, None);
            }
            return self.s.members.push(member);
        }
        // The checker reports these, which are in the list.
        flags -= Flags::CONST | Flags::EXPORT | Flags::DEFAULT;
        // `parseClassElement`: its own `declare` makes a property or a method ambient.
        let saved = self.context;
        if flags.contains(Flags::AMBIENT) && kind == MemberKind::Property {
            self.context |= ctx::AMBIENT;
        }
        flags |= self.ambient();
        let is_generator = kind == MemberKind::Property && self.eat(T::Asterisk);
        if matches!(self.token(), T::Plus | T::Minus) && self.is_flow {
            self.flow_variance();
        }
        let name_token = self.token();
        let (mut key, name_kind, name_pos) = self.property_name();
        if name_token == T::BigInt {
            key = PropKey::None;
            flags |= Flags::LITERAL_NAME;
        }
        match name_kind {
            NameKind::StringLiteral => flags |= Flags::STRING_NAME | Flags::LITERAL_NAME,
            NameKind::NumericLiteral => flags |= Flags::LITERAL_NAME,
            NameKind::ComputedString if matches!(key, PropKey::Name(_)) => {
                flags |= Flags::STRING_NAME | Flags::COMPUTED_NAME;
            }
            _ if name_token == T::OpenBracket => flags |= Flags::COMPUTED_NAME,
            _ => {}
        }
        let mut question = None;
        if self.token() == T::Question {
            question = Some(self.pos());
            self.next();
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
                    || name_token == T::String
                        && self.token() == T::OpenParen
                        && question.is_none());
            // The parameters follow the keyword.
            if is_constructor && question.is_some() {
                self.fail();
            }
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
            if member.kind != MemberKind::Method {
                self.context = saved;
                member.flags.set(Flags::AMBIENT, is_parent_ambient);
                // Only its modifiers say that `async constructor() {}` is async.
                member.flags -= Flags::ASYNC;
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
        if self.options.is_javascript {
            self.check_js_member(&member, question);
        }
        self.s.members.push(member);
    }

    /// `parseClassStaticBlockDeclaration`, at `static`.
    fn class_static_block(&mut self, start: Start, first_modifier: usize) {
        // The checker reports them.
        let modifiers = self.take_modifiers(first_modifier);
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
            modifiers,
        });
    }
}
