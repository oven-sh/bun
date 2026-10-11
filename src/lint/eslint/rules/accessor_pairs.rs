use bun_lint::prelude::*;
use smallvec::SmallVec;

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
pub(super) struct Accessor<'a> {
    pub(super) key: Key<'a>,
    pub(super) func: Func<'a>,
    pub(super) is_getter: bool,
}

impl<'a> Accessor<'a> {
    pub(super) fn of_prop(prop: Prop<'a>) -> Option<Self> {
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

    pub(super) fn of_member(member: Member<'a>) -> Option<Self> {
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
    /// It is compiled once, not for each kind of list.
    #[inline(never)]
    fn check_list<'a>(
        &self,
        accessors: &mut dyn Iterator<Item = Accessor<'a>>,
        missing_getter: Message,
        missing_setter: Message,
        cx: &Cx<'a, Self>,
    ) {
        let accessors: SmallVec<[Accessor<'a>; 8]> = accessors.collect();
        let is_checked = |accessor: Accessor<'a>| match accessor.is_getter {
            true => self.get_without_set,
            false => self.set_without_get,
        };
        let report = |accessor: Accessor<'a>| {
            let message = if accessor.is_getter { missing_setter } else { missing_getter };
            // oxlint points at the key.
            let place = match cx.language().is_oxlint {
                true => accessor.key.inner_span(cx.file()),
                false => ast_utils::get_function_head_loc(accessor.func),
            };
            cx.report(place, message)
                .data("name", ast_utils::get_function_name_with_kind(accessor.func));
        };
        // Of several getters, or setters, of a name that is known oxlint keeps the last.
        let is_oxlint = cx.language().is_oxlint;
        let keeps_the_last = |accessor: Accessor<'a>| is_oxlint && accessor.key.name().is_some();
        for (i, &accessor) in accessors.iter().enumerate() {
            let is_paired = |other: &Accessor<'a>| {
                other.is_getter != accessor.is_getter && are_equal_keys(cx.file(), other.key, accessor.key)
            };
            let is_same = |other: &Accessor<'a>| {
                other.is_getter == accessor.is_getter && are_equal_keys(cx.file(), other.key, accessor.key)
            };
            if is_checked(accessor)
                && !accessors.iter().any(is_paired)
                && !(keeps_the_last(accessor) && accessors.iter().skip(i + 1).any(is_same))
            {
                report(accessor);
            }
        }
    }

    fn check_type<'a>(&self, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        self.check_list(
            &mut members.iter().filter_map(Accessor::of_member),
            MISSING_GETTER_IN_TYPE,
            MISSING_SETTER_IN_TYPE,
            cx,
        );
    }
}

impl Rule for AccessorPairs {
    const META: Meta = Meta::eslint("accessor-pairs", Kind::Suggestion);
    const ON: On = On::new()
        .exprs(&[ExprTag::Object])
        .classes()
        .types(&[TypeTag::Object])
        .stmts(&[StmtTag::Interface]);
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

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Object]);
        if self.enforce_for_class_members {
            on = on.classes();
        }
        if self.enforce_for_ts_types {
            on = on.types(&[TypeTag::Object]).stmts(&[StmtTag::Interface]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        if !self.get_without_set && !self.set_without_get {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(props) = e.kind() else {
            return;
        };
        self.check_list(
            &mut props.iter().filter_map(Accessor::of_prop),
            MISSING_GETTER_IN_OBJECT_LITERAL,
            MISSING_SETTER_IN_OBJECT_LITERAL,
            cx,
        );

        let (mut has_getter, mut has_setter, mut key_of_setter) = (false, false, None);
        for prop in props {
            if matches!(prop.kind(), PropKind::Init | PropKind::Shorthand | PropKind::Method)
                && let Some(KeyKind::Ident(name)) = prop.key().map(Key::kind)
            {
                has_getter |= name.is("get");
                if name.is("set") {
                    (has_setter, key_of_setter) = (true, prop.key());
                }
            }
        }
        let message = match (has_getter, has_setter) {
            (false, true) if self.set_without_get => MISSING_GETTER_IN_PROPERTY_DESCRIPTOR,
            // oxlint does not miss the setter of a descriptor.
            (true, false) if self.get_without_set && !cx.language().is_oxlint => MISSING_SETTER_IN_PROPERTY_DESCRIPTOR,
            _ => return,
        };
        if ast_utils::is_property_descriptor(e) {
            // oxlint points at the `set`.
            let place = match key_of_setter.filter(|_| cx.language().is_oxlint) {
                Some(key) => key.inner_span(cx.file()),
                None => e.span(),
            };
            cx.report(place, message);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for is_static in [true, false] {
            // An abstract accessor is not a `MethodDefinition`.
            let methods = class.members().iter().filter(move |member| {
                member.is_static() == is_static && !member.flags().contains(Flags::ABSTRACT)
            });
            self.check_list(
                &mut methods.filter_map(Accessor::of_member),
                MISSING_GETTER_IN_CLASS,
                MISSING_SETTER_IN_CLASS,
                cx,
            );
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Object(members) = ty.kind() {
            self.check_type(members, cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = statement.kind() {
            self.check_type(interface.members(), cx);
        }
    }
}
