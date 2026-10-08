use bun_lint::prelude::*;
use rustc_hash::FxHashSet;

/// Enforce that class methods utilize `this`.
pub struct ClassMethodsUseThis {
    checker: Checker,
}

pub const MISSING_THIS: Message = Message::new(
    "missingThis",
    "Expected 'this' to be used by class {{name}}.",
);

/// Which members of a class that has an `implements` clause are left alone.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum IgnoreClassesWithImplements {
    None,
    All,
    PublicFields,
}

/// What this rule and the one of typescript-eslint have in common.
pub struct Checker {
    enforce_for_class_fields: bool,
    except_methods: Vec<Vec<u8>>,
    ignore_override_methods: bool,
    ignore_classes_with_implements: IgnoreClassesWithImplements,
    /// typescript-eslint goes by `private` and `protected` alone.
    are_private_names_public: bool,
}

#[derive(Default)]
pub struct State<'a> {
    /// The functions that have to use `this`.
    methods: Vec<Func<'a>>,
    /// The functions of class members with a `this` or a `super` of their own.
    uses_this: FxHashSet<Func<'a>>,
}

impl<'a> State<'a> {
    pub fn methods_without_this(&self) -> impl Iterator<Item = Func<'a>> {
        self.methods.iter().copied().filter(|func| !self.uses_this.contains(func))
    }
}

/// Whether `e` is the value or the computed key of `member`, as opposed to a decorator.
fn is_value_or_key<'a>(member: Member<'a>, e: Expr<'a>) -> bool {
    member.init() == Some(e)
        || matches!(member.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == e)
}

/// Whether ESLint's `parent` of `func` is a member of a class.
fn is_child_of_member(func: Func) -> bool {
    match func.owner() {
        Node::Member(_) => true,
        Node::Expr(e) => matches!(e.parent(), Node::Member(member) if is_value_or_key(member, e)),
        _ => false,
    }
}

/// `PropertyDefinition > ArrowFunctionExpression.value`, `AccessorProperty > ArrowFunctionExpression.value`
fn is_value_of_field(arrow: Func) -> bool {
    matches!(arrow.owner(), Node::Expr(e)
        if matches!(e.parent(), Node::Member(member) if member.init() == Some(e)))
}

impl Checker {
    pub fn new(
        options: Object,
        ignore_classes_with_implements: IgnoreClassesWithImplements,
        are_private_names_public: bool,
    ) -> Checker {
        let except_methods = options.strings("exceptMethods");
        Checker {
            enforce_for_class_fields: options.bool_or("enforceForClassFields", true),
            except_methods: except_methods.iter().map(|name| name.as_bytes().to_vec()).collect(),
            ignore_override_methods: options.bool_or("ignoreOverrideMethods", false),
            ignore_classes_with_implements,
            are_private_names_public,
        }
    }

    /// `e` is a `this` or a `super`: notes which function it belongs to.
    pub fn mark_this_used<'a>(&self, e: Expr<'a>, state: &mut State<'a>) {
        if e.is_jsx_tag_name() {
            return;
        }
        let mut child = Node::Expr(e);
        for ancestor in child.ancestors() {
            match ancestor {
                Node::Func(func) => match func.kind() {
                    FnKind::StaticBlock => return,
                    FnKind::Arrow if self.enforce_for_class_fields && is_value_of_field(func) => {
                        state.uses_this.insert(func);
                        return;
                    }
                    FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
                        if func.has_body() =>
                    {
                        if is_child_of_member(func) {
                            state.uses_this.insert(func);
                        }
                        return;
                    }
                    _ => {}
                },
                // What follows the key of a field is an implicit function.
                Node::Member(member)
                    if member.kind() == MemberKind::Property
                        && !member.flags().contains(Flags::ABSTRACT)
                        && !member.is_signature() =>
                {
                    let is_after_key = match child {
                        Node::Expr(e) => member.init() == Some(e),
                        Node::Type(_) => true,
                        _ => false,
                    };
                    if is_after_key {
                        return;
                    }
                }
                _ => {}
            }
            child = ancestor;
        }
    }

    /// Notes the functions of `member` that have to use `this`.
    pub fn check_member<'a>(&self, member: Member<'a>, state: &mut State<'a>) {
        let is_field = match member.kind() {
            MemberKind::Method if member.is_constructor() => return,
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => false,
            MemberKind::Property if self.enforce_for_class_fields => true,
            _ => return,
        };
        let flags = member.flags();
        if flags.intersects(Flags::STATIC | Flags::ABSTRACT) {
            return;
        }
        let value = match is_field {
            true => member.init().and_then(Expr::as_fn),
            false => member.func(),
        };
        let value = value.filter(|func| func.has_body());
        let key = member.key();
        // ESLint only looks at the parent of a function expression.
        let function_in_key = match key.map(Key::kind) {
            Some(KeyKind::Computed(e)) => e.as_fn().filter(|func| !func.is_arrow()),
            _ => None,
        };
        if value.is_none() && function_in_key.is_none() {
            return;
        }
        let Node::Class(class) = member.parent() else {
            return;
        };
        if self.ignore_override_methods && flags.contains(Flags::OVERRIDE) {
            return;
        }
        let is_ignored_with_implements = match self.ignore_classes_with_implements {
            IgnoreClassesWithImplements::None => false,
            IgnoreClassesWithImplements::All => true,
            IgnoreClassesWithImplements::PublicFields => {
                !flags.intersects(Flags::PRIVATE | Flags::PROTECTED)
                    && (self.are_private_names_public || !key.is_some_and(Key::is_private))
            }
        };
        if is_ignored_with_implements && !class.implements().is_empty() {
            return;
        }
        if !self.except_methods.is_empty() && !key.is_some_and(Key::is_computed) {
            let name = key.and_then(Key::name).map_or(&b""[..], Name::bytes);
            if self.except_methods.iter().any(|except| except == name) {
                return;
            }
        }
        state.methods.extend(value.into_iter().chain(function_in_key));
    }
}

impl Rule for ClassMethodsUseThis {
    const META: Meta = Meta::eslint("class-methods-use-this", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let ignore_classes_with_implements = match options.str("ignoreClassesWithImplements") {
            Some("all") => IgnoreClassesWithImplements::All,
            Some("public-fields") => IgnoreClassesWithImplements::PublicFields,
            _ => IgnoreClassesWithImplements::None,
        };
        ClassMethodsUseThis {
            checker: Checker::new(options, ignore_classes_with_implements, false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.has_classes() {
            on.members(|rule, member, cx| rule.checker.check_member(member, &mut cx.state));
            on.exprs([ExprTag::This, ExprTag::Super], |rule, e, cx| {
                rule.checker.mark_this_used(e, &mut cx.state);
            });
            on.finish(|_, cx| {
                for func in cx.state.methods_without_this() {
                    cx.report(ast_utils::get_function_head_loc(func), MISSING_THIS)
                        .data("name", ast_utils::get_function_name_with_kind(func));
                }
            });
        }
        State::default()
    }
}
