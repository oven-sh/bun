use bun_lint::prelude::*;

/// Disallow classes used as namespaces.
pub struct NoExtraneousClass {
    allow_constructor_only: bool,
    allow_empty: bool,
    allow_static_only: bool,
    allow_with_decorator: bool,
}

const EMPTY: Message = Message::new("empty", "Unexpected empty class.");
const ONLY_CONSTRUCTOR: Message = Message::new("onlyConstructor", "Unexpected class with only a constructor.");
const ONLY_STATIC: Message = Message::new("onlyStatic", "Unexpected class with only static properties.");

impl NoExtraneousClass {
    fn check<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if class.extends().is_some() || self.allow_with_decorator && class.decorators().next().is_some() {
            return;
        }

        let members = class.members();
        let (mut only_static, mut only_constructor) = (true, true);
        for member in members {
            if member.is_constructor() {
                if member.func().is_some_and(|it| it.params().iter().any(Param::is_parameter_property)) {
                    (only_static, only_constructor) = (false, false);
                }
            } else {
                only_constructor = false;
                only_static &= match member.kind() {
                    MemberKind::StaticBlock => true,
                    MemberKind::IndexSignature => false,
                    _ => member.is_static() && !member.flags().contains(Flags::ABSTRACT),
                };
            }
            if !only_static && !only_constructor {
                return;
            }
        }

        let message = if members.is_empty() {
            (!self.allow_empty).then_some(EMPTY)
        } else if only_constructor {
            (!self.allow_constructor_only).then_some(ONLY_CONSTRUCTOR)
        } else {
            (!self.allow_static_only).then_some(ONLY_STATIC)
        };
        let Some(message) = message else {
            return;
        };
        match (class.owner(), class.name()) {
            (Node::Stmt(_), Some(name)) => cx.report(name, message),
            _ => cx.report(class.estree_span(), message),
        };
    }
}

impl Rule for NoExtraneousClass {
    const META: Meta = Meta::typescript("no-extraneous-class", Kind::Suggestion).presets(Presets::STRICT);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoExtraneousClass {
            allow_constructor_only: options.bool_or("allowConstructorOnly", false),
            allow_empty: options.bool_or("allowEmpty", false),
            allow_static_only: options.bool_or("allowStaticOnly", false),
            allow_with_decorator: options.bool_or("allowWithDecorator", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(Self::check);
    }
}
