use bun_core::strings;
use bun_lint::json::{Notation, parse_as};
use bun_lint::prelude::*;
use bun_lint::regex::parse_literal;
use bun_lint::rule::Plugin;
use std::sync::LazyLock;

/// Enforce a leading comment with the webpackChunkName for dynamic imports.
pub struct DynamicImportChunkname {
    import_functions: Vec<Box<[u8]>>,
    allow_empty: bool,
    chunk_substr_format: String,
    /// `None`: it is none, which `validate` has said.
    chunk_substr_regex: Option<Regex>,
}

const NO_COMMENT: Message = Message::new("", "dynamic imports require a leading comment with the webpack chunkname");
const LINE_COMMENT: Message =
    Message::new("", "dynamic imports require a /* foo */ style comment, not a // foo comment");
const NOT_PADDED: Message = Message::new("", "dynamic imports require a block comment padded with spaces - /* foo */");
const INVALID_SYNTAX: Message = Message::new("", "dynamic imports require a \"webpack\" comment with valid syntax");
const EAGER_WITH_NAME: Message = Message::new("", "dynamic imports using eager mode do not need a webpackChunkName");
const REMOVE_CHUNK_NAME: Message = Message::new("", "Remove webpackChunkName");
const REMOVE_MODE: Message = Message::new("", "Remove webpackMode");
const NO_CHUNK_NAME: Message = Message::new("", "dynamic imports require a leading comment in the form /*{{format}}*/");

static PADDED_COMMENT_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/^ (\S[\s\S]+\S) $/"));
static COMMENT_STYLE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(
        r#"/^( ((webpackChunkName: .+)|((webpackPrefetch|webpackPreload): (true|false|-?[0-9]+))|(webpackIgnore: (true|false))|((webpackInclude|webpackExclude): \/.*\/)|(webpackMode: ["'](lazy|lazy-once|eager|weak)["'])|(webpackExports: (['"]\w+['"]|\[(['"]\w+['"], *)+(['"]\w+['"]*)\]))),?)+ $/"#,
    )
});
static EAGER_MODE_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r#"/webpackMode: ["']eager["'],? /"#));
/// A string, or what is before a regular expression that is a value, and that.
static STRING_OR_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(
        r#"/"(?:[^"\\\n\r]|\\[^])*"|'(?:[^'\\\n\r]|\\[^])*'|([:,[]\s*)(\/(?:[^/\\[\n\r\u2028\u2029]|\\.|\[(?:[^\]\\\n\r\u2028\u2029]|\\.)*\])+\/[\w$]*)/g"#,
    )
});

fn chunk_substr_format(options: &Options) -> String {
    let format = options.object(0).str("webpackChunknameFormat");
    format!("webpackChunkName: [\"']{}[\"'],? ", format.unwrap_or(r"([0-9a-zA-Z-_/.]|\[(request|index)\])+"))
}

/// Whether `({<value>})` is an object of literals. Upstream evaluates it and asks whether that throws: what is
/// written otherwise and does not throw, like `a: 1 + 1`, is refused here.
fn evaluates(value: &[u8]) -> bool {
    let mut is_valid = true;
    let without_regexes = STRING_OR_REGEX.replace_with(value, |found, out| match found.get(2) {
        Some(literal) => {
            is_valid &= parse_literal(literal.as_bytes(), bun_lint::regex::Options::default()).is_ok();
            out.extend_from_slice(found.bytes(1));
            out.push(b'0');
        }
        None => out.extend_from_slice(found.as_bytes()),
    });
    is_valid && parse_as(Notation::Json5, &[&b"{"[..], &without_regexes[..], b"}"].concat()).is_ok()
}

/// What both suggestions do: the first comment that has `part` loses it.
#[cold]
#[inline(never)]
fn remove_from_comment<'a>(fixer: Fixer<'a>, arg: Expr<'a>, part: &Regex) -> Option<Fix> {
    let comment = fixer.file().comments_before(arg).find(|it| part.test(it.comment_value()))?;
    let replacement = part.replace(comment.comment_value(), b"");
    let replacement = strings::trim_js_whitespace(&replacement);
    let replacement = replacement.strip_suffix(b",").unwrap_or(replacement);
    if replacement.is_empty() {
        return Some(fixer.remove(comment));
    }
    Some(fixer.replace(comment, [&b"/* "[..], replacement, b" */"].concat()))
}

impl DynamicImportChunkname {
    fn run<'a>(&self, node: Expr<'a>, arg: Expr<'a>, cx: &Cx<'a, Self>) {
        let Some(chunk_substr_regex) = &self.chunk_substr_regex else {
            return;
        };
        let (mut has_comments, mut is_chunkname_present, mut is_eager_mode_present) = (false, false, false);
        for comment in cx.file().comments_before(arg) {
            let value = comment.comment_value();
            let problem = if comment.kind() != TokenKind::Block {
                Some(LINE_COMMENT)
            } else if !PADDED_COMMENT_REGEX.test(value) {
                Some(NOT_PADDED)
            } else if !COMMENT_STYLE_REGEX.test(value) || !evaluates(value) {
                Some(INVALID_SYNTAX)
            } else {
                None
            };
            if let Some(problem) = problem {
                cx.report(node, problem);
                return;
            }
            has_comments = true;
            is_eager_mode_present |= EAGER_MODE_REGEX.test(value);
            is_chunkname_present |= chunk_substr_regex.test(value);
        }
        if self.allow_empty && !is_chunkname_present {
            return;
        }
        if !has_comments {
            cx.report(node, NO_COMMENT);
        } else if !is_eager_mode_present && !is_chunkname_present {
            cx.report(node, NO_CHUNK_NAME).data("format", self.chunk_substr_format.clone());
        } else if is_eager_mode_present && is_chunkname_present {
            cx.report(node, EAGER_WITH_NAME)
                .suggest(REMOVE_CHUNK_NAME, |fixer| remove_from_comment(fixer, arg, chunk_substr_regex))
                .suggest(REMOVE_MODE, |fixer| remove_from_comment(fixer, arg, &EAGER_MODE_REGEX));
        }
    }
}

impl Rule for DynamicImportChunkname {
    const META: Meta = Meta::plugin(Plugin::Import, "dynamic-import-chunkname", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::ImportCall]);
    no_state!();

    fn new(options: &Options) -> Self {
        let chunk_substr_format = chunk_substr_format(options);
        let options = options.object(0);
        DynamicImportChunkname {
            import_functions: options.strings("importFunctions").into_iter().map(|it| it.as_bytes().into()).collect(),
            allow_empty: options.bool_or("allowEmpty", false),
            chunk_substr_regex: Regex::new(&chunk_substr_format, "").ok(),
            chunk_substr_format,
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        match Regex::new(&chunk_substr_format(options), "") {
            Ok(_) => Ok(()),
            Err(error) => Err(error.message.into_bytes()),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        if self.import_functions.is_empty() { On::new().exprs(&[ExprTag::ImportCall]) } else { Self::ON }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let args = match e.kind() {
            ExprKind::ImportCall { args } => args,
            ExprKind::Call(call) => {
                let Some(callee) = call.callee().as_ident() else {
                    return;
                };
                if !self.import_functions.iter().any(|it| callee.bytes() == &**it) {
                    return;
                }
                call.args()
            }
            _ => return,
        };
        // Without an argument upstream throws.
        if let Some(arg) = args.first() {
            self.run(e, arg, cx);
        }
    }
}
