//! Many lint plugins load TypeScript, 9 MB of code, to read a few of its enums and to have the rest at hand for a project with
//! types. They get a module that has the same exports, knows the enums, and loads the real one for anything else.

use bun_core::strings;

pub(crate) fn is_typescript(path: &[u8]) -> bool {
    path.ends_with(b"/node_modules/typescript/lib/typescript.js")
        || cfg!(windows) && path.ends_with(b"\\node_modules\\typescript\\lib\\typescript.js")
}

fn between<'t>(text: &'t [u8], start: &[u8], end: &[u8]) -> Option<&'t [u8]> {
    let rest = &text[strings::index_of(text, start)? + start.len()..];
    Some(&rest[..strings::index_of(rest, end)?])
}

fn is_word(text: &[u8]) -> bool {
    !text.is_empty() && (text.iter()).all(|it| it.is_ascii_alphanumeric() || *it == b'_')
}

fn is_plain_string(text: &[u8]) -> bool {
    matches!(text, [b'"', inner @ .., b'"'] if strings::index_of_any(inner, b"\"\\\r\n").is_none())
}

/// `E[E["a"] = 1 /* b */] = "a";` or `E["a"] = "b";`
fn is_member(line: &[u8], parameter: &[u8]) -> bool {
    let check = || {
        let open = |it: &'_ [u8]| -> Option<usize> {
            it.strip_prefix(parameter)?.strip_prefix(b"[")?;
            Some(parameter.len() + 1)
        };
        let rest = line.strip_prefix(b"  ")?.strip_suffix(b";")?;
        let rest = &rest[open(rest)?..];
        let inner = open(rest);
        let rest = &rest[inner.unwrap_or(0)..];
        let at = strings::index_of(rest, b"] = ")?;
        let (name, mut value) = (&rest[..at], &rest[at + 4..]);
        if inner.is_some() {
            value = value.strip_suffix(name)?.strip_suffix(b"] = ")?;
        }
        if let Some(before_end) = value.strip_suffix(b" */") {
            let at = strings::index_of(before_end, b" /* ")?;
            let comment = &before_end[at + 4..];
            strings::split(comment, b".").all(is_word).then_some(())?;
            value = &value[..at];
        }
        let digits = value.strip_prefix(b"-").unwrap_or(value);
        let is_number = !digits.is_empty() && digits.iter().all(u8::is_ascii_digit);
        Some(is_plain_string(name) && (is_number || is_plain_string(value)))
    };
    check() == Some(true)
}

/// Each enum of nothing but literals with the function that fills it
fn enums(text: &[u8]) -> Vec<(&[u8], &[u8])> {
    const MIDDLE: &[u8] = b" = /* @__PURE__ */ ((";
    let (mut found, mut rest) = (Vec::new(), text);
    while let Some(at) = strings::index_of(rest, MIDDLE) {
        let line = strings::last_index_of_char(&rest[..at], b'\n').map_or(0, |it| it + 1);
        let name = rest[line..at].strip_prefix(b"var ");
        rest = &rest[at + MIDDLE.len() - 1..];
        let function = || {
            let name = name.filter(|it| is_word(it))?;
            let end = strings::index_of(rest, b"\n})(")?;
            let after = rest[end + 4..].strip_prefix(name)?;
            after.strip_prefix(b" || {});\n")?;
            let mut lines = strings::split(&rest[..end], b"\n");
            let parameter = lines.next()?.strip_prefix(b"(")?.strip_suffix(b") => {")?;
            let last = [b"  return ", parameter, b";"].concat();
            (is_word(parameter) && lines.all(|it| it == last || is_member(it, parameter)))
                .then_some((name, &rest[..end + 2]))
        };
        found.extend(function());
    }
    found.sort_unstable();
    found
}

/// The code of that module. `text`: typescript.js, as it is since version 5.5
pub(crate) fn front_of(text: &[u8]) -> Option<Vec<u8>> {
    let exports = between(
        text,
        b"\nvar typescript_exports = {};\n__export(typescript_exports, {\n",
        b"\n});\nmodule.exports = __toCommonJS(typescript_exports);\n",
    )?;
    if !strings::contains(text, b"\nvar __toCommonJS = (mod) => (__copyProps, mod);") {
        return None;
    }
    let enums = enums(text);
    let (mut names, mut known) = (Vec::new(), Vec::new());
    for line in strings::split(exports, b"\n") {
        let line = line.strip_prefix(b"  ")?;
        let line = line.strip_suffix(b",").unwrap_or(line);
        let at = strings::index_of(line, b": () => ")?;
        let (name, local) = (&line[..at], &line[at + 8..]);
        if !is_word(name) || !is_word(local) {
            return None;
        }
        names.extend_from_slice(&[name, b" "].concat());
        if let Ok(at) = enums.binary_search_by_key(&local, |it| it.0) {
            known.extend_from_slice(&[name, b": ", enums[at].1, b",\n"].concat());
        } else if matches!(local, b"version" | b"versionMajorMinor") {
            let value = between(text, &[b"\nvar ", local, b" = "].concat(), b";\n");
            let value = value.filter(|it| is_plain_string(it))?;
            known.extend_from_slice(&[name, b": () => ", value, b",\n"].concat());
        }
    }
    names.pop();
    let start = b"module.exports = $Bun_lazy.front(require, __filename, \"";
    Some([start, &names[..], b"\", {\n", &known[..], b"});\n"].concat())
}
