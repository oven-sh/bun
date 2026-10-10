use bun_lint::prelude::*;

/// Require consistently using either `T[]` or `Array<T>` for arrays.
pub struct ArrayType {
    default: Style,
    readonly: Style,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Style {
    Array,
    ArraySimple,
    Generic,
}

impl Style {
    fn parse(option: Option<&str>) -> Option<Style> {
        Some(match option? {
            "array" => Style::Array,
            "array-simple" => Style::ArraySimple,
            "generic" => Style::Generic,
            _ => return None,
        })
    }
}

const ERROR_STRING_ARRAY: Message = Message::new(
    "errorStringArray",
    "Array type using '{{className}}<{{type}}>' is forbidden. Use '{{readonlyPrefix}}{{type}}[]' instead.",
);
const ERROR_STRING_ARRAY_READONLY: Message = Message::new(
    "errorStringArrayReadonly",
    "Array type using '{{className}}<{{type}}>' is forbidden. Use '{{readonlyPrefix}}{{type}}' instead.",
);
const ERROR_STRING_ARRAY_SIMPLE: Message = Message::new(
    "errorStringArraySimple",
    "Array type using '{{className}}<{{type}}>' is forbidden for simple types. Use '{{readonlyPrefix}}{{type}}[]' instead.",
);
const ERROR_STRING_ARRAY_SIMPLE_READONLY: Message = Message::new(
    "errorStringArraySimpleReadonly",
    "Array type using '{{className}}<{{type}}>' is forbidden for simple types. Use '{{readonlyPrefix}}{{type}}' instead.",
);
const ERROR_STRING_GENERIC: Message = Message::new(
    "errorStringGeneric",
    "Array type using '{{readonlyPrefix}}{{type}}[]' is forbidden. Use '{{className}}<{{type}}>' instead.",
);
const ERROR_STRING_GENERIC_SIMPLE: Message = Message::new(
    "errorStringGenericSimple",
    "Array type using '{{readonlyPrefix}}{{type}}[]' is forbidden for non-simple types. Use '{{className}}<{{type}}>' instead.",
);

/// typescript-eslint's `isSimpleType`.
fn is_simple_type(mut ty: TypeNode) -> bool {
    loop {
        return match ty.kind() {
            TypeKind::Keyword(keyword) => keyword != Keyword::Intrinsic,
            TypeKind::Array(_) => true,
            TypeKind::Ref { name, args } if name.is("Array") => match (args.first(), args.len()) {
                (None, _) => true,
                (Some(only), 1) => {
                    ty = only;
                    continue;
                }
                _ => false,
            },
            TypeKind::Ref { args, .. } => args.is_empty(),
            _ => false,
        };
    }
}

/// typescript-eslint's `typeNeedsParentheses`.
fn type_needs_parentheses(ty: TypeNode) -> bool {
    match ty.kind() {
        TypeKind::Ref { name, .. } => name.is("ReadonlyArray"),
        TypeKind::Union(_)
        | TypeKind::Intersection(_)
        | TypeKind::Fn(_)
        | TypeKind::Keyof(_)
        | TypeKind::Readonly(_)
        | TypeKind::UniqueSymbol
        | TypeKind::Unique(_)
        | TypeKind::Infer(_)
        | TypeKind::Cond { .. } => true,
        _ => false,
    }
}

/// typescript-eslint's `getMessageType`.
fn message_type(ty: TypeNode<'_>) -> &[u8] {
    if is_simple_type(ty) { ty.text() } else { b"T" }
}

/// Whether a scope around `ty`, other than the global scope, declares `name`.
fn is_shadowed<'a>(ty: TypeNode<'a>, name: Name<'a>) -> bool {
    Node::Type(ty).scope().chain().any(|scope| {
        scope.parent().is_some()
            && (scope.get_name(name).is_some()
                // ESLint has the name of a class declaration in the scope of the class too.
                || matches!(scope.node(), Node::Class(class) if class.name().is_some_and(|it| it.name() == name)))
    })
}

impl ArrayType {
    /// `T[]`
    fn check_array<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Array(element) = ty.kind() else {
            return;
        };
        let readonly = ty.parent().as_type().filter(|parent| parent.tag() == TypeTag::Readonly);
        let style = if readonly.is_some() { self.readonly } else { self.default };
        if style == Style::Array || style == Style::ArraySimple && is_simple_type(element) {
            return;
        }
        let message = match style {
            Style::Generic => ERROR_STRING_GENERIC,
            _ => ERROR_STRING_GENERIC_SIMPLE,
        };
        let whole = readonly.unwrap_or(ty).span();
        let class_name = if readonly.is_some() { "ReadonlyArray" } else { "Array" };
        cx.report(whole, message)
            .data("type", message_type(element))
            .data("className", class_name)
            .data("readonlyPrefix", if readonly.is_some() { "readonly " } else { "" })
            .fix(|fixer| {
                let inner = element.span();
                [
                    fixer.replace(Span::new(whole.start, inner.start), format!("{class_name}<")),
                    fixer.replace(Span::new(inner.end, whole.end), ">"),
                ]
            });
    }

    /// `Array<T>`, `ReadonlyArray<T>`, `Readonly<T[]>`
    fn check_reference<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, args } = ty.kind() else {
            return;
        };
        let Some(name) = name.as_ident().map(Ident::name) else {
            return;
        };
        let (is_readonly, is_readonly_with_array) = match name.bytes() {
            b"Array" => (false, false),
            b"ReadonlyArray" => (true, false),
            // oxlint does not know it.
            b"Readonly" if cx.language().is_oxlint => return,
            b"Readonly" if args.first().is_some_and(|it| it.tag() == TypeTag::Array) => (true, true),
            _ => return,
        };
        let style = if is_readonly { self.readonly } else { self.default };
        // oxlint takes `Array` for `Array<any>`.
        if args.is_empty()
            && cx.language().is_oxlint
            && style != Style::Generic
            && !cx.file().is_javascript()
            && utils::estree_type_name(Node::Type(ty)) == "TSTypeReference"
        {
            let message = if style == Style::Array { ERROR_STRING_ARRAY } else { ERROR_STRING_ARRAY_SIMPLE };
            let readonly_prefix = if is_readonly { "readonly " } else { "" };
            cx.report(ty, message)
                .data("type", "any")
                .data("className", name)
                .data("readonlyPrefix", readonly_prefix)
                .fix(|fixer| fixer.replace(ty, [readonly_prefix, "any[]"].concat()));
            return;
        }
        let (Some(argument), 1) = (args.first(), args.len()) else {
            return;
        };
        if style == Style::Generic
            || style == Style::ArraySimple && !is_simple_type(argument)
            || utils::estree_type_name(Node::Type(ty)) != "TSTypeReference"
            || is_shadowed(ty, name)
        {
            return;
        }
        let message = match (style, is_readonly_with_array) {
            (Style::Array, true) => ERROR_STRING_ARRAY_READONLY,
            (Style::Array, false) => ERROR_STRING_ARRAY,
            (_, true) => ERROR_STRING_ARRAY_SIMPLE_READONLY,
            (_, false) => ERROR_STRING_ARRAY_SIMPLE,
        };
        let readonly_prefix = if is_readonly { "readonly " } else { "" };
        cx.report(ty, message)
            .data("type", message_type(argument))
            .data("className", name)
            .data("readonlyPrefix", readonly_prefix)
            .fix(|fixer| {
                let type_parens = type_needs_parentheses(argument);
                let parent_parens = is_readonly
                    && ty.parent().as_type().is_some_and(|parent| parent.tag() == TypeTag::Array)
                    && !ty.is_parenthesized();
                let start = format!(
                    "{}{readonly_prefix}{}",
                    if parent_parens { "(" } else { "" },
                    if type_parens { "(" } else { "" },
                );
                let end = format!(
                    "{}{}{}",
                    if type_parens { ")" } else { "" },
                    if is_readonly_with_array { "" } else { "[]" },
                    if parent_parens { ")" } else { "" },
                );
                let (whole, inner) = (ty.span(), argument.span());
                [
                    fixer.replace(Span::new(whole.start, inner.start), start),
                    fixer.replace(Span::new(inner.end, whole.end), end),
                ]
            });
    }
}

impl Rule for ArrayType {
    const META: Meta = Meta::typescript("array-type", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC);
    const ON: On = On::new().types(&[TypeTag::Array, TypeTag::Ref]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let default = Style::parse(options.str("default")).unwrap_or(Style::Array);
        ArrayType {
            default,
            readonly: Style::parse(options.str("readonly")).unwrap_or(default),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.default != Style::Array || self.readonly != Style::Array {
            on = on.types(&[TypeTag::Array]);
        }
        if self.default != Style::Generic || self.readonly != Style::Generic {
            on = on.types(&[TypeTag::Ref]);
        }
        on
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.tag() {
            TypeTag::Array => self.check_array(ty, cx),
            TypeTag::Ref => self.check_reference(ty, cx),
            _ => {}
        }
    }
}
