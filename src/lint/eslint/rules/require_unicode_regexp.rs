use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap, get_string_if_constant, is_comma_token};
use bun_lint::utils::regular_expressions::{UnicodeFlag, is_valid_with_unicode_flag};
use bun_lint_oxlint::ast_util::{get_const_variable_initializer, get_inner_expression, static_string};
use bun_lint_oxlint::regex_flags::is_regexp_callee;
use smallvec::SmallVec;

/// Enforce the use of `u` or `v` flag on regular expressions.
pub struct RequireUnicodeRegexp {
    require_flag: Option<UnicodeFlag>,
}

const ADD_U_FLAG: Message = Message::new("addUFlag", "Add the 'u' flag.");
const ADD_V_FLAG: Message = Message::new("addVFlag", "Add the 'v' flag.");
const REQUIRE_U_FLAG: Message = Message::new("requireUFlag", "Use the 'u' flag.");
const REQUIRE_V_FLAG: Message = Message::new("requireVFlag", "Use the 'v' flag.");

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);

/// `text` with the first `from` in it, at or after `start`, replaced by `to`.
fn replace_first(text: &[u8], start: usize, from: u8, to: u8) -> Option<Vec<u8>> {
    let at = start + strings::index_of_char_usize(text.get(start..)?, from)?;
    let mut replaced = text.to_vec();
    *replaced.get_mut(at)? = to;
    Some(replaced)
}

/// oxlint's `resolve_flags`: those of the characters `u` and `v` that are in the flags that `e` is. `None` if it does not know
/// them. `seen` has the identifiers on the way.
fn resolve_flags<'a>(e: Expr<'a>, seen: &mut SmallVec<[Expr<'a>; 4]>) -> Option<SmallVec<[u8; 2]>> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return None;
    }
    let of_text = |text: &[u8]| -> SmallVec<[u8; 2]> {
        b"uv".iter().copied().filter(|it| strings::contains_char(text, *it)).collect()
    };
    let e = get_inner_expression(e);
    match e.kind() {
        ExprKind::Ident(_) => {
            if seen.contains(&e) {
                return None;
            }
            seen.push(e);
            resolve_flags(get_const_variable_initializer(e)?, seen)
        }
        ExprKind::String(value) => Some(of_text(value.bytes())),
        ExprKind::Template(template) => {
            let mut flags: SmallVec<[u8; 2]> = SmallVec::new();
            for i in 0..template.quasi_count() {
                flags.extend(of_text(template.cooked(i)?.bytes()));
                if let Some(substitution) = template.exprs().get(i) {
                    flags.extend(resolve_flags(substitution, seen)?);
                }
            }
            Some(flags)
        }
        ExprKind::True | ExprKind::Null => Some(of_text(b"u")),
        ExprKind::False | ExprKind::Number(_) => Some(SmallVec::new()),
        ExprKind::Binary { op: BinOp::Add, left, right } => {
            let mut flags = resolve_flags(left, seen)?;
            flags.extend(resolve_flags(right, seen)?);
            Some(flags)
        }
        ExprKind::Index { obj, index, chain: Chain::No } => {
            let object = get_inner_expression(obj);
            let object = match object.tag() {
                ExprTag::Ident => get_inner_expression(get_const_variable_initializer(object)?),
                _ => object,
            };
            let ExprKind::Number(index) = get_inner_expression(index).kind() else {
                return None;
            };
            let is_index = index.is_finite() && index >= 0.0 && index.fract() == 0.0;
            let (_, character) = strings::wtf8_codepoints(static_string(object)?.bytes()).nth(index as usize)?;
            is_index.then(|| of_text(&[u8::try_from(character).unwrap_or(0)]))
        }
        ExprKind::Binary { op: BinOp::Comma, right, .. } => resolve_flags(right, seen),
        ExprKind::Assign { op: None, value, .. } => resolve_flags(value, seen),
        _ => None,
    }
}

impl RequireUnicodeRegexp {
    /// ESLint's `checkFlags`
    fn is_missing_flag(&self, flags: &[u8]) -> bool {
        let has = |flag| strings::contains_char(flags, flag);
        match self.require_flag {
            Some(UnicodeFlag::V) => !has(b'v'),
            Some(UnicodeFlag::U) => !has(b'u'),
            None => !has(b'u') && !has(b'v'),
        }
    }

    fn requires_v(&self) -> bool {
        self.require_flag == Some(UnicodeFlag::V)
    }

    fn require_message(&self) -> Message {
        if self.requires_v() { REQUIRE_V_FLAG } else { REQUIRE_U_FLAG }
    }

    fn add_message(&self) -> Message {
        if self.requires_v() { ADD_V_FLAG } else { ADD_U_FLAG }
    }

    /// The flag to add.
    fn replace_flag(&self) -> u8 {
        if self.requires_v() { b'v' } else { b'u' }
    }

    /// The flag that it takes the place of.
    fn other_flag(&self) -> u8 {
        if self.require_flag == Some(UnicodeFlag::U) { b'v' } else { b'u' }
    }

    fn is_valid_with_flag(&self, file: &File<'_>, pattern: &[u8]) -> bool {
        let flag = self.require_flag.unwrap_or(UnicodeFlag::U);
        is_valid_with_unicode_flag(file.language().ecma_version, pattern, flag)
    }
}

impl Rule for RequireUnicodeRegexp {
    const META: Meta = Meta::eslint("require-unicode-regexp", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Regex, ExprTag::New]).calls_named(&["RegExp"]).finish();
    no_state!();

    fn new(options: &Options) -> Self {
        RequireUnicodeRegexp {
            require_flag: match options.object(0).str("requireFlag") {
                Some("u") => Some(UnicodeFlag::U),
                Some("v") => Some(UnicodeFlag::V),
                _ => None,
            },
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Regex]);
        match file.language().is_oxlint {
            true if file.mentions("RegExp") => on.exprs(&[ExprTag::New]).calls_named(&["RegExp"]),
            true => on,
            false => on.finish(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint looks at what is called, not at what the variable is that is called.
        if let ExprKind::Call(call) | ExprKind::New(call) = e.kind() {
            let args = call.args();
            if !is_regexp_callee(call.callee()) || args.iter().any(|it| it.tag() == ExprTag::Spread) {
                return;
            }
            let flags = match args.get(1) {
                Some(flags) => resolve_flags(flags, &mut SmallVec::new()),
                None => Some(SmallVec::new()),
            };
            if flags.is_some_and(|it| self.is_missing_flag(&it)) {
                cx.report(e, self.require_message());
            }
            return;
        }
        let Some(regex) = e.as_regex() else {
            return;
        };
        if !self.is_missing_flag(regex.flags()) {
            return;
        }
        cx.report(e, self.require_message()).suggest(self.add_message(), |fixer| {
            if !self.is_valid_with_flag(fixer.file(), regex.pattern()) {
                return None;
            }
            let text = e.text();
            let flags_start = text.len() - regex.flags().len();
            if self.require_flag.is_some()
                && let Some(replaced) = replace_first(text, flags_start, self.other_flag(), self.replace_flag())
            {
                return Some(fixer.replace(e, replaced));
            }
            Some(fixer.insert_after(e, &[self.replace_flag()]))
        });
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let references = ReferenceTracker::new(file).iterate_global_references(&TRACE_MAP);
        let scope = (!references.is_empty()).then(|| file.scope());
        for reference in references {
            let (Some(node), Some(call)) = (reference.expr(), reference.call()) else {
                continue;
            };
            let (pattern_node, flags_node) = (call.args().first(), call.args().get(1));
            if pattern_node.is_some_and(|it| it.tag() == ExprTag::Spread) {
                continue;
            }
            let flags = flags_node.and_then(|it| get_string_if_constant(it, scope));
            let is_missing_flag = match &flags {
                Some(flags) => self.is_missing_flag(flags),
                None => flags_node.is_none(),
            };
            if !is_missing_flag {
                continue;
            }
            cx.report(node, self.require_message()).suggest(self.add_message(), |fixer| {
                let pattern = get_string_if_constant(pattern_node?, scope)?;
                if !self.is_valid_with_flag(file, &pattern) {
                    return None;
                }
                let replace_flag = self.replace_flag();
                let Some(flags_node) = flags_node else {
                    // The last token is the closing parenthesis.
                    let penultimate_token = file.tokens_in(node).nth_back(1)?;
                    let flag = replace_flag as char;
                    let argument = match is_comma_token(&penultimate_token) {
                        true => format!(" \"{flag}\","),
                        false => format!(", \"{flag}\""),
                    };
                    return Some(fixer.insert_after(penultimate_token, argument));
                };
                let text = flags_node.text();
                // A `u` can be part of an escape such as `g`, or come from a substitution.
                let is_literally_written = match flags_node.kind() {
                    ExprKind::String(_) => !strings::contains_char(text, b'\\'),
                    ExprKind::Template(template) => {
                        template.exprs().is_empty() && !strings::contains_char(text, b'\\')
                    }
                    _ => return None,
                };
                if strings::contains_char(&flags?, self.other_flag()) {
                    if !is_literally_written {
                        return None;
                    }
                    let replaced = replace_first(text, 0, self.other_flag(), replace_flag)?;
                    return Some(fixer.replace(flags_node, replaced));
                }
                let (quote, body) = text.split_last()?;
                Some(fixer.replace(flags_node, [body, &[replace_flag, *quote]].concat()))
            });
        }
    }
}
