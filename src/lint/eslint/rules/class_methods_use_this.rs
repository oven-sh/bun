use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::types::IdSet;

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
    /// Whether each of them has a `this` or a `super` of its own.
    is_using_this: Vec<bool>,
    /// The other methods, accessors and constructors.
    others: Vec<Func<'a>>,
    /// The functions of class members with a `this` or a `super` of their own that is written elsewhere.
    uses_this: IdSet<Func<'a>>,
    /// The function of a class member that a `this` in a node belongs to. `None`: it belongs to
    /// something else.
    owners_of_this: AncestorMemo<'a, Option<Func<'a>>>,
}

impl<'a> State<'a> {
    pub fn methods_without_this(&self) -> impl Iterator<Item = Func<'a>> {
        let unused = self
            .methods
            .iter()
            .zip(&self.is_using_this)
            .filter(|it| !it.1);
        unused
            .map(|it| *it.0)
            .filter(|func| !self.uses_this.contains(*func))
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
            except_methods: except_methods
                .iter()
                .map(|name| name.as_bytes().to_vec())
                .collect(),
            ignore_override_methods: options.bool_or("ignoreOverrideMethods", false),
            ignore_classes_with_implements,
            are_private_names_public,
        }
    }

    /// Notes which functions of class members the `this` and the `super` of `file` belong to, once the functions that have to use
    /// `this` are known.
    pub fn mark_this_used<'a>(&self, file: &'a File<'a>, state: &mut State<'a>) {
        if state.methods.is_empty() {
            return;
        }
        state.is_using_this = vec![false; state.methods.len()];
        // For each: where a `this` belongs to it or to what is in it, its index, and whether no more is to be found out.
        let inside = |func: Func<'a>| {
            let whole = func.span();
            let start = match func.open_paren() {
                Some(open) => func
                    .type_params()
                    .first()
                    .map_or(open, |it| it.span().start),
                None => whole.start,
            };
            Span::new(start, whole.end)
        };
        let methods = state
            .methods
            .iter()
            .enumerate()
            .map(|(index, &func)| (inside(func), func, index, false));
        let others = state
            .others
            .iter()
            .map(|&func| (inside(func), func, usize::MAX, true));
        let mut methods: Vec<_> = methods.chain(others).collect();
        bun_lint::utils::sort::sort_by_key(&mut methods, |it| it.0.start);
        // The last that starts before the `this`.
        let mut at = 0;
        for e in file
            .exprs_of_kind(ExprTag::This)
            .chain(file.exprs_of_kind(ExprTag::Super))
        {
            let start = e.span().start;
            let is_at = methods.get(at).is_some_and(|it| it.0.start <= start)
                && methods.get(at + 1).is_none_or(|it| start < it.0.start);
            if !is_at {
                at = methods
                    .partition_point(|it| it.0.start <= start)
                    .wrapping_sub(1);
            }
            let around = methods.get_mut(at).filter(|it| start < it.0.end);
            if around.as_ref().is_some_and(|it| it.3) {
                continue;
            }
            match (self.owner_of_this(e, state), around) {
                (Some(owner), Some(around)) if around.1 == owner => {
                    around.3 = true;
                    if let Some(is_using_this) = state.is_using_this.get_mut(around.2) {
                        *is_using_this = true;
                    }
                }
                (Some(owner), _) => {
                    state.uses_this.insert(owner);
                }
                _ => {}
            }
        }
    }

    /// The function of a class member that `e`, a `this` or a `super`, counts for.
    fn owner_of_this<'a>(&self, e: Expr<'a>, state: &mut State<'a>) -> Option<Func<'a>> {
        let is_oxlint = e.file().language().is_oxlint;
        if e.is_jsx_tag_name() && !is_oxlint {
            return None;
        }
        // For oxlint a declaration without a body is a function as well.
        let is_function = |func: Func<'a>| {
            func.has_body()
                || is_oxlint && !matches!(func.owner(), Node::Member(it) if it.is_signature())
        };
        let owner = state.owners_of_this.find(Node::Expr(e), |child, ancestor| match ancestor {
            Node::Func(func) => match func.kind() {
                FnKind::StaticBlock => Some(None),
                FnKind::Arrow if self.enforce_for_class_fields && is_value_of_field(func) => Some(Some(func)),
                FnKind::Decl
                | FnKind::Expr
                | FnKind::Method
                | FnKind::Getter
                | FnKind::Setter
                | FnKind::Constructor
                    if is_function(func) =>
                {
                    Some(is_child_of_member(func).then_some(func))
                }
                _ => None,
            },
            // Of a field oxlint looks at the key alone, and not at that of one with `accessor`.
            Node::Member(member) if is_oxlint && member.kind() == MemberKind::Property && !member.is_signature() => {
                let is_key = !member.flags().contains(Flags::ACCESSOR)
                    && matches!((member.key().map(Key::kind), child), (Some(KeyKind::Computed(key)), Node::Expr(e)) if key == e);
                (!is_key).then_some(None)
            }
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
                is_after_key.then_some(None)
            }
            _ => None,
        });
        // oxlint looks at the body alone.
        let body_start = |func: Func<'a>| match func.arrow_span() {
            Some(arrow) => Some(arrow.end),
            None => func.body_span().map(|it| it.start),
        };
        owner.flatten().filter(|&func| {
            !is_oxlint || body_start(func).is_some_and(|start| start <= e.span().start)
        })
    }

    /// Notes the functions of the members of `class` that have to use `this`, and the others.
    pub fn check_class<'a>(&self, class: Class<'a>, state: &mut State<'a>) {
        for member in class.members() {
            let before = state.methods.len();
            self.check_member(member, class, state);
            if state.methods.len() == before {
                state
                    .others
                    .extend(member.func().filter(|it| it.has_body()));
            }
        }
    }

    fn check_member<'a>(&self, member: Member<'a>, class: Class<'a>, state: &mut State<'a>) {
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
        // oxlint sees no function in parentheses, and none in a key.
        let is_oxlint = member.file().language().is_oxlint;
        let value = match is_field {
            true => member
                .init()
                .filter(|it| !(is_oxlint && it.is_parenthesized()))
                .and_then(Expr::as_fn),
            false => member.func(),
        };
        let value = value.filter(|func| func.has_body());
        let key = member.key();
        // ESLint only looks at the parent of a function expression.
        let function_in_key = match key.map(Key::kind) {
            Some(KeyKind::Computed(e)) => e.as_fn().filter(|func| !func.is_arrow() && !is_oxlint),
            _ => None,
        };
        if value.is_none() && function_in_key.is_none() {
            return;
        }
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
        state
            .methods
            .extend(value.into_iter().chain(function_in_key));
    }
}

impl Rule for ClassMethodsUseThis {
    const META: Meta = Meta::eslint("class-methods-use-this", Kind::Suggestion).reports_on_exit();
    const ON: On = On::new().classes().finish();
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

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.has_classes().then(State::default)
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        self.checker.check_class(class, &mut cx.state);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.checker.mark_this_used(cx.file(), &mut cx.state);
        for func in cx.state.methods_without_this() {
            cx.report(ast_utils::get_function_head_loc(func), MISSING_THIS)
                .called_with(func.owner())
                .data("name", ast_utils::get_function_name_with_kind(func));
        }
    }
}
