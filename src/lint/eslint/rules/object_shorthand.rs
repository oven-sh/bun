use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::string_utils;

/// Require or disallow method and property shorthand syntax for object literals.
pub struct ObjectShorthand {
    applies_to_methods: bool,
    applies_to_props: bool,
    is_never: bool,
    is_consistent: bool,
    is_consistent_as_needed: bool,
    ignores_constructors: bool,
    methods_ignore_pattern: Option<Regex>,
    avoids_quotes: bool,
    avoids_explicit_return_arrows: bool,
}

const EXPECTED_ALL_PROPERTIES_SHORTHANDED: Message = Message::new(
    "expectedAllPropertiesShorthanded",
    "Expected shorthand for all properties.",
);
const EXPECTED_LITERAL_METHOD_LONGFORM: Message = Message::new(
    "expectedLiteralMethodLongform",
    "Expected longform method syntax for string literal keys.",
);
const EXPECTED_PROPERTY_SHORTHAND: Message =
    Message::new("expectedPropertyShorthand", "Expected property shorthand.");
const EXPECTED_PROPERTY_LONGFORM: Message =
    Message::new("expectedPropertyLongform", "Expected longform property syntax.");
const EXPECTED_METHOD_SHORTHAND: Message =
    Message::new("expectedMethodShorthand", "Expected method shorthand.");
const EXPECTED_METHOD_LONGFORM: Message =
    Message::new("expectedMethodLongform", "Expected longform method syntax.");
const UNEXPECTED_MIX: Message = Message::new(
    "unexpectedMix",
    "Unexpected mix of shorthand and non-shorthand properties.",
);

/// What is wrong with a property.
enum Finding<'a> {
    /// `{ x() {} }` should be written as `{ x: function() {} }`
    MethodLongform(Message, Func<'a>),
    /// `{ x }` should be written as `{ x: x }`
    PropertyLongform(Name<'a>),
    /// `{ x: function() {} }` should be written as `{ x() {} }`
    MethodShorthand(Func<'a>),
    /// `{ x: x }` should be written as `{ x }`
    PropertyShorthand(Name<'a>),
}

/// ESLint's `isConstructor`: whether the first character of `name` after `_`, `$` and digits is a
/// capital letter.
fn is_constructor(name: &[u8]) -> bool {
    let mut rest = text::code_points(name).skip_while(|it| matches!(it.1, 0x5F | 0x24 | 0x30..=0x39));
    let Some((start, first)) = rest.next() else {
        return false;
    };
    let end = rest.next().map_or(name.len(), |it| it.0);
    string_utils::is_letter(first) && name.get(start..end).is_some_and(text::is_upper_case)
}

/// ESLint's `canHaveShorthand`
fn can_have_shorthand(prop: Prop) -> bool {
    !matches!(prop.kind(), PropKind::Getter | PropKind::Setter | PropKind::Spread)
}

/// ESLint's `isStringLiteral(property.key)`
fn is_string_literal_key<'a>(key: Key<'a>, file: &File<'a>) -> bool {
    match key.kind() {
        KeyKind::String(_) => true,
        // It is also what a template without substitutions is.
        KeyKind::ComputedString(_) => file.text().get(key.inner_span(file).start as usize) != Some(&b'`'),
        KeyKind::Computed(e) => matches!(e.kind(), ExprKind::String(_)),
        _ => false,
    }
}

/// ESLint's `isProtoKey`
fn is_proto_key(key: Key) -> bool {
    !key.is_computed() && key.is("__proto__")
}

/// ESLint's `isRedundant`
fn is_redundant(prop: Prop) -> bool {
    let (Some(key), Some(value)) = (prop.key(), prop.value()) else {
        return false;
    };
    if is_proto_key(key) {
        return false;
    }
    match value.kind() {
        ExprKind::Fn(func) if func.kind() == FnKind::Expr => func.name().is_none(),
        ExprKind::Ident(name) => ast_utils::get_static_key_name(key).is_some_and(|it| *it == *name.bytes()),
        _ => false,
    }
}

/// Whether `e`, which is written `arguments`, refers to a variable of a function that is not an
/// arrow function, or of the global scope.
fn is_arguments_of_function(e: Expr) -> bool {
    let Some(symbol) = e.reference().and_then(Reference::symbol) else {
        return false;
    };
    let scope = symbol.scope();
    match scope.kind() {
        ScopeKind::Global => true,
        ScopeKind::Function => matches!(scope.node(), Node::Func(func) if !func.is_arrow()),
        _ => false,
    }
}

/// Whether there is a `this`, a `super`, a `new.target` or an `arguments` in `arrow` that means
/// something else in a method.
fn has_lexical_identifier(arrow: Func) -> bool {
    let mut pending = vec![Node::Func(arrow)];
    while let Some(node) = pending.pop() {
        match node {
            Node::Func(func) => {
                let defines_its_own = func.has_body() && !matches!(func.kind(), FnKind::Arrow | FnKind::StaticBlock);
                if defines_its_own {
                    continue;
                }
            }
            Node::Expr(e) => match e.kind() {
                ExprKind::Super | ExprKind::NewTarget => return true,
                ExprKind::This if !e.is_jsx_tag_name() => return true,
                ExprKind::Ident(name) if name.is("arguments") && is_arguments_of_function(e) => return true,
                _ => {}
            },
            _ => {}
        }
        node.for_each_child(|child| pending.push(child));
    }
    false
}

/// ESLint's `makeFunctionShorthand`. `func` is the value of `prop`.
fn make_function_shorthand<'a>(fixer: Fixer<'a>, prop: Prop<'a>, func: Func<'a>) -> Option<Fix> {
    let file = fixer.file();
    let (key, value) = (prop.key()?.span(file), prop.value()?.span());
    if file.comments_exist_between(key, value) {
        return None;
    }
    let mut method = Vec::new();
    if func.is_async() {
        method.extend_from_slice(b"async ");
    }
    if func.is_generator() {
        method.push(b'*');
    }
    method.extend_from_slice(file.slice(key));
    match func.arrow_span() {
        None => {
            let function_token = file.tokens_in(value).find(|token| token.is_keyword("function"))?;
            let token_before_params = match func.is_generator() {
                true => file.token_after(function_token)?,
                false => function_token,
            };
            method.extend_from_slice(file.slice(Span::new(token_before_params.end(), value.end)));
        }
        Some(arrow) => {
            // The first token that is not `async`.
            let start = file.tokens_in(value).nth(usize::from(func.is_async()))?.start();
            let params = file.slice(Span::new(start, file.token_before(arrow)?.end()));
            let should_add_parens =
                func.params().len() == 1 && func.params().first().is_some_and(|it| it.span().start == start);
            if should_add_parens {
                method.push(b'(');
            }
            method.extend_from_slice(params);
            if should_add_parens {
                method.push(b')');
            }
            method.extend_from_slice(file.slice(Span::new(arrow.end, value.end)));
        }
    }
    Some(fixer.replace(Span::new(key.start, prop.span().end), method))
}

/// ESLint's `makeFunctionLongform`. `func` is the value of `prop`.
fn make_function_longform<'a>(fixer: Fixer<'a>, prop: Prop<'a>, func: Func<'a>) -> Option<Fix> {
    let file = fixer.file();
    let key = prop.key()?.span(file);
    let mut longform = file.slice(key).to_vec();
    longform.extend_from_slice(if func.is_async() { &b": async function"[..] } else { b": function" });
    if func.is_generator() {
        longform.push(b'*');
    }
    Some(fixer.replace(Span::new(prop.span().start, key.end), longform))
}

impl ObjectShorthand {
    /// ESLint's `checkConsistency`
    fn check_consistency<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(props) = e.kind() else {
            return;
        };
        let (mut longform, mut shorthand) = (0, 0);
        for prop in props {
            match prop.kind() {
                PropKind::Init => longform += 1,
                PropKind::Shorthand | PropKind::Method => shorthand += 1,
                PropKind::Getter | PropKind::Setter | PropKind::Spread => {}
            }
        }
        if longform == 0 || utils::is_assignment_target(e) {
            return;
        }
        if shorthand > 0 {
            cx.report(e, UNEXPECTED_MIX);
        } else if self.is_consistent_as_needed && props.iter().filter(|it| can_have_shorthand(*it)).all(is_redundant) {
            cx.report(e, EXPECTED_ALL_PROPERTIES_SHORTHANDED);
        }
    }

    fn find<'a>(&self, prop: Prop<'a>, key: Key<'a>, value: Expr<'a>, file: &'a File<'a>) -> Option<Finding<'a>> {
        match (prop.kind(), value.kind()) {
            (PropKind::Method, ExprKind::Fn(func)) => {
                let message = if self.is_never {
                    EXPECTED_METHOD_LONGFORM
                } else if self.avoids_quotes && is_string_literal_key(key, file) {
                    EXPECTED_LITERAL_METHOD_LONGFORM
                } else {
                    return None;
                };
                Some(Finding::MethodLongform(message, func))
            }
            (PropKind::Shorthand, _) if self.is_never => match key.kind() {
                KeyKind::Ident(name) => Some(Finding::PropertyLongform(name)),
                _ => None,
            },
            (PropKind::Init, ExprKind::Fn(func)) if self.applies_to_methods && func.name().is_none() => {
                let name = ast_utils::get_static_key_name(key);
                let name = name.as_deref();
                // oxlint takes only a key that is written as a name for that of a constructor.
                let can_be_constructor = !file.language().is_oxlint || matches!(key.kind(), KeyKind::Ident(_));
                if (self.ignores_constructors && can_be_constructor && name.is_some_and(is_constructor))
                    || (self.methods_ignore_pattern.as_ref())
                        .is_some_and(|pattern| name.is_some_and(|name| pattern.test(name)))
                    || (self.avoids_quotes && is_string_literal_key(key, file))
                {
                    return None;
                }
                let is_method = match func.kind() {
                    FnKind::Expr => true,
                    FnKind::Arrow => {
                        self.avoids_explicit_return_arrows
                            && matches!(func.body(), FnBody::Block(_))
                            && !has_lexical_identifier(func)
                    }
                    _ => false,
                };
                is_method.then_some(Finding::MethodShorthand(func))
            }
            (PropKind::Init, ExprKind::Ident(name)) if self.applies_to_props => {
                let is_quoted = match key.kind() {
                    KeyKind::Ident(key) if key == name => false,
                    KeyKind::String(key) if key == name && !self.avoids_quotes => true,
                    _ => return None,
                };
                // A JSDoc type annotation would be lost.
                let has_type_annotation = file.comments_in(prop).any(|comment| {
                    let value = comment.comment_value();
                    let start = if is_quoted { value } else { text::trim_start(value) };
                    comment.kind() == TokenKind::Block && start.starts_with(b"*") && strings::contains(value, b"@type")
                });
                (!has_type_annotation).then_some(Finding::PropertyShorthand(name))
            }
            _ => None,
        }
    }

    fn check_property<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.is_jsx_attribute() {
            return;
        }
        let (Some(key), Some(value)) = (prop.key(), prop.value()) else {
            return;
        };
        let Some(finding) = self.find(prop, key, value, cx.file()) else {
            return;
        };
        let is_in_pattern = matches!(prop.parent(), Node::Expr(object) if utils::is_assignment_target(object));
        if is_proto_key(key) || is_in_pattern {
            return;
        }
        match finding {
            Finding::MethodLongform(message, func) => {
                cx.report(prop, message).fix(|fixer| make_function_longform(fixer, prop, func));
            }
            Finding::PropertyLongform(name) => {
                cx.report(prop, EXPECTED_PROPERTY_LONGFORM)
                    .fix(|fixer| fixer.insert_after(key.span(fixer.file()), [&b": "[..], name.bytes()].concat()));
            }
            Finding::MethodShorthand(func) => {
                // oxlint points at the function.
                let place = if cx.language().is_oxlint { value.span() } else { prop.span() };
                cx.report(place, EXPECTED_METHOD_SHORTHAND).fix(|fixer| make_function_shorthand(fixer, prop, func));
            }
            Finding::PropertyShorthand(name) => {
                cx.report(prop, EXPECTED_PROPERTY_SHORTHAND).fix(|fixer| {
                    let has_comments = fixer.file().comments_in(prop).next().is_some();
                    (!has_comments).then(|| fixer.replace(prop, name))
                });
            }
        }
    }
}

impl Rule for ObjectShorthand {
    const META: Meta = Meta::eslint("object-shorthand", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let apply = options.str(0).unwrap_or("always");
        let params = options.object(1);
        let pattern = params.str("methodsIgnorePattern").filter(|it| !it.is_empty());
        ObjectShorthand {
            applies_to_methods: matches!(apply, "methods" | "always"),
            applies_to_props: matches!(apply, "properties" | "always"),
            is_never: apply == "never",
            is_consistent: apply == "consistent",
            is_consistent_as_needed: apply == "consistent-as-needed",
            ignores_constructors: params.bool_or("ignoreConstructors", false),
            methods_ignore_pattern: pattern.and_then(|it| Regex::new(it, "u").ok()),
            avoids_quotes: params.bool_or("avoidQuotes", false),
            avoids_explicit_return_arrows: params.bool_or("avoidExplicitReturnArrows", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.is_consistent || self.is_consistent_as_needed {
            on.exprs([ExprTag::Object], Self::check_consistency);
        }
        if self.applies_to_methods || self.applies_to_props || self.is_never || self.avoids_quotes {
            on.props(Self::check_property);
        }
    }
}
