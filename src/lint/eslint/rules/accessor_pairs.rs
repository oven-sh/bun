use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;
use smallvec::SmallVec;
use std::borrow::Cow;

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
    let is_oxlint = file.language().is_oxlint;
    let name = |key: Key<'a>| match is_oxlint {
        true => oxlint_static_name(key).map(Cow::Borrowed),
        false => ast_utils::get_static_key_name(key),
    };
    let span = |key: Key<'a>| match key.kind() {
        KeyKind::Computed(e) if is_oxlint => get_inner_expression(e).span(),
        _ => key.inner_span(file),
    };
    match (name(left), name(right)) {
        (Some(left), Some(right)) => left == right,
        (None, None) => ast_utils::equal_tokens(file, span(left), span(right)),
        _ => false,
    }
}

/// `PropertyKey::static_name`
fn oxlint_static_name(key: Key<'_>) -> Option<&[u8]> {
    utils::oxlint::property_key_name(key).filter(|_| !key.is_private())
}

/// What oxlint asks of a property descriptor beyond [`ast_utils::is_property_descriptor`]: neither it nor the object that
/// it is in is in parentheses, and the name of the method is not in brackets.
fn is_plain_descriptor(e: Expr<'_>) -> bool {
    let argument = match e.parent() {
        Node::Prop(prop) => prop.parent().as_expr(),
        _ => Some(e),
    };
    !e.is_parenthesized()
        && argument.is_some_and(|argument| {
            let call = argument.parent().as_expr().and_then(Expr::as_call);
            !argument.is_parenthesized() && call.is_some_and(|call| call.callee().tag() == ExprTag::Dot)
        })
}

impl AccessorPairs {
    /// `func` is one of `accessors`, which are all of an object literal, a class or a type that can be a pair with it.
    fn check<'a>(
        &self,
        func: Func<'a>,
        accessors: &mut dyn Iterator<Item = Accessor<'a>>,
        missing_getter: Message,
        missing_setter: Message,
        cx: &Cx<'a, Self>,
    ) {
        let accessors: SmallVec<[Accessor<'a>; 8]> = accessors.collect();
        let Some((i, &accessor)) = accessors.iter().enumerate().find(|(_, it)| it.func == func) else {
            return;
        };
        let is_paired = |other: &Accessor<'a>| {
            other.is_getter != accessor.is_getter && are_equal_keys(cx.file(), other.key, accessor.key)
        };
        let is_same = |other: &Accessor<'a>| {
            other.is_getter == accessor.is_getter && are_equal_keys(cx.file(), other.key, accessor.key)
        };
        // Of several getters, or setters, of a name that is known oxlint keeps the last.
        let is_oxlint = cx.language().is_oxlint;
        let keeps_the_last = is_oxlint && accessor.key.name().is_some();
        if accessors.iter().any(is_paired) || keeps_the_last && accessors.iter().skip(i + 1).any(is_same) {
            return;
        }
        let message = if accessor.is_getter { missing_setter } else { missing_getter };
        // oxlint points at the key.
        let place = match is_oxlint {
            true => utils::oxlint::property_key_span(accessor.key, cx.file()),
            false => ast_utils::get_function_head_loc(accessor.func),
        };
        cx.report(place, message)
            .data("name", ast_utils::get_function_name_with_kind(accessor.func));
    }

    fn check_type<'a>(&self, func: Func<'a>, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        self.check(
            func,
            &mut members.iter().filter_map(Accessor::of_member),
            MISSING_GETTER_IN_TYPE,
            MISSING_SETTER_IN_TYPE,
            cx,
        );
    }

    /// Whether an object literal of the file can be a property descriptor that is reported.
    fn may_have_descriptors(&self, file: &File) -> bool {
        (self.set_without_get && file.mentions("set")
            || self.get_without_set && !file.language().is_oxlint && file.mentions("get"))
            && (file.mentions("defineProperty") && file.mentions_any(&["Object", "Reflect"])
                || file.mentions("Object") && file.mentions_any(&["create", "defineProperties"]))
    }
}

impl Rule for AccessorPairs {
    const META: Meta = Meta::eslint("accessor-pairs", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Object]).funcs();
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

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match self.may_have_descriptors(file) {
            true => On::new().funcs().exprs(&[ExprTag::Object]),
            false => On::new().funcs(),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        if !self.get_without_set && !self.set_without_get {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(props) = e.as_object() else {
            return;
        };
        let (mut has_getter, mut has_setter, mut key_of_setter) = (false, false, None);
        let is_oxlint = cx.language().is_oxlint;
        for prop in props {
            // oxlint goes by the name, however it is written and whatever has it.
            let name = match (prop.key().map(Key::kind), prop.kind()) {
                _ if is_oxlint => prop.key().and_then(oxlint_static_name),
                (Some(KeyKind::Ident(name)), PropKind::Init | PropKind::Shorthand | PropKind::Method) => Some(name.bytes()),
                _ => None,
            };
            has_getter |= name == Some(b"get");
            if name == Some(b"set") {
                (has_setter, key_of_setter) = (true, prop.key());
            }
        }
        let message = match (has_getter, has_setter) {
            (false, true) if self.set_without_get => MISSING_GETTER_IN_PROPERTY_DESCRIPTOR,
            // oxlint does not miss the setter of a descriptor.
            (true, false) if self.get_without_set && !is_oxlint => MISSING_SETTER_IN_PROPERTY_DESCRIPTOR,
            _ => return,
        };
        if ast_utils::is_property_descriptor(e) && (!is_oxlint || is_plain_descriptor(e)) {
            // oxlint points at the `set`.
            let place = match key_of_setter.filter(|_| is_oxlint) {
                Some(key) => key.inner_span(cx.file()),
                None => e.span(),
            };
            cx.report(place, message);
        }
    }

    #[inline]
    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let is_checked = match func.kind() {
            FnKind::Getter => self.get_without_set,
            FnKind::Setter => self.set_without_get,
            _ => false,
        };
        if is_checked {
            self.check_accessor(func, cx);
        }
    }
}

impl AccessorPairs {
    #[inline(never)]
    fn check_accessor<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>) {
        match func.owner() {
            Node::Expr(e) => {
                if let Node::Prop(prop) = e.parent()
                    && let Node::Expr(object) = prop.parent()
                    && let Some(props) = object.as_object()
                {
                    self.check(
                        func,
                        &mut props.iter().filter_map(Accessor::of_prop),
                        MISSING_GETTER_IN_OBJECT_LITERAL,
                        MISSING_SETTER_IN_OBJECT_LITERAL,
                        cx,
                    );
                }
            }
            Node::Member(member) => match member.parent() {
                Node::Class(class) if self.enforce_for_class_members => {
                    let is_static = member.is_static();
                    // An abstract accessor is not a `MethodDefinition`, but for oxlint.
                    let is_oxlint = cx.language().is_oxlint;
                    let methods = class.members().iter().filter(move |member| {
                        member.is_static() == is_static && (is_oxlint || !member.flags().contains(Flags::ABSTRACT))
                    });
                    self.check(
                        func,
                        &mut methods.filter_map(Accessor::of_member),
                        MISSING_GETTER_IN_CLASS,
                        MISSING_SETTER_IN_CLASS,
                        cx,
                    );
                }
                Node::Type(ty) if self.enforce_for_ts_types => {
                    if let TypeKind::Object(members) = ty.kind() {
                        self.check_type(func, members, cx);
                    }
                }
                Node::Stmt(statement) if self.enforce_for_ts_types => {
                    if let Some(interface) = statement.as_interface() {
                        self.check_type(func, interface.members(), cx);
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
}
