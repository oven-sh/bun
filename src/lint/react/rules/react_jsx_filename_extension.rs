use bun_lint_oxlint::text::file_extension;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces consistent use of the `.jsx` file extension.
pub struct JsxFilenameExtension {
    /// `"as-needed"`, not `"always"`
    allow_as_needed: bool,
    /// Without the dot.
    extensions: Vec<Box<[u8]>>,
    ignore_files_without_code: bool,
}

const NO_JSX_WITH_FILENAME_EXTENSION: Message = Message::new("", "JSX not allowed in files with extension '.{{ext}}'");
const EXTENSION_ONLY_FOR_JSX: Message = Message::new("", "Only files containing JSX may use the extension '.{{ext}}'");

impl Rule for JsxFilenameExtension {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-filename-extension", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let extension = |it: &Json| it.as_str().map(|it| Box::from(it.strip_prefix(b".").unwrap_or(it)));
        JsxFilenameExtension {
            allow_as_needed: options.str("allow") == Some("as-needed"),
            extensions: match options.get("extensions").and_then(Json::as_array) {
                // oxlint keeps the first of each.
                Some(extensions) => extensions.iter().filter_map(extension).fold(Vec::new(), |mut all, it| {
                    if !all.contains(&it) {
                        all.push(it);
                    }
                    all
                }),
                None => vec![Box::from(&b"jsx"[..])],
            },
            ignore_files_without_code: options.bool_or("ignoreFilesWithoutCode", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let ext = file_extension(file.path()).unwrap_or_default();
        let has_ext_allowed = self.extensions.iter().any(|it| **it == *ext);
        let has_jsx = file.has_exprs([ExprTag::Jsx]);
        if !has_ext_allowed && has_jsx {
            on.finish(|rule, cx| {
                let file = cx.file();
                if let Some(jsx_elt) = file.exprs_of_kind(ExprTag::Jsx).min_by_key(|it| it.span().start) {
                    let ext = file_extension(file.path()).unwrap_or_default();
                    cx.report(jsx_elt, NO_JSX_WITH_FILENAME_EXTENSION).data("ext", ext).help_with(|| {
                        let allowed_extensions = rule.extensions.join(&b", ."[..]);
                        let allowed_extensions = bstr::BStr::new(&allowed_extensions);
                        format!("Rename the file to use an allowed extension: .{allowed_extensions}")
                    });
                }
            });
        } else if has_ext_allowed
            && !has_jsx
            && self.allow_as_needed
            && !(self.ignore_files_without_code && file.body().is_empty())
        {
            on.finish(|_, cx| {
                let ext = file_extension(cx.file().path()).unwrap_or_default();
                cx.report(Span::new(0, 0), EXTENSION_ONLY_FOR_JSX).data("ext", ext);
            });
        }
    }
}
