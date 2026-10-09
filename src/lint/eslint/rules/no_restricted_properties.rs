use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

type Text = Box<[u8]>;

/// Disallow certain properties on certain objects.
#[derive(Default)]
pub struct NoRestrictedProperties {
    /// By the name of the object, then by the name of the property.
    restricted_properties: FxHashMap<Text, FxHashMap<Text, Restriction>>,
    globally_restricted_objects: FxHashMap<Text, Restriction>,
    globally_restricted_properties: FxHashMap<Text, Restriction>,
}

struct Restriction {
    /// `allowProperties` of a restricted object, `allowObjects` of a restricted property.
    allowed: Option<Vec<Text>>,
    message: Text,
}

#[derive(Copy, Clone)]
enum Found<'r> {
    ObjectProperty(&'r Restriction),
    /// All the properties of an object.
    Object(&'r Restriction),
    Property(&'r Restriction),
}

/// Where an access can be reported.
#[derive(Copy, Clone)]
struct Places {
    eslint: Span,
    /// oxlint points at what is restricted: the object, the property, or both.
    object: Option<Span>,
    property: Span,
    access: Span,
}

impl Places {
    fn everywhere(at: Span) -> Places {
        Places { eslint: at, object: None, property: at, access: at }
    }

    /// `key`: of the property of a pattern.
    fn of_pattern(pattern: Span, key: Option<Span>) -> Places {
        Places { eslint: pattern, ..Places::everywhere(key.unwrap_or(pattern)) }
    }
}

const RESTRICTED_OBJECT_PROPERTY: Message = Message::new(
    "restrictedObjectProperty",
    "'{{objectName}}.{{propertyName}}' is restricted from being used.{{allowedPropertiesMessage}}{{message}}",
);
const RESTRICTED_PROPERTY: Message = Message::new(
    "restrictedProperty",
    "'{{propertyName}}' is restricted from being used.{{allowedObjectsMessage}}{{message}}",
);

impl Restriction {
    /// ESLint's `isAllowed`.
    fn allows(&self, name: &[u8]) -> bool {
        self.allowed.as_ref().is_some_and(|allowed| allowed.iter().any(|it| **it == *name))
    }

    /// `before`, the allowed names and a `.`. Empty if no names are configured.
    fn allowed_message(&self, before: &[&[u8]]) -> Vec<u8> {
        let Some(allowed) = &self.allowed else {
            return Vec::new();
        };
        let mut message = before.concat();
        message.extend_from_slice(&allowed.join(&b", "[..]));
        message.push(b'.');
        message
    }

    fn message(&self) -> Vec<u8> {
        match self.message.is_empty() {
            true => Vec::new(),
            false => [&b" "[..], &self.message[..]].concat(),
        }
    }
}

impl NoRestrictedProperties {
    /// The restriction that an access to the property of the object violates.
    fn find(&self, object_name: Option<&[u8]>, property_name: &[u8]) -> Option<Found<'_>> {
        let matched_object_property = object_name.and_then(|name| match self.restricted_properties.get(name) {
            Some(properties) => properties.get(property_name).map(Found::ObjectProperty),
            None => self.globally_restricted_objects.get(name).map(Found::Object),
        });
        if let Some(found @ (Found::ObjectProperty(matched) | Found::Object(matched))) = matched_object_property
            && !matched.allows(property_name)
        {
            return Some(found);
        }
        (self.globally_restricted_properties.get(property_name))
            .filter(|matched| !object_name.is_some_and(|name| matched.allows(name)))
            .map(Found::Property)
    }

    fn report<'a>(
        &self,
        places: Places,
        found: Found<'_>,
        object_name: Option<Name<'a>>,
        property_name: Cow<'a, [u8]>,
        cx: &Cx<'a, Self>,
    ) {
        let at = match found {
            _ if !cx.language().is_oxlint => places.eslint,
            Found::ObjectProperty(_) => places.access,
            Found::Object(_) => places.object.unwrap_or(places.property),
            Found::Property(_) => places.property,
        };
        match found {
            Found::ObjectProperty(matched) | Found::Object(matched) => {
                let allowed = matched.allowed_message(&[&b" Only these properties are allowed: "[..]]);
                cx.report(at, RESTRICTED_OBJECT_PROPERTY)
                    .data("objectName", object_name.map_or(&b""[..], Name::bytes))
                    .data("propertyName", property_name)
                    .data("message", matched.message())
                    .data("allowedPropertiesMessage", allowed);
            }
            Found::Property(matched) => {
                let allowed = matched.allowed_message(&[
                    &b" Property '"[..],
                    &*property_name,
                    &b"' is only allowed on these objects: "[..],
                ]);
                cx.report(at, RESTRICTED_PROPERTY)
                    .data("propertyName", property_name)
                    .data("message", matched.message())
                    .data("allowedObjectsMessage", allowed);
            }
        }
    }

    /// ESLint's `checkPropertyAccess`.
    fn check_property_access<'a>(
        &self,
        at: impl FnOnce() -> Places,
        object_name: Option<Name<'a>>,
        property_name: Option<Cow<'a, [u8]>>,
        cx: &Cx<'a, Self>,
    ) {
        if let Some(property_name) = property_name
            && let Some(found) = self.find(object_name.map(Name::bytes), &property_name)
        {
            self.report(at(), found, object_name, property_name, cx);
        }
    }

    fn check_member_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(object_name) = ast_utils::member_object(e).map(Expr::as_ident) else {
            return;
        };
        if self.globally_restricted_properties.is_empty()
            && !object_name.is_some_and(|name| {
                self.restricted_properties.contains_key(name.bytes())
                    || self.globally_restricted_objects.contains_key(name.bytes())
            })
        {
            return;
        }
        if let Some(property_name) = ast_utils::get_static_property_name(e)
            && let Some(found) = self.find(object_name.map(Name::bytes), &property_name)
            && ast_utils::is_member_expression(e)
        {
            let (object, property) = match e.kind() {
                ExprKind::Dot { obj, name, .. } => (Some(obj.outer_span()), name.span()),
                ExprKind::Index { obj, index, .. } => (Some(obj.outer_span()), index.outer_span()),
                _ => (None, e.span()),
            };
            let places = Places { object, property, ..Places::everywhere(e.span()) };
            self.report(places, found, object_name, property_name, cx);
        }
    }

    /// An `ObjectPattern` in a declaration or a parameter.
    fn check_binding_pattern<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = pat.kind() else {
            return;
        };
        // The `init` of a `VariableDeclarator`, the `right` of an `AssignmentPattern`.
        let right = match pat.parent() {
            Node::VarDecl(declaration) => declaration.init(),
            Node::Param(param) => param.default(),
            Node::PatProp(property) => property.default(),
            Node::PatElem(element) => element.default(),
            _ => None,
        };
        let object_name = right.and_then(Expr::as_ident);
        for property in properties {
            let property_name = ast_utils::get_static_property_name(property);
            let places = || {
                let key = property.key().map(|it| it.inner_span(cx.file()));
                Places::of_pattern(utils::estree_span(Node::Pat(pat)), key)
            };
            self.check_property_access(places, object_name, property_name, cx);
        }
    }

    /// An `ObjectPattern` in an assignment.
    fn check_assignment_pattern<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = e.kind() else {
            return;
        };
        if properties.is_empty() || !utils::is_assignment_target(e) {
            return;
        }
        // The `right` of an `AssignmentExpression` or of an `AssignmentPattern`.
        let object_name = match e.parent().as_expr().map(Expr::kind) {
            Some(ExprKind::Assign { target, value, .. }) if target == e => value.as_ident(),
            _ => None,
        };
        for property in properties {
            let property_name = ast_utils::get_static_property_name(property);
            let places = || Places::of_pattern(e.span(), property.key().map(|it| it.inner_span(cx.file())));
            self.check_property_access(places, object_name, property_name, cx);
        }
    }

    /// `interface I extends a.b`, `class C implements a.b`: typescript-eslint has the name as a
    /// `MemberExpression`.
    fn check_heritage<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        let mut object_name = name.first().map(Ident::name);
        for property in name.parts().skip(1) {
            if let Some(found) = self.find(object_name.map(Name::bytes), property.bytes())
                && utils::estree_type_name(Node::Type(ty)) != "TSTypeReference"
            {
                let at = Span::new(ty.span().start, property.span().end);
                self.report(Places::everywhere(at), found, object_name, Cow::Borrowed(property.bytes()), cx);
            }
            object_name = None;
        }
    }
}

impl Rule for NoRestrictedProperties {
    const META: Meta = Meta::eslint("no-restricted-properties", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let mut rule = NoRestrictedProperties::default();
        for option in options.all() {
            let option = Object::of(Some(option));
            let restriction = |allowed: &str| Restriction {
                allowed: (option.has(allowed))
                    .then(|| option.strings(allowed).into_iter().map(|it| it.as_bytes().into()).collect()),
                message: option.str("message").unwrap_or_default().as_bytes().into(),
            };
            match (option.str("object"), option.str("property")) {
                (None, Some(property)) => {
                    rule.globally_restricted_properties.insert(property.as_bytes().into(), restriction("allowObjects"));
                }
                (Some(object), None) => {
                    rule.globally_restricted_objects.insert(object.as_bytes().into(), restriction("allowProperties"));
                }
                (Some(object), Some(property)) => {
                    let properties = rule.restricted_properties.entry(object.as_bytes().into()).or_default();
                    properties.insert(property.as_bytes().into(), Restriction {
                        allowed: None,
                        message: option.str("message").unwrap_or_default().as_bytes().into(),
                    });
                }
                (None, None) => {}
            }
        }
        rule
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.restricted_properties.is_empty()
            && self.globally_restricted_objects.is_empty()
            && self.globally_restricted_properties.is_empty()
        {
            return;
        }
        on.exprs([ExprTag::Dot, ExprTag::Index], Self::check_member_expression);
        on.pats([PatTag::Object], Self::check_binding_pattern);
        on.exprs([ExprTag::Object], Self::check_assignment_pattern);
        if !file.is_javascript() {
            on.types([TypeTag::Ref], Self::check_heritage);
        }
    }
}
