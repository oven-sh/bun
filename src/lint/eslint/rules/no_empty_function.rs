use bun_lint::prelude::*;
use bun_lint::utils::oxlint::{FunctionParent, member_key_name};

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
    /// typescript-eslint spells two of them with a hyphen. The other second names are oxlint's: no schema allows them.
    pub fn new(options: &Options) -> Allow {
        let allowed = options.object(0).strings("allow").into_iter();
        Allow(allowed.fold(0, |all, kind| {
            all | match kind {
                "functions" | "function" => FUNCTIONS,
                "arrowFunctions" | "arrow-functions" => ARROW_FUNCTIONS,
                "generatorFunctions" | "generator-functions" => GENERATOR_FUNCTIONS,
                "methods" | "method" => METHODS,
                "generatorMethods" | "generator-methods" => GENERATOR_METHODS,
                "getters" | "getter" => GETTERS,
                "setters" | "setter" => SETTERS,
                "constructors" | "constructor" => CONSTRUCTORS,
                "asyncFunctions" | "async-functions" => ASYNC_FUNCTIONS,
                "asyncMethods" | "async-methods" => ASYNC_METHODS,
                "privateConstructors" | "private-constructors" => PRIVATE_CONSTRUCTORS,
                "protectedConstructors" | "protected-constructors" => PROTECTED_CONSTRUCTORS,
                "decoratedFunctions" | "decorated-functions" => DECORATED_FUNCTIONS,
                "overrideMethods" | "override-methods" => OVERRIDE_METHODS,
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
        // An accessor of an interface that has a body, which is an error.
        _ if matches!(func.owner(), Node::Member(member) if member.is_signature()) => return None,
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

/// oxlint's `get_function_name_and_kind`, as far as it says that the function may be empty. There `methods` is for all
/// methods, `asyncFunctions` also for arrow functions, `overrideMethods` not for accessors, and nothing for
/// `export default function () {}`.
fn is_allowed_by_oxlint(func: Func, allow: Allow) -> bool {
    let (is_async, is_generator) = (func.is_async(), func.is_generator());
    let is_allowed_function = is_async && allow.includes(ASYNC_FUNCTIONS)
        || is_generator && allow.includes(GENERATOR_FUNCTIONS)
        || !is_async && !is_generator && allow.includes(FUNCTIONS);
    let is_allowed_method = is_async && allow.includes(ASYNC_METHODS)
        || is_generator && allow.includes(GENERATOR_METHODS)
        || allow.includes(METHODS);
    let is_decorated = |member: Member| allow.includes(DECORATED_FUNCTIONS) && member.decorators().next().is_some();
    if func.is_arrow() {
        return allow.includes(ARROW_FUNCTIONS)
            || is_async && allow.includes(ASYNC_FUNCTIONS)
            || matches!(FunctionParent::of(func), FunctionParent::PropertyDefinition(member) if is_decorated(member));
    }
    if func.name().is_some() {
        return is_allowed_function;
    }
    match FunctionParent::of(func) {
        FunctionParent::MethodDefinition(member) => {
            let flags = member.flags();
            is_decorated(member)
                || match member.kind() {
                    _ if member.is_constructor() => {
                        allow.includes(CONSTRUCTORS)
                            || func.params().iter().any(Param::is_parameter_property)
                            || flags.contains(Flags::PRIVATE) && allow.includes(PRIVATE_CONSTRUCTORS)
                            || flags.contains(Flags::PROTECTED) && allow.includes(PROTECTED_CONSTRUCTORS)
                    }
                    MemberKind::Getter => allow.includes(GETTERS),
                    MemberKind::Setter => allow.includes(SETTERS),
                    _ => is_allowed_method || flags.contains(Flags::OVERRIDE) && allow.includes(OVERRIDE_METHODS),
                }
        }
        FunctionParent::ObjectProperty(prop) => match prop.kind() {
            PropKind::Getter => allow.includes(GETTERS),
            PropKind::Setter => allow.includes(SETTERS),
            PropKind::Method => is_allowed_method,
            _ => is_allowed_function,
        },
        FunctionParent::PropertyDefinition(member) => is_allowed_function || is_decorated(member),
        FunctionParent::VariableDeclarator(_) | FunctionParent::Other => {
            is_allowed_function && func.kind() != FnKind::Decl
        }
    }
}

/// How oxlint calls the function.
/// With what oxlint calls the function in its `help`.
fn name_for_oxlint(func: Func) -> (Vec<u8>, &'static [u8]) {
    const FUNCTION: &[u8] = b"function";
    let (kind, name) = match (func.name(), FunctionParent::of(func)) {
        (Some(name), _) if func.is_async() => (&b"async function"[..], Some(name.bytes())),
        (Some(name), _) if func.is_generator() => (&b"generator function"[..], Some(name.bytes())),
        (Some(name), _) => (FUNCTION, Some(name.bytes())),
        (None, FunctionParent::MethodDefinition(member)) => {
            let kind: &[u8] = match member.kind() {
                _ if member.is_constructor() => b"constructor",
                MemberKind::Getter => b"getter",
                MemberKind::Setter => b"setter",
                _ if member.is_static() => b"static method",
                _ => b"method",
            };
            (kind, member_key_name(member))
        }
        (None, FunctionParent::PropertyDefinition(member)) => (FUNCTION, member_key_name(member)),
        (None, FunctionParent::VariableDeclarator(declarator)) => {
            (FUNCTION, declarator.pat().as_ident().map(Name::bytes))
        }
        (None, FunctionParent::ObjectProperty(_) | FunctionParent::Other) => (FUNCTION, None),
    };
    match name {
        Some(name) => ([kind, b" `", name, b"`"].concat(), kind),
        None => (FUNCTION.to_vec(), kind),
    }
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
    let is_allowed = || match cx.language().is_oxlint {
        true => is_allowed_by_oxlint(func, allow),
        false => is_allowed_empty_function(func, kind, allow),
    };
    if cx.slice(inside).iter().any(u8::is_ascii_graphic) || is_allowed() {
        return;
    }
    let name = ast_utils::get_function_name_with_kind(func);
    let report = match cx.language().is_oxlint {
        true => {
            let (name, fn_kind) = name_for_oxlint(func);
            cx.report(body, UNEXPECTED).data("name", name).data("fn_kind", fn_kind)
        }
        false => cx.report(body, UNEXPECTED).data("name", name.clone()),
    };
    report
        .suggest_with(SUGGEST_COMMENT, &[("name", &name[..])], |fixer| {
            fixer.replace(inside, " /* empty */ ")
        });
}

impl Rule for NoEmptyFunction {
    const META: Meta = Meta::eslint("no-empty-function", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(options: &Options) -> Self {
        NoEmptyFunction {
            allow: Allow::new(options),
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check(func, self.allow, cx);
    }
}
