//! Finds the end of a function's block without parsing it.

use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Before {
    Operand,
    Operator,
    Either,
}

fn is_keyword_before_an_expression(name: &[u8]) -> bool {
    matches!(
        name,
        b"return"
            | b"typeof"
            | b"instanceof"
            | b"in"
            | b"of"
            | b"new"
            | b"delete"
            | b"void"
            | b"throw"
            | b"case"
            | b"do"
            | b"else"
            | b"yield"
            | b"await"
    )
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'\\' | 0x80..)
}

fn is_line_end(byte: u8) -> bool {
    matches!(byte, b'\n' | b'\r')
}

fn find_what_stands_before(code: &[u8]) -> Before {
    let is_blank = |byte: &u8| matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C);
    let Some(last) = code.iter().rposition(|byte| !is_blank(byte)) else {
        return Before::Either;
    };
    let code = &code[..=last];
    match code[last] {
        b')' | b'}' | b'/' => Before::Either,
        b'+' | b'-' if last > 0 && code[last - 1] == code[last] => Before::Either,
        b']' | b'\'' | b'"' | b'`' => Before::Operand,
        byte if is_name_byte(byte) => {
            let start = code
                .iter()
                .rposition(|&byte| !is_name_byte(byte))
                .map_or(0, |at| at + 1);
            let is_member = start > 0 && matches!(code[start - 1], b'.' | b'#');
            match !is_member && is_keyword_before_an_expression(&code[start..]) {
                true => Before::Operator,
                false => Before::Operand,
            }
        }
        _ => Before::Operator,
    }
}

fn names_what_loads_modules(block: &[u8]) -> bool {
    [&b"import"[..], b"require"].iter().any(|&word| {
        let mut from = 0;
        while let Some(found) = strings::index_of(&block[from..], word) {
            let (start, end) = (from + found, from + found + word.len());
            let begins_a_name = start == 0
                || !(is_name_byte(block[start - 1]) || matches!(block[start - 1], b'.' | b'#'));
            if begins_a_name && !block.get(end).copied().is_some_and(is_name_byte) {
                return true;
            }
            from = end;
        }
        false
    })
}

fn skip_string(text: &[u8], at: usize) -> Option<usize> {
    let ends = [text[at], b'\\', b'\n', b'\r'];
    let mut at = at + 1;
    loop {
        at += strings::index_of_any(text.get(at..)?, &ends)?;
        match text[at] {
            b'\\' => at += 2,
            byte if is_line_end(byte) => return None,
            _ => return Some(at + 1),
        }
    }
}

fn skip_template_text(text: &[u8], mut at: usize) -> Option<(usize, bool)> {
    loop {
        at += strings::index_of_any(text.get(at..)?, b"`\\$")?;
        match text[at] {
            b'\\' => at += 2,
            b'`' => return Some((at + 1, false)),
            _ if text.get(at + 1) == Some(&b'{') => return Some((at + 2, true)),
            _ => at += 1,
        }
    }
}

fn skip_regular_expression(text: &[u8], at: usize) -> Option<usize> {
    let mut at = at + 1;
    let mut is_in_class = false;
    loop {
        match *text.get(at)? {
            b'\\' => at += 1,
            b'[' => is_in_class = true,
            b']' => is_in_class = false,
            b'/' if !is_in_class => break,
            byte if is_line_end(byte) => return None,
            _ => {}
        }
        at += 1;
    }
    at += 1;
    while text.get(at).copied().is_some_and(is_name_byte) {
        at += 1;
    }
    Some(at)
}

pub(crate) fn find_end_of_block(text: &[u8], open: usize) -> Option<usize> {
    debug_assert_eq!(text.get(open), Some(&b'{'));
    let mut at = open + 1;
    let mut depth = 1u32;
    let mut depths_around_holes: Vec<u32> = Vec::new();
    let mut end_of_last_comment = at;
    loop {
        at += strings::index_of_any(text.get(at..)?, b"{}'\"`/")?;
        match text[at] {
            b'{' => {
                depth += 1;
                at += 1;
            }
            b'}' => {
                depth -= 1;
                at += 1;
                if depth > 0 {
                    continue;
                }
                let Some(depth_around) = depths_around_holes.pop() else {
                    let close = at - 1;
                    return (!names_what_loads_modules(&text[open..close])).then_some(close);
                };
                let (end, opens_hole) = skip_template_text(text, at)?;
                at = end;
                depth = depth_around;
                if opens_hole {
                    depths_around_holes.push(depth_around);
                    depth = 1;
                }
            }
            b'\'' | b'"' => at = skip_string(text, at)?,
            b'`' => {
                let (end, opens_hole) = skip_template_text(text, at + 1)?;
                at = end;
                if opens_hole {
                    depths_around_holes.push(depth);
                    depth = 1;
                }
            }
            _ => match text.get(at + 1) {
                Some(b'/') => {
                    at += 2 + strings::index_of_any(&text[at + 2..], b"\n\r")?;
                    end_of_last_comment = at;
                }
                Some(b'*') => {
                    at += 4 + strings::index_of(&text[at + 2..], b"*/")?;
                    end_of_last_comment = at;
                }
                _ => match find_what_stands_before(&text[end_of_last_comment..at]) {
                    Before::Operand => at += 1,
                    Before::Operator => at = skip_regular_expression(text, at)?,
                    Before::Either => return None,
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::find_end_of_block;

    fn block(text: &str) -> Option<&str> {
        find_end_of_block(text.as_bytes(), 0).map(|close| &text[..=close])
    }

    #[test]
    fn braces_are_counted() {
        assert_eq!(block("{} rest }"), Some("{}"));
        assert_eq!(
            block("{ if (a) { b(); } else { c = { d: {} }; } } }"),
            Some("{ if (a) { b(); } else { c = { d: {} }; } }")
        );
        assert_eq!(block("{ a; "), None);
        assert_eq!(block("{ { }"), None);
    }

    #[test]
    fn strings_and_comments_hold_no_braces() {
        for text in [
            r#"{ a = "}"; }"#,
            r#"{ a = '}\'}'; }"#,
            "{ // }\n }",
            "{ /* } */ }",
            "{ /* } \n * } */ }",
            "{ a = \"\\\n}\"; }",
        ] {
            assert_eq!(block(text), Some(text), "{text}");
        }
        assert_eq!(block("{ a = \"}\n\"; }"), None);
        assert_eq!(block("{ /* } "), None);
        assert_eq!(block("{ // }"), None);
    }

    #[test]
    fn templates_nest() {
        for text in [
            "{ a = `}`; }",
            "{ a = `${b}}`; }",
            "{ a = `${ { c: `}${d}` } }}`; }",
            "{ a = `\\`}${'}'}`; }",
            "{ a = `$}{`; }",
        ] {
            assert_eq!(block(text), Some(text), "{text}");
        }
        assert_eq!(block("{ a = `${b}; }"), None);
    }

    #[test]
    fn regular_expressions_and_divisions() {
        for text in [
            "{ a = /}/; }",
            "{ a = /[/}]/g.test(b); }",
            "{ return /\\/}/; }",
            "{ f(/}/, b / c / d); }",
            "{ a = b / 2; c = d[0] / e; }",
            "{ a = 'x' / 2; }",
        ] {
            assert_eq!(block(text), Some(text), "{text}");
        }
    }

    #[test]
    fn what_cannot_be_told_is_parsed() {
        assert_eq!(block("{ a = (b) / 2; }"), None);
        assert_eq!(block("{ if (b) /}/.test(c); }"), None);
        assert_eq!(block("{ {} /}/.test(c); }"), None);
        assert_eq!(block("{ a++ / 2; }"), None);
        assert_eq!(block("{ a = /}\n/; }"), None);
        assert_eq!(block("{ a = b /* c */ / 2; }"), None);
        assert_eq!(block("{ a = // c\n /}/; }"), None);
    }

    #[test]
    fn blocks_that_load_modules_are_parsed() {
        assert_eq!(block("{ return import('./a'); }"), None);
        assert_eq!(block("{ let a: import('./a').B; }"), None);
        assert_eq!(block("{ return require('./a'); }"), None);
        assert_eq!(block("{ return import.meta.url; }"), None);
        assert_eq!(block("{ a = 'import(x)'; }"), None);
        for text in [
            "{ a.import(); }",
            "{ a.require('b'); }",
            "{ imports(); required = 1; reimport(); }",
        ] {
            assert!(block(text).is_some(), "{text}");
        }
    }
}
