use crate::import_minimatch::Glob;
use bun_lint_oxlint::text::{file_name, glob_match};
use bun_core::fmt::parse_decimal;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// Forbid namespace (a.k.a. "wildcard" `*`) imports.
pub struct NoNamespace {
    /// Each as it is written, which is what oxlint reads, and as minimatch reads it.
    ignore: Vec<(Box<[u8]>, Glob)>,
}

const NO_NAMESPACE: Message = Message::new("", "Unexpected namespace import.");
const OXLINT: Message = Message::new("", "Usage of namespaced aka wildcard \"*\" imports prohibited");

/// How often a scope is asked for a name to make one fix. Upstream has no bound.
const MAX_LOOKUPS: usize = 1 << 20;

/// What every object of JavaScript has. Upstream keeps the names in one, and throws at these.
const OF_EVERY_OBJECT: [&[u8]; 12] = [
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
    b"__proto__",
    b"constructor",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
];

impl Rule for NoNamespace {
    const META: Meta = Meta::plugin(Plugin::Import, "no-namespace", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    no_state!();

    fn new(options: &Options) -> Self {
        let ignore = options.object(0).strings("ignore");
        let read = |it: &&str| (Box::<[u8]>::from(it.as_bytes()), Glob::matching_base(it.as_bytes()));
        NoNamespace { ignore: ignore.iter().map(read).collect() }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = stmt.kind() else {
            return;
        };
        let (Some(local), Some(node)) = (import.namespace(), import.namespace_span()) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint looks at the top level only.
        if is_oxlint && !matches!(stmt.parent(), Node::File(_)) {
            return;
        }
        if self.ignores(import.spec().bytes(), is_oxlint) {
            return;
        }
        // oxlint points at the name, and changes nothing.
        if is_oxlint {
            cx.report(local, OXLINT);
        } else {
            cx.report(node, NO_NAMESPACE).fix(|fixer| fix(fixer, stmt, local, node));
        }
    }
}

impl NoNamespace {
    fn ignores(&self, source: &[u8], is_oxlint: bool) -> bool {
        if !is_oxlint {
            // What `find` returns is tested, and an empty pattern is falsy.
            return self.ignore.iter().find(|it| it.1.matches(source)).is_some_and(|it| !it.0.is_empty());
        }
        // oxlint has another syntax of patterns.
        self.ignore.iter().any(|(pattern, _)| {
            let target = match strings::contains_char(pattern, b'/') {
                true => source,
                false => file_name(source),
            };
            glob_match(pattern, target)
        })
    }
}

/// A `MemberExpression` that is the parent of a reference to the namespace.
struct Member<'a> {
    /// What tells which scope it is in.
    node: Node<'a>,
    span: Span,
    /// upstream's `getMemberPropertyName`
    property: Cow<'a, [u8]>,
}

impl<'a> Member<'a> {
    /// `None`: what upstream's `usesNamespaceAsObject` looks for.
    fn around(reference: Reference<'a>) -> Option<Member<'a>> {
        if let Some(identifier) = reference.expr() {
            let Node::Expr(parent) = identifier.parent() else {
                return None;
            };
            let property = match parent.kind() {
                _ if !ast_utils::is_member_expression(parent) => return None,
                ExprKind::Dot { name, .. } if !parent.is_private_member() => Cow::Borrowed(name.bytes()),
                ExprKind::Index { index, .. } => match index.as_ident() {
                    Some(name) => Cow::Borrowed(name.bytes()),
                    None if ast_utils::is_literal(index) => ast_utils::get_static_string_value(index)?,
                    None => return None,
                },
                _ => return None,
            };
            return Some(Member { node: parent.into(), span: parent.span(), property });
        }
        // What an interface extends and what a class implements is an expression for ESLint.
        let Node::Type(ty) = reference.node() else {
            return None;
        };
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return None;
        };
        let (object, property) = (name.get(0)?, name.get(1)?);
        (utils::estree_type_name(ty.into()) != "TSTypeReference").then(|| Member {
            node: ty.into(),
            span: object.span().to(property.span()),
            property: Cow::Borrowed(property.bytes()),
        })
    }
}

/// Whether `scope.variables` of ESLint has one that is called `name`.
fn has_variable<'a>(file: &'a File<'a>, scope: Scope<'a>, name: &[u8]) -> bool {
    scope.get_bytes(name).is_some()
        || match (scope.kind(), scope.node()) {
            (ScopeKind::Global, _) => file.global(name).is_some(),
            // The name of a class declaration is declared in the class once more.
            (ScopeKind::Class, Node::Class(class)) => class.name().is_some_and(|it| it.bytes() == name),
            _ => false,
        }
}

/// One name of upstream's `generateLocalNames`. `has`: `nameConflicts[name].has(..)`
fn generate_local_name(
    name: &[u8],
    has: &mut dyn FnMut(&[u8]) -> Option<bool>,
    namespace_name: &[u8],
) -> Option<Vec<u8>> {
    if !has(name)? {
        return Some(name.to_vec());
    }
    let prefixed = [namespace_name, b"_", name].concat();
    let (mut local_name, mut i) = (prefixed.clone(), 0u32);
    while has(&local_name)? {
        i += 1;
        local_name = [&prefixed[..], b"_", i.to_string().as_bytes()].concat();
    }
    Some(local_name)
}

/// Each `namespace.x` becomes a named import. `None`: the namespace is used otherwise or not at all, or upstream
/// throws.
#[cold]
#[inline(never)]
fn fix<'a>(fixer: Fixer<'a>, declaration: Stmt<'a>, local: Ident<'a>, node: Span) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let namespace_variable = Node::Stmt(declaration).scope().get_name(local.name())?;
    if namespace_variable.declarations().next().and_then(Declaration::name_span) != Some(local.span()) {
        return None;
    }
    let members: Vec<Member<'a>> = namespace_variable.references().map(Member::around).collect::<Option<_>>()?;

    // `importNameConflicts`. In place of the names the scopes that have them: that of a member, and `scope.upper`.
    let mut import_name_conflicts: FxHashMap<&[u8], Vec<(Scope<'a>, Scope<'a>)>> = FxHashMap::default();
    let mut import_names: Vec<&[u8]> = Vec::new();
    for member in &members {
        let import_name = &*member.property;
        if OF_EVERY_OBJECT.contains(&import_name) {
            return None;
        }
        let scope = member.node.scope();
        let local_conflicts = (scope, scope.parent()?);
        let conflicts = import_name_conflicts.entry(import_name).or_insert_with(|| {
            import_names.push(import_name);
            Vec::new()
        });
        if conflicts.last() != Some(&local_conflicts) {
            conflicts.push(local_conflicts);
        }
    }
    // `Object.keys` has the names that are indices of an array first, by their value.
    let place = |it: &&[u8]| {
        let is_canonical = |index: &u32| *index != u32::MAX && index.to_string().as_bytes() == *it;
        parse_decimal::<u32>(it).filter(is_canonical).map_or((true, 0), |index| (false, index))
    };
    utils::sort::sort_by_cached_key(&mut import_names, place);

    let mut lookups = MAX_LOOKUPS;
    let mut import_local_names: FxHashMap<&[u8], Vec<u8>> = FxHashMap::default();
    let mut named_import_specifiers = Vec::new();
    for import_name in import_names {
        let conflicts = import_name_conflicts.get(import_name)?;
        let mut has = |name: &[u8]| {
            lookups = lookups.checked_sub(conflicts.len())?;
            Some(conflicts.iter().any(|it| has_variable(file, it.0, name) || has_variable(file, it.1, name)))
        };
        let local_name = generate_local_name(import_name, &mut has, local.bytes())?;
        named_import_specifiers.push(match local_name == import_name {
            true => import_name.to_vec(),
            false => [import_name, b" as ", &local_name[..]].concat(),
        });
        import_local_names.insert(import_name, local_name);
    }
    if named_import_specifiers.is_empty() {
        return None;
    }

    let mut fixes = Vec::with_capacity(members.len() + 1);
    let named_import_specifiers = named_import_specifiers.join(&b", "[..]);
    fixes.push(fixer.replace(node, [b"{ ", &named_import_specifiers[..], b" }"].concat()));
    for member in &members {
        fixes.push(fixer.replace(member.span, import_local_names.get(&*member.property)?.as_slice()));
    }
    Some(fixes)
}
