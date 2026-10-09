use crate::bun::{LaunchOptions, Starter, is_listed, launches, list_option, written_start};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::callee_name;
use rustc_hash::FxHashSet;

/// Disallow starting a process with a command that is written out and does not behave alike on every system.
///
/// `scripts`: what package managers install on Windows as `.cmd` files: see "Spawning .bat and .cmd files on Windows"
/// in the documentation of Node.js. `posixOnly`: utilities of POSIX.1-2017 (XCU, chapter 4) that Windows does not have.
pub struct NoUnportableCommands {
    scripts: Box<[Box<[u8]>]>,
    posix_only: Box<[Box<[u8]>]>,
    launchers: Box<[Box<[u8]>]>,
}

const NEEDS_SHELL: Message = Message::new(
    "needsShell",
    "On Windows `{{command}}` is a script, `{{command}}.cmd`, and a script cannot be started without a shell.",
);
const POSIX_ONLY: Message = Message::new("posixOnly", "Windows has no `{{command}}`.");
const SHELL_SYNTAX: Message = Message::new(
    "shellSyntax",
    "`{{operator}}` is for a shell to read, and which shell that is depends on the system.",
);
const PS_OPTIONS: Message =
    Message::new("psOptions", "The options of `ps` differ from system to system, and Windows has no `ps`.");

const SCRIPTS: [&str; 5] = ["npm", "npx", "pnpm", "pnpx", "yarn"];
const POSIX_ONLY_UTILITIES: [&str; 33] = [
    "awk", "basename", "cat", "chmod", "chown", "cp", "cut", "df", "dirname", "du", "env", "grep", "head", "id", "kill",
    "ln", "ls", "mkfifo", "mv", "nohup", "ps", "pwd", "rm", "sed", "sh", "sleep", "tail", "tee", "touch", "tr", "uname", "wc",
    "xargs",
];
const SHELL_OPERATORS: [&str; 8] = ["&&", "||", "|", ";", ">", "<", "$(", "`"];

/// The expression that says which program is started.
fn command_of<'a>(call: Call<'a>, starter: Starter, options: &LaunchOptions<'a>) -> Option<Expr<'a>> {
    let first = call.args().first()?;
    if starter != Starter::Bun {
        return Some(first);
    }
    let list = if first.tag() == ExprTag::Object { options.get("cmd")? } else { first };
    match list.kind() {
        ExprKind::Array(words) => words.first(),
        _ => None,
    }
}

/// Whether `text` has the word `ps` with options after it: `ps -ef`, `ps aux`.
fn has_ps_with_options(mut text: &[u8]) -> bool {
    while let Some(at) = strings::index_of(text, b"ps ") {
        let before = at.checked_sub(1).and_then(|it| text.get(it));
        let after = text.get(at + 3..).unwrap_or_default();
        let is_word = before.is_none_or(|it| !it.is_ascii_alphanumeric() && !matches!(it, b'_' | b'-' | b'.'));
        let has_options = match after.trim_ascii_start() {
            [b'-', letter, ..] => letter.is_ascii_alphabetic(),
            options => options.starts_with(b"aux") || options.starts_with(b"ax"),
        };
        if is_word && has_options {
            return true;
        }
        text = after;
    }
    false
}

impl NoUnportableCommands {
    /// Reports what is wrong with a call that starts a process, and returns the command then.
    fn check_launch<'a>(&self, call: Call<'a>, starter: Starter, cx: &Cx<'a, Self>) -> Option<Expr<'a>> {
        let options = LaunchOptions::of(call, starter);
        let command = command_of(call, starter, &options)?;
        let (text, is_whole) = written_start(command)?;
        let has_shell_option = options.get("shell").is_some_and(|it| it.tag() != ExprTag::False);
        let uses_shell = starter == Starter::Shell || has_shell_option;
        // A shell takes the first word for the program.
        let end = if uses_shell { strings::index_of_any(text, b" \t\n") } else { None };
        if end.is_none() && !is_whole {
            return None;
        }
        let path = text.get(..end.unwrap_or(text.len()))?;
        let program = path.get(strings::last_index_of_char(path, b'/').map_or(0, |it| it + 1)..)?;
        let may_use_shell = uses_shell || matches!(options, LaunchOptions::Unknown);
        if is_listed(&self.posix_only, program) {
            cx.report(command, POSIX_ONLY).data("command", program);
        } else if !may_use_shell && is_listed(&self.scripts, program) {
            cx.report(command, NEEDS_SHELL).data("command", program);
        } else if uses_shell
            && let Some(operator) = SHELL_OPERATORS.iter().find(|it| strings::contains(text, it.as_bytes()))
        {
            cx.report(command, SHELL_SYNTAX).data("operator", *operator);
        } else {
            return None;
        }
        Some(command)
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut launched = launches(file);
        if !self.launchers.is_empty() {
            let calls = file.exprs_of_kind(ExprTag::Call).filter_map(Expr::as_call);
            let is_launcher = |it: &Call| callee_name(*it).is_some_and(|name| is_listed(&self.launchers, name.bytes()));
            launched.extend(calls.filter(is_launcher).map(|it| (it, Starter::File)));
        }
        let reported = launched.iter().filter_map(|it| self.check_launch(it.0, it.1, cx));
        let reported: FxHashSet<u32> = reported.map(|it| it.span().start).collect();
        for e in [ExprTag::String, ExprTag::Template].into_iter().flat_map(|it| file.exprs_of_kind(it)) {
            let has_ps = match e.kind() {
                ExprKind::String(value) => !e.is_jsx_text() && has_ps_with_options(value.bytes()),
                ExprKind::Template(template) => {
                    (0..template.quasi_count()).any(|at| has_ps_with_options(template.raw(at)))
                }
                _ => false,
            };
            if has_ps && !reported.contains(&e.span().start) {
                cx.report(e, PS_OPTIONS);
            }
        }
    }
}

impl Rule for NoUnportableCommands {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-unportable-commands", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnportableCommands {
            scripts: list_option(options, "scripts", &SCRIPTS),
            posix_only: list_option(options, "posixOnly", &POSIX_ONLY_UTILITIES),
            launchers: list_option(options, "launchers", &[]),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
