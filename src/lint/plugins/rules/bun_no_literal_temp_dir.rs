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

fn is_jsx_attribute_string(e: Expr) -> bool {
    matches!(e.parent(), Node::Prop(it) if it.is_jsx_attribute()) && e.jsx_container_span().is_none()
}

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
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoLiteralTempDir { directories: list_option(options, "directories", &["/tmp", "/var/tmp"]) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::String, ExprTag::Template], |rule, e, cx| {
            let found = match e.kind() {
                // In JSX a text is prose, and `a=".."` is more often a URL than a path.
                ExprKind::String(_) if e.is_jsx_text() || e.is_jsx_tag_name() => None,
                ExprKind::String(_) if is_jsx_attribute_string(e) => None,
                _ => written_start(e).and_then(|(path, is_whole)| rule.directory_of(path, is_whole)),
            };
            if let Some(directory) = found {
                cx.report(e, LITERAL_DIRECTORY).data("directory", directory.to_vec());
            }
        });
    }
}
