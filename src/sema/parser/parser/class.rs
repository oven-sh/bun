//! Classes.

use super::declared::Declares;
use super::stmt::{ModifiersOf, Start};
use super::{ListKind, Parser, ctx, oxc, take_span};
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

/// What the name of a member of a class says about the member. `name_token`: its first token.
pub(crate) fn flags_of_member_name(name_token: T, name_kind: NameKind, key: PropKey) -> Flags {
    match name_kind {
        _ if name_token == T::BigInt => Flags::LITERAL_NAME,
        NameKind::StringLiteral => Flags::STRING_NAME | Flags::LITERAL_NAME,
        NameKind::NumericLiteral => Flags::LITERAL_NAME,
        NameKind::ComputedString if matches!(key, PropKey::Name(_)) => {
            Flags::STRING_NAME | Flags::COMPUTED_NAME
        }
        _ if name_token == T::OpenBracket => Flags::COMPUTED_NAME,
        _ => Flags::empty(),
    }
}

/// The key by which a member is declared. `key`: what is written, which starts with `name_token`. `is_default`: `default` is
/// among its modifiers.
pub(super) fn declared_key(key: PropKey, name_token: T, is_default: bool) -> PropKey {
    match key {
        // `getDeclarationName`: a bigint name declares nothing.
        _ if name_token == T::BigInt => PropKey::None,
        // `declareSymbolEx`: `isDefaultExport && parent != nil`
        PropKey::Name(_) if is_default => PropKey::Name(known::default),
        _ => key,
    }
}

/// `IsClassMemberModifier`: "it is certain that we are starting to parse class member"
#[inline]
fn is_class_member_modifier(token: T) -> bool {
    matches!(
        token,
        T::Public | T::Private | T::Protected | T::Readonly | T::Override | T::Static | T::Accessor
    )
}

impl<const GENERAL: bool> Parser<'_, GENERAL> {
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
        if let Some(name) = self.f.classes.get(class.idx()).map(|it| it.name)
            && name.is_some()
        {
            self.declare(name, Declares::Class);
        }
        // In a namespace what has no name is not exported. For acorn and Babel only a default export
        // has none. In the list of the file `checkClassDeclaration` reports it.
        let is_ecmascript = self.is_ecmascript;
        let lacks_name = |it: &Class| {
            it.name.is_none()
                && !it.flags.contains(Flags::DEFAULT)
                && (is_ecmascript || it.flags.contains(Flags::EXPORT))
        };
        if self.f.classes.get(class.idx()).is_some_and(lacks_name) {
            let is_in_list_of_file = self.lists == 1 << ListKind::SourceElements as u32;
            match self.recovers() {
                // The linter has oxc's words for it.
                _ if is_ecmascript && self.options.dialect.oxc => {}
                true if is_in_list_of_file => {}
                true if !is_ecmascript => {
                    if let Some(class) = self.f.classes.get_mut(class.idx()) {
                        class.flags -= Flags::EXPORT;
                    }
                }
                _ => self.report(),
            }
        }
        let modifiers = self.f.classes.get(class.idx()).map(|it| it.modifiers);
        self.add_stmt(StmtKind::Class(class), start, modifiers.unwrap_or_default())
    }

    /// `parseClassExpression`
    pub(crate) fn class_expression(&mut self) -> ExprId {
        let start = self.pos();
        let base = self.s.modifiers.len();
        let class = self.class((start, start), base, Flags::empty());
        if self.reads_jsdoc() {
            self.class_jsdoc(class, start);
        }
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
        if self.reads_jsdoc() {
            self.class_jsdoc(class, start);
        }
        self.finish_expr(ExprKind::Class(class), keyword)
    }

    /// The end of `parseDecoratedExpression`, at another token than `class`: a `MissingDeclaration`
    /// at the `@` at `start`, with the modifiers on the stack from `base` on.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn missing_declaration_expression(&mut self, start: u32, base: usize) -> ExprId {
        if !self.recovers() {
            self.fail();
            return ExprId::NONE;
        }
        let end = self.full_start();
        let at = match self.is_for_oxc() {
            true => self.range_of_token(),
            false => (end, Diagnostic::NO_LENGTH),
        };
        self.error(1109, at, &[]);
        self.note_stray_decorators(base, end);
        self.add_expr(ExprKind::Missing, start, start)
    }

    /// `parseTypeArguments` of an element of an `extends` clause that is not the base class, at the
    /// `<`. The tree has no place for them.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn type_arguments_in_no_list(&mut self) {
        if !self.recovers() {
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
        let mut first_implements = (0, 0);
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
            if !is_extends && !has_implements {
                first_implements = keyword;
            }
            if misplaced != 0 && self.is_for_oxc() {
                let errors = &mut self.f.diagnostics;
                oxc::misplaced_clause(errors, misplaced, first_implements, keyword);
            }
            if misplaced != 0 && !heritage.has_error {
                match self.is_ecmascript {
                    true if self.is_for_oxc() => {}
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
                    let errors = p.f.diagnostics.len();
                    // `parseExpressionWithTypeArguments`
                    let saved = p.enter_context(ctx::NO_RECORD, 0);
                    let extended = p.left_hand_side_expression();
                    p.context = saved;
                    let of_import = p.import_with_type_arguments(first_token);
                    if index > 0 || has_extends {
                        // Type arguments that the expression has not taken are in no list.
                        if p.token() == T::LessThan {
                            p.type_arguments_in_no_list();
                        }
                        other_extends.push(extended);
                        // Not where oxc has given up in the element.
                        let is_of_parser = |it: &Diagnostic| it.kind == DiagnosticKind::Parse;
                        let found = p.f.diagnostics.get(errors..).unwrap_or_default();
                        if index > 0 && p.is_for_oxc() && !found.iter().any(is_of_parser) {
                            let at = (first_token.0, p.prev_end());
                            oxc::second_base_class(&mut p.f.diagnostics, at);
                        }
                        if index == 1 && !heritage.has_error {
                            match p.is_ecmascript {
                                true if p.is_for_oxc() => {}
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
                    } else if p.is_at_type_arguments_of_heritage_element() {
                        (heritage.extends_args, element_error) = p.type_arguments_unchecked();
                    }
                    p.check_js_type_arguments(heritage.extends_args);
                    // oxc says it about an empty list, too.
                    if let Some(((less_than, _), 1099)) = element_error
                        && p.is_for_oxc()
                    {
                        p.js_error((less_than + 1, Diagnostic::NO_LENGTH), 8011, b"");
                    }
                    element_error =
                        element_error.or_else(|| p.import_with_type_arguments(first_token));
                    element_error = element_error.or(of_import);
                }),
                false => {
                    let saved = self.enter_context(ctx::TYPE, 0);
                    self.is_in_implements_for_oxc = self.is_for_oxc();
                    let list = self.heritage_elements(|p, _| {
                        let first_token = (p.lx.start, p.lx.end);
                        let ty = p.heritage_type(!has_implements, 2500);
                        p.s.ids.push(ty.0);
                        element_error =
                            element_error.or_else(|| p.import_with_type_arguments(first_token));
                    });
                    self.is_in_implements_for_oxc = false;
                    self.context = saved;
                    self.js_error((keyword.0, self.prev_end()), 8005, b"");
                    list
                }
            };
            // After the keyword and after a comma oxc's parser wants a name.
            if (comma.is_some() || count == 0) && !is_extends && self.is_for_oxc() {
                self.unexpected_like_oxc();
            }
            let is_refused = self.is_ecmascript && !self.is_for_oxc();
            // `checkGrammarHeritageClause`
            match comma {
                _ if heritage.has_error => {}
                Some(_) if is_refused => self.report(),
                Some(comma) => self.flag(DiagnosticKind::Grammar, 1009, comma, &[]),
                None if count == 0 && is_refused => self.report(),
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
        self.leave_list(lists);
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
            if self.token() != T::Identifier && self.reports_like_oxc() {
                self.check_type_name_like_oxc(oxc::TypeName::Class);
            }
            (name, name_pos) = (self.lx.atom, self.pos());
            self.note_identifier(name, name_pos);
            self.next_after_name();
        }
        let less_than = (self.token() == T::LessThan).then(|| self.pos());
        let type_params = self.type_parameters();
        // The name of a class expression is in one scope with its type parameters.
        let named_alike = self.f.type_params.get(type_params.range());
        if named_alike.is_some_and(|all| all.iter().any(|it| it.name == name)) {
            self.may_redeclare();
        }
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
        // What is scanned from here to the `}` is in the class. What it extends and its decorators are not.
        let private_names = (
            self.lx.private_names.len(),
            self.declared_private_names.len(),
        );
        let has_members = self.expect(T::OpenBrace);
        let members = self.s.members.len();
        let decorators = self.s.decorators.len();
        let has_odd_members = std::mem::take(&mut self.has_odd_members);
        let lists = self.enter_list(ListKind::ClassMembers);
        while has_members
            && self.is_in_list(T::CloseBrace)
            && self.is_at_element(ListKind::ClassMembers)
        {
            // A `SemicolonClassElement` is not a member.
            if self.eat(T::Semicolon) {
                if self.reads_jsdoc() {
                    self.semicolon_jsdoc();
                }
                continue;
            }
            self.class_element(members);
        }
        self.leave_list(lists);
        if self.lx.private_names.len() > private_names.0 {
            self.resolve_private_names(private_names);
        }
        if has_members {
            self.expect(T::CloseBrace);
        }
        self.classes_around -= 1;
        if std::mem::replace(&mut self.has_odd_members, has_odd_members) {
            let (written, place) = (&self.s.members[members..], self.place());
            let is_abstract = flags.contains(Flags::ABSTRACT);
            oxc::class_members(&mut self.f, self.lx.src, written, is_abstract, place);
        }
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
            if is_class_member_modifier(last) {
                return true;
            }
            self.next();
        }
        // In Flow: the variance of a property.
        if self.token() == T::Asterisk
            || matches!(self.token(), T::Plus | T::Minus) && self.is_flow()
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
        if self.recovers() {
            return name == T::Constructor;
        }
        self.report();
        false
    }

    /// `parseClassElement`: pushes it on the stack of members, of which the class's start at
    /// `base`.
    /// At the `}` of a class, for `rare::ODD_PRIVATE_NAME`: the private names that were scanned in it and that it declares are
    /// forgotten. The others are left to the class around it. `(scanned, declared)`: how many there were at its `{`.
    #[inline(never)]
    fn resolve_private_names(&mut self, (scanned, declared): (usize, usize)) {
        let own = self
            .declared_private_names
            .get(declared..)
            .unwrap_or_default();
        let mut at = 0;
        self.lx.private_names.retain(|it| {
            at += 1;
            at <= scanned || !own.contains(it)
        });
        self.declared_private_names.truncate(declared);
    }

    fn class_element(&mut self, base: usize) {
        let start = self.start();
        let first_modifier = self.s.modifiers.len();
        let token = self.token();
        if token.is_modifier()
            && !is_class_member_modifier(token)
            && !self.look_ahead(Self::scan_class_member_start)
        {
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
            if !modifiers.is_empty() && self.is_for_oxc() {
                oxc::index_signature(&mut self.f, modifiers, Flags::READONLY | Flags::STATIC);
            }
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
        let is_default = flags.contains(Flags::DEFAULT);
        let written = flags;
        // The checker reports these, which are in the list.
        flags -= Flags::CONST | Flags::EXPORT | Flags::DEFAULT;
        // `parseClassElement`: its own `declare` makes a property or a method ambient.
        let saved = self.context;
        if flags.contains(Flags::AMBIENT) && kind == MemberKind::Property {
            self.context |= ctx::AMBIENT;
        }
        flags |= self.ambient();
        let is_generator = kind == MemberKind::Property && self.eat(T::Asterisk);
        if matches!(self.token(), T::Plus | T::Minus) && self.is_flow() {
            self.flow_variance();
        }
        let name_token = self.token();
        let name_end = self.lx.end;
        // `tryParseConstructorDeclaration` leaves the keyword with `nextToken`.
        if name_token == T::Constructor
            && self.lx.has_escape
            && self.recovers()
            && kind == MemberKind::Property
            && !is_generator
        {
            self.error_at_token(1260, &[]);
        }
        let has_name = kind != MemberKind::Property
            || is_generator
            || name_token == T::OpenBracket
            || self.is_literal_property_name();
        let (mut key, name_kind, name_pos) = match has_name {
            true => self.property_name(),
            // "treat this as a property declaration with a missing name."
            false => {
                match self.is_for_oxc() && self.recovers() {
                    true => self.unexpected_like_oxc(),
                    false => self.error(1146, (self.full_start(), Diagnostic::NO_LENGTH), &[]),
                }
                (
                    PropKey::Name(known::empty),
                    NameKind::Identifier,
                    self.full_start(),
                )
            }
        };
        let name = (name_pos, self.prev_end());
        // To oxc `static constructor` is a name like any other.
        let is_keyword =
            name_token == T::Constructor && !(written.contains(Flags::STATIC) && self.is_for_oxc());
        key = declared_key(key, name_token, is_default);
        flags |= flags_of_member_name(name_token, name_kind, key);
        // Neither `tryParseConstructorDeclaration` nor the property without a name looks for it.
        let mut question = None;
        if self.token() == T::Question
            && has_name
            && !(self.recovers() && is_keyword && kind == MemberKind::Property && !is_generator)
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
        // See `oxc::type_parameters_of_quoted_constructor`.
        let is_quoted_constructor = name_token == T::String
            && self.token() == T::LessThan
            && key == PropKey::Name(known::constructor)
            && kind == MemberKind::Property
            && !is_generator
            && !written.contains(Flags::STATIC)
            && question.is_none();
        // The checker reports the `async` of `async a!`.
        if !is_function
            && (is_keyword || flags.contains(Flags::ASYNC) && self.token() == T::Exclamation)
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
            self.context |= ctx::CLASS_MEMBER;
            member.func =
                self.function_rest_or(code, fn_kind, fn_flags, (name, name_pos), start.pos);
        } else {
            // `parsePropertyDeclaration`
            if self.token() == T::Exclamation {
                let is_definite = match question {
                    None => !self.newline_before(),
                    // oxc reports the two and goes on.
                    Some(question) => {
                        if self.is_for_oxc() {
                            oxc::optional_and_definite(&mut self.f.diagnostics, question);
                        }
                        self.is_for_oxc()
                    }
                };
                if is_definite {
                    self.next();
                    member.flags |= Flags::DEFINITE;
                }
            }
            member.ty = self.type_annotation();
            let cleared = ctx::YIELD | ctx::AWAIT | ctx::DISALLOW_IN | ctx::TOP_LEVEL;
            let inner = self.enter_context(0, cleared);
            member.init = self.optional_initializer();
            self.context = inner;
            // `parseSemicolonAfterPropertyName`
            if self.token() == T::OpenParen && self.recovers()
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
        let context = self.context;
        self.context = saved;
        member.loc = TextRange {
            pos: start.full,
            end: self.prev_end(),
        };
        if self.reads_jsdoc() {
            self.member_jsdoc(&mut member, first_modifier);
        }
        member.modifiers = self.take_modifiers(first_modifier);
        if self.is_for_oxc() {
            self.check_class_member_like_oxc(&member, written, name, context);
        }
        if is_quoted_constructor && self.reports_like_oxc() {
            let at = (name.1, self.prev_end());
            let src = self.lx.src;
            oxc::type_parameters_of_quoted_constructor(&mut self.f, src, member.func, at);
        }
        if self.options.is_javascript {
            self.check_js_member(&member, question);
        }
        let before = self.s.members.get(base..).unwrap_or_default();
        let is_notable = match (member.kind, member.key) {
            (MemberKind::Constructor, _) => {
                flags.contains(Flags::ASYNC)
                    || before.iter().any(|it| it.kind == MemberKind::Constructor)
            }
            (_, PropKey::Private(name)) => {
                self.declared_private_names.push(name);
                before.iter().any(|it| it.key == member.key)
                    || self.lx.text_of(name) == b"#constructor"
            }
            (_, PropKey::Name(name)) => name == known::constructor || name == known::prototype,
            _ => false,
        };
        if is_notable {
            self.f.rare_syntax |= rare::NOTABLE_CLASS_MEMBER;
        }
        self.s.members.push(member);
    }

    /// `parseClassStaticBlockDeclaration`, at `static`.
    fn class_static_block(&mut self, start: Start, first_modifier: usize) {
        if self.is_flow() {
            self.flow_refuse_decorators(first_modifier);
        }
        // The checker reports them.
        let modifiers = self.take_modifiers(first_modifier);
        if !modifiers.is_empty() && self.is_for_oxc() {
            oxc::static_block(&mut self.f, modifiers);
        }
        self.next();
        let open = self.pos();
        // `parseClassStaticBlockBody`
        let suspensions = self.suspensions;
        let (body, _) = self.function_block(ctx::AWAIT | self.context & ctx::OUTSIDE_BODIES);
        if self.is_for_oxc() {
            oxc::returns_in_static_block(&mut self.f, body);
        }
        if self.suspensions != suspensions {
            self.f.rare_syntax |= rare::SUSPENDS_IN_STATIC_BLOCK;
        }
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
        if self.reads_jsdoc() {
            self.static_block_jsdoc(start);
        }
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
