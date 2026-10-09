use crate::bun::{LaunchOptions, can_launch, launches};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require `windowsHide` for a child process that does not share a stream with its parent.
///
/// See `windowsHide` and `stdio` in the documentation of `child_process.spawn()` of Node.js and of `Bun.spawn()`.
pub struct NoConsoleWindowFlash;

const CONSOLE_WINDOW: Message = Message::new(
    "consoleWindow",
    "On Windows a console window opens for this process and closes again. Set `windowsHide: true`.",
);

impl Rule for NoConsoleWindowFlash {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-console-window-flash", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConsoleWindowFlash
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !can_launch(file) {
            return;
        }
        on.finish(|_, cx| {
            for (call, starter) in launches(cx.file()) {
                let options = LaunchOptions::of(call, starter);
                let is_unknown = matches!(options, LaunchOptions::Unknown);
                if !is_unknown && !options.has("windowsHide") && !options.shares_a_stream() {
                    cx.report(call.callee(), CONSOLE_WINDOW);
                }
            }
        });
    }
}
