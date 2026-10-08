use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex;

/// Disallow invalid regular expression strings in `RegExp` constructors.
pub struct NoInvalidRegexp {
    /// The characters in `allowConstructorFlags` that are not flags of ECMAScript.
    allowed_flags: Vec<u8>,
}

const REGEX_MESSAGE: Message = Message::new("regexMessage", "{{message}}.");

const VALID_FLAGS: &[u8] = b"dgimsuvy";

impl NoInvalidRegexp {
    /// Upstream's `validateRegExpFlags`, for flags that are known.
    fn validate_flags(&self, flags: &[u8]) -> Option<Vec<u8>> {
        // What is left of the flags without the first occurrence of each flag that exists, and
        // those of them that exist.
        let (mut flags_to_check, mut duplicate_flags) = (Vec::new(), Vec::new());
        let ends = text::code_points(flags).map(|(offset, _)| offset).skip(1).chain([flags.len()]);
        let mut start = 0;
        for end in ends.filter(|_| !flags.is_empty()) {
            let (before, flag) = (&flags[..start], &flags[start..end]);
            start = end;
            let exists = strings::contains(VALID_FLAGS, flag) || strings::contains(&self.allowed_flags, flag);
            if exists && !strings::contains(before, flag) {
                continue;
            }
            flags_to_check.extend_from_slice(flag);
            if exists {
                duplicate_flags.extend_from_slice(flag);
            }
        }
        if strings::contains_char(flags, b'u') && strings::contains_char(flags, b'v') {
            return Some(b"Regex 'u' and 'v' flags cannot be used together".to_vec());
        }
        if !duplicate_flags.is_empty() {
            return Some(
                [&b"Duplicate flags ('"[..], &duplicate_flags[..], b"') supplied to RegExp constructor"].concat(),
            );
        }
        if flags_to_check.is_empty() {
            return None;
        }
        Some([&b"Invalid flags supplied to RegExp constructor '"[..], &flags_to_check[..], b"'"].concat())
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        if !call.callee().is_ident("RegExp") || !ast_utils::is_global_reference(call.callee()) {
            return;
        }
        let args = call.args();
        // `None` if they cannot be determined.
        let flags = match args.get(1) {
            None => Some(&b""[..]),
            Some(flags) => flags.as_string().map(Name::bytes),
        };
        if let Some(message) = flags.and_then(|flags| self.validate_flags(flags)) {
            cx.report(e, REGEX_MESSAGE).data("message", message);
            return;
        }
        let Some(pattern) = args.first().and_then(Expr::as_string) else {
            return;
        };
        let validate = |mode: regex::Mode| {
            regex::validate_pattern(pattern.bytes(), mode, regex::Options::default(), &mut regex::Ignore).err()
        };
        let mode = |unicode: bool, unicode_sets: bool| regex::Mode { unicode, unicode_sets };
        let error = match flags {
            Some(flags) => validate(regex::Mode::of_flags(flags)),
            // It is invalid whatever the flags are.
            None => validate(mode(true, false))
                .and_then(|_| validate(mode(false, true)))
                .and_then(|_| validate(mode(false, false))),
        };
        if let Some(error) = error {
            cx.report(e, REGEX_MESSAGE).data("message", error.message);
        }
    }
}

impl Rule for NoInvalidRegexp {
    const META: Meta = Meta::eslint("no-invalid-regexp", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let mut allowed_flags = options.object(0).strings("allowConstructorFlags").concat().into_bytes();
        allowed_flags.retain(|flag| !strings::contains_char(VALID_FLAGS, *flag));
        NoInvalidRegexp { allowed_flags }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_expr_named("RegExp") {
            on.exprs([ExprTag::Call, ExprTag::New], Self::check);
        }
    }
}
