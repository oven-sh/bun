use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{FixOrSuggest, get_fix_or_suggest};
use rustc_hash::FxHashSet;

/// Require or disallow the `Record` type.
pub struct ConsistentIndexedObjectStyle {
    prefers_record: bool,
}

const PREFER_INDEX_SIGNATURE: Message =
    Message::new("preferIndexSignature", "An index signature is preferred over a record.");
const PREFER_INDEX_SIGNATURE_SUGGESTION: Message = Message::new(
    "preferIndexSignatureSuggestion",
    "Change into an index signature instead of a record.",
);
const PREFER_RECORD: Message = Message::new("preferRecord", "A record is preferred over an index signature.");
const PREFER_RECORD_SUGGESTION: Message = Message::new(
    "preferRecordSuggestion",
    "Change into a record instead of an index signature.",
);

/// Whether there is a comment in `node` that is in none of `preserved`: a fix that only keeps the
/// text of those would drop it.
fn has_unpreserved_comments<'a>(file: &'a File<'a>, node: Span, preserved: [Option<TypeNode<'a>>; 2]) -> bool {
    file.comments_in(node)
        .any(|comment| preserved.iter().flatten().all(|target| !target.span().contains(comment.span())))
}

/// The type alias that `ty` is part of, with no type annotation in between.
fn find_parent_declaration(ty: TypeNode<'_>) -> Option<Alias<'_>> {
    let mut at = Node::Type(ty);
    loop {
        let parent = at.parent();
        match (at, parent) {
            // ESLint has a `TSTypeAnnotation` around these.
            (Node::Type(_), Node::Func(_) | Node::Param(_) | Node::VarDecl(_) | Node::Member(_)) => return None,
            (Node::Type(_), Node::Type(outer)) if outer.tag() == TypeTag::Predicate => return None,
            (_, Node::Stmt(statement)) => {
                return match statement.kind() {
                    StmtKind::TypeAlias(alias) => Some(alias),
                    _ => None,
                };
            }
            (_, Node::File(_) | Node::Expr(_) | Node::Class(_)) => return None,
            _ => at = parent,
        }
    }
}

type Visited<'a> = FxHashSet<Node<'a>>;

fn is_deeply_referencing_type<'a>(node: Node<'a>, super_var: Symbol<'a>, visited: &mut Visited<'a>) -> bool {
    // Something on the chain is circular, but it is not the reference that is checked.
    if !visited.insert(node) {
        return false;
    }
    match node {
        Node::Type(ty) => match ty.kind() {
            TypeKind::Object(members) => {
                members.iter().any(|it| is_deeply_referencing_type(it.into(), super_var, visited))
            }
            TypeKind::IndexedAccess { obj, index } => {
                [index, obj].into_iter().any(|it| is_deeply_referencing_type(it.into(), super_var, visited))
            }
            TypeKind::Mapped(mapped) => {
                mapped.ty().is_some_and(|it| is_deeply_referencing_type(it.into(), super_var, visited))
            }
            TypeKind::Cond { check, extends, yes, no } => [check, extends, no, yes]
                .into_iter()
                .any(|it| is_deeply_referencing_type(it.into(), super_var, visited)),
            TypeKind::Union(types) | TypeKind::Intersection(types) => any_is_referencing(types, super_var, visited),
            TypeKind::Ref { name, args } => {
                name.as_ident().is_some_and(|it| is_name_referencing(it.name(), super_var, visited))
                    || any_is_referencing(args, super_var, visited)
            }
            _ => false,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::TypeAlias(alias) => is_deeply_referencing_type(alias.ty().into(), super_var, visited),
            StmtKind::Interface(interface) => {
                interface.members().iter().any(|it| is_deeply_referencing_type(it.into(), super_var, visited))
            }
            _ => false,
        },
        Node::Member(member) if member.kind() == MemberKind::IndexSignature => (member.func())
            .and_then(Func::return_type)
            .is_some_and(|it| is_deeply_referencing_type(it.into(), super_var, visited)),
        _ => false,
    }
}

fn any_is_referencing<'a>(types: List<'a, TypeNode<'a>>, super_var: Symbol<'a>, visited: &mut Visited<'a>) -> bool {
    types.iter().any(|it| is_deeply_referencing_type(it.into(), super_var, visited))
}

/// The `Identifier` case of `isDeeplyReferencingType`, which compares names and not variables.
fn is_name_referencing<'a>(name: Name<'a>, super_var: Symbol<'a>, visited: &mut Visited<'a>) -> bool {
    if name == super_var.name() && super_var.references().next().is_some() {
        return true;
    }
    super_var.scope().resolve_name(name).is_some_and(|it| {
        it.declarations()
            .filter_map(Declaration::node)
            .any(|it| is_deeply_referencing_type(it, super_var, visited))
    })
}

/// typescript-eslint's `checkMembers`. `node`: the type literal, or the statement of `interface`.
/// `parent`: the interface or the type alias that must not refer to itself, and its name.
fn check_members<'a>(
    members: List<'a, Member<'a>>,
    node: Node<'a>,
    parent: Option<(Stmt<'a>, Ident<'a>)>,
    interface: Option<Interface<'a>>,
    is_safe_fix: bool,
    cx: &Cx<'a, ConsistentIndexedObjectStyle>,
) {
    let Some(member) = members.first() else {
        return;
    };
    if member.kind() != MemberKind::IndexSignature || members.len() != 1 {
        return;
    }
    let Some(func) = member.func() else {
        return;
    };
    let Some(parameter) = func.params_with_this().next() else {
        return;
    };
    if parameter.pat().tag() != PatTag::Ident
        || parameter.is_rest()
        || parameter.default().is_some()
        || parameter.is_parameter_property()
    {
        return;
    }
    let (Some(key), Some(value)) = (parameter.ty(), func.return_type()) else {
        return;
    };
    if let Some((declaration, name)) = parent
        && let Some(super_var) = Node::Stmt(declaration).scope().resolve_name(name.name())
        && is_deeply_referencing_type(node, super_var, &mut Visited::default())
    {
        return;
    }
    let at = utils::estree_span(node);
    let fix_or_suggest = if !is_safe_fix {
        FixOrSuggest::None
    } else if has_unpreserved_comments(cx.file(), at, [Some(key), Some(value)]) {
        FixOrSuggest::Suggest
    } else {
        FixOrSuggest::Fix
    };
    get_fix_or_suggest(cx.report(at, PREFER_RECORD), fix_or_suggest, PREFER_RECORD_SUGGESTION, |fixer| {
        let mut text = Vec::new();
        if let Some(interface) = interface {
            text.extend_from_slice(b"type ");
            text.extend_from_slice(interface.name().bytes());
            for (i, param) in interface.type_params().iter().enumerate() {
                text.extend_from_slice(if i == 0 { &b"<"[..] } else { &b", "[..] });
                text.extend_from_slice(param.text());
            }
            if !interface.type_params().is_empty() {
                text.push(b'>');
            }
            text.extend_from_slice(b" = ");
        }
        let is_readonly = member.flags().contains(Flags::READONLY);
        if is_readonly {
            text.extend_from_slice(b"Readonly<");
        }
        text.extend_from_slice(&[&b"Record<"[..], key.text(), b", ", value.text(), b">"].concat());
        if is_readonly {
            text.push(b'>');
        }
        if interface.is_some() {
            text.push(b';');
        }
        fixer.replace(at, text)
    });
}

impl ConsistentIndexedObjectStyle {
    fn check_type_reference<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, args } = ty.kind() else {
            return;
        };
        if !name.is("Record") {
            return;
        }
        let (Some(key), Some(value), None) = (args.get(0), args.get(1), args.get(2)) else {
            return;
        };
        if utils::estree_type_name(ty.into()) != "TSTypeReference" {
            return;
        }
        let should_fix = matches!(key.kind(), TypeKind::Keyword(Keyword::String | Keyword::Number | Keyword::Symbol));
        let fix_or_suggest = match should_fix && !has_unpreserved_comments(cx.file(), ty.span(), [Some(key), Some(value)]) {
            true => FixOrSuggest::Fix,
            false => FixOrSuggest::Suggest,
        };
        get_fix_or_suggest(
            cx.report(ty, PREFER_INDEX_SIGNATURE),
            fix_or_suggest,
            PREFER_INDEX_SIGNATURE_SUGGESTION,
            |fixer| fixer.replace(ty, [&b"{ [key: "[..], key.text(), b"]: ", value.text(), b" }"].concat()),
        );
    }

    fn check_mapped_type<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Mapped(mapped) = ty.kind() else {
            return;
        };
        let Some(constraint) = mapped.param().constraint() else {
            return;
        };
        // Modifiers are preserved by such a mapped type, and not by `Record`.
        if constraint.tag() == TypeTag::Keyof && !constraint.is_parenthesized() {
            return;
        }
        // The key is used to compute the value.
        if mapped.param().symbol().is_some_and(|key| key.references().any(Reference::is_type)) {
            return;
        }
        if let Some(alias) = find_parent_declaration(ty)
            && let Some(super_var) = Node::Type(ty).scope().resolve_name(alias.name().name())
        {
            let visited = &mut Visited::default();
            let is_circular = match ty.parent() {
                Node::Type(parent) => match parent.kind() {
                    // The parent is the list of type arguments.
                    TypeKind::Ref { args, .. } | TypeKind::Typeof { args, .. } | TypeKind::Import { args, .. } => {
                        any_is_referencing(args, super_var, visited)
                    }
                    _ => is_deeply_referencing_type(parent.into(), super_var, visited),
                },
                parent @ Node::Stmt(_) => is_deeply_referencing_type(parent, super_var, visited),
                _ => false,
            };
            if is_circular {
                return;
            }
        }
        // There is no `Mutable<T>`.
        let fix_or_suggest = if mapped.readonly() == MappedModifier::Remove {
            FixOrSuggest::None
        } else if has_unpreserved_comments(cx.file(), ty.span(), [Some(constraint), mapped.ty()]) {
            FixOrSuggest::Suggest
        } else {
            FixOrSuggest::Fix
        };
        get_fix_or_suggest(cx.report(ty, PREFER_RECORD), fix_or_suggest, PREFER_RECORD_SUGGESTION, |fixer| {
            let value = mapped.ty().map_or(&b"any"[..], TypeNode::text);
            let mut text = [&b"Record<"[..], constraint.text(), b", ", value, b">"].concat();
            let mut wrap = |name: &[u8]| text = [name, b"<", &text, b">"].concat();
            match mapped.optional() {
                MappedModifier::Add => wrap(b"Partial"),
                MappedModifier::Remove => wrap(b"Required"),
                MappedModifier::None => {}
            }
            if mapped.readonly() == MappedModifier::Add {
                wrap(b"Readonly");
            }
            fixer.replace(ty, text)
        });
    }
}

impl Rule for ConsistentIndexedObjectStyle {
    const META: Meta = Meta::typescript("consistent-indexed-object-style", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .presets(Presets::STYLISTIC);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentIndexedObjectStyle {
            prefers_record: options.str(0) != Some("index-signature"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.prefers_record {
            on.types([TypeTag::Ref], Self::check_type_reference);
            return;
        }
        on.stmts([StmtTag::Interface], |_, statement, cx| {
            if let StmtKind::Interface(interface) = statement.kind() {
                check_members(
                    interface.members(),
                    statement.into(),
                    Some((statement, interface.name())),
                    Some(interface),
                    interface.extends().is_empty() && !statement.is_default_export(),
                    cx,
                );
            }
        });
        on.types([TypeTag::Mapped], Self::check_mapped_type);
        on.types([TypeTag::Object], |_, ty, cx| {
            if let TypeKind::Object(members) = ty.kind()
                && members.first().is_some_and(|it| it.kind() == MemberKind::IndexSignature)
                && members.len() == 1
            {
                let parent = find_parent_declaration(ty).map(|alias| (alias.stmt(), alias.name()));
                check_members(members, ty.into(), parent, None, true, cx);
            }
        });
    }
}
