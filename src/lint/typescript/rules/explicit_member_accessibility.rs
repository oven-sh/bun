use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{get_member_head_loc, get_name_from_member, get_parameter_property_head_loc};
use std::borrow::Cow;

/// Require explicit accessibility modifiers on class properties and methods.
pub struct ExplicitMemberAccessibility {
    constructors: Level,
    accessors: Level,
    methods: Level,
    properties: Level,
    parameter_properties: Level,
    ignored_method_names: Vec<Vec<u8>>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Level {
    Explicit,
    NoPublic,
    Off,
}

const ADD_EXPLICIT_ACCESSIBILITY: Message =
    Message::new("addExplicitAccessibility", "Add '{{ type }}' accessibility modifier");
const MISSING_ACCESSIBILITY: Message =
    Message::new("missingAccessibility", "Missing accessibility modifier on {{type}} {{name}}.");
const UNWANTED_PUBLIC_ACCESSIBILITY: Message =
    Message::new("unwantedPublicAccessibility", "Public accessibility modifier on {{type}} {{name}}.");

const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);

/// `head`: what is reported, which starts after the decorators, where the modifier belongs. `key`: what oxlint points at.
fn report_missing<'a>(
    head: Span,
    key: Option<Span>,
    node_type: &'static str,
    name: Cow<'a, [u8]>,
    cx: &Cx<'a, ExplicitMemberAccessibility>,
) {
    let place = key.filter(|_| cx.language().is_oxlint).unwrap_or(head);
    let mut report = cx.report(place, MISSING_ACCESSIBILITY).data("type", node_type).data("name", name);
    for accessibility in ["public", "private", "protected"] {
        report = report.suggest_with(ADD_EXPLICIT_ACCESSIBILITY, &[("type", accessibility.as_bytes())], |fixer| {
            fixer.insert_before(head, format!("{accessibility} "))
        });
    }
}

/// Reports the `public` among `modifiers`. The fix removes it and the whitespace after it.
fn report_public<'a>(
    modifiers: List<'a, Modifier<'a>>,
    node_type: &'static str,
    name: Cow<'a, [u8]>,
    cx: &Cx<'a, ExplicitMemberAccessibility>,
) {
    let Some(keyword) = modifiers.iter().find(|it| it.flag() == Flags::PUBLIC) else {
        return;
    };
    cx.report(keyword, UNWANTED_PUBLIC_ACCESSIBILITY).data("type", node_type).data("name", name).fix(|fixer| {
        let next = fixer.file().tokens_after(keyword).with_comments().next()?;
        Some(fixer.remove(Span::new(keyword.span().start, next.start())))
    });
}

impl ExplicitMemberAccessibility {
    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let (check, node_type) = match member.kind() {
            MemberKind::Constructor if member.is_constructor() => (self.constructors, "method definition"),
            MemberKind::Method | MemberKind::Constructor => (self.methods, "method definition"),
            MemberKind::Getter => (self.accessors, "get property accessor"),
            MemberKind::Setter => (self.accessors, "set property accessor"),
            MemberKind::Property => (self.properties, "class property"),
            _ => return,
        };
        let is_wrong = match check {
            Level::Explicit => !member.flags().intersects(ACCESSIBILITY),
            Level::NoPublic => member.flags().contains(Flags::PUBLIC),
            Level::Off => false,
        };
        if !is_wrong || member.is_signature() || member.key().is_some_and(Key::is_private) {
            return;
        }
        // oxlint has a key that is a string without quotes, and no name for one that is computed.
        let name = match cx.language().is_oxlint {
            true => Cow::Borrowed(utils::oxlint::member_key_name(member).unwrap_or_default()),
            false => get_name_from_member(member).name,
        };
        if member.kind() != MemberKind::Property && self.ignored_method_names.iter().any(|it| **it == *name) {
            return;
        }
        match check {
            Level::Explicit => {
                let key = match member.key() {
                    Some(key) => Some(key.inner_span(cx.file())),
                    None => member.constructor_keyword().map(|it| it.span()),
                };
                report_missing(get_member_head_loc(member), key, node_type, name, cx);
            }
            _ => report_public(member.modifiers(), node_type, name, cx),
        }
    }

    fn check_parameter<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if !param.is_parameter_property() {
            return;
        }
        let is_wrong = match self.parameter_properties {
            Level::Explicit => !param.flags().intersects(ACCESSIBILITY),
            _ => param.flags().contains(Flags::PUBLIC | Flags::READONLY),
        };
        let Some(name) = param.pat().as_ident().filter(|_| is_wrong) else {
            return;
        };
        let name = name.bytes();
        match self.parameter_properties {
            Level::Explicit => {
                let head = get_parameter_property_head_loc(param, name);
                report_missing(head, Some(param.pat().span()), "parameter property", Cow::Borrowed(name), cx);
            }
            _ => report_public(param.modifiers(), "parameter property", Cow::Borrowed(name), cx),
        }
    }
}

impl Rule for ExplicitMemberAccessibility {
    const META: Meta = Meta::typescript("explicit-member-accessibility", Kind::Problem)
        .fixable(Fixable::Code)
        .has_suggestions();
    const ON: On = On::new().members().params();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let level = |level: Option<&str>, default: Level| match level {
            Some("explicit") => Level::Explicit,
            Some("no-public") => Level::NoPublic,
            Some("off") => Level::Off,
            _ => default,
        };
        let base = level(options.str("accessibility"), Level::Explicit);
        let overrides = options.object("overrides");
        ExplicitMemberAccessibility {
            constructors: level(overrides.str("constructors"), base),
            accessors: level(overrides.str("accessors"), base),
            methods: level(overrides.str("methods"), base),
            properties: level(overrides.str("properties"), base),
            parameter_properties: level(overrides.str("parameterProperties"), base),
            ignored_method_names: (options.strings("ignoredMethodNames").into_iter())
                .map(|it| it.as_bytes().to_vec())
                .collect(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.has_classes() {
            return None;
        }
        Some(())
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let members = [self.constructors, self.accessors, self.methods, self.properties];
        if members.iter().any(|it| *it != Level::Off) {
            self.check_member(member, cx);
        }
    }

    fn param<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if self.parameter_properties != Level::Off {
            self.check_parameter(param, cx);
        }
    }
}
