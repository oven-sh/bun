use bun_lint::prelude::*;

/// Disallow accidentally using the "empty object" type.
pub struct NoEmptyObjectType {
    allow_interfaces: AllowInterfaces,
    allow_object_types: bool,
    allow_with_name: Option<Regex>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum AllowInterfaces {
    Always,
    Never,
    WithSingleExtends,
}

const NO_EMPTY_INTERFACE: Message = Message::new(
    "noEmptyInterface",
    "An empty interface declaration allows any non-nullish value, including literals like `0` and `\"\"`.\n- If that's what you want, disable this lint rule with an inline comment or configure the '{{ option }}' rule option.\n- If you want a type meaning \"any object\", you probably want `object` instead.\n- If you want a type meaning \"any value\", you probably want `unknown` instead.",
);
const NO_EMPTY_INTERFACE_WITH_SUPER: Message = Message::new(
    "noEmptyInterfaceWithSuper",
    "An interface declaring no members is equivalent to its supertype.",
);
const NO_EMPTY_OBJECT: Message = Message::new(
    "noEmptyObject",
    "The `{}` (\"empty object\") type allows any non-nullish value, including literals like `0` and `\"\"`.\n- If that's what you want, disable this lint rule with an inline comment or configure the '{{ option }}' rule option.\n- If you want a type meaning \"any object\", you probably want `object` instead.\n- If you want a type meaning \"any value\", you probably want `unknown` instead.",
);
const REPLACE_EMPTY_INTERFACE: Message =
    Message::new("replaceEmptyInterface", "Replace empty interface with `{{replacement}}`.");
const REPLACE_EMPTY_INTERFACE_WITH_SUPER: Message =
    Message::new("replaceEmptyInterfaceWithSuper", "Replace empty interface with a type alias.");
const REPLACE_EMPTY_OBJECT_TYPE: Message =
    Message::new("replaceEmptyObjectType", "Replace `{}` with `{{replacement}}`.");

const REPLACEMENTS: [&str; 2] = ["object", "unknown"];

/// `type Name<Params> = ty` in place of the interface.
fn replace_interface<'a>(fixer: Fixer<'a>, interface: Interface<'a>, ty: &[u8]) -> Fix {
    let type_params = interface.type_params().angle_brackets_span().unwrap_or_default();
    let text = [
        &b"type "[..],
        fixer.file().slice(interface.name().span()),
        fixer.file().slice(type_params),
        b" = ",
        ty,
    ]
    .concat();
    fixer.replace(interface.stmt().span_without_export(), text)
}

fn is_merged_with_other_declaration<'a>(statement: Stmt<'a>, interface: Interface<'a>) -> bool {
    let Some(symbol) = Node::Stmt(statement).scope().get_name(interface.name().name()) else {
        return false;
    };
    symbol.declarations().any(|declaration| match declaration {
        Declaration::Class(class) => matches!(class.owner(), Node::Stmt(_)),
        Declaration::Interface(other) => other != interface,
        _ => false,
    })
}

impl NoEmptyObjectType {
    fn allows_name(&self, name: Ident) -> bool {
        self.allow_with_name.as_ref().is_some_and(|pattern| pattern.test(name.bytes()))
    }

    fn check_interface<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Interface(interface) = statement.kind() else {
            return;
        };
        let extends = interface.extends();
        if !interface.members().is_empty()
            || extends.len() > 1
            || extends.len() == 1 && self.allow_interfaces == AllowInterfaces::WithSingleExtends
            || self.allows_name(interface.name())
        {
            return;
        }
        let should_suggest =
            !statement.is_default_export() && !is_merged_with_other_declaration(statement, interface);
        let Some(extended) = extends.first() else {
            let report = cx.report(interface.name(), NO_EMPTY_INTERFACE).data("option", "allowInterfaces");
            if should_suggest {
                REPLACEMENTS.into_iter().fold(report, |report, replacement| {
                    report.suggest_with(
                        REPLACE_EMPTY_INTERFACE,
                        &[("replacement", replacement.as_bytes())],
                        |fixer| replace_interface(fixer, interface, replacement.as_bytes()),
                    )
                });
            }
            return;
        };
        let report = cx.report(interface.name(), NO_EMPTY_INTERFACE_WITH_SUPER);
        if should_suggest {
            report.suggest(REPLACE_EMPTY_INTERFACE_WITH_SUPER, |fixer| {
                replace_interface(fixer, interface, extended.text())
            });
        }
    }

    fn check_type_literal<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Object(members) = ty.kind() else {
            return;
        };
        if !members.is_empty() {
            return;
        }
        let is_allowed = match ty.parent() {
            Node::Type(parent) => parent.tag() == TypeTag::Intersection,
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::TypeAlias(alias) => self.allows_name(alias.name()),
                _ => false,
            },
            _ => false,
        };
        if is_allowed {
            return;
        }
        let report = cx.report(ty, NO_EMPTY_OBJECT).data("option", "allowObjectTypes");
        REPLACEMENTS.into_iter().fold(report, |report, replacement| {
            report.suggest_with(
                REPLACE_EMPTY_OBJECT_TYPE,
                &[("replacement", replacement.as_bytes())],
                |fixer| fixer.replace(ty, replacement),
            )
        });
    }
}

impl Rule for NoEmptyObjectType {
    const META: Meta = Meta::typescript("no-empty-object-type", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoEmptyObjectType {
            allow_interfaces: match object.str("allowInterfaces") {
                Some("always") => AllowInterfaces::Always,
                Some("with-single-extends") => AllowInterfaces::WithSingleExtends,
                _ => AllowInterfaces::Never,
            },
            allow_object_types: object.str("allowObjectTypes") == Some("always"),
            allow_with_name: object.str("allowWithName").filter(|it| !it.is_empty()).and_then(|it| Regex::new(it, "u").ok()),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.allow_interfaces != AllowInterfaces::Always {
            on.stmts([StmtTag::Interface], Self::check_interface);
        }
        if !self.allow_object_types {
            on.types([TypeTag::Object], Self::check_type_literal);
        }
    }
}
