use super::*;
use crate::atom::known;

fn with_file<R>(file: FileBuilder, check: impl FnOnce(&mut File<'_>) -> R) -> R {
    let session = Session::new();
    let (mut hir, _) = file.into_arena(session.arena(), &session);
    check(&mut hir)
}

fn add_ident(file: &mut FileBuilder) -> ExprId {
    file.expr(ExprKind::Ident(known::this), 0, 0)
}

fn add_string(file: &mut FileBuilder) -> ExprId {
    file.expr(ExprKind::String(known::length), 0, 0)
}

fn add_index(file: &mut FileBuilder, index: ExprId) -> (ExprId, ExprId) {
    let obj = add_ident(file);
    let chain = Chain::No;
    (obj, file.expr(ExprKind::Index { obj, index, chain }, 0, 0))
}

fn add_function(file: &mut FileBuilder, body: FnBody, is_strict: bool) -> FnId {
    file.add_fn(Func {
        kind: FnKind::Method,
        flags: Flags::empty(),
        name: Atom::NONE,
        name_pos: 0,
        type_params: Span::EMPTY,
        params: Span::EMPTY,
        this_param: ParamId::NONE,
        ret: TypeNodeId::NONE,
        body,
        anchor: 0,
        start: 0,
        text_start: 0,
        is_strict,
        is_strict_by_syntax: is_strict,
    })
}

fn property(key: PropKey, value: ExprId, pos: u32) -> Prop {
    Prop {
        kind: PropKind::Init,
        key,
        name_kind: NameKind::default(),
        value,
        pos,
        start: pos,
        end: pos,
        postfix_token: 0,
    }
}

fn add_attributes(file: &mut FileBuilder, value: ExprId) -> ExprId {
    let props = file.add_props(&[property(PropKey::Name(known::default), value, 0)]);
    file.expr(ExprKind::Object(props), 0, 0)
}

type MemberCase = (MemberKind, Flags, FnId, Span<ModifierId>, bool);

fn add_class_member(file: &mut FileBuilder, case: &MemberCase) -> MemberId {
    let &(kind, flags, func, modifiers, _) = case;
    file.add_member(Member {
        kind,
        key: PropKey::Name(known::length),
        flags,
        ty: TypeNodeId::NONE,
        init: ExprId::NONE,
        func,
        name_pos: 0,
        start: 0,
        loc: TextRange::default(),
        modifiers,
    })
}

#[test]
fn new_kinds_have_tags_of_old_kinds() {
    let with = StmtKind::With {
        object: ExprId::NONE,
        body: StmtId::NONE,
    };
    let directive = StmtKind::Directive {
        expr: ExprId::NONE,
        raw: known::use_strict,
    };
    assert_eq!(with.tag(), StmtTag::Block);
    assert_eq!(directive.tag(), StmtTag::Expr);
    assert_eq!(ExprKind::JsxText(known::empty).tag(), ExprTag::String);
}

#[test]
fn member_key_of_dot() {
    let mut file = FileBuilder::default();
    let obj = add_ident(&mut file);
    let name = known::length;
    let kind = file.dot((obj, Chain::No), (name, 0), 0);
    let dot = file.expr(kind, 0, 0);
    assert_eq!(file.member_key(dot), Some((obj, MemberKey::Name(name))));
    file.add_flags(dot, ExprFlags::PRIVATE_NAME);
    let private = MemberKey::PrivateName(name);
    assert_eq!(file.member_key(dot), Some((obj, private)));
}

#[test]
fn member_key_of_literal_index() {
    let mut file = FileBuilder::default();
    let expected = MemberKey::Name(known::length);

    let string = add_string(&mut file);
    let (obj, index) = add_index(&mut file, string);
    assert_eq!(file.member_key(index), Some((obj, expected)));

    let backticks = add_string(&mut file);
    file.add_flags(backticks, ExprFlags::TEMPLATE_LITERAL);
    let (obj, index) = add_index(&mut file, backticks);
    assert_eq!(file.member_key(index), Some((obj, expected)));

    let exprs = file.list::<ExprId>(&[]);
    file.ids.push(known::length.0);
    let template = file.expr(ExprKind::Template { exprs }, 0, 0);
    let (obj, index) = add_index(&mut file, template);
    assert_eq!(file.member_key(index), Some((obj, expected)));

    let parenthesized = add_string(&mut file);
    file.add_flags(parenthesized, ExprFlags::PARENTHESIZED);
    let (obj, index) = add_index(&mut file, parenthesized);
    assert_eq!(file.member_key(index), Some((obj, expected)));
}

#[test]
fn member_key_of_computed_index() {
    let mut file = FileBuilder::default();
    let number = file.number(0.0);
    let zero = file.expr(ExprKind::Number(number), 0, 0);
    let (obj, index) = add_index(&mut file, zero);
    assert_eq!(
        file.member_key(index),
        Some((obj, MemberKey::Computed(zero)))
    );

    let name = add_ident(&mut file);
    let (obj, index) = add_index(&mut file, name);
    assert_eq!(
        file.member_key(index),
        Some((obj, MemberKey::Computed(name)))
    );
}

#[test]
fn member_key_of_other_kinds() {
    let mut file = FileBuilder::default();
    let ident = add_ident(&mut file);
    assert_eq!(file.member_key(ident), None);
    assert_eq!(file.member_key(ExprId::NONE), None);
}

#[test]
fn type_assertions_are_skipped() {
    let mut file = FileBuilder::default();
    let ident = add_ident(&mut file);
    let non_null = file.expr(ExprKind::NonNull(ident), 0, 0);
    let as_const = file.expr(ExprKind::AsConst(non_null), 0, 0);
    assert_eq!(file.type_assertion_operand(as_const), Some(non_null));
    assert_eq!(file.type_assertion_operand(ident), None);
    assert_eq!(file.type_assertion_operand(ExprId::NONE), None);
    assert_eq!(file.skip_type_assertions(as_const), ident);
    assert_eq!(file.skip_type_assertions(ident), ident);
}

#[test]
fn builder_sets_flags_that_follow_from_kind() {
    let mut file = FileBuilder::default();
    let name = add_ident(&mut file);
    let (_, index) = add_index(&mut file, name);
    let private = file.expr(ExprKind::PrivateIdentifier(known::length), 0, 0);
    let kind = file.dot((name, Chain::Start), (known::length, 0), 0);
    let link = file.expr(kind, 0, 0);
    assert_eq!(file.expr_flags(name), ExprFlags::empty());
    assert_eq!(file.expr_flags(index), ExprFlags::BRACKET_ACCESS);
    assert_eq!(file.expr_flags(private), ExprFlags::PRIVATE_NAME);
    assert_eq!(file.expr_flags(link), ExprFlags::OPTIONAL_CHAIN_LINK);
    assert_eq!(file.expr_flags(ExprId::NONE), ExprFlags::empty());
    assert_eq!(file.expr_flags.len(), file.exprs.len());
}

#[test]
fn pop_expr_removes_flags() {
    let mut file = FileBuilder::default();
    add_ident(&mut file);
    assert!(file.pop_expr().is_some());
    assert!(file.exprs.is_empty());
    assert!(file.expr_flags.is_empty());
}

#[test]
fn template_parts_without_entry_are_empty() {
    let mut file = FileBuilder::default();
    let string = add_string(&mut file);
    assert!(file.template_parts(string).is_empty());
}

#[test]
fn template_parts_of_tagged_string() {
    let mut file = FileBuilder::default();
    let string = add_string(&mut file);
    let part = TemplatePart {
        cooked: None,
        raw: known::length,
    };
    file.template_parts.push(part);
    file.template_part_starts.push((string, 0));
    assert_eq!(file.template_parts(string), &[part]);
}

#[test]
fn jsx_attribute_text_defaults_to_string() {
    let mut file = FileBuilder::default();
    let plain = add_string(&mut file);
    let decoded = add_string(&mut file);
    file.jsx_attribute_texts.push((decoded, known::default));
    assert_eq!(file.jsx_attribute_text(plain), known::length);
    assert_eq!(file.jsx_attribute_text(decoded), known::default);
}

#[test]
fn import_attribute_value() {
    let mut file = FileBuilder::default();
    let string = add_string(&mut file);
    let attributes = add_attributes(&mut file, string);
    let found = file.import_attribute(attributes, known::default);
    assert_eq!(found, Some(known::length));
    assert_eq!(file.import_attribute(attributes, known::this), None);
    assert_eq!(file.import_attribute(ExprId::NONE, known::default), None);
}

#[test]
fn import_attribute_with_non_string_value_is_none() {
    let mut file = FileBuilder::default();
    let ident = add_ident(&mut file);
    let attributes = add_attributes(&mut file, ident);
    assert_eq!(file.import_attribute(attributes, known::default), None);
}

#[test]
fn may_mention_with_empty_filter() {
    let file = FileBuilder::default();
    assert!(file.may_mention(b"require"));
}

#[test]
fn may_mention_reads_bit() {
    let mut file = FileBuilder::default();
    file.mentioned = vec![0; MENTIONED_BITS / 64];
    assert!(!file.may_mention(b"require"));
    let bit = mention_bit(b"require");
    file.mentioned[bit as usize / 64] |= 1 << (bit % 64);
    assert!(file.may_mention(b"require"));
}

#[test]
fn top_level_await_is_rare_syntax() {
    let mut file = FileBuilder::default();
    assert!(!file.has_top_level_await());
    file.rare_syntax |= rare::TOP_LEVEL_AWAIT;
    assert!(file.has_top_level_await());
}

#[test]
fn diagnostic_class() {
    let classes = [
        (DiagnosticKind::Parse, DiagnosticClass::EarlyError),
        (DiagnosticKind::Js, DiagnosticClass::EarlyError),
        (DiagnosticKind::JsDoc, DiagnosticClass::TypeScriptGrammar),
        (DiagnosticKind::Grammar, DiagnosticClass::TypeScriptGrammar),
        (DiagnosticKind::Checker, DiagnosticClass::Semantic),
    ];
    for (kind, class) in classes {
        assert_eq!(
            Diagnostic::new(kind, (1, 2), 3, &[]).class,
            class,
            "{kind:?}"
        );
    }
    let diagnostic = Diagnostic::new(DiagnosticKind::Grammar, (1, 2), 3, &[]);
    let classed = diagnostic.clone().with_class(DiagnosticClass::Style);
    let expected = Diagnostic {
        class: DiagnosticClass::Style,
        ..diagnostic
    };
    assert_eq!(classed, expected);
}

#[test]
fn bigint_name_is_runtime_key() {
    let mut file = FileBuilder::default();
    let value = add_ident(&mut file);
    let props = file.add_props(&[
        property(PropKey::None, value, 4),
        property(PropKey::Name(known::length), value, 9),
    ]);
    assert_eq!(file.runtime_property_key(props.at(0)), PropKey::None);
    file.bigint_names.push((4, known::default));
    let name = PropKey::Name(known::default);
    assert_eq!(file.runtime_property_key(props.at(0)), name);
    assert_eq!(file[props.at(0)].key, PropKey::None);
    let written = PropKey::Name(known::length);
    assert_eq!(file.runtime_property_key(props.at(1)), written);
}

#[test]
fn directives_of_body() {
    let mut file = FileBuilder::default();
    let first = add_string(&mut file);
    let second = add_string(&mut file);
    let third = add_string(&mut file);
    let directive = |expr, raw| StmtKind::Directive { expr, raw };
    let statements = [
        file.stmt(directive(first, known::length), 0),
        file.stmt(directive(second, known::use_strict), 0),
        file.stmt(StmtKind::Expr(third), 0),
    ];
    let list = file.list(&statements);
    let found: Vec<(StmtId, Atom)> = file.directives(list).collect();
    let expected = [
        (statements[0], known::length),
        (statements[1], known::use_strict),
    ];
    assert_eq!(found, expected);
    assert!(file.has_use_strict_directive(FnBody::Block(list)));
    let other = file.list(&statements[..1]);
    assert!(!file.has_use_strict_directive(FnBody::Block(other)));
    assert!(!file.has_use_strict_directive(FnBody::Expr(first)));
    assert!(!file.has_use_strict_directive(FnBody::None));
}

#[test]
fn strictness_is_set_and_reset() {
    let mut file = FileBuilder::default();
    let strict = add_function(&mut file, FnBody::None, true);
    let sloppy = add_function(&mut file, FnBody::None, false);
    with_file(file, |hir| {
        hir.set_strict();
        assert!(hir.is_strict && !hir.is_strict_by_syntax);
        assert!(hir[strict].is_strict && hir[sloppy].is_strict);
        assert!(!hir[sloppy].is_strict_by_syntax);
        hir.reset_strict();
        assert!(!hir.is_strict);
        assert!(hir[strict].is_strict && !hir[sloppy].is_strict);
    });
}

#[test]
fn module_declaration_makes_every_function_strict() {
    let mut file = FileBuilder::default();
    let function = add_function(&mut file, FnBody::None, false);
    file.set_strict_by_syntax();
    assert!(file.is_strict && file.is_strict_by_syntax);
    assert!(file[function].is_strict && file[function].is_strict_by_syntax);
}

#[test]
fn runtime_members() {
    let mut file = FileBuilder::default();
    let decorator = add_ident(&mut file);
    let decorated = file.add_modifiers(&[Modifier {
        kind: ModifierKind::Decorator(decorator),
        pos: 0,
    }]);
    let declare_keyword = file.add_modifiers(&[Modifier {
        kind: ModifierKind::Keyword(Flags::AMBIENT),
        pos: 0,
    }]);
    let plain: Span<ModifierId> = Span::EMPTY;
    let with_body = add_function(&mut file, FnBody::Block(IdList::EMPTY), true);
    let without_body = add_function(&mut file, FnBody::None, true);
    let (none, declare, is_abstract) = (Flags::empty(), Flags::AMBIENT, Flags::ABSTRACT);
    let cases: [MemberCase; 20] = [
        (MemberKind::Property, none, FnId::NONE, plain, true),
        (MemberKind::Property, none, FnId::NONE, decorated, true),
        (
            MemberKind::Property,
            declare,
            FnId::NONE,
            declare_keyword,
            false,
        ),
        (MemberKind::Property, is_abstract, FnId::NONE, plain, false),
        (MemberKind::Property, declare, FnId::NONE, decorated, true),
        (
            MemberKind::Property,
            is_abstract,
            FnId::NONE,
            decorated,
            true,
        ),
        (MemberKind::Method, none, with_body, plain, true),
        (MemberKind::Getter, none, with_body, plain, true),
        (MemberKind::Setter, none, with_body, plain, true),
        (MemberKind::Constructor, none, with_body, plain, true),
        (MemberKind::Method, none, without_body, plain, false),
        (MemberKind::Constructor, none, without_body, plain, false),
        (MemberKind::Method, none, FnId::NONE, plain, false),
        (
            MemberKind::Method,
            is_abstract,
            without_body,
            decorated,
            false,
        ),
        (MemberKind::Method, declare, with_body, decorated, false),
        (MemberKind::StaticBlock, none, with_body, plain, true),
        (MemberKind::StaticBlock, declare, with_body, plain, false),
        (MemberKind::CallSignature, none, without_body, plain, false),
        (
            MemberKind::ConstructSignature,
            none,
            without_body,
            plain,
            false,
        ),
        (MemberKind::IndexSignature, none, without_body, plain, false),
    ];
    let members = cases
        .each_ref()
        .map(|case| add_class_member(&mut file, case));
    with_file(file, |hir| {
        for (member, case) in members.into_iter().zip(&cases) {
            assert_eq!(has_runtime_member(hir, member), case.4, "{case:?}");
        }
    });
}
