use bun_lint::prelude::*;

/// Disallow empty functions.
pub struct NoEmptyFunction {
    allow: Allow,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected empty {{name}}.");
const SUGGEST_COMMENT: Message =
    Message::new("suggestComment", "Add comment inside empty {{name}}.");

const FUNCTIONS: u16 = 1 << 0;
const ARROW_FUNCTIONS: u16 = 1 << 1;
const GENERATOR_FUNCTIONS: u16 = 1 << 2;
const METHODS: u16 = 1 << 3;
const GENERATOR_METHODS: u16 = 1 << 4;
const GETTERS: u16 = 1 << 5;
const SETTERS: u16 = 1 << 6;
const CONSTRUCTORS: u16 = 1 << 7;
const ASYNC_FUNCTIONS: u16 = 1 << 8;
const ASYNC_METHODS: u16 = 1 << 9;
const PRIVATE_CONSTRUCTORS: u16 = 1 << 10;
const PROTECTED_CONSTRUCTORS: u16 = 1 << 11;
const DECORATED_FUNCTIONS: u16 = 1 << 12;
const OVERRIDE_METHODS: u16 = 1 << 13;
/// Not an option: typescript-eslint also looks at the decorators and the `override` of a constructor.
const CONSTRUCTORS_AS_METHODS: u16 = 1 << 14;

/// The option `allow`: the kinds of functions that may be empty.
#[derive(Copy, Clone)]
pub struct Allow(u16);

impl Allow {
    /// typescript-eslint spells two of them with a hyphen.
    pub fn new(options: &Options) -> Allow {
        let allowed = options.object(0).strings("allow").into_iter();
        Allow(allowed.fold(0, |all, kind| {
            all | match kind {
                "functions" => FUNCTIONS,
                "arrowFunctions" => ARROW_FUNCTIONS,
                "generatorFunctions" => GENERATOR_FUNCTIONS,
                "methods" => METHODS,
                "generatorMethods" => GENERATOR_METHODS,
                "getters" => GETTERS,
                "setters" => SETTERS,
                "constructors" => CONSTRUCTORS,
                "asyncFunctions" => ASYNC_FUNCTIONS,
                "asyncMethods" => ASYNC_METHODS,
                "privateConstructors" | "private-constructors" => PRIVATE_CONSTRUCTORS,
                "protectedConstructors" | "protected-constructors" => PROTECTED_CONSTRUCTORS,
                "decoratedFunctions" => DECORATED_FUNCTIONS,
                "overrideMethods" => OVERRIDE_METHODS,
                _ => 0,
            }
        }))
    }

    pub fn of_typescript_eslint(options: &Options) -> Allow {
        Allow(Allow::new(options).0 | CONSTRUCTORS_AS_METHODS)
    }

    #[inline]
    fn includes(self, kind: u16) -> bool {
        self.0 & kind != 0
    }
}

/// ESLint's `parent` of `func`, if that is a `MethodDefinition`: `func` is its function or its
/// computed key.
fn method_definition_of(func: Func<'_>) -> Option<Member<'_>> {
    let member = match func.owner() {
        Node::Member(member) => member,
        Node::Expr(e) => match e.parent() {
            Node::Member(member)
                if matches!(member.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == e) =>
            {
                member
            }
            _ => return None,
        },
        _ => return None,
    };
    let is_method_definition =
        member.func().is_some() && !member.is_signature() && !member.flags().contains(Flags::ABSTRACT);
    is_method_definition.then_some(member)
}

/// The same for a `Property`, whose value `func` can be as well.
fn property_of(func: Func<'_>) -> Option<Prop<'_>> {
    match func.owner().parent() {
        Node::Prop(prop) => Some(prop),
        _ => None,
    }
}

/// `None` for what ESLint does not have as a function.
fn get_kind(func: Func) -> Option<u16> {
    let is_method = match func.kind() {
        FnKind::Arrow => return Some(ARROW_FUNCTIONS),
        FnKind::Decl => false,
        FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
            match (method_definition_of(func), property_of(func).map(Prop::kind)) {
                (Some(member), _) if member.is_constructor() => return Some(CONSTRUCTORS),
                (Some(member), _) => match member.kind() {
                    MemberKind::Getter => return Some(GETTERS),
                    MemberKind::Setter => return Some(SETTERS),
                    _ => true,
                },
                (None, Some(PropKind::Getter)) => return Some(GETTERS),
                (None, Some(PropKind::Setter)) => return Some(SETTERS),
                (None, kind) => kind == Some(PropKind::Method),
            }
        }
        _ => return None,
    };
    Some(match (is_method, func.is_generator(), func.is_async()) {
        (true, true, _) => GENERATOR_METHODS,
        (true, false, true) => ASYNC_METHODS,
        (true, false, false) => METHODS,
        (false, true, _) => GENERATOR_FUNCTIONS,
        (false, false, true) => ASYNC_FUNCTIONS,
        (false, false, false) => FUNCTIONS,
    })
}

fn is_allowed_empty_function(func: Func, kind: u16, allow: Allow) -> bool {
    if allow.includes(kind) {
        return true;
    }
    let Some(member) = method_definition_of(func).filter(|_| kind != ARROW_FUNCTIONS) else {
        return false;
    };
    let flags = member.flags();
    if kind == CONSTRUCTORS {
        if flags.contains(Flags::PRIVATE) && allow.includes(PRIVATE_CONSTRUCTORS)
            || flags.contains(Flags::PROTECTED) && allow.includes(PROTECTED_CONSTRUCTORS)
            || func.params().iter().any(Param::is_parameter_property)
        {
            return true;
        }
        if !allow.includes(CONSTRUCTORS_AS_METHODS) {
            return false;
        }
    }
    allow.includes(DECORATED_FUNCTIONS) && member.decorators().next().is_some()
        || allow.includes(OVERRIDE_METHODS) && flags.contains(Flags::OVERRIDE)
}

/// The whole rule, for a function, and typescript-eslint's rule of the same name.
pub fn check<'a, R: Rule>(func: Func<'a>, allow: Allow, cx: &Cx<'a, R>) {
    if !func.body_statements().is_some_and(|body| body.is_empty()) {
        return;
    }
    let (Some(kind), Some(body)) = (get_kind(func), func.body_span()) else {
        return;
    };
    let inside = body.shrink(1, 1);
    // There are no statements, so there is only whitespace, of which TypeScript knows more kinds,
    // and comments.
    if cx.slice(inside).iter().any(u8::is_ascii_graphic) || is_allowed_empty_function(func, kind, allow) {
        return;
    }
    let name = ast_utils::get_function_name_with_kind(func);
    cx.report(body, UNEXPECTED)
        .data("name", name.clone())
        .suggest_with(SUGGEST_COMMENT, &[("name", &name[..])], |fixer| {
            fixer.replace(inside, " /* empty */ ")
        });
}

impl Rule for NoEmptyFunction {
    const META: Meta = Meta::eslint("no-empty-function", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoEmptyFunction {
            allow: Allow::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|rule, func, cx| check(func, rule.allow, cx));
    }
}
