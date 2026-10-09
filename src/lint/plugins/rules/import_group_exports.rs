use bun_lint_oxlint::ast_util::{is_specific_id, static_property_name};
use bun_lint_oxlint::import::{
    AssignmentTargets, export_declaration_span, is_assignment_target, is_export_declaration, is_type_export_declaration,
    module_items,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Reports when named exports are not grouped together in a single export declaration.
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
    const META: Meta = Meta::oxlint(Plugin::Import, "group-exports", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        GroupExports
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.mentions("exports") {
            on.exprs([ExprTag::Assign], |_, e, cx| {
                if e.left().is_some_and(is_commonjs_export) && !is_assignment_target(e, &mut cx.state.assignment_targets) {
                    cx.state.commonjs_exports.push(e.span());
                }
            });
        }
        on.finish(check);
        State::default()
    }
}

/// `exports.a`, `module.exports`, `module.exports.a`
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

fn check<'a>(_: &GroupExports, cx: &mut Cx<'a, GroupExports>) {
    // Of values, of types.
    let mut nodes: [Spans; 2] = [Spans::new(), Spans::new()];
    let mut source_records: [FxHashMap<Name<'a>, Spans>; 2] = [FxHashMap::default(), FxHashMap::default()];
    for stmt in module_items(cx.file()) {
        match stmt.kind() {
            StmtKind::ExportNamed(export) => {
                let kind = usize::from(export.is_type_only());
                match export.spec().filter(|_| export.has_from()) {
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
