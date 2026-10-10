use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_static_property_name;
use bun_lint::utils::estree_type_name;
use rustc_hash::FxHashMap;

/// Disallow specified global variables.
pub struct NoRestrictedGlobals {
    /// The custom message of each restricted name.
    restricted: FxHashMap<Box<[u8]>, Option<Box<[u8]>>>,
    checks_global_object: bool,
    global_objects: Vec<Box<[u8]>>,
}

const DEFAULT_MESSAGE: Message = Message::new("defaultMessage", "Unexpected use of '{{name}}'.");
const CUSTOM_MESSAGE: Message = Message::new(
    "customMessage",
    "Unexpected use of '{{name}}'. {{customMessage}}",
);

/// Whether `e` is the operand of a `typeof` type, or the start of it. ESLint has a `TSTypeQuery` or
/// a `TSQualifiedName` around it.
fn is_in_type_query(e: Expr<'_>) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == at) => {
                at = parent;
            }
            Node::Type(ty) => return matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return false,
        }
    }
}

/// `node.type === "MemberExpression"`
// TODO(api): replace by utils::ast_utils::is_member_expression, once it leaves out JSX and types
fn is_member_expression(e: Expr<'_>) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index) && !e.is_jsx_tag_name() && !is_in_type_query(e)
}

/// Whether the parent of the identifier is a `TSTypeReference`, a `TSInterfaceHeritage`, a
/// `TSClassImplements`, a `TSTypeQuery` or a `TSQualifiedName`.
fn is_in_type_context(reference: Reference<'_>, is_oxlint: bool) -> bool {
    // For oxc the operand of a `typeof` type is a value, and what `export default` exports can be a type.
    if is_oxlint {
        let is_exported = |it: &Expr| matches!(it.parent(), Node::Stmt(it) if it.tag() == StmtTag::ExportDefault);
        return match reference.expr().filter(is_exported) {
            Some(exported) => !exported.is_parenthesized(),
            None => reference.is_type(),
        };
    }
    match reference.node() {
        Node::Expr(e) => is_in_type_query(e),
        Node::Type(ty) => match ty.kind() {
            // The `a.b` of `extends a.b` and `implements a.b` is a `MemberExpression`.
            TypeKind::Ref { name, .. } => {
                name.len() == 1 || estree_type_name(Node::Type(ty)) == "TSTypeReference"
            }
            TypeKind::Predicate { .. } => false,
            _ => true,
        },
        Node::Stmt(statement) => matches!(statement.kind(), StmtKind::ImportEquals(import)
            if matches!(import.target(), ImportEqualsTarget::Entity(name) if name.len() > 1)),
        _ => false,
    }
}

impl NoRestrictedGlobals {
    fn report<'a>(
        cx: &Cx<'a, Self>,
        at: Span,
        name: impl IntoText<'a>,
        custom_message: Option<&[u8]>,
    ) {
        match custom_message {
            Some(message) => cx
                .report(at, CUSTOM_MESSAGE)
                .data("name", name)
                .data("customMessage", message.to_vec()),
            None => cx.report(at, DEFAULT_MESSAGE).data("name", name),
        };
    }

    /// Reports `window.name`, given the reference `window`.
    fn check_property_of_global_object<'a>(&self, reference: Reference<'a>, cx: &Cx<'a, Self>) {
        let Some(object) = reference.expr() else {
            return;
        };
        let mut parent = object.parent();
        // `window.window.name`
        let (access, name) = loop {
            let Node::Expr(access) = parent else {
                return;
            };
            if !is_member_expression(access) {
                return;
            }
            let Some(name) = get_static_property_name(access) else {
                return;
            };
            // oxlint goes no further than the first property.
            if *name != *reference.name().bytes() || cx.language().is_oxlint {
                break (access, name);
            }
            parent = access.parent();
        };
        let Some(custom_message) = self.restricted.get(&*name) else {
            return;
        };
        let property = match access.kind() {
            ExprKind::Dot { name, .. } => name.span(),
            ExprKind::Index { index, .. } => index.span(),
            _ => return,
        };
        Self::report(cx, property, name, custom_message.as_deref());
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for reference in file.unresolved_references() {
            let name = reference.name();
            if let Some(custom_message) = self.restricted.get(name.bytes())
                && !is_in_type_context(reference, file.language().is_oxlint)
            {
                Self::report(cx, reference.span(), name, custom_message.as_deref());
            }
            if self.checks_global_object
                && self.global_objects.iter().any(|it| **it == *name.bytes())
                // For oxlint nothing has to define it.
                && (file.language().is_oxlint || file.global(name.bytes()).is_some_and(|it| it.accepts(false)))
            {
                self.check_property_of_global_object(reference, cx);
            }
        }
        if !self.checks_global_object {
            return;
        }
        // What a script declares at its top level is a variable of the global scope too.
        for name in &self.global_objects {
            let Some(symbol) = file.scope().get_bytes(name) else {
                continue;
            };
            for reference in symbol.references() {
                self.check_property_of_global_object(reference, cx);
            }
        }
    }
}

impl Rule for NoRestrictedGlobals {
    const META: Meta = Meta::eslint("no-restricted-globals", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let is_globals_object = object.has("globals");
        let globals = if is_globals_object { object.array("globals") } else { options.all() };
        let mut restricted = FxHashMap::default();
        for global in globals {
            match global.as_str() {
                Some(name) => {
                    restricted.insert(Box::from(name), None);
                }
                None => {
                    if let Some(name) = global.get(b"name").and_then(Json::as_str) {
                        let message = global.get(b"message").and_then(Json::as_str);
                        restricted.insert(
                            Box::from(name),
                            message.filter(|it| !it.is_empty()).map(Box::from),
                        );
                    }
                }
            }
        }
        let mut global_objects: Vec<Box<[u8]>> =
            vec![Box::from(&b"globalThis"[..]), Box::from(&b"self"[..]), Box::from(&b"window"[..])];
        if is_globals_object {
            for name in object.array("globalObjects").iter().filter_map(Json::as_str) {
                if !global_objects.iter().any(|it| **it == *name) {
                    global_objects.push(Box::from(name));
                }
            }
        }
        NoRestrictedGlobals {
            restricted,
            checks_global_object: is_globals_object && object.bool_or("checkGlobalObject", false),
            global_objects,
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        (!self.restricted.is_empty()).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check(cx);
    }
}
