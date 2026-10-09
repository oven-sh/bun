use bun_lint::prelude::*;

/// Disallow renaming import, export, and destructured assignments to the same name.
pub struct NoUselessRename {
    ignore_destructuring: bool,
    ignore_import: bool,
    ignore_export: bool,
}

const UNNECESSARILY_RENAMED: Message =
    Message::new("unnecessarilyRenamed", "{{type}} {{name}} unnecessarily renamed.");

/// What is reported: the node, and the part of it that is left after the fix.
#[derive(Copy, Clone)]
struct Renamed<'a> {
    node: Span,
    replacement: Span,
    name: Name<'a>,
    kind: &'static str,
    is_fixable: bool,
}

/// The name that a key which is not computed has as a string.
fn name_of_key(key: Key<'_>) -> Option<Name<'_>> {
    match key.kind() {
        KeyKind::Ident(name) | KeyKind::String(name) => Some(name),
        _ => None,
    }
}

impl NoUselessRename {
    fn report<'a>(cx: &Cx<'a, Self>, renamed: Renamed<'a>) {
        let Renamed { node, replacement, name, kind, is_fixable } = renamed;
        // Of an import and an export, oxlint points at the local name.
        let place = if cx.language().is_oxlint && kind != "Destructuring assignment" { replacement } else { node };
        cx.report(place, UNNECESSARILY_RENAMED).data("name", name).data("type", kind).fix(|fixer| {
            let file = fixer.file();
            if !is_fixable || file.comments_in(node).len() > file.comments_in(replacement).len() {
                return None;
            }
            Some(fixer.replace(node, file.slice(replacement)))
        });
    }

    /// An `ObjectPattern` in a declaration or a parameter.
    fn check_pattern<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(props) = pat.kind() else {
            return;
        };
        for prop in props {
            if prop.is_shorthand() {
                continue;
            }
            let Some(name) = prop.key().and_then(name_of_key) else {
                continue;
            };
            if prop.value().as_ident() == Some(name) {
                Self::report(cx, Renamed {
                    node: prop.span(),
                    replacement: Span::new(prop.value().span().start, prop.span().end),
                    name,
                    kind: "Destructuring assignment",
                    is_fixable: true,
                });
            }
        }
    }

    /// A `Property` of an `ObjectPattern` that is assigned to.
    fn check_property<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() != PropKind::Init || prop.is_jsx_attribute() {
            return;
        }
        let Some(value) = prop.value() else {
            return;
        };
        let (left, has_default) = match value.kind() {
            ExprKind::Assign { op: None, target, .. } => (target, true),
            _ => (value, false),
        };
        let Some(local) = left.as_ident() else {
            return;
        };
        let Some(name) = prop.key().and_then(name_of_key).filter(|&name| name == local) else {
            return;
        };
        let Node::Expr(object) = prop.parent() else {
            return;
        };
        if utils::is_assignment_target(object) {
            Self::report(cx, Renamed {
                node: prop.span(),
                replacement: value.span(),
                name,
                kind: "Destructuring assignment",
                is_fixable: !(has_default && left.is_parenthesized()),
            });
        }
    }

    fn check_import<'a>(&self, spec: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.is_renamed() && spec.imported().name() == spec.local().name() {
            Self::report(cx, Renamed {
                node: spec.span(),
                replacement: spec.local().span(),
                name: spec.imported().name(),
                kind: "Import",
                is_fixable: true,
            });
        }
    }

    fn check_export<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.is_renamed() && spec.local().name() == spec.exported().name() {
            Self::report(cx, Renamed {
                node: spec.span(),
                replacement: spec.local().span(),
                name: spec.local().name(),
                kind: "Export",
                is_fixable: true,
            });
        }
    }
}

impl Rule for NoUselessRename {
    const META: Meta = Meta::eslint("no-useless-rename", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoUselessRename {
            ignore_destructuring: object.bool_or("ignoreDestructuring", false),
            ignore_import: object.bool_or("ignoreImport", false),
            ignore_export: object.bool_or("ignoreExport", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.ignore_destructuring {
            on.pats([PatTag::Object], Self::check_pattern);
            on.props(Self::check_property);
        }
        if !self.ignore_import {
            on.import_specs(Self::check_import);
        }
        if !self.ignore_export {
            on.export_specs(Self::check_export);
        }
    }
}
