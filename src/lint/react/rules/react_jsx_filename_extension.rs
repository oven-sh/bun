use bun_lint::paths::extname;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::text::file_extension;

/// Disallow file extensions that may contain JSX
pub struct JsxFilenameExtension {
    /// `"as-needed"`, not `"always"`
    allow_as_needed: bool,
    /// As they are written.
    extensions: Vec<Box<[u8]>>,
    ignore_files_without_code: bool,
}

const NO_JSX_WITH_EXTENSION: Message =
    Message::new("noJSXWithExtension", "JSX not allowed in files with extension '{{ext}}'");
const EXTENSION_ONLY_FOR_JSX: Message =
    Message::new("extensionOnlyForJSX", "Only files containing JSX may use the extension '{{ext}}'");
const OXLINT_NO_JSX_WITH_EXTENSION: Message = Message::new("", "JSX not allowed in files with extension '.{{ext}}'");
const OXLINT_EXTENSION_ONLY_FOR_JSX: Message =
    Message::new("", "Only files containing JSX may use the extension '.{{ext}}'");

fn without_dot(extension: &[u8]) -> &[u8] {
    extension.strip_prefix(b".").unwrap_or(extension)
}

impl Rule for JsxFilenameExtension {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-filename-extension", Kind::Suggestion);
    const ON: On = On::new().finish();
    /// Whether the file has JSX.
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxFilenameExtension {
            allow_as_needed: options.str("allow") == Some("as-needed"),
            extensions: match options.get("extensions").and_then(Json::as_array) {
                Some(extensions) => extensions.iter().filter_map(|it| it.as_str().map(Box::from)).collect(),
                None => vec![Box::from(&b".jsx"[..])],
            },
            ignore_files_without_code: options.bool_or("ignoreFilesWithoutCode", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        let path = file.path();
        let has_ext_allowed = if file.language().is_oxlint {
            // oxlint compares what is after the last dot, and takes an extension with its dot or without.
            let ext = file_extension(path).unwrap_or_default();
            self.extensions.iter().any(|it| without_dot(it) == ext)
        } else if path == b"<text>" {
            return None;
        } else {
            self.extensions.iter().any(|it| !it.is_empty() && path.ends_with(it))
        };
        let has_jsx = file.has_exprs([ExprTag::Jsx]);
        if !has_ext_allowed && has_jsx {
            Some(true)
        } else if has_ext_allowed
            && !has_jsx
            && self.allow_as_needed
            && !(self.ignore_files_without_code && file.body().is_empty())
        {
            Some(false)
        } else {
            None
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (file, is_oxlint) = (cx.file(), cx.language().is_oxlint);
        // oxlint's is without the dot.
        let ext = if is_oxlint { file_extension(file.path()).unwrap_or_default() } else { extname(file.path()) };
        if cx.state {
            let Some(jsx_node) = file.exprs_of_kind(ExprTag::Jsx).min_by_key(|it| it.span().start) else {
                return;
            };
            if !is_oxlint {
                cx.report(jsx_node, NO_JSX_WITH_EXTENSION).data("ext", ext).at_the_end();
                return;
            }
            cx.report(jsx_node, OXLINT_NO_JSX_WITH_EXTENSION).data("ext", ext).help_with(|| {
                // oxlint keeps the first of each.
                let mut allowed_extensions: Vec<&[u8]> = Vec::new();
                for it in self.extensions.iter().map(|it| without_dot(it)) {
                    if !allowed_extensions.contains(&it) {
                        allowed_extensions.push(it);
                    }
                }
                let allowed_extensions = allowed_extensions.join(&b", ."[..]);
                let allowed_extensions = bstr::BStr::new(&allowed_extensions);
                format!("Rename the file to use an allowed extension: .{allowed_extensions}")
            });
        } else if is_oxlint {
            // oxlint points at the start of the file.
            cx.report(Span::new(0, 0), OXLINT_EXTENSION_ONLY_FOR_JSX).data("ext", ext);
        } else {
            // espree's `Program` is the whole text.
            let node = if file.uses_typescript_parser() { file.program_span() } else { file.span() };
            cx.report(node, EXTENSION_ONLY_FOR_JSX).data("ext", ext).at_the_end();
        }
    }
}
