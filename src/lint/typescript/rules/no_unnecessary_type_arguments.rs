use bun_lint::prelude::*;
use bun_lint::types::utils::is_type_reference_type;
use bun_lint::types::{SyntaxKind, TsNode, TsSymbol, Type};
use smallvec::SmallVec;

/// Disallow type arguments that are equal to the default.
pub struct NoUnnecessaryTypeArguments;

const UNNECESSARY_TYPE_PARAMETER: Message = Message::new(
    "unnecessaryTypeParameter",
    "This is the default value for this type parameter, so it can be omitted.",
);

/// `ts.TypeParameterDeclaration[]`
type TypeParameters<'a> = SmallVec<[TsNode<'a>; 4]>;

/// `declaration.typeParameters`. `None` if it has none.
fn type_parameters_of(declaration: TsNode<'_>) -> Option<TypeParameters<'_>> {
    let children = declaration.children();
    let type_parameters: TypeParameters =
        children.filter(|child| child.kind() == SyntaxKind::TypeParameter).collect();
    (!type_parameters.is_empty()).then_some(type_parameters)
}

fn is_type_context_declaration(decl: TsNode) -> bool {
    matches!(decl.kind(), SyntaxKind::TypeAliasDeclaration | SyntaxKind::InterfaceDeclaration)
}

/// `checker.getSymbolAtLocation(expression)`, which has nothing for a `ParenthesizedExpression`.
fn get_symbol_at_location(expression: Expr<'_>) -> Option<TsSymbol<'_>> {
    if expression.is_parenthesized() {
        return None;
    }
    expression.ts_symbol()
}

fn get_construct_signature_declaration(symbol: TsSymbol<'_>) -> Option<TsNode<'_>> {
    symbol.get_type().get_construct_signatures().first()?.declaration()
}

/// `sym_at_location`: the symbol of the name that the type arguments follow.
/// `is_in_type_context`: it is the name of a type, not the class that a class extends or that
/// `new` is applied to.
fn get_type_parameters_from_type(
    sym_at_location: Option<TsSymbol<'_>>,
    is_in_type_context: bool,
) -> Option<TypeParameters<'_>> {
    let sym_at_location = sym_at_location?;
    let mut declarations: SmallVec<[TsNode; 4]> =
        sym_at_location.skip_alias().declarations().collect();
    declarations.sort_by_key(|&decl| !is_type_context_declaration(decl));
    if !is_in_type_context {
        declarations.reverse();
    }
    declarations.into_iter().find_map(|decl| match decl.kind() {
        SyntaxKind::TypeAliasDeclaration
        | SyntaxKind::InterfaceDeclaration
        | SyntaxKind::ClassDeclaration
        | SyntaxKind::ClassExpression => type_parameters_of(decl),
        SyntaxKind::VariableDeclaration => {
            type_parameters_of(get_construct_signature_declaration(sym_at_location)?)
        }
        _ => None,
    })
}

/// Whether two types that are not one are references to the same generic type with the same type
/// arguments.
fn is_same_type_reference<'a>(a: Type<'a>, b: Type<'a>) -> bool {
    match (is_type_reference_type(a), is_type_reference_type(b)) {
        (true, true) => {
            a.target().is_some()
                && a.target() == b.target()
                && a.get_type_arguments().iter().eq(b.get_type_arguments())
        }
        (true, false) => a.target() == Some(b) && a.get_type_arguments().is_empty(),
        (false, true) => b.target() == Some(a) && b.get_type_arguments().is_empty(),
        (false, false) => false,
    }
}

fn check_ts_args_and_parameters<'a>(
    es_parameters: List<'a, TypeNode<'a>>,
    type_parameters: &[TsNode<'a>],
    cx: &Cx<'a, NoUnnecessaryTypeArguments>,
) {
    // Only the last one: the ones before it have to be there if it is.
    let Some(i) = es_parameters.len().checked_sub(1) else {
        return;
    };
    let (Some(arg), Some(param)) = (es_parameters.get(i), type_parameters.get(i)) else {
        return;
    };
    let Some(default) = param.default_type() else {
        return;
    };
    let (default_type, arg_type) = (default.get_type_at_location(), arg.ty());
    if default_type.is_unresolved() || arg_type.is_unresolved() {
        return;
    }
    if default_type != arg_type && !is_same_type_reference(default_type, arg_type) {
        return;
    }
    cx.report(arg, UNNECESSARY_TYPE_PARAMETER).fix(|fixer| {
        let range = match i.checked_sub(1).and_then(|before| es_parameters.get(before)) {
            Some(previous) => Span::new(previous.span().end, arg.span().end),
            None => es_parameters.angle_brackets_span()?,
        };
        Some(fixer.remove(range))
    });
}

impl NoUnnecessaryTypeArguments {
    /// A `TSTypeReference`, a `TSInterfaceHeritage` or a `TSClassImplements`.
    fn check_type<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let (TypeKind::Ref { args, .. } | TypeKind::Heritage { args, .. }) = node.kind() else {
            return;
        };
        if args.is_empty() {
            return;
        }
        // `typeName` of a `TypeReference`, `expression` of an `ExpressionWithTypeArguments`
        let name = node.ts_node().children().next();
        let symbol = name.and_then(|name| name.get_symbol_at_location());
        if let Some(type_parameters) = get_type_parameters_from_type(symbol, true) {
            check_ts_args_and_parameters(args, &type_parameters, cx);
        }
    }

    fn check_class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let args = class.extends_args();
        if args.is_empty() {
            return;
        }
        let symbol = class.extends().and_then(get_symbol_at_location);
        if let Some(type_parameters) = get_type_parameters_from_type(symbol, false) {
            check_ts_args_and_parameters(args, &type_parameters, cx);
        }
    }

    fn check_call<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (args, class) = match node.kind() {
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => (call.type_args(), None),
            ExprKind::New(call) => (call.type_args(), Some(call.callee())),
            ExprKind::Jsx(jsx) => (jsx.type_args(), None),
            _ => return,
        };
        if args.is_empty() {
            return;
        }
        let sig_decl = node.resolved_signature().and_then(|sig| sig.declaration());
        let type_parameters = match sig_decl {
            Some(sig_decl) => type_parameters_of(sig_decl),
            None => class.and_then(|it| get_type_parameters_from_type(get_symbol_at_location(it), false)),
        };
        if let Some(type_parameters) = type_parameters {
            check_ts_args_and_parameters(args, &type_parameters, cx);
        }
    }
}

impl Rule for NoUnnecessaryTypeArguments {
    const META: Meta = Meta::typescript("no-unnecessary-type-arguments", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryTypeArguments
    }

    // The type arguments of a `TSInstantiationExpression`, where defaults do not apply, of a
    // `TSTypeQuery` and of a `TSImportType` are not checked.
    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.types([TypeTag::Ref, TypeTag::Heritage], Self::check_type);
        on.classes(Self::check_class);
        on.exprs(
            [ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate, ExprTag::Jsx],
            Self::check_call,
        );
    }
}
