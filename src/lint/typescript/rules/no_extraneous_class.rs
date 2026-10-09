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
/// What oxlint suggests.
const REMOVE_CLASS: Message = Message::new("removeClass", "Remove the class.");

impl NoExtraneousClass {
    /// For oxlint a constructor, a static block and an index signature are not static, and a class has only a
    /// constructor if that is its only member. It points at the name, of a class expression too, and at an empty class,
    /// after decorators from `class` on.
    fn check_as_oxlint<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let members = class.members();
        let whole = match class.decorators().next() {
            Some(_) => Span::new(class.keyword_span().start, class.estree_span().end),
            None => class.estree_span(),
        };
        let name = class.name().map_or(whole, |it| it.span());
        let (place, message, is_allowed) = match members.first() {
            None => (whole, EMPTY, self.allow_empty),
            Some(only) if members.len() == 1 && only.is_constructor() => {
                if only.func().is_some_and(|it| it.params().iter().any(Param::is_parameter_property)) {
                    return;
                }
                (name, ONLY_CONSTRUCTOR, self.allow_constructor_only)
            }
            Some(_) => {
                let is_static = |it: Member| {
                    !matches!(it.kind(), MemberKind::StaticBlock | MemberKind::IndexSignature)
                        && !it.is_constructor()
                        && it.is_static()
                        && !it.flags().contains(Flags::ABSTRACT)
                };
                if !members.iter().all(is_static) {
                    return;
                }
                (name, ONLY_STATIC, self.allow_static_only)
            }
        };
        if is_allowed {
            return;
        }
        let report = cx.report(place, message);
        // oxlint suggests to remove an empty class declaration without decorators, with its `export`.
        if let Node::Stmt(statement) = class.owner()
            && members.is_empty()
            && class.decorators().next().is_none()
        {
            let export = statement.export_span().filter(|_| !statement.is_default_export());
            report.suggest(REMOVE_CLASS, |fixer| fixer.remove(export.unwrap_or(whole)));
        }
    }

    fn check<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if class.extends().is_some() || self.allow_with_decorator && class.decorators().next().is_some() {
            return;
        }
        if cx.language().is_oxlint {
            return self.check_as_oxlint(class, cx);
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
