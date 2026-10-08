use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

/// Require or disallow parameter properties in class constructors.
pub struct ParameterProperties {
    /// A bit for each combination of modifiers that is allowed, numbered by [`modifiers_of`].
    allow: u8,
    prefers_parameter_property: bool,
}

const PREFER_CLASS_PROPERTY: Message = Message::new(
    "preferClassProperty",
    "Property {{parameter}} should be declared as a class property.",
);
const PREFER_PARAMETER_PROPERTY: Message = Message::new(
    "preferParameterProperty",
    "Property {{parameter}} should be declared as a parameter property.",
);

const READONLY: u8 = 1;
const PRIVATE: u8 = 2;
const PROTECTED: u8 = 4;
const PUBLIC: u8 = 6;

/// Upstream's `getModifiers`, as a number below 8.
fn modifiers_of(flags: Flags) -> u8 {
    let accessibility = if flags.contains(Flags::PRIVATE) {
        PRIVATE
    } else if flags.contains(Flags::PROTECTED) {
        PROTECTED
    } else if flags.contains(Flags::PUBLIC) {
        PUBLIC
    } else {
        0
    };
    accessibility | if flags.contains(Flags::READONLY) { READONLY } else { 0 }
}

/// Where typescript-estree has a `TSParameterProperty`: a keyword is before the parameter.
fn has_keyword(param: Param) -> bool {
    param.modifiers().iter().any(|modifier| modifier.decorator().is_none())
}

/// The name of a parameter that is an `Identifier` for typescript-estree.
fn plain_name<'a>(param: Param<'a>) -> Option<Name<'a>> {
    let name = param.pat().as_ident()?;
    (!param.is_rest() && param.default().is_none() && !has_keyword(param)).then_some(name)
}

/// The name of a key that is an `Identifier`, in brackets or not.
pub(crate) fn identifier_key<'a>(member: Member<'a>) -> Option<Name<'a>> {
    match member.key()?.kind() {
        KeyKind::Ident(name) => Some(name),
        KeyKind::Computed(e) => e.as_ident(),
        _ => None,
    }
}

/// The `name` of the statement `this.property = name`.
fn assigned_name<'a>(statement: Stmt<'a>) -> Option<Name<'a>> {
    let StmtKind::Expr(e) = statement.kind() else {
        return None;
    };
    let ExprKind::Assign { target, value, .. } = e.kind() else {
        return None;
    };
    let is_property_of_this = match target.kind() {
        ExprKind::Dot { obj, name, .. } => obj.tag() == ExprTag::This && !name.bytes().starts_with(b"#"),
        ExprKind::Index { obj, index, .. } => obj.tag() == ExprTag::This && index.tag() == ExprTag::Ident,
        _ => false,
    };
    value.as_ident().filter(|_| is_property_of_this)
}

fn type_annotations_match<'a>(class_property: Member<'a>, constructor_parameter: Param<'a>) -> bool {
    match (class_property.ty(), constructor_parameter.ty()) {
        (Some(a), Some(b)) => {
            let file = a.file();
            file.slice(a.annotation_span()) == file.slice(b.annotation_span())
        }
        (None, None) => true,
        _ => false,
    }
}

impl ParameterProperties {
    fn is_allowed(&self, flags: Flags) -> bool {
        self.allow & (1 << modifiers_of(flags)) != 0
    }

    fn check_parameter<'a>(&self, param: Param<'a>, cx: &mut Cx<'a, Self>) {
        if has_keyword(param)
            && !self.is_allowed(param.flags())
            && let Some(name) = param.pat().as_ident()
        {
            cx.report(param, PREFER_CLASS_PROPERTY).data("parameter", name);
        }
    }

    fn check_class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let constructors = || {
            let members = class.members().iter();
            members.filter(|it| it.kind() == MemberKind::Constructor).filter_map(Member::func)
        };
        let mut assigned: FxHashSet<Name<'a>> = FxHashSet::default();
        for constructor in constructors() {
            let statements = constructor.body_statements().into_iter().flatten();
            assigned.extend(statements.map_while(assigned_name));
        }
        if assigned.is_empty() {
            return;
        }
        // Of several with the same name, the last counts.
        let parameters: FxHashMap<Name<'a>, Param<'a>> =
            constructors().flat_map(Func::params).filter_map(|it| Some((plain_name(it)?, it))).collect();
        let mut properties: FxHashMap<Name<'a>, Member<'a>> = FxHashMap::default();
        for member in class.members() {
            if member.kind() == MemberKind::Property
                && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
                && member.init().is_none()
                && !self.is_allowed(member.flags())
                && let Some(name) = identifier_key(member)
            {
                properties.insert(name, member);
            }
        }
        for name in assigned {
            if let (Some(parameter), Some(property)) = (parameters.get(&name), properties.get(&name))
                && type_annotations_match(*property, *parameter)
            {
                cx.report(*property, PREFER_PARAMETER_PROPERTY).data("parameter", name);
            }
        }
    }
}

impl Rule for ParameterProperties {
    const META: Meta = Meta::typescript("parameter-properties", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let mut allow = 0;
        for modifiers in object.strings("allow") {
            allow |= 1u8
                << match modifiers {
                    "readonly" => READONLY,
                    "private" => PRIVATE,
                    "protected" => PROTECTED,
                    "public" => PUBLIC,
                    "private readonly" => PRIVATE | READONLY,
                    "protected readonly" => PROTECTED | READONLY,
                    "public readonly" => PUBLIC | READONLY,
                    _ => continue,
                };
        }
        ParameterProperties {
            allow,
            prefers_parameter_property: object.str("prefer") == Some("parameter-property"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.prefers_parameter_property {
            on.classes(Self::check_class);
        } else {
            on.params(Self::check_parameter);
        }
    }
}
