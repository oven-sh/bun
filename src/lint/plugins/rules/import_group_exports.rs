use bun_lint_oxlint::ast_util::{is_specific_id, static_property_name};
use bun_lint_oxlint::import::{
    AssignmentTargets, export_declaration_span, is_assignment_target, is_export_declaration, is_type_export_declaration,
    module_items,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Prefer named exports to be grouped together in a single export declaration
pub struct GroupExports;

const ES_MODULE: Message = Message::new(
    "",
    "Multiple named export declarations; consolidate all named exports into a single export declaration",
);
const COMMONJS: Message = Message::new(
    "",
    "Multiple CommonJS exports; consolidate all exports into a single assignment to `module.exports`",
);

type Spans = SmallVec<[Span; 4]>;

#[derive(Default)]
pub struct State<'a> {
    commonjs_exports: Spans,
    assignment_targets: AssignmentTargets<'a>,
}

impl Rule for GroupExports {
    const META: Meta = Meta::plugin(Plugin::Import, "group-exports", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Assign]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        GroupExports
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions_any(&["exports", "#exports"]) {
            on = on.exprs(&[ExprTag::Assign]);
        }
        on.finish()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_export = if cx.language().is_oxlint { is_commonjs_export } else { has_exporting_accessor_chain };
        if e.left().is_some_and(is_export) && !is_assignment_target(e, &mut cx.state.assignment_targets) {
            cx.state.commonjs_exports.push(e.span());
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        // Of values, of types.
        let mut nodes: [Spans; 2] = [Spans::new(), Spans::new()];
        let mut source_records: [FxHashMap<Name<'a>, Spans>; 2] = [FxHashMap::default(), FxHashMap::default()];
        let is_oxlint = cx.language().is_oxlint;
        for stmt in module_items(cx.file()) {
            match stmt.kind() {
                StmtKind::ExportNamed(export) => {
                    let kind = usize::from(export.is_type_only());
                    match export.spec().filter(|_| export.has_from()) {
                        // The original keeps them by name in an object, of which that is no key. oxlint has a map.
                        Some(source) if !is_oxlint && source.is("__proto__") => {}
                        Some(source) => source_records[kind].entry(source).or_default().push(stmt.span()),
                        None => nodes[kind].push(stmt.span()),
                    }
                }
                _ if is_export_declaration(stmt) => {
                    nodes[usize::from(is_type_export_declaration(stmt))].push(export_declaration_span(stmt));
                }
                _ => {}
            }
        }
        let groups = nodes.iter().chain(source_records.iter().flat_map(|it| it.values()));
        for span in groups.filter(|it| it.len() > 1).flatten() {
            cx.report(*span, ES_MODULE);
        }
        if cx.state.commonjs_exports.len() > 1 {
            for span in &cx.state.commonjs_exports {
                cx.report(*span, COMMONJS);
            }
        }
    }
}

/// Whether upstream's `accessorChain` is `exports.a`, `module.exports` or `module.exports.a`. A name in brackets is as
/// one after a dot, and the chain begins after what is neither a member nor a name: `f().exports[a]`.
fn has_exporting_accessor_chain(left: Expr) -> bool {
    // From the last to the first. `None`: what is in the brackets is no name.
    let mut chain: SmallVec<[Option<&[u8]>; 5]> = SmallVec::new();
    let mut node = left;
    while chain.len() <= 3 && let Some(object) = node.object() {
        chain.push(match node.index() {
            Some(index) => index.as_ident().map(Name::bytes),
            None => node.member_name().map(|it| it.bytes().strip_prefix(b"#").unwrap_or_else(|| it.bytes())),
        });
        if let Some(name) = object.as_ident() {
            chain.push(Some(name.bytes()));
            break;
        }
        if object.is_chain_root() {
            break;
        }
        node = object;
    }
    matches!(
        chain[..],
        [_, Some(b"exports")] | [Some(b"exports"), Some(b"module")] | [_, Some(b"exports"), Some(b"module")]
    )
}

/// oxlint's: `exports.a`, `module.exports`, `module.exports.a`
fn is_commonjs_export(left: Expr) -> bool {
    let Some(object) = left.object() else {
        return false;
    };
    is_specific_id(object, "exports")
        || check_module_export(left)
        || !object.is_parenthesized() && !object.is_chain_root() && check_module_export(object)
}

fn check_module_export(member: Expr) -> bool {
    static_property_name(member).is_some_and(|it| it.is("exports")) && member.object().is_some_and(|it| is_specific_id(it, "module"))
}
