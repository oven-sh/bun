use bun_lint::prelude::*;
use crate::rules::no_wrapper_object_types::{GlobalFunctions, is_reference_to_global};

/// Enforce specifying generic type arguments on type annotation or constructor name of a
/// constructor call.
pub struct ConsistentGenericConstructors {
    prefers_type_annotation: bool,
}

const PREFER_CONSTRUCTOR: Message = Message::new(
    "preferConstructor",
    "The generic type arguments should be specified as part of the constructor type arguments.",
);
const PREFER_TYPE_ANNOTATION: Message = Message::new(
    "preferTypeAnnotation",
    "The generic type arguments should be specified as part of the type annotation.",
);

const BUILT_IN_ARRAYS: [&str; 9] = [
    "Float32Array",
    "Float64Array",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray",
];

/// What a `new` expression initializes.
#[derive(Copy, Clone)]
enum Owner<'a> {
    /// `VariableDeclarator`
    Var(VarDecl<'a>),
    /// `PropertyDefinition`, `AccessorProperty`
    Member(Member<'a>),
    /// `:matches(FunctionDeclaration, FunctionExpression) > AssignmentPattern`
    Param(Param<'a>),
}

impl<'a> Owner<'a> {
    fn of(rhs: Expr<'a>) -> Option<Owner<'a>> {
        match rhs.parent() {
            Node::VarDecl(decl) if decl.init() == Some(rhs) => Some(Owner::Var(decl)),
            Node::Member(member)
                if member.init() == Some(rhs)
                    && member.kind() == MemberKind::Property
                    && !member.flags().contains(Flags::ABSTRACT) =>
            {
                Some(Owner::Member(member))
            }
            Node::Param(param)
                if param.default() == Some(rhs)
                    // oxlint looks at every parameter.
                    && (rhs.file().language().is_oxlint
                        || !param.is_parameter_property()
                            && param.func().is_some_and(|func| !func.is_arrow() && func.has_body())) =>
            {
                Some(Owner::Param(param))
            }
            _ => None,
        }
    }

    fn ty(self) -> Option<TypeNode<'a>> {
        match self {
            Owner::Var(decl) => decl.ty(),
            Owner::Member(member) => member.ty(),
            Owner::Param(param) => param.ty(),
        }
    }

    fn span(self, rhs: Expr<'a>) -> Span {
        match self {
            Owner::Var(decl) => decl.span(),
            Owner::Member(member) => member.span(),
            Owner::Param(param) => Span::new(param.pat().span().start, rhs.outer_span().end),
        }
    }

    /// Where a type annotation goes.
    fn end_of_name(self, file: &File<'a>) -> u32 {
        match self {
            Owner::Var(decl) => decl.pat().span().end,
            Owner::Param(param) => param.pat().span().end,
            Owner::Member(member) => match member.key() {
                Some(key) => match key.kind() {
                    // The token after the expression, as upstream.
                    KeyKind::Computed(e) => skip_trivia(file.text(), e.span().end) + 1,
                    _ => key.span(file).end,
                },
                None => member.span().start,
            },
        }
    }
}

impl Rule for ConsistentGenericConstructors {
    const META: Meta = Meta::typescript("consistent-generic-constructors", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = GlobalFunctions<'a>;

    fn new(options: &Options) -> Self {
        ConsistentGenericConstructors {
            prefers_type_annotation: options.str(0) == Some("type-annotation"),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<GlobalFunctions<'a>> {
        Some(GlobalFunctions::default())
    }

    fn expr<'a>(&self, rhs: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(call) = rhs.kind() else {
            return;
        };
        let callee = call.callee();
        let Some(callee_name) = callee.as_ident() else {
            return;
        };
        // For oxlint `(A)` is no name.
        if callee.is_parenthesized() && cx.language().is_oxlint {
            return;
        }
        let rhs_type_args = call.type_args().angle_brackets_span();
        if rhs_type_args.is_some() != self.prefers_type_annotation {
            return;
        }
        let Some(owner) = Owner::of(rhs) else {
            return;
        };

        if let Some(type_args) = rhs_type_args {
            if owner.ty().is_some() {
                return;
            }
            // oxlint points at the type arguments.
            let place = if cx.language().is_oxlint { type_args } else { owner.span(rhs) };
            cx.report(place, PREFER_TYPE_ANNOTATION).fix(|fixer| {
                let file = fixer.file();
                let mut annotation = b": ".to_vec();
                annotation.extend_from_slice(callee.text());
                annotation.extend_from_slice(file.slice(type_args));
                [
                    fixer.remove(type_args),
                    fixer.insert_after(Span::empty(owner.end_of_name(file)), annotation),
                ]
            });
            return;
        }

        let Some(lhs) = owner.ty() else {
            return;
        };
        let TypeKind::Ref { name, args } = lhs.kind() else {
            return;
        };
        let Some(type_args) = args.angle_brackets_span() else {
            return;
        };
        let Some(type_name) = name.as_ident().map(Ident::name) else {
            return;
        };
        if type_name != callee_name
            || type_name.is_any(&BUILT_IN_ARRAYS) && is_reference_to_global(type_name, lhs, &mut cx.state)
            || Object::of(Some(&cx.language().parser_options)).bool_or("isolatedDeclarations", false)
        {
            return;
        }
        // oxlint points at the annotation.
        let place = if cx.language().is_oxlint { lhs.annotation_span() } else { owner.span(rhs) };
        cx.report(place, PREFER_CONSTRUCTOR).fix(|fixer| {
            let file = fixer.file();
            let annotation = lhs.annotation_span();
            let mut text = Vec::new();
            for comment in file.comments_in(annotation) {
                if !type_args.contains(comment.span()) {
                    text.extend_from_slice(comment.text());
                }
            }
            text.extend_from_slice(file.slice(type_args));
            let after_callee = skip_trivia(file.text(), callee.span().end);
            if file.text().get(after_callee as usize) != Some(&b'(') {
                text.extend_from_slice(b"()");
            }
            [fixer.remove(annotation), fixer.insert_after(callee, text)]
        });
    }
}
