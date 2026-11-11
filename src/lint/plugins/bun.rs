//! Helpers shared by the `bun` plugin's rules.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::{Mode, ReferenceKind, ReferenceTracker, Trace, TraceMap};
use bun_lint_oxlint::ast_util::is_global_reference;

/// True for `(function () {})()`, `new (function () {})()` and `(function () {}).call(this)`, where the body runs
/// immediately. A generator's body doesn't.
fn is_called_immediately(func: Func) -> bool {
    let Node::Expr(e) = func.owner() else {
        return false;
    };
    let Node::Expr(parent) = e.parent() else {
        return false;
    };
    let is_called_through_method = || {
        parent.object() == Some(e)
            && ast_utils::is_member_access_of_any(parent, &["call", "apply"])
            && ast_utils::is_callee(parent)
    };
    !func.is_generator() && (parent.callee() == Some(e) || is_called_through_method())
}

/// The memo for [`runs_while_module_is_evaluated`]. A rule that calls it keeps one in its state.
pub(crate) type RunsLater<'a> = AncestorMemo<'a, ()>;

/// True if `node` runs while the module is evaluated. That means it isn't inside a function that's called later, or
/// inside an instance field's initializer.
pub(crate) fn runs_while_module_is_evaluated<'a>(
    node: Node<'a>,
    known: &mut RunsLater<'a>,
) -> bool {
    let runs_later = known.find(node, |child, parent| {
        let is_later = match parent {
            Node::Func(func) => func.kind() != FnKind::StaticBlock && !is_called_immediately(func),
            Node::Member(member) => {
                !member.is_static() && member.init().map(Node::Expr) == Some(child)
            }
            _ => false,
        };
        is_later.then_some(())
    });
    runs_later.is_none()
}

/// The strings in the option `key` of the first options object, or `default` if the key is missing.
pub(crate) fn list_option(options: &Options, key: &str, default: &[&str]) -> Box<[Box<[u8]>]> {
    let config = options.object(0);
    let configured = config.strings(key);
    let names = if config.has(key) {
        &configured[..]
    } else {
        default
    };
    names.iter().map(|it| it.as_bytes().into()).collect()
}

pub(crate) fn is_listed(list: &[Box<[u8]>], name: &[u8]) -> bool {
    list.iter().any(|it| **it == *name)
}

/// The static prefix of a string or a template, and true if that's the whole value.
pub(crate) fn static_prefix(e: Expr<'_>) -> Option<(&[u8], bool)> {
    match e.kind() {
        ExprKind::String(value) => Some((value.bytes(), true)),
        ExprKind::Template(template) => {
            Some((template.cooked(0)?.bytes(), template.exprs().is_empty()))
        }
        _ => None,
    }
}

/// The root of a chain of calls and member accesses: the `z` in `z.object({}).strict()`.
pub(crate) fn chain_start(mut e: Expr<'_>) -> Expr<'_> {
    loop {
        e = match e.kind() {
            ExprKind::Call(call) => call.callee(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::NonNull(operand) => operand,
            _ => return e,
        };
    }
}

/// `{ [CALL]: true }`
pub(crate) const CALLED: TraceMap<'static, ()> = TraceMap::EMPTY.call(());

/// A trace map that maps each of `names` to `then`.
pub(crate) struct Each<'m> {
    pub(crate) names: &'m [&'m str],
    pub(crate) then: &'m dyn Trace<'m>,
}

impl<'m> Trace<'m> for Each<'m> {
    fn info(&self, _: ReferenceKind) -> Option<u16> {
        None
    }

    fn member(&self, index: usize) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        Some((*self.names.get(index)?, self.then))
    }

    fn get(&self, name: &[u8]) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        self.names
            .iter()
            .find(|it| it.as_bytes() == name)
            .map(|it| (*it, self.then))
    }
}

/// The calls that match the trace map `modules`, whether the module is imported or required. Each comes with the last
/// name on its path.
pub(crate) fn module_calls<'a, 'm>(
    file: &'a File<'a>,
    modules: &'m dyn Trace<'m>,
) -> Vec<(Expr<'a>, &'m str)> {
    let tracker = ReferenceTracker::new(file).with_mode(Mode::Legacy);
    let found = tracker
        .iterate_esm_references(modules)
        .into_iter()
        .chain(tracker.iterate_cjs_references(modules));
    found
        .filter(|it| it.kind == ReferenceKind::Call)
        .filter_map(|it| Some((it.expr()?, *it.path.last()?)))
        .collect()
}

/// The `Bun.name()` calls where `name` is one of `names`, each with that name.
pub(crate) fn bun_calls<'a>(
    file: &'a File<'a>,
    names: &'static [&'static str],
) -> Vec<(Expr<'a>, &'static str)> {
    if !file.mentions("Bun") {
        return Vec::new();
    }
    let name_of = |e: Expr<'a>| match e.callee()?.kind() {
        ExprKind::Dot { obj, name, .. } if obj.is_ident("Bun") && is_global_reference(obj) => {
            names.iter().find(|it| name.name().is(it)).copied()
        }
        _ => None,
    };
    file.exprs_of_kind(ExprTag::Call)
        .filter_map(|e| Some((e, name_of(e)?)))
        .collect()
}

/// How a process is started.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Starter {
    /// `exec()`, `execSync()`: a shell reads the command.
    Shell,
    /// `spawn()`, `spawnSync()`, `execFile()`, `execFileSync()`: the command is a file.
    File,
    /// `Bun.spawn()`, `Bun.spawnSync()`: the command and its arguments are one array, which can be in the options.
    Bun,
}

const CHILD_PROCESS: Each<'static> = Each {
    names: &["node:child_process", "child_process"],
    then: &Each {
        names: &[
            "exec",
            "execSync",
            "spawn",
            "spawnSync",
            "execFile",
            "execFileSync",
        ],
        then: &CALLED,
    },
};

/// A cheap check that's false if [`launches`] can't find anything.
pub(crate) fn can_launch(file: &File) -> bool {
    file.mentions("Bun") || CHILD_PROCESS.names.iter().any(|it| file.mentions(it))
}

/// The calls that start a process: those of `node:child_process`, `Bun.spawn()` and `Bun.spawnSync()`.
pub(crate) fn launches<'a>(file: &'a File<'a>) -> Vec<(Call<'a>, Starter)> {
    let node_calls = match CHILD_PROCESS.names.iter().any(|it| file.mentions(it)) {
        true => module_calls(file, &CHILD_PROCESS),
        false => Vec::new(),
    };
    let node_calls = node_calls.into_iter().map(|(e, name)| match name {
        "exec" | "execSync" => (e, Starter::Shell),
        _ => (e, Starter::File),
    });
    let bun_spawn_calls = bun_calls(file, &["spawn", "spawnSync"])
        .into_iter()
        .map(|(e, _)| (e, Starter::Bun));
    node_calls
        .chain(bun_spawn_calls)
        .filter_map(|(e, starter)| Some((e.as_call()?, starter)))
        .collect()
}

/// The options that a process is started with.
pub(crate) enum LaunchOptions<'a> {
    None,
    /// An object literal in which nothing is spread.
    Literal(List<'a, Prop<'a>>),
    /// The options can't be determined from the call.
    Unknown,
}

impl<'a> LaunchOptions<'a> {
    pub(crate) fn of(call: Call<'a>, starter: Starter) -> Self {
        // After the command, an argument list can come before the options and a callback after them.
        let is_list = call
            .args()
            .first()
            .is_some_and(|it| it.tag() == ExprTag::Array);
        let starts_with_options = starter == Starter::Bun && !is_list;
        for argument in call.args().iter().skip(usize::from(!starts_with_options)) {
            match argument.kind() {
                ExprKind::Array(_) | ExprKind::Fn(_) => {}
                ExprKind::Object(properties)
                    if properties.iter().all(|it| it.kind() != PropKind::Spread) =>
                {
                    return LaunchOptions::Literal(properties);
                }
                _ => return LaunchOptions::Unknown,
            }
        }
        LaunchOptions::None
    }

    fn property(&self, name: &str) -> Option<Prop<'a>> {
        match self {
            LaunchOptions::Literal(properties) => properties
                .iter()
                .find(|it| it.key().is_some_and(|key| key.is(name))),
            _ => None,
        }
    }

    pub(crate) fn has(&self, name: &str) -> bool {
        self.property(name).is_some()
    }

    /// The value of the option `name`.
    pub(crate) fn get(&self, name: &str) -> Option<Expr<'a>> {
        self.property(name)?.value()
    }

    /// True if the process inherits one of its parent's streams.
    pub(crate) fn inherits_a_stream(&self) -> bool {
        let is_inherit = |e: Expr| e.as_string().is_some_and(|it| it.is("inherit"));
        let mut streams = ["stdio", "stdin", "stdout", "stderr"]
            .into_iter()
            .filter_map(|it| self.get(it));
        streams.any(|value| match value.kind() {
            ExprKind::Array(each) => each.iter().any(is_inherit),
            _ => is_inherit(value),
        })
    }
}

/// Modules, each with a list of export names. An empty list means the module itself.
pub(crate) type Exports = Box<[(Box<str>, Box<[Box<str>]>)]>;

/// The option `key` of the first options object: `[{ "module": "m", "names": ["a"] }]`.
pub(crate) fn exports_option(options: &Options, key: &str) -> Exports {
    let listed = options.object(0).array(key).iter().filter_map(|it| {
        let entry = Object::of(Some(it));
        let names = entry.strings("names").into_iter().map(Box::from);
        Some((Box::from(entry.str("module")?), names.collect()))
    });
    listed.collect()
}

/// Calls `each` with every call that matches `then` on one of `exports`, in the form [`module_calls`] returns.
pub(crate) fn for_each_export_call<'a>(
    file: &'a File<'a>,
    exports: &Exports,
    then: TraceMap<'_, ()>,
    each: &mut dyn FnMut(Expr<'a>, &str),
) {
    for (module, names) in exports.iter().filter(|it| file.mentions(&it.0)) {
        let members: Vec<_> = names.iter().map(|it| (&**it, then)).collect();
        let exported = match members.is_empty() {
            true => then,
            false => TraceMap::new(&members),
        };
        let modules = [(&**module, exported)];
        for (e, name) in module_calls(file, &TraceMap::new(&modules)) {
            each(e, name);
        }
    }
}

/// True if `path` ends with `end`, and `end` starts at a path component: `src/a.ts` ends with `a.ts` but not with
/// `.ts`.
pub(crate) fn is_end_of_path(path: &[u8], end: &[u8]) -> bool {
    let before = path.strip_suffix(end);
    before.is_some_and(|it| matches!(it.last(), None | Some(b'/' | b'\\')))
}
