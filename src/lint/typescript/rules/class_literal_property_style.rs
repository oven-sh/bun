use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_utils::{
    FixOrSuggest, MemberAccessValue, get_fix_or_suggest, get_static_member_access_value, is_assignee,
};
use rustc_hash::{FxHashMap, FxHashSet};

/// Enforce that literals on classes are exposed in a consistent style.
pub struct ClassLiteralPropertyStyle {
    prefers_getters: bool,
}

#[derive(Default)]
pub struct State<'a> {
    /// What a constructor assigns to a property of `this`, with the class whose body the assignment
    /// is in.
    excluded: FxHashSet<(Class<'a>, MemberAccessValue<'a>)>,
    /// The `readonly` properties whose value is a literal.
    properties: Vec<Member<'a>>,
    /// The names of the setters of the classes that have many members.
    setters: FxHashMap<Class<'a>, FxHashSet<MemberAccessValue<'a>>>,
    /// What is around something: the function, and the class whose body it is in.
    functions: AncestorMemo<'a, Func<'a>>,
    class_bodies: AncestorMemo<'a, Class<'a>>,
}

/// The name of a setter.
fn name_of_setter(element: Member<'_>) -> Option<MemberAccessValue<'_>> {
    let is_setter = element.kind() == MemberKind::Setter && !element.flags().contains(Flags::ABSTRACT);
    get_static_member_access_value(element).filter(|_| is_setter)
}

const PREFER_FIELD_STYLE: Message =
    Message::new("preferFieldStyle", "Literals should be exposed using readonly fields.");
const PREFER_FIELD_STYLE_SUGGESTION: Message =
    Message::new("preferFieldStyleSuggestion", "Replace the literals with readonly fields.");
const PREFER_GETTER_STYLE: Message =
    Message::new("preferGetterStyle", "Literals should be exposed using getters.");
const PREFER_GETTER_STYLE_SUGGESTION: Message =
    Message::new("preferGetterStyleSuggestion", "Replace the literals with getters.");

/// Upstream's `printNodeModifiers`, followed by the key.
fn print_modifiers_and_key<'a>(member: Member<'a>, key: Key<'a>, last: &str) -> Vec<u8> {
    let (file, flags) = (member.file(), member.flags());
    let mut text = Vec::new();
    for (flag, keyword) in [
        (Flags::PUBLIC, "public "),
        (Flags::PROTECTED, "protected "),
        (Flags::PRIVATE, "private "),
        (Flags::STATIC, "static "),
    ] {
        if flags.contains(flag) {
            text.extend_from_slice(keyword.as_bytes());
        }
    }
    text.extend_from_slice(last.as_bytes());
    text.push(b' ');
    let name = file.slice(key.inner_span(file));
    if key.is_computed() {
        text.push(b'[');
    }
    text.extend_from_slice(name);
    if key.is_computed() {
        text.push(b']');
    }
    text
}

/// Upstream's `isSupportedLiteral`.
fn is_supported_literal(e: Expr<'_>) -> bool {
    let has_no_substitutions =
        |e: Expr<'_>| matches!(e.kind(), ExprKind::Template(template) if template.quasi_count() == 1);
    match e.kind() {
        ExprKind::TaggedTemplate(call) => call.template().is_some_and(has_no_substitutions),
        ExprKind::Template(_) => has_no_substitutions(e),
        _ => ast_utils::is_literal(e),
    }
}

/// `getStaticMemberAccessValue(node, context)`, if it is truthy.
fn truthy_name(name: Option<MemberAccessValue<'_>>) -> Option<MemberAccessValue<'_>> {
    name.filter(|it| it.as_string().is_none_or(|it| !it.is_empty()))
}

impl ClassLiteralPropertyStyle {
    /// `"fields"`
    fn check_getter<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.kind() != MemberKind::Getter || member.flags().intersects(Flags::OVERRIDE | Flags::ABSTRACT) {
            return;
        }
        let (Node::Class(class), Some(func), Some(key)) = (member.parent(), member.func(), member.key()) else {
            return;
        };
        let Some(StmtKind::Return(Some(argument))) =
            func.body_statements().and_then(List::first).map(Stmt::kind)
        else {
            return;
        };
        if !is_supported_literal(argument) {
            return;
        }
        if let Some(name) = truthy_name(get_static_member_access_value(member)) {
            let members = class.members();
            let has_setter = match cx.state.setters.get(&class) {
                Some(setters) => setters.contains(&name),
                None if members.len() <= 16 => members.iter().any(|element| name_of_setter(element).as_ref() == Some(&name)),
                None => {
                    let setters: FxHashSet<MemberAccessValue<'a>> = members.iter().filter_map(name_of_setter).collect();
                    let has_setter = setters.contains(&name);
                    cx.state.setters.insert(class, setters);
                    has_setter
                }
            };
            if has_setter {
                return;
            }
        }
        let file = cx.file();
        let fix_or_suggest = match member.decorators().next() {
            None => FixOrSuggest::Suggest,
            Some(_) => FixOrSuggest::None,
        };
        get_fix_or_suggest(
            cx.report(key.inner_span(file), PREFER_FIELD_STYLE),
            fix_or_suggest,
            PREFER_FIELD_STYLE_SUGGESTION,
            |fixer| {
                let between_parens_and_body = Span::new(func.close_paren()? + 1, func.body_span()?.start);
                let mut text = print_modifiers_and_key(member, key, "readonly");
                text.extend_from_slice(file.slice(between_parens_and_body));
                text.extend_from_slice(b"= ");
                text.extend_from_slice(argument.text());
                text.push(b';');
                Some(fixer.replace(member, text))
            },
        );
    }

    /// `"getters"`: an assignment to a property of `this` directly in a constructor.
    fn check_this<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(access) = this.parent() else {
            return;
        };
        if !matches!(access.tag(), ExprTag::Dot | ExprTag::Index) || !is_assignee(access) {
            return;
        }
        let function = (cx.state.functions).find(Node::Expr(access), |_, it| it.as_func().filter(|it| it.kind() != FnKind::StaticBlock));
        if !function.is_some_and(|it| it.kind() == FnKind::Constructor && !it.flags().contains(Flags::STATIC)) {
            return;
        }
        let class = cx.state.class_bodies.find(Node::Expr(access), |inner, it| match it {
            // What is in the heritage clause is not in the body.
            Node::Class(class) if matches!(inner, Node::Member(_)) => Some(class),
            _ => None,
        });
        if let Some(class) = class
            && let Some(name) = truthy_name(get_static_member_access_value(access))
        {
            cx.state.excluded.insert((class, name));
        }
    }

    /// `"getters"`
    fn collect_property<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let flags = member.flags();
        if member.kind() == MemberKind::Property
            && flags.contains(Flags::READONLY)
            && !flags.intersects(Flags::OVERRIDE | Flags::ABSTRACT | Flags::ACCESSOR)
            && member.init().is_some_and(is_supported_literal)
            // The flags also have it for what is in a `declare class`.
            && !member.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT)
        {
            cx.state.properties.push(member);
        }
    }

    /// `"getters"`
    fn check_properties<'a>(&self, cx: &mut Cx<'a, Self>) {
        let State { excluded, properties, .. } = std::mem::take(&mut cx.state);
        for member in properties {
            let (Node::Class(class), Some(key), Some(value)) = (member.parent(), member.key(), member.init()) else {
                continue;
            };
            if !excluded.is_empty()
                && let Some(name) = truthy_name(get_static_member_access_value(member))
                && excluded.contains(&(class, name))
            {
                continue;
            }
            cx.report(key.inner_span(cx.file()), PREFER_GETTER_STYLE).suggest(
                PREFER_GETTER_STYLE_SUGGESTION,
                |fixer| {
                    let mut text = print_modifiers_and_key(member, key, "get");
                    text.extend_from_slice(b"() { return ");
                    text.extend_from_slice(value.text());
                    text.extend_from_slice(b"; }");
                    fixer.replace(member, text)
                },
            );
        }
    }
}

impl Rule for ClassLiteralPropertyStyle {
    const META: Meta = Meta::typescript("class-literal-property-style", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STYLISTIC);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        ClassLiteralPropertyStyle {
            prefers_getters: options.str(0) == Some("getters"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if !file.has_classes() {
            return State::default();
        }
        if self.prefers_getters {
            on.exprs([ExprTag::This], Self::check_this);
            on.members(Self::collect_property);
            on.finish(Self::check_properties);
        } else {
            on.members(Self::check_getter);
        }
        State::default()
    }
}
