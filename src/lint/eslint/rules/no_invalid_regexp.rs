use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex;
use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::regex_pattern::Pattern;
use smallvec::SmallVec;

/// Disallow invalid regular expression strings in `RegExp` constructors.
pub struct NoInvalidRegexp {
    /// The characters in `allowConstructorFlags` that aren't ECMAScript flags.
    allowed_flags: Vec<u8>,
}

const REGEX_MESSAGE: Message = Message::new("regexMessage", "{{message}}.");
/// oxlint's message.
const INVALID: Message = Message::new("regexMessage", "Invalid regular expression: {{message}}");
const VALID_FLAGS_NOTE: &str = "Valid flags are: d (indices), g (global), i (ignore case), m (multiline),\n             s (dot all), u (unicode), v (unicode sets), y (sticky)";

const VALID_FLAGS: &[u8] = b"dgimsuvy";

impl NoInvalidRegexp {
    /// Upstream's `validateRegExpFlags`, for flags that are statically known.
    fn validate_flags(&self, flags: &[u8]) -> Option<Vec<u8>> {
        // The flags that remain after removing the first occurrence of each valid flag, and the valid ones among them.
        let (mut flags_to_check, mut duplicate_flags) = (Vec::new(), Vec::new());
        // The valid flags seen so far, each once.
        let mut seen: SmallVec<[&[u8]; 8]> = SmallVec::new();
        let ends = strings::wtf8_codepoints(flags).map(|(offset, _)| offset).skip(1).chain([flags.len()]);
        let mut start = 0;
        for end in ends.filter(|_| !flags.is_empty()) {
            let flag = &flags[start..end];
            start = end;
            let exists = strings::contains(VALID_FLAGS, flag) || strings::contains(&self.allowed_flags, flag);
            if exists && !seen.contains(&flag) {
                seen.push(flag);
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
        let Some(call) = e.as_call_like() else {
            return;
        };
        if !call.callee().is_ident("RegExp") || !ast_utils::is_global_reference(call.callee()) {
            return;
        }
        let args = call.args();
        // `None` if they can't be determined.
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
            Some(flags) => validate(regex::Mode::from_flags(flags)),
            // Reported only if it's invalid whatever the flags are.
            None => validate(mode(true, false))
                .and_then(|_| validate(mode(false, true)))
                .and_then(|_| validate(mode(false, false))),
        };
        if let Some(error) = error {
            cx.report(e, REGEX_MESSAGE).data("message", error.message);
        }
    }
}

/// Returns `argument` if it's a bare string literal. For oxlint a parenthesized one doesn't count.
fn string_literal(argument: Expr<'_>) -> Option<Expr<'_>> {
    (argument.tag() == ExprTag::String && !argument.is_parenthesized()).then_some(argument)
}

impl NoInvalidRegexp {
    /// oxlint doesn't check what `RegExp` refers to, reads the flags from their source text, and only looks at the
    /// pattern if it knows the flags. It reports at the flag, or wherever its parser reports.
    fn check_as_oxlint<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        if !get_inner_expression(call.callee()).is_ident("RegExp") {
            return;
        }
        let args = call.args();
        let (pattern, flags) = match (args.first(), args.get(1)) {
            (Some(pattern), Some(flags)) => (string_literal(pattern), string_literal(flags)),
            (Some(pattern), None) => (string_literal(pattern), None),
            _ => return,
        };
        if args.get(1).is_some() && flags.is_none() {
            return;
        }
        let mut mode = regex::Mode::default();
        if let Some(flags) = flags {
            let text = strings::trim(strings::trim(flags.text(), b"'"), b"\"");
            let ends = strings::wtf8_codepoints(text).map(|it| it.0).skip(1).chain([text.len()]);
            let mut seen: SmallVec<[&[u8]; 8]> = SmallVec::new();
            let mut start = 0;
            for end in ends.filter(|_| !text.is_empty()) {
                let flag = &text[start..end];
                let report_span = Span::empty(flags.span().start + 1 + start as u32);
                start = end;
                let flag_text = bstr::BStr::new(flag);
                if flag == b"u" && mode.unicode_sets || flag == b"v" && mode.unicode {
                    let (new, old) = if flag == b"u" { ('u', 'v') } else { ('v', 'u') };
                    cx.report(report_span, INVALID)
                        .data("message", "`u` and `v` flags should be used alone")
                        .help("Specify only one of 'u' or 'v' flags")
                        .first_label(format!("the '{new}' flag cannot be used when the '{old}' flag is specified"));
                    return;
                }
                mode.unicode |= flag == b"u";
                mode.unicode_sets |= flag == b"v";
                if seen.contains(&flag) {
                    cx.report(report_span, INVALID)
                        .data("message", "Duplicated flag")
                        .help_with(|| {
                            format!("Remove the duplicated '{flag_text}' flag from the regular expression flags")
                        })
                        .first_label(format!("flag '{flag_text}' already specified"));
                    return;
                }
                seen.push(flag);
                if !strings::contains(VALID_FLAGS, flag) && !strings::contains(&self.allowed_flags, flag) {
                    cx.report(report_span, INVALID)
                        .data("message", "Unknown flag")
                        .note(VALID_FLAGS_NOTE)
                        .first_label(format!("flag '{flag_text}' is not a valid regular expression flag"));
                    return;
                }
            }
        }
        let Some(pattern) = pattern.and_then(|it| Pattern::read(it, mode)) else {
            return;
        };
        let Err(regex::SyntaxError { oxc: Some(found), .. }) =
            regex::validate_pattern(pattern.text(), mode, regex::Options::default(), &mut regex::Ignore)
        else {
            return;
        };
        let report = cx
            .report(pattern.span(found.start, found.end), INVALID)
            .data("message", found.message.into_owned())
            .help(found.help);
        if let Some((start, end)) = found.also {
            report.label(pattern.span(start, end), "");
        }
    }
}

impl Rule for NoInvalidRegexp {
    const META: Meta = Meta::eslint("no-invalid-regexp", Kind::Problem).recommended();
    const ON: On = On::new().function_calls(&["RegExp"]).exprs(&[ExprTag::New]);
    no_state!();

    fn new(options: &Options) -> Self {
        let mut allowed_flags = options.object(0).strings("allowConstructorFlags").concat().into_bytes();
        allowed_flags.retain(|flag| !strings::contains_char(VALID_FLAGS, *flag));
        NoInvalidRegexp { allowed_flags }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions("RegExp") { Self::ON } else { On::new() }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match cx.language().is_oxlint {
            true => self.check_as_oxlint(e, cx),
            false => self.check(e, cx),
        }
    }
}
