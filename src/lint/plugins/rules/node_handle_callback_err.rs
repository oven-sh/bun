use bun_lint_oxlint::regex_flags::rust_regex;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule expects that when you're using the callback pattern in Node.js you'll handle the error.
pub struct HandleCallbackErr(ErrorPattern);

enum ErrorPattern {
    Plain(Box<str>),
    Regex(Box<Regex>),
}

const HANDLE_CALLBACK_ERR: Message = Message::new("", "Expected error to be handled.");

impl Rule for HandleCallbackErr {
    const META: Meta = Meta::oxlint(Plugin::Node, "handle-callback-err", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let pattern = options.str(0).unwrap_or("err");
        let regex = || rust_regex(pattern, false);
        HandleCallbackErr(match pattern.starts_with('^').then(regex).flatten() {
            Some(regex) => ErrorPattern::Regex(Box::new(regex)),
            None => ErrorPattern::Plain(pattern.into()),
        })
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if matches!(&self.0, ErrorPattern::Plain(name) if !file.mentions(name)) {
            return;
        }
        on.funcs(|rule, func, cx| {
            let is_function = matches!(
                func.kind(),
                FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
            );
            if is_function
                && let Some(ident) = func.params().first().filter(|it| !it.is_rest()).map(Param::pat)
                && let Some(name) = ident.as_ident()
                && rule.matches(name.bytes())
                && !matches!(func.owner(), Node::Member(member) if member.is_signature())
                && ident.symbol().is_some_and(|it| it.references().all(|it| it.is_init()))
            {
                cx.report(ident, HANDLE_CALLBACK_ERR);
            }
        });
    }
}

impl HandleCallbackErr {
    fn matches(&self, name: &[u8]) -> bool {
        match &self.0 {
            ErrorPattern::Plain(plain) => name == plain.as_bytes(),
            ErrorPattern::Regex(regex) => regex.test(name),
        }
    }
}
