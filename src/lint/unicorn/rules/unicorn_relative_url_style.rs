use bun_lint_oxlint::ast_util::is_new_expression;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent relative URL style.
pub struct RelativeUrlStyle {
    always: bool,
}

const NEVER: Message = Message::new("", "Remove the `./` prefix from the relative URL.");
const ALWAYS: Message = Message::new("", "Add a `./` prefix to the relative URL.");
const REMOVE: Message = Message::new("", "Remove leading `./`");

impl Rule for RelativeUrlStyle {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "relative-url-style", Kind::Suggestion).fixable(Fixable::Code).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RelativeUrlStyle { always: options.str(0) == Some("always") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("URL") {
            return;
        }
        on.exprs([ExprTag::New], |rule, e, cx| {
            let ExprKind::New(new_expr) = e.kind() else {
                return;
            };
            if !is_new_expression(new_expr, &["URL"], Some(2), Some(2)) {
                return;
            }
            let (Some(first_arg), Some(base)) = (new_expr.args().first(), new_expr.args().get(1)) else {
                return;
            };
            if base.tag() == ExprTag::Spread || first_arg.is_parenthesized() {
                return;
            }
            let base = base.as_string().filter(|_| !base.is_parenthesized()).map(Name::bytes);
            let after_quote = first_arg.span().start + 1;
            let dot_slash_span = Span::new(after_quote, after_quote + 2);
            match first_arg.kind() {
                ExprKind::String(url) if rule.always => {
                    if !matches!(url.bytes().first(), Some(b'.' | b'/')) && is_safe_to_add_dot_slash(url.bytes(), base) {
                        cx.report(first_arg, ALWAYS).fix(|fixer| fixer.insert_before(Span::empty(after_quote), "./"));
                    }
                }
                // As it is written.
                ExprKind::String(_) => {
                    if cx.slice(first_arg.span().shrink(1, 1)).strip_prefix(b"./").is_some_and(|it| is_safe_to_add_dot_slash(it, base)) {
                        cx.report(first_arg, NEVER).fix(|fixer| fixer.remove(dot_slash_span));
                    }
                }
                ExprKind::Template(template) if !rule.always && template.raw(0).starts_with(b"./") => {
                    cx.report(first_arg, NEVER).suggest(REMOVE, |fixer| fixer.remove(dot_slash_span));
                }
                _ => {}
            }
        });
    }
}

fn is_c0_control_or_space(byte: u8) -> bool {
    byte <= b' '
}

/// What a URL parser passes over wherever it is.
fn is_tab_or_newline(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | b'\r')
}

fn is_scheme_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.')
}

fn trim_end(url: &[u8]) -> &[u8] {
    let end = url.len() - url.iter().rev().take_while(|it| is_c0_control_or_space(**it)).count();
    url.get(..end).unwrap_or_default()
}

/// Whether `url` and `./url` are the same URL: relative to `base`, or else both relative to `https://example.com/a/b/` and to
/// `https://example.com/a/b.html`.
fn is_safe_to_add_dot_slash(url: &[u8], base: Option<&[u8]>) -> bool {
    let url = trim_end(url);
    // At the start it is dropped, after `./` it is part of the path.
    if !url.iter().take_while(|it| is_c0_control_or_space(**it)).all(|it| is_tab_or_newline(*it)) {
        return false;
    }
    let mut rest = url.iter().copied().filter(|it| !is_tab_or_newline(*it));
    match rest.next() {
        // The last part of the path of the base stays, and before `#` the query.
        None | Some(b'#') => base.and_then(parse_base).is_some_and(|it| it.is_directory && !it.has_query),
        Some(b'?') => base.and_then(parse_base).is_some_and(|it| it.is_directory),
        Some(b'/' | b'\\') => false,
        // `a:b` has a scheme.
        Some(first) if first.is_ascii_alphabetic() => rest.find(|it| !is_scheme_byte(*it)) != Some(b':'),
        Some(_) => true,
    }
}

struct Base {
    /// The path ends with a `/`.
    is_directory: bool,
    has_query: bool,
}

/// `None`: it is not a URL, or one that nothing is relative to. Names of hosts that are not ASCII are not examined.
fn parse_base(base: &[u8]) -> Option<Base> {
    let base = trim_end(base);
    let base: Vec<u8> = base.iter().copied().skip_while(|it| is_c0_control_or_space(*it)).filter(|it| !is_tab_or_newline(*it)).collect();
    let (scheme, rest) = strings::split_once_char(&base, b':')?;
    if !scheme.first()?.is_ascii_alphabetic() || !scheme.iter().all(|it| is_scheme_byte(*it)) {
        return None;
    }
    let scheme = scheme.to_ascii_lowercase();
    let is_file = scheme == b"file";
    let is_special = is_file || matches!(&scheme[..], b"http" | b"https" | b"ws" | b"wss" | b"ftp");
    let is_slash = |it: u8| it == b'/' || is_special && it == b'\\';
    let slashes = rest.iter().take_while(|it| is_slash(**it)).count();
    // After `https:` any number of slashes, also none, is before the host.
    let before_authority = if is_special && !is_file { Some(slashes) } else { (slashes >= 2).then_some(2) };
    let path_and_more = match before_authority {
        Some(before_authority) => {
            let after = rest.get(before_authority..)?;
            let end = after.iter().take_while(|it| !is_slash(**it) && !matches!(it, b'?' | b'#')).count();
            let (authority, after) = after.split_at_checked(end)?;
            validate_authority(authority, is_special, is_file)?;
            after
        }
        None if slashes == 0 && !is_file => return None,
        None => rest,
    };
    let path = path_and_more.get(..strings::index_of_any(path_and_more, b"?#").unwrap_or(path_and_more.len()))?;
    let last_segment = path.get(path.len() - path.iter().rev().take_while(|it| !is_slash(**it)).count()..)?;
    let is_dots = matches!(&last_segment.to_ascii_lowercase()[..], b"." | b".." | b"%2e" | b".%2e" | b"%2e." | b"%2e%2e");
    Some(Base {
        is_directory: if path.is_empty() { is_special } else { last_segment.is_empty() || is_dots },
        has_query: path_and_more.get(path.len()) == Some(&b'?'),
    })
}

/// `user:password@host:port`
fn validate_authority(authority: &[u8], is_special: bool, is_file: bool) -> Option<()> {
    if is_file {
        // `file://C:/` has no host.
        let is_drive_letter = matches!(authority, [letter, b':' | b'|'] if letter.is_ascii_alphabetic());
        return (authority.is_empty() || is_drive_letter || is_valid_domain(authority)).then_some(());
    }
    let credentials_end = strings::last_index_of_char(authority, b'@');
    let host_and_port = credentials_end.and_then(|it| authority.get(it + 1..)).unwrap_or(authority);
    let (host, port) = match host_and_port.strip_prefix(b"[") {
        Some(bracketed) => {
            let (address, after) = strings::split_once_char(bracketed, b']')?;
            std::str::from_utf8(address).ok()?.parse::<std::net::Ipv6Addr>().ok()?;
            (None, if after.is_empty() { None } else { Some(after.strip_prefix(b":")?) })
        }
        None => match strings::split_once_char(host_and_port, b':') {
            Some((host, port)) => (Some(host), Some(port)),
            None => (Some(host_and_port), None),
        },
    };
    let port_number = port.unwrap_or_default().iter().try_fold(0u32, |all, digit| {
        digit.is_ascii_digit().then(|| (all * 10 + u32::from(digit - b'0')).min(1 << 16))
    })?;
    let is_valid_host = match host {
        None => true,
        Some(b"") => !is_special && credentials_end.is_none() && port.is_none(),
        Some(host) if is_special => is_valid_domain(host),
        Some(host) => !host.iter().any(|it| is_forbidden_host_code_point(*it)),
    };
    (port_number < 1 << 16 && is_valid_host).then_some(())
}

fn is_forbidden_host_code_point(byte: u8) -> bool {
    matches!(byte, 0 | b'\t' | b'\n' | b'\r' | b' ' | b'#' | b'/' | b':' | b'<' | b'>' | b'?' | b'@' | b'[' | b'\\' | b']' | b'^' | b'|')
}

fn is_valid_domain(host: &[u8]) -> bool {
    let hex = |it: u8| (it as char).to_digit(16);
    let mut decoded = Vec::with_capacity(host.len());
    let mut rest = host;
    while let Some((&byte, after)) = rest.split_first() {
        let escaped = match after {
            [high, low, ..] if byte == b'%' => hex(*high).zip(hex(*low)),
            _ => None,
        };
        decoded.push(escaped.map_or(byte, |(high, low)| (high * 16 + low) as u8));
        rest = if escaped.is_some() { after.get(2..).unwrap_or_default() } else { after };
    }
    !decoded.iter().any(|it| is_forbidden_host_code_point(*it) || matches!(it, 0..=0x1F | b'%' | 0x7F)) && is_valid_if_ipv4(&decoded)
}

/// A host whose last part is a number has to be an IPv4 address.
fn is_valid_if_ipv4(host: &[u8]) -> bool {
    fn parse(part: &[u8]) -> Option<u64> {
        let (digits, radix) = match part {
            [] => return None,
            [b'0', b'x' | b'X', digits @ ..] => (digits, 16),
            [b'0', digits @ ..] if !digits.is_empty() => (digits, 8),
            _ => (part, 10),
        };
        digits.iter().try_fold(0u64, |all, digit| Some((all * u64::from(radix) + u64::from((*digit as char).to_digit(radix)?)).min(1 << 33)))
    }
    let parts: Vec<&[u8]> = strings::split(host.strip_suffix(b".").unwrap_or(host), b".").collect();
    let Some((last, others)) = parts.split_last() else {
        return true;
    };
    let ends_in_a_number = !last.is_empty() && last.iter().all(u8::is_ascii_digit) || parse(last).is_some();
    !ends_in_a_number
        || parts.len() <= 4
            && others.iter().all(|it| parse(it).is_some_and(|it| it <= 255))
            && parse(last).is_some_and(|it| it < 256u64.pow(5 - parts.len() as u32))
}
