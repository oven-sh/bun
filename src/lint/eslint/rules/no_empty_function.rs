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

    #[inline]
    fn includes(self, kind: u16) -> bool {
        self.0 & kind != 0
    }
}

/// The member of a class that `func` is the function of.
fn member_of(func: Func<'_>) -> Option<Member<'_>> {
    match func.owner() {
        Node::Member(member) => Some(member),
        _ => None,
    }
}

/// `None` for what ESLint does not have as a function.
fn get_kind(func: Func) -> Option<u16> {
    let (plain, generator, asynchronous) = match func.kind() {
        FnKind::Arrow => return Some(ARROW_FUNCTIONS),
        FnKind::Getter => return Some(GETTERS),
        FnKind::Setter => return Some(SETTERS),
        FnKind::Constructor if member_of(func).is_some_and(Member::is_constructor) => {
            return Some(CONSTRUCTORS);
        }
        FnKind::Decl | FnKind::Expr => (FUNCTIONS, GENERATOR_FUNCTIONS, ASYNC_FUNCTIONS),
        FnKind::Method | FnKind::Constructor => (METHODS, GENERATOR_METHODS, ASYNC_METHODS),
        _ => return None,
    };
    Some(if func.is_generator() {
        generator
    } else if func.is_async() {
        asynchronous
    } else {
        plain
    })
}

fn is_allowed_empty_function(func: Func, kind: u16, allow: Allow) -> bool {
    if allow.includes(kind) {
        return true;
    }
    let Some(member) = member_of(func) else {
        return false;
    };
    let flags = member.flags();
    if kind == CONSTRUCTORS {
        return flags.contains(Flags::PRIVATE) && allow.includes(PRIVATE_CONSTRUCTORS)
            || flags.contains(Flags::PROTECTED) && allow.includes(PROTECTED_CONSTRUCTORS)
            || func.params().iter().any(Param::is_parameter_property);
    }
    allow.includes(DECORATED_FUNCTIONS) && member.decorators().next().is_some()
        || allow.includes(OVERRIDE_METHODS) && flags.contains(Flags::OVERRIDE)
}

/// The whole rule, for a function. typescript-eslint's rule of the same name is no different.
pub fn check<'a, R: Rule>(func: Func<'a>, allow: Allow, cx: &Cx<'a, R>) {
    if !func.body_statements().is_some_and(|body| body.is_empty()) {
        return;
    }
    let (Some(kind), Some(body)) = (get_kind(func), func.body_span()) else {
        return;
    };
    let inside = body.shrink(1, 1);
    // There are no statements, so anything but whitespace is a comment.
    if is_allowed_empty_function(func, kind, allow) || !text::is_blank(cx.slice(inside)) {
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
