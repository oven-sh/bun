use bun_lint::prelude::*;
use bun_lint::types::{NameOf, SymbolFlags, TsNode, TsSymbol, Types};
use smallvec::SmallVec;

/// Disallow unnecessary namespace qualifiers.
pub struct NoUnnecessaryQualifier;

const UNNECESSARY_QUALIFIER: Message = Message::new(
    "unnecessaryQualifier",
    "Qualifier is unnecessary since '{{ name }}' is in scope.",
);

type Namespaces<'a> = SmallVec<[TsNode<'a>; 4]>;

/// Whether `at` is in one of `declarations`, which are apart from each other and in the order of the text.
fn is_in_declaration(declarations: &[Span], at: u32) -> bool {
    let after = declarations.partition_point(|it| it.start <= at);
    after.checked_sub(1).and_then(|last| declarations.get(last)).is_some_and(|it| at < it.end)
}

/// The declarations of the namespaces and the enums that `node` is in.
///
/// Of `namespace A.B.C {}`, which is three declarations for TypeScript and one for ESLint, that is
/// the one of `A`, and if it is exported also the one of `C`: typescript-estree maps the
/// `TSModuleDeclaration` to the former and the `ExportNamedDeclaration` to the latter.
fn namespaces_in_scope<'a>(node: Node<'a>) -> Namespaces<'a> {
    let mut namespaces = Namespaces::new();
    for ancestor in node.ancestors() {
        let Node::Stmt(statement) = ancestor else {
            continue;
        };
        match statement.kind() {
            StmtKind::Enum(declaration) => namespaces.push(declaration.ts_node()),
            StmtKind::Module(declaration) => {
                namespaces.push(declaration.ts_node());
                if statement.is_exported() {
                    namespaces.push(declaration.innermost().ts_node());
                }
            }
            _ => {}
        }
    }
    namespaces
}

fn symbol_is_namespace_in_scope<'a>(mut symbol: TsSymbol<'a>, namespaces: &Namespaces<'a>) -> bool {
    for _ in 0..8 {
        if symbol.declarations().any(|declaration| namespaces.contains(&declaration)) {
            return true;
        }
        if !symbol.has_flags(SymbolFlags::ALIAS) {
            return false;
        }
        symbol = symbol.get_aliased_symbol();
    }
    false
}

/// `checker.getSymbolsInScope(node, flags).find(it => it.name === name)`. `name`: as it is written.
/// TODO(api): `resolve_name` stops at an `import name = ..` on the way, which is in that list only if `flags` has `ALIAS`.
fn get_symbol_in_scope<'a>(
    types: Types<'a>,
    node: TsNode<'a>,
    flags: SymbolFlags,
    name: &[u8],
) -> Option<TsSymbol<'a>> {
    types.resolve_name(name, node, flags, false)
}

fn symbols_are_equal<'a>(accessed: TsSymbol<'a>, in_scope: TsSymbol<'a>) -> bool {
    accessed == in_scope.get_export_symbol().get_merged_symbol()
}

/// `qualifier`, `name`: the two sides of the last dot of `A.B.name`. For the checker the `B` stands
/// for all of `A.B`.
fn qualifier_is_unnecessary<'a>(
    types: Types<'a>,
    qualifier: TsNode<'a>,
    name: TsNode<'a>,
    name_text: &[u8],
    namespaces: &Namespaces<'a>,
) -> bool {
    let is_in_scope = |symbol| symbol_is_namespace_in_scope(symbol, namespaces);
    if !qualifier.get_symbol_at_location().is_some_and(is_in_scope) {
        return false;
    }
    let Some(accessed_symbol) = name.get_symbol_at_location() else {
        return false;
    };
    // If the symbol in scope is different, the qualifier is necessary.
    get_symbol_in_scope(types, qualifier, accessed_symbol.flags(), name_text)
        .is_some_and(|from_scope| symbols_are_equal(accessed_symbol, from_scope))
}

/// An `Identifier`, or a `MemberExpression` that is not computed of one.
fn is_entity_name_expression(mut node: Expr) -> bool {
    loop {
        match node.kind() {
            ExprKind::Ident(_) => return true,
            // ESLint has a `ChainExpression` around the object of `(a?.b).c`.
            ExprKind::Dot { obj, .. } if !node.is_chain_root() => node = obj,
            _ => return false,
        }
    }
}

impl NoUnnecessaryQualifier {
    fn report<'a>(cx: &Cx<'a, Self>, qualifier: Span, name: Span) {
        cx.report(qualifier, UNNECESSARY_QUALIFIER)
            .data("name", cx.slice(name))
            .fix(|fixer| fixer.remove(Span::new(qualifier.start, name.start)));
    }

    /// `A.B.c`, as an expression or after `typeof` in a type. The qualifiers in a qualifier that is
    /// reported are not looked at, so all of them are checked from the outermost.
    fn check_member<'a>(&self, mut node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, .. } = node.kind() else {
            return;
        };
        if !is_in_declaration(&cx.state, node.span().start) || !is_entity_name_expression(obj) {
            return;
        }
        if let Node::Expr(parent) = node.parent()
            && matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == node)
            && !node.is_chain_root()
        {
            return;
        }
        if node.is_jsx_tag_name() {
            return;
        }
        let namespaces = namespaces_in_scope(Node::Expr(node));
        if namespaces.is_empty() {
            return;
        }
        let types = cx.file().type_checker();
        while let ExprKind::Dot { obj, name, .. } = node.kind() {
            let (qualifier, name_text) = (obj.ts_node(), cx.slice(name.span()));
            if qualifier_is_unnecessary(types, qualifier, NameOf(node).ts_node(), name_text, &namespaces) {
                Self::report(cx, obj.span(), name.span());
                return;
            }
            node = obj;
        }
    }

    /// `owner`: what `name` is part of.
    fn check_entity_name<'a>(cx: &Cx<'a, Self>, owner: Node<'a>, name: EntityName<'a>) {
        let Some(first) = name.first().filter(|_| name.len() > 1) else {
            return;
        };
        if !is_in_declaration(&cx.state, first.start()) {
            return;
        }
        let namespaces = namespaces_in_scope(owner);
        if namespaces.is_empty() {
            return;
        }
        let types = cx.file().type_checker();
        for i in (1..name.len()).rev() {
            let (Some(left), Some(right)) = (name.get(i - 1), name.get(i)) else {
                return;
            };
            let (qualifier, right_text) = (types.ts_node(left), cx.slice(right.span()));
            if qualifier_is_unnecessary(types, qualifier, types.ts_node(right), right_text, &namespaces) {
                Self::report(cx, first.span().to(left.span()), right.span());
                return;
            }
        }
    }
}

impl Rule for NoUnnecessaryQualifier {
    const META: Meta = Meta::typescript("no-unnecessary-qualifier", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types();
    /// Where the namespaces and the enums are that are in no other, in the order of the text.
    type State<'a> = Vec<Span>;

    fn new(_: &Options) -> Self {
        NoUnnecessaryQualifier
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<Span> {
        let declarations = file.stmts_of_kind(StmtTag::Module).chain(file.stmts_of_kind(StmtTag::Enum));
        let mut declarations: Vec<Span> = declarations.map(|it| it.span()).collect();
        if declarations.is_empty() {
            return declarations;
        }
        declarations.sort_unstable_by_key(|it| (it.start, std::cmp::Reverse(it.end)));
        let mut end = 0;
        declarations.retain(|it| {
            let is_in_no_other = it.start >= end;
            end = end.max(it.end);
            is_in_no_other
        });
        on.exprs([ExprTag::Dot], Self::check_member);
        on.types([TypeTag::Ref, TypeTag::Import], |_, node, cx| {
            if let TypeKind::Ref { name, .. } | TypeKind::Import { name, .. } = node.kind() {
                Self::check_entity_name(cx, Node::Type(node), name);
            }
        });
        on.stmts([StmtTag::ImportEquals], |_, node, cx| {
            if let StmtKind::ImportEquals(import) = node.kind()
                && let ImportEqualsTarget::Entity(name) = import.target()
            {
                Self::check_entity_name(cx, Node::Stmt(node), name);
            }
        });
        declarations
    }
}
