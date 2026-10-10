use crate::bun::{list_option, written_start};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow paths that are written out and start with a directory for temporary files.
///
/// By default `/tmp`, which POSIX requires (XBD 10.1, Directory Structure and Files), and `/var/tmp` of the Filesystem
/// Hierarchy Standard (5.15).
pub struct NoLiteralTempDir {
    directories: Box<[Box<[u8]>]>,
}

const LITERAL_DIRECTORY: Message = Message::new(
    "literalDirectory",
    "`{{directory}}` is not where every system keeps temporary files. Ask for the directory: `os.tmpdir()`.",
);

impl NoLiteralTempDir {
    /// The directory that `path` is or is in. `is_whole`: nothing follows `path`.
    fn directory_of(&self, path: &[u8], is_whole: bool) -> Option<&[u8]> {
        let is_in = |directory: &[u8]| match path.strip_prefix(directory) {
            Some(b"") => is_whole,
            Some(rest) => rest.starts_with(b"/"),
            None => false,
        };
        self.directories.iter().map(|it| &**it).find(|it| is_in(it))
    }
}

impl Rule for NoLiteralTempDir {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-literal-temp-dir", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::String, ExprTag::Template]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoLiteralTempDir { directories: list_option(options, "directories", &["/tmp", "/var/tmp"]) }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let found = match e.kind() {
            // In JSX a text is prose, and `a=".."` is more often a URL than a path.
            ExprKind::String(_) if e.is_jsx_text() || e.is_jsx_tag_name() => None,
            ExprKind::String(_) if e.is_jsx_attribute_string() => None,
            _ => written_start(e).and_then(|(path, is_whole)| self.directory_of(path, is_whole)),
        };
        if let Some(directory) = found {
            cx.report(e, LITERAL_DIRECTORY).data("directory", directory.to_vec());
        }
    }
}
