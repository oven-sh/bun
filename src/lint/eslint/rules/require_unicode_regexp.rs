use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap, get_string_if_constant, is_comma_token};
use bun_lint::utils::regular_expressions::{UnicodeFlag, is_valid_with_unicode_flag};

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

    fn check_literal<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Regex(regex) = e.kind() else {
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

    fn check_calls<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let scope = Some(file.scope());
        for reference in ReferenceTracker::new(file).iterate_global_references(&TRACE_MAP) {
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

impl Rule for RequireUnicodeRegexp {
    const META: Meta = Meta::eslint("require-unicode-regexp", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireUnicodeRegexp {
            require_flag: match options.object(0).str("requireFlag") {
                Some("u") => Some(UnicodeFlag::U),
                Some("v") => Some(UnicodeFlag::V),
                _ => None,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Regex], Self::check_literal);
        on.finish(Self::check_calls);
    }
}
