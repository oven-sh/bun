use bun_lint::prelude::*;
use std::borrow::Cow;

/// Require constructor names to begin with a capital letter.
pub struct NewCap {
    new_is_cap: bool,
    cap_is_new: bool,
    new_is_cap_exceptions: Exceptions,
    cap_is_new_exceptions: Exceptions,
    skips_properties: bool,
}

struct Exceptions {
    names: Vec<Vec<u8>>,
    pattern: Option<Regex>,
}

const UPPER: Message = Message::new(
    "upper",
    "A function with a name starting with an uppercase letter should only be used as a constructor.",
);
const LOWER: Message = Message::new("lower", "A constructor name should not start with a lowercase letter.");

const CAPS_ALLOWED: [&str; 11] = [
    "Array", "Boolean", "Date", "Error", "Function", "Number", "Object", "RegExp", "String", "Symbol", "BigInt",
];
const GLOBAL_OBJECT_NAMES: [&str; 4] = ["global", "globalThis", "self", "window"];

#[derive(Copy, Clone, PartialEq, Eq)]
enum Cap {
    NonAlpha,
    Lower,
    Upper,
}

/// ESLint's `getCap`, of the first character of `name`.
fn get_cap(name: &[u8]) -> Cap {
    match name.first() {
        Some(b'a'..=b'z') => return Cap::Lower,
        Some(b'A'..=b'Z') => return Cap::Upper,
        Some(0x80..) => {}
        _ => return Cap::NonAlpha,
    }
    let end = text::code_points(name).nth(1).map_or(name.len(), |next| next.0);
    let first = name.get(..end).unwrap_or_default();
    let lower = text::to_lower_case(first);
    if lower == text::to_upper_case(first) {
        Cap::NonAlpha
    } else if *lower == *first {
        Cap::Lower
    } else {
        Cap::Upper
    }
}

/// ESLint's `extractNameFromExpression`. `None` where that is empty.
fn extract_name(callee: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    let name = match callee.kind() {
        ExprKind::Ident(name) => Cow::Borrowed(name.bytes()),
        _ => ast_utils::get_static_property_name(callee)?,
    };
    (!name.is_empty()).then_some(name)
}

/// ESLint's `isGlobalBuiltIn`: `name`, `globalThis.name`
fn is_global_built_in(e: Expr, name: &[u8]) -> bool {
    match e.kind() {
        ExprKind::Ident(it) => it.bytes() == name && ast_utils::is_global_reference(e),
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
            ast_utils::get_static_property_name(e).is_some_and(|it| *it == *name)
                && obj.as_ident().is_some_and(|it| it.is_any(&GLOBAL_OBJECT_NAMES))
                && ast_utils::is_global_reference(obj)
        }
        _ => false,
    }
}

impl Exceptions {
    fn new(options: Object, names: &str, pattern: &str) -> Exceptions {
        Exceptions {
            names: options.strings(names).into_iter().map(|it| it.as_bytes().to_vec()).collect(),
            pattern: options.str(pattern).filter(|it| !it.is_empty()).and_then(|it| Regex::new(it, "u").ok()),
        }
    }

    fn has(&self, name: &[u8]) -> bool {
        self.names.iter().any(|it| it == name)
    }
}

impl NewCap {
    /// ESLint's `isCapAllowed`
    fn is_cap_allowed(&self, exceptions: &Exceptions, callee: Expr, name: &[u8]) -> bool {
        let source = callee.text();
        if exceptions.has(name)
            || exceptions.has(source)
            || exceptions.pattern.as_ref().is_some_and(|it| it.test(source))
        {
            return true;
        }
        match callee.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                // oxlint goes by the names.
                let is_date = || match callee.file().language().is_oxlint {
                    true => obj.is_ident("Date"),
                    false => is_global_built_in(obj, b"Date"),
                };
                self.skips_properties || name == b"UTC" && is_date()
            }
            _ => false,
        }
    }

    fn check_new<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::New(call) = e.kind()
            && let Some(name) = extract_name(call.callee())
            && get_cap(&name) == Cap::Lower
            && !self.is_cap_allowed(&self.new_is_cap_exceptions, call.callee(), &name)
        {
            report(call.callee(), LOWER, cx);
        }
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Call(call) = e.kind()
            && let Some(name) = extract_name(call.callee())
            && get_cap(&name) == Cap::Upper
            && !self.is_cap_allowed(&self.cap_is_new_exceptions, call.callee(), &name)
            // oxlint goes by the name, whatever it refers to.
            && !(CAPS_ALLOWED.iter().any(|it| it.as_bytes() == &*name)
                && (cx.language().is_oxlint || is_global_built_in(call.callee(), &name)))
        {
            report(call.callee(), UPPER, cx);
        }
    }
}

/// At the property, or at the callee.
fn report<'a>(callee: Expr<'a>, message: Message, cx: &Cx<'a, NewCap>) {
    let at = match callee.kind() {
        ExprKind::Dot { name, .. } => name.span(),
        ExprKind::Index { index, .. } => index.span(),
        _ => callee.span(),
    };
    cx.report(at, message);
}

impl Rule for NewCap {
    const META: Meta = Meta::eslint("new-cap", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NewCap {
            new_is_cap: options.bool_or("newIsCap", true),
            cap_is_new: options.bool_or("capIsNew", true),
            new_is_cap_exceptions: Exceptions::new(options, "newIsCapExceptions", "newIsCapExceptionPattern"),
            cap_is_new_exceptions: Exceptions::new(options, "capIsNewExceptions", "capIsNewExceptionPattern"),
            skips_properties: !options.bool_or("properties", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.new_is_cap {
            on.exprs([ExprTag::New], Self::check_new);
        }
        if self.cap_is_new {
            on.exprs([ExprTag::Call], Self::check_call);
        }
    }
}
