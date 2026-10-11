use bun_lint::prelude::*;
use smallvec::SmallVec;

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
    /// `type a as a`
    is_type_only: bool,
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
        let Renamed { node, replacement, name, kind, is_fixable, is_type_only } = renamed;
        // Of an import and an export, oxlint points at the local name.
        let place = if cx.language().is_oxlint && kind != "Destructuring assignment" { replacement } else { node };
        cx.report(place, UNNECESSARILY_RENAMED).data("name", name).data("type", kind).fix(|fixer| {
            let file = fixer.file();
            // oxlint does not look for comments, and keeps the `type`.
            if file.language().is_oxlint && is_fixable {
                let modifier: &[u8] = if is_type_only { b"type " } else { b"" };
                return Some(fixer.replace(node, [modifier, file.slice(replacement)].concat()));
            }
            if !is_fixable || file.comments_in(node).len() > file.comments_in(replacement).len() {
                return None;
            }
            Some(fixer.replace(node, file.slice(replacement)))
        });
    }

    /// A `Property` of an `ObjectPattern` that is assigned to.
    fn check_property<'a>(prop: Prop<'a>, cx: &Cx<'a, Self>) {
        if prop.kind() != PropKind::Init || prop.is_jsx_attribute() {
            return;
        }
        let Some(value) = prop.value() else {
            return;
        };
        let (left, has_default) = match value.as_assign() {
            Some((None, target, _)) => (target, true),
            _ => (value, false),
        };
        let Some(local) = left.as_ident() else {
            return;
        };
        let Some(name) = prop.key().and_then(name_of_key).filter(|&name| name == local) else {
            return;
        };
        Self::report(cx, Renamed {
            node: prop.span(),
            replacement: value.span(),
            name,
            kind: "Destructuring assignment",
            is_fixable: !(has_default && left.is_parenthesized()),
            is_type_only: false,
        });
    }

    /// `target`: what an assignment, a `for`-`in` or a `for`-`of` assigns to. The way down of [`Expr::is_assignment_target`].
    fn check_target<'a>(target: Expr<'a>, cx: &Cx<'a, Self>) {
        if !matches!(target.tag(), ExprTag::Object | ExprTag::Array | ExprTag::Spread) {
            return;
        }
        let mut pending: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
        pending.push(target);
        while let Some(e) = pending.pop() {
            if e.is_parenthesized() {
                continue;
            }
            if let Some(props) = e.as_object() {
                for prop in props {
                    Self::check_property(prop, cx);
                    pending.extend(prop.value());
                }
            } else if let Some(elements) = e.as_array() {
                pending.extend(elements);
            } else if e.tag() == ExprTag::Spread {
                pending.extend(e.operand());
            }
        }
    }
}

impl Rule for NoUselessRename {
    const META: Meta = Meta::eslint("no-useless-rename", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new()
        .pats(&[PatTag::Object])
        .exprs(&[ExprTag::Assign])
        .stmts(&[StmtTag::ForIn, StmtTag::ForOf])
        .import_specs()
        .export_specs();
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoUselessRename {
            ignore_destructuring: object.bool_or("ignoreDestructuring", false),
            ignore_import: object.bool_or("ignoreImport", false),
            ignore_export: object.bool_or("ignoreExport", false),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if !self.ignore_destructuring {
            on = on.pats(&[PatTag::Object]).exprs(&[ExprTag::Assign]).stmts(&[StmtTag::ForIn, StmtTag::ForOf]);
        }
        if !self.ignore_import {
            on = on.import_specs();
        }
        if !self.ignore_export {
            on = on.export_specs();
        }
        on
    }

    /// An `ObjectPattern` in a declaration or a parameter.
    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
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
                    is_type_only: false,
                });
            }
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(target) = e.left() {
            Self::check_target(target, cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } = statement.kind()
            && let Some(head) = left.as_expr()
        {
            Self::check_target(head, cx);
        }
    }

    fn import_spec<'a>(&self, spec: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.is_renamed() && spec.imported().name() == spec.local().name() {
            Self::report(cx, Renamed {
                node: spec.span(),
                replacement: spec.local().span(),
                name: spec.imported().name(),
                kind: "Import",
                is_fixable: true,
                is_type_only: spec.is_type_only(),
            });
        }
    }

    fn export_spec<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.is_renamed() && spec.local().name() == spec.exported().name() {
            Self::report(cx, Renamed {
                node: spec.span(),
                replacement: spec.local().span(),
                name: spec.local().name(),
                kind: "Export",
                is_fixable: true,
                is_type_only: spec.is_type_only(),
            });
        }
    }
}
