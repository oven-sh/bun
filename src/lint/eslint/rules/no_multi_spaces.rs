use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::{estree_type_name, get_node_by_range_index};

/// Disallow multiple spaces.
pub struct NoMultiSpaces {
    ignore_eol_comments: bool,
    /// The types of nodes, as ESLint names them, in which anything goes.
    exceptions: Vec<Box<[u8]>>,
}

const MULTIPLE_SPACES: Message =
    Message::new("multipleSpaces", "Multiple spaces found before '{{displayValue}}'.");

#[inline]
fn has(span: Option<Span>, offset: u32) -> bool {
    span.is_some_and(|it| it.contains_offset(offset))
}

fn is_in_annotation(ty: Option<TypeNode>, offset: u32) -> bool {
    ty.is_some_and(|it| it.annotation_span().contains_offset(offset))
}

fn is_in_decorator<'a>(modifiers: List<'a, Modifier<'a>>, offset: u32) -> bool {
    modifiers.iter().any(|it| it.decorator().is_some() && it.span().contains_offset(offset))
}

/// The `export` or `export default` before a declaration.
fn type_of_export(statement: Stmt, offset: u32) -> Option<&'static str> {
    (offset < statement.span_without_export().start).then(|| match statement.is_default_export() {
        true => "ExportDefaultDeclaration",
        false => "ExportNamedDeclaration",
    })
}

/// The parts of a function that are nodes for ESLint only.
fn type_in_function(func: Func, offset: u32) -> Option<&'static str> {
    if has(func.body_span(), offset) {
        return Some(if func.kind() == FnKind::StaticBlock { "StaticBlock" } else { "BlockStatement" });
    }
    if has(func.type_params().angle_brackets_span(), offset) {
        let is_in_parameter = func.type_params().iter().any(|it| it.span().contains_offset(offset));
        return Some(if is_in_parameter { "TSTypeParameter" } else { "TSTypeParameterDeclaration" });
    }
    is_in_annotation(func.return_type(), offset).then_some("TSTypeAnnotation")
}

fn type_in_member(member: Member, offset: u32) -> &'static str {
    if is_in_decorator(member.modifiers(), offset) {
        "Decorator"
    } else if is_in_annotation(member.ty(), offset) {
        "TSTypeAnnotation"
    } else {
        estree_type_name(member.into())
    }
}

fn type_in_param(param: Param, offset: u32) -> &'static str {
    if is_in_decorator(param.modifiers(), offset) {
        "Decorator"
    } else if is_in_annotation(param.ty(), offset) {
        "TSTypeAnnotation"
    } else if offset < param.span_without_modifiers().start {
        estree_type_name(param.into())
    } else if param.is_rest() {
        "RestElement"
    } else if param.default().is_some() && !param.binding_span().contains_offset(offset) {
        "AssignmentPattern"
    } else {
        estree_type_name(param.pat().into())
    }
}

fn type_in_jsx(e: Expr, jsx: Jsx, offset: u32) -> &'static str {
    let is_fragment = jsx.is_fragment();
    if jsx.opening_span().contains_offset(offset) {
        return match is_fragment {
            _ if has(jsx.type_args().angle_brackets_span(), offset) => "TSTypeParameterInstantiation",
            true => "JSXOpeningFragment",
            false => "JSXOpeningElement",
        };
    }
    if has(jsx.closing_span(), offset) {
        return if is_fragment { "JSXClosingFragment" } else { "JSXClosingElement" };
    }
    match jsx.children().iter().find(|it| has(it.jsx_container_span(), offset)).map(Expr::tag) {
        Some(ExprTag::Missing) => "JSXEmptyExpression",
        Some(ExprTag::Spread) => "JSXSpreadChild",
        Some(_) => "JSXExpressionContainer",
        None => estree_type_name(e.into()),
    }
}

fn type_in_statement(statement: Stmt, offset: u32) -> &'static str {
    if let Some(export) = type_of_export(statement, offset) {
        return export;
    }
    let is_in_attribute = || {
        (statement.import_attributes())
            .is_some_and(|it| it.entries().iter().any(|entry| entry.span().contains_offset(offset)))
    };
    let found = match statement.kind() {
        StmtKind::Try { .. } => has(statement.catch_clause_span(), offset).then_some("CatchClause"),
        StmtKind::Interface(it) if it.body_span().contains_offset(offset) => Some("TSInterfaceBody"),
        StmtKind::Interface(it) => {
            has(it.type_params().angle_brackets_span(), offset).then_some("TSTypeParameterDeclaration")
        }
        StmtKind::TypeAlias(it) => {
            has(it.type_params().angle_brackets_span(), offset).then_some("TSTypeParameterDeclaration")
        }
        StmtKind::Enum(it) => it.body_span().contains_offset(offset).then_some("TSEnumBody"),
        StmtKind::Module(it) if has(it.body_span(), offset) => Some("TSModuleBlock"),
        // `namespace A.B`
        StmtKind::Module(it) => {
            (it.nested().is_some() && offset >= it.name_span().start).then_some("TSQualifiedName")
        }
        StmtKind::Import(it) if has(it.namespace_span(), offset) => Some("ImportNamespaceSpecifier"),
        StmtKind::Import(_) | StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => {
            is_in_attribute().then_some("ImportAttribute")
        }
        StmtKind::ImportEquals(it) if has(it.require_span(), offset) => Some("TSExternalModuleReference"),
        StmtKind::ImportEquals(it) => match it.target() {
            ImportEqualsTarget::Entity(name) => name.span().contains_offset(offset).then_some("TSQualifiedName"),
            ImportEqualsTarget::Require(_) => None,
        },
        _ => None,
    };
    found.unwrap_or_else(|| estree_type_name(statement.into()))
}

fn type_in_type(ty: TypeNode, offset: u32) -> &'static str {
    let own = estree_type_name(ty.into());
    let (name, args) = match ty.kind() {
        TypeKind::Ref { name, args } | TypeKind::Import { name, args, .. } => (Some(name), args),
        TypeKind::Typeof { args, .. } | TypeKind::Heritage { args, .. } => (None, args),
        _ => return own,
    };
    if has(args.angle_brackets_span(), offset) {
        "TSTypeParameterInstantiation"
    } else if !name.is_some_and(|it| it.span().contains_offset(offset)) {
        own
    } else if matches!(own, "TSClassImplements" | "TSInterfaceHeritage") {
        "MemberExpression"
    } else {
        "TSQualifiedName"
    }
}

/// ESLint's `sourceCode.getNodeByRangeIndex(offset)?.type`, for an `offset` that is between two
/// tokens: also the types of what is a node for ESLint and a part of a node here.
// TODO(api): replace by the helper of `utils` for the type at an offset
fn estree_type_name_at<'a>(file: &'a File<'a>, offset: u32) -> Option<&'static str> {
    let node = get_node_by_range_index(file, offset);
    let own = || estree_type_name(node);
    Some(match node {
        // espree ends the `Program` with its last token.
        Node::File(_) => {
            let is_after = || file.tokens().next_back().is_none_or(|last| offset >= last.end());
            if offset < file.program_span().start || !file.uses_typescript_parser() && is_after() {
                return None;
            }
            "Program"
        }
        Node::Stmt(statement) => type_in_statement(statement, offset),
        Node::Func(func) => match (type_in_function(func, offset), func.owner()) {
            (Some(part), _) => part,
            (None, Node::Stmt(statement)) => type_of_export(statement, offset).unwrap_or_else(own),
            // The function of a method starts after the name.
            (None, Node::Member(member))
                if !member.is_signature()
                    && member.kind() != MemberKind::StaticBlock
                    && offset < func.span_from_params().start =>
            {
                type_in_member(member, offset)
            }
            _ => own(),
        },
        Node::Class(class) => {
            if is_in_decorator(class.modifiers(), offset) {
                "Decorator"
            } else if class.body_span().contains_offset(offset) {
                "ClassBody"
            } else if has(class.type_params().angle_brackets_span(), offset) {
                "TSTypeParameterDeclaration"
            } else if has(class.extends_args().angle_brackets_span(), offset) {
                "TSTypeParameterInstantiation"
            } else {
                let export = class.owner().as_stmt().and_then(|it| type_of_export(it, offset));
                export.unwrap_or_else(own)
            }
        }
        Node::Member(member) => type_in_member(member, offset),
        Node::Param(param) => type_in_param(param, offset),
        Node::VarDecl(declaration) => {
            if is_in_annotation(declaration.ty(), offset) {
                "TSTypeAnnotation"
            } else if declaration.binding_span().contains_offset(offset) {
                estree_type_name(declaration.pat().into())
            } else {
                own()
            }
        }
        // The `value` of `{ key: value = default }` is an `AssignmentPattern`.
        Node::PatProp(prop) if prop.default().is_some() && offset >= prop.value().span().start => {
            "AssignmentPattern"
        }
        // The expression that is the function of a method starts at the `(`.
        Node::Prop(prop) => match prop.func().and_then(|func| type_in_function(func, offset)) {
            Some(part) => part,
            None if prop.kind() == PropKind::Spread => own(),
            None => match prop.value().filter(|it| has(it.jsx_container_span(), offset)) {
                Some(value) if value.is_missing() => "JSXEmptyExpression",
                Some(_) => "JSXExpressionContainer",
                None => own(),
            },
        },
        Node::Expr(e) => match e.kind() {
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)
                if has(call.type_args().angle_brackets_span(), offset) =>
            {
                "TSTypeParameterInstantiation"
            }
            ExprKind::Instantiation { type_args, .. } if has(type_args.angle_brackets_span(), offset) => {
                "TSTypeParameterInstantiation"
            }
            ExprKind::Jsx(jsx) => type_in_jsx(e, jsx, offset),
            _ => own(),
        },
        Node::Type(ty) => type_in_type(ty, offset),
        // The `K in T` of a mapped type is no node.
        Node::TypeParam(param) if matches!(param.parent(), Node::Type(ty) if ty.tag() == TypeTag::Mapped) => {
            "TSMappedType"
        }
        _ => own(),
    })
}

/// ESLint's `formatReportedCommentValue`, appended to `out`.
fn format_reported_comment_value(value: &[u8], out: &mut Vec<u8>) {
    let first_line = &value[..strings::index_of_char_usize(value, b'\n').unwrap_or(value.len())];
    if first_line.len() == value.len() && strings::wtf8_len_utf16(value) <= 12 {
        out.extend_from_slice(value);
    } else {
        out.extend_from_slice(strings::wtf8_slice_by_utf16(first_line, 0, 12));
        out.extend_from_slice(b"...");
    }
}

fn display_value(token: Token<'_>) -> Vec<u8> {
    let mut out = Vec::new();
    match token.kind() {
        TokenKind::Block => {
            out.extend_from_slice(b"/*");
            format_reported_comment_value(token.comment_value(), &mut out);
            out.extend_from_slice(b"*/");
        }
        TokenKind::Line => {
            out.extend_from_slice(b"//");
            format_reported_comment_value(token.comment_value(), &mut out);
        }
        // Its `value` is without the `#`.
        TokenKind::PrivateIdentifier => out.extend_from_slice(token.text().get(1..).unwrap_or_default()),
        _ => out.extend_from_slice(token.text()),
    }
    out
}

impl NoMultiSpaces {
    fn is_exception<'a>(&self, file: &'a File<'a>, offset: u32) -> bool {
        !self.exceptions.is_empty()
            && estree_type_name_at(file, offset)
                .is_some_and(|name| self.exceptions.iter().any(|it| **it == *name.as_bytes()))
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut tokens = file.tokens().with_comments();
        let Some(mut left) = tokens.next() else {
            return;
        };
        while let Some(right) = tokens.next() {
            let spaces = Span::new(left.end(), right.start());
            left = right;
            let between = file.slice(spaces);
            if between.len() < 2 || !strings::contains(between, b"  ") || strings::contains_js_line_break(between) {
                continue;
            }
            if self.ignore_eol_comments && right.is_comment() {
                let mut rest = tokens;
                let is_last_on_line = rest
                    .next()
                    .is_none_or(|next| {
                        strings::contains_js_line_break(file.slice(Span::new(right.end(), next.start())))
                    });
                if is_last_on_line {
                    continue;
                }
            }
            if self.is_exception(file, right.start() - 1) {
                continue;
            }
            cx.report(spaces, MULTIPLE_SPACES)
                .data("displayValue", display_value(right))
                .fix(|fixer| fixer.replace(spaces, " "));
        }
    }
}

impl Rule for NoMultiSpaces {
    const META: Meta = Meta::eslint("no-multi-spaces", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut exceptions: Vec<Box<[u8]>> = vec![b"Property"[..].into()];
        for (name, is_exception) in options.object("exceptions").entries() {
            exceptions.retain(|it| **it != name[..]);
            if is_exception.as_bool() == Some(true) {
                exceptions.push(name[..].into());
            }
        }
        NoMultiSpaces {
            ignore_eol_comments: options.bool_or("ignoreEOLComments", false),
            exceptions,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
