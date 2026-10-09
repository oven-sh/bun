//! What the rules of `bun` share.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::{Mode, ReferenceKind, ReferenceTracker, Trace, TraceMap};
use bun_lint_oxlint::ast_util::is_global_reference;

/// `(function () {})()`, `new (function () {})()`, `(function () {}).call(this)`: the body runs where it is written.
/// That of a generator does not.
fn is_called_at_once(func: Func) -> bool {
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

/// What is known about which nodes run later than the module is evaluated: the state of a rule that asks.
pub(crate) type RunsLater<'a> = AncestorMemo<'a, ()>;

/// Whether `node` runs while the module is evaluated: no function around it is called later, and it is not in what a
/// field of an instance starts with.
pub(crate) fn runs_while_module_is_evaluated<'a>(
    node: Node<'a>,
    known: &mut RunsLater<'a>,
) -> bool {
    let runs_later = known.find(node, |child, parent| {
        let is_later = match parent {
            Node::Func(func) => func.kind() != FnKind::StaticBlock && !is_called_at_once(func),
            Node::Member(member) => {
                !member.is_static() && member.init().map(Node::Expr) == Some(child)
            }
            _ => false,
        };
        is_later.then_some(())
    });
    runs_later.is_none()
}

/// The strings of the option `key` of the first object, or `default` if it is not there.
pub(crate) fn list_option(options: &Options, key: &str, default: &[&str]) -> Box<[Box<[u8]>]> {
    let config = options.object(0);
    let written = config.strings(key);
    let names = if config.has(key) {
        &written[..]
    } else {
        default
    };
    names.iter().map(|it| it.as_bytes().into()).collect()
}

pub(crate) fn is_listed(list: &[Box<[u8]>], name: &[u8]) -> bool {
    list.iter().any(|it| **it == *name)
}

/// What a string or a template starts with, as far as it is written out, and whether that is all of it.
pub(crate) fn written_start(e: Expr<'_>) -> Option<(&[u8], bool)> {
    match e.kind() {
        ExprKind::String(value) => Some((value.bytes(), true)),
        ExprKind::Template(template) => {
            Some((template.cooked(0)?.bytes(), template.exprs().is_empty()))
        }
        _ => None,
    }
}

/// What a chain of calls and member accesses starts with: the `z` of `z.object({}).strict()`.
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

/// A trace map in which each of `names` leads to `then`.
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

/// The calls that `modules` asks for, however a module is loaded, each with the last name on the way to it.
pub(crate) fn calls_of_modules<'a, 'm>(
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

/// The calls of `Bun.name()` for one of `names`, each with the name.
pub(crate) fn calls_of_bun<'a>(
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

/// Whether [`launches`] can find something.
pub(crate) fn can_launch(file: &File) -> bool {
    file.mentions("Bun") || CHILD_PROCESS.names.iter().any(|it| file.mentions(it))
}

/// The calls that start a process: those of `node:child_process`, `Bun.spawn()` and `Bun.spawnSync()`.
pub(crate) fn launches<'a>(file: &'a File<'a>) -> Vec<(Call<'a>, Starter)> {
    let of_node = match CHILD_PROCESS.names.iter().any(|it| file.mentions(it)) {
        true => calls_of_modules(file, &CHILD_PROCESS),
        false => Vec::new(),
    };
    let of_node = of_node.into_iter().map(|(e, name)| match name {
        "exec" | "execSync" => (e, Starter::Shell),
        _ => (e, Starter::File),
    });
    let of_bun = calls_of_bun(file, &["spawn", "spawnSync"])
        .into_iter()
        .map(|(e, _)| (e, Starter::Bun));
    of_node
        .chain(of_bun)
        .filter_map(|(e, starter)| Some((e.as_call()?, starter)))
        .collect()
}

/// The options that a process is started with.
pub(crate) enum LaunchOptions<'a> {
    None,
    /// An object literal in which nothing is spread.
    Written(List<'a, Prop<'a>>),
    /// What they are is not to be seen in the call.
    Unknown,
}

impl<'a> LaunchOptions<'a> {
    pub(crate) fn of(call: Call<'a>, starter: Starter) -> Self {
        // After the command there can be a list of arguments before them, and a callback after them.
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
                    return LaunchOptions::Written(properties);
                }
                _ => return LaunchOptions::Unknown,
            }
        }
        LaunchOptions::None
    }

    fn property(&self, name: &str) -> Option<Prop<'a>> {
        match self {
            LaunchOptions::Written(properties) => properties
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

    /// Whether one of the streams of the process is that of its parent.
    pub(crate) fn shares_a_stream(&self) -> bool {
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
