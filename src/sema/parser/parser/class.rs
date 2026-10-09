//! Classes.

use super::stmt::{ModifiersOf, Start};
use super::{ListKind, Parser, ctx, take_span};
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
        // A default export without a name is placed at `export`.
        let is_export = |it: &&Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
        let modifiers = self.s.modifiers.get(base..).unwrap_or_default();
        let unnamed_at = match (modifiers.iter().rfind(is_export), modifiers.last()) {
            (Some(export), _) if flags.contains(Flags::DEFAULT) => export.pos,
            // Any other without a name is an error, and placed at an `abstract` before the keyword.
            (_, Some(last)) if last.kind == ModifierKind::Keyword(Flags::ABSTRACT) => last.pos,
            _ => self.pos(),
        };
        let class = self.class((start.pos, unnamed_at), base, class_flags);
        // In a namespace the other parser does not export what has no name. For acorn and Babel only
        // a default export has none. In the list of the file `checkClassDeclaration` reports it.
        let is_ecmascript = self.is_ecmascript;
        let lacks_name = |it: &Class| {
            it.name.is_none()
                && !it.flags.contains(Flags::DEFAULT)
                && (is_ecmascript || it.flags.contains(Flags::EXPORT))
        };
        if self.f.classes.get(class.idx()).is_some_and(lacks_name)
            && !(self.recovers && self.lists == 1 << ListKind::SourceElements as u32)
        {
            self.report();
        }
        let modifiers = self.f.classes.get(class.idx()).map(|it| it.modifiers);
        self.add_stmt(StmtKind::Class(class), start, modifiers.unwrap_or_default())
    }

    /// `parseClassExpression`
    pub(crate) fn class_expression(&mut self) -> ExprId {
        let start = self.pos();
        let base = self.s.modifiers.len();
        let class = self.class((start, start), base, Flags::empty());
        self.finish_expr(ExprKind::Class(class), start)
    }

    /// `parseDecoratedExpression`
    pub(crate) fn decorated_expression(&mut self) -> ExprId {
        let start = self.pos();
        let base = self.s.modifiers.len();
        let flags = self.modifiers(ModifiersOf::Declaration);
        if self.token() != T::Class {
            return self.missing_declaration_expression(start, base);
        }
        let keyword = self.pos();
        let class = self.class((start, keyword), base, flags & Flags::ABSTRACT);
        self.finish_expr(ExprKind::Class(class), keyword)
    }

    /// The end of `parseDecoratedExpression`, at another token than `class`: a `MissingDeclaration`
    /// at the `@` at `start`, with the modifiers on the stack from `base` on.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn missing_declaration_expression(&mut self, start: u32, base: usize) -> ExprId {
        if !self.recovers {
            self.fail();
            return ExprId::NONE;
        }
        let end = self.full_start();
        self.error(1109, (end, Diagnostic::NO_LENGTH), &[]);
        self.note_stray_decorators(base, end);
        self.add_expr(ExprKind::Missing, start, start)
    }

    /// `parseTypeArguments` of an element of an `extends` clause that is not the base class, at the
    /// `<`. The tree has no place for them.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn type_arguments_in_no_list(&mut self) {
        if !self.recovers {
            return self.refuse(Refusal::Reported);
        }
        let before = self.checkpoint();
        let (list, _) = self.type_arguments_unchecked();
        self.check_js_type_arguments(list);
        self.forget_nodes(&before);
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
        let lists = self.enter_list(ListKind::HeritageClauses);
        let mut is_first = true;
        while self.is_at_heritage_clause(std::mem::take(&mut is_first)) {
            let keyword = (self.lx.start, self.lx.end);
            let is_extends = self.token() == T::Extends;
            let misplaced = match (is_extends, has_extends, has_implements) {
                (true, true, _) => 1172,
                (true, false, true) => 1173,
                (false, _, true) => 1175,
                _ => 0,
            };
            if misplaced != 0 && !heritage.has_error {
                match self.is_ecmascript {
                    true => self.report(),
                    false => self.flag(DiagnosticKind::Grammar, misplaced, keyword, &[]),
                }
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
                            p.type_arguments_in_no_list();
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
                None if count == 0 && self.is_ecmascript => self.report(),
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
        self.lists = lists;
        heritage.other_extends = self.f.list(&other_extends);
        heritage.other_implements = self.f.list(&other_implements);
        heritage
    }

    /// `parseClassDeclarationOrExpression`, at `class`. Its modifiers are on the stack from `base`
    /// on. `unnamed_at`: where it is placed if it has no name.
    fn class(&mut self, (start, unnamed_at): (u32, u32), base: usize, flags: Flags) -> ClassId {
        if self.is_too_deep() {
            return ClassId::NONE;
        }
        self.next();
        // `GetContainingClass`: its heritage clauses are inside it too.
        self.classes_around += 1;
        // `parseNameOfClassDeclarationOrExpression`
        let (mut name, mut name_pos) = (Atom::NONE, unnamed_at);
        if self.is_binding_identifier() && !self.is_implements_clause() {
            (name, name_pos) = (self.lx.atom, self.pos());
            self.note_identifier(name, name_pos);
            self.next_after_name();
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
        let has_members = self.expect(T::OpenBrace);
        let members = self.s.members.len();
        let decorators = self.s.decorators.len();
        let lists = self.enter_list(ListKind::ClassMembers);
        while has_members
            && self.is_in_list(T::CloseBrace)
            && self.is_at_element(ListKind::ClassMembers)
        {
            // A `SemicolonClassElement` is not a member.
            if self.eat(T::Semicolon) {
                continue;
            }
            self.class_element(members);
        }
        self.lists = lists;
        if has_members {
            self.expect(T::CloseBrace);
        }
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
        // In Flow: the variance of a property.
        if self.token() == T::Asterisk || matches!(self.token(), T::Plus | T::Minus) && self.is_flow
        {
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

    /// `tryParseConstructorDeclaration` takes the keyword whatever follows it. `name`: the first
    /// token of the name of a member that no parameters follow.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn is_constructor_without_parameters(&mut self, name: T) -> bool {
        if self.recovers && name == T::Constructor {
            return true;
        }
        self.report();
        false
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
        let name_end = self.lx.end;
        let has_name = kind != MemberKind::Property
            || is_generator
            || name_token == T::OpenBracket
            || self.is_literal_property_name();
        let (mut key, name_kind, name_pos) = match has_name {
            true => self.property_name(),
            // "treat this as a property declaration with a missing name."
            false => {
                self.error(1146, (self.full_start(), Diagnostic::NO_LENGTH), &[]);
                (
                    PropKey::Name(known::empty),
                    NameKind::Identifier,
                    self.full_start(),
                )
            }
        };
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
        // Neither `tryParseConstructorDeclaration` nor the property without a name looks for it.
        let mut question = None;
        if self.token() == T::Question
            && has_name
            && !(self.recovers
                && name_token == T::Constructor
                && kind == MemberKind::Property
                && !is_generator)
        {
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
        // What has no name is a property, whatever follows.
        let mut is_function = has_name
            && (kind != MemberKind::Property
                || is_generator
                || matches!(self.token(), T::OpenParen | T::LessThan));
        // The other parser does not go on at the `!` of `async a!`.
        if !is_function
            && (name_token == T::Constructor
                || flags.contains(Flags::ASYNC) && self.token() == T::Exclamation)
        {
            is_function = self.is_constructor_without_parameters(name_token);
        }
        if is_function {
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
            // "'{' or ';' expected."
            let code = match fn_kind {
                FnKind::Method | FnKind::Constructor => 1144,
                _ => 1005,
            };
            member.func =
                self.function_rest_or(code, fn_kind, fn_flags, (name, name_pos), start.pos);
        } else {
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
            // `parseSemicolonAfterPropertyName`
            if self.token() == T::OpenParen && self.recovers
                || !self.eat(T::Semicolon) && !self.can_parse_semicolon()
            {
                let is_identifier =
                    name_token.is_identifier_or_keyword() && name_token != T::PrivateIdentifier;
                let name = key.name().filter(|_| is_identifier);
                let name = name.map(|name| (name, (name_pos, name_end)));
                let (has_type, has_initializer) = (member.ty.is_some(), member.init.is_some());
                self.missing_semicolon_after_property(name, has_type, has_initializer);
            }
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
        if self.is_flow {
            self.flow_refuse_decorators(first_modifier);
        }
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
