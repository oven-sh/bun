use bun_lint::prelude::*;

/// Enforce getter and setter pairs in objects and classes.
pub struct AccessorPairs {
    get_without_set: bool,
    set_without_get: bool,
    enforce_for_class_members: bool,
    enforce_for_ts_types: bool,
}

const MISSING_GETTER_IN_PROPERTY_DESCRIPTOR: Message = Message::new(
    "missingGetterInPropertyDescriptor",
    "Getter is not present in property descriptor.",
);
const MISSING_SETTER_IN_PROPERTY_DESCRIPTOR: Message = Message::new(
    "missingSetterInPropertyDescriptor",
    "Setter is not present in property descriptor.",
);
const MISSING_GETTER_IN_OBJECT_LITERAL: Message =
    Message::new("missingGetterInObjectLiteral", "Getter is not present for {{ name }}.");
const MISSING_SETTER_IN_OBJECT_LITERAL: Message =
    Message::new("missingSetterInObjectLiteral", "Setter is not present for {{ name }}.");
const MISSING_GETTER_IN_CLASS: Message =
    Message::new("missingGetterInClass", "Getter is not present for class {{ name }}.");
const MISSING_SETTER_IN_CLASS: Message =
    Message::new("missingSetterInClass", "Setter is not present for class {{ name }}.");
const MISSING_GETTER_IN_TYPE: Message =
    Message::new("missingGetterInType", "Getter is not present for type {{ name }}.");
const MISSING_SETTER_IN_TYPE: Message =
    Message::new("missingSetterInType", "Setter is not present for type {{ name }}.");

/// A `get` or a `set` of an object literal, a class, an interface or a type literal.
#[derive(Copy, Clone)]
struct Accessor<'a> {
    key: Key<'a>,
    func: Func<'a>,
    is_getter: bool,
}

impl<'a> Accessor<'a> {
    fn of_prop(prop: Prop<'a>) -> Option<Self> {
        let is_getter = match prop.kind() {
            PropKind::Getter => true,
            PropKind::Setter => false,
            _ => return None,
        };
        Some(Accessor {
            key: prop.key()?,
            func: prop.func()?,
            is_getter,
        })
    }

    fn of_member(member: Member<'a>) -> Option<Self> {
        let is_getter = match member.kind() {
            MemberKind::Getter => true,
            MemberKind::Setter => false,
            _ => return None,
        };
        Some(Accessor {
            key: member.key()?,
            func: member.func()?,
            is_getter,
        })
    }
}

/// The same name, if both are known without evaluating anything. The same tokens, if neither is.
fn are_equal_keys<'a>(file: &'a File<'a>, left: Key<'a>, right: Key<'a>) -> bool {
    if let (KeyKind::Private(left), KeyKind::Private(right)) = (left.kind(), right.kind()) {
        return left == right;
    }
    match (ast_utils::get_static_key_name(left), ast_utils::get_static_key_name(right)) {
        (Some(left), Some(right)) => left == right,
        (None, None) => ast_utils::equal_tokens(file, left.inner_span(file), right.inner_span(file)),
        _ => false,
    }
}

impl AccessorPairs {
    fn check_list<'a>(
        &self,
        accessors: &(impl Iterator<Item = Accessor<'a>> + Clone),
        missing_getter: Message,
        missing_setter: Message,
        cx: &Cx<'a, Self>,
    ) {
        for accessor in accessors.clone() {
            let is_checked = if accessor.is_getter { self.get_without_set } else { self.set_without_get };
            let is_paired = |other: Accessor<'a>| {
                other.is_getter != accessor.is_getter && are_equal_keys(cx.file(), other.key, accessor.key)
            };
            if is_checked && !accessors.clone().any(is_paired) {
                let message = if accessor.is_getter { missing_setter } else { missing_getter };
                cx.report(ast_utils::get_function_head_loc(accessor.func), message)
                    .data("name", ast_utils::get_function_name_with_kind(accessor.func));
            }
        }
    }

    fn check_object_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(props) = e.kind() else {
            return;
        };
        self.check_list(
            &props.iter().filter_map(Accessor::of_prop),
            MISSING_GETTER_IN_OBJECT_LITERAL,
            MISSING_SETTER_IN_OBJECT_LITERAL,
            cx,
        );

        let (mut has_getter, mut has_setter) = (false, false);
        for prop in props {
            if matches!(prop.kind(), PropKind::Init | PropKind::Shorthand | PropKind::Method)
                && let Some(KeyKind::Ident(name)) = prop.key().map(Key::kind)
            {
                has_getter |= name.is("get");
                has_setter |= name.is("set");
            }
        }
        let message = match (has_getter, has_setter) {
            (false, true) if self.set_without_get => MISSING_GETTER_IN_PROPERTY_DESCRIPTOR,
            (true, false) if self.get_without_set => MISSING_SETTER_IN_PROPERTY_DESCRIPTOR,
            _ => return,
        };
        if ast_utils::is_property_descriptor(e) {
            cx.report(e, message);
        }
    }

    fn check_class_body<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for is_static in [true, false] {
            // An abstract accessor is not a `MethodDefinition`.
            let methods = class.members().iter().filter(move |member| {
                member.is_static() == is_static && !member.flags().contains(Flags::ABSTRACT)
            });
            self.check_list(
                &methods.filter_map(Accessor::of_member),
                MISSING_GETTER_IN_CLASS,
                MISSING_SETTER_IN_CLASS,
                cx,
            );
        }
    }

    fn check_type<'a>(&self, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        self.check_list(
            &members.iter().filter_map(Accessor::of_member),
            MISSING_GETTER_IN_TYPE,
            MISSING_SETTER_IN_TYPE,
            cx,
        );
    }
}

impl Rule for AccessorPairs {
    const META: Meta = Meta::eslint("accessor-pairs", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        AccessorPairs {
            get_without_set: options.bool_or("getWithoutSet", false),
            set_without_get: options.bool_or("setWithoutGet", true),
            enforce_for_class_members: options.bool_or("enforceForClassMembers", true),
            enforce_for_ts_types: options.bool_or("enforceForTSTypes", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.get_without_set && !self.set_without_get {
            return;
        }
        on.exprs([ExprTag::Object], Self::check_object_expression);
        if self.enforce_for_class_members {
            on.classes(Self::check_class_body);
        }
        if self.enforce_for_ts_types {
            on.types([TypeTag::Object], |rule, ty, cx| {
                if let TypeKind::Object(members) = ty.kind() {
                    rule.check_type(members, cx);
                }
            });
            on.stmts([StmtTag::Interface], |rule, statement, cx| {
                if let StmtKind::Interface(interface) = statement.kind() {
                    rule.check_type(interface.members(), cx);
                }
            });
        }
    }
}
