//! A small subset of Markdown: headings, paragraphs, lists, quotations, fenced code, and in a line: `code`, **strong**, *emphasis*,
//! [links](https://..), @mentions and #123 references to issues of the same project.

use crate::format::{escape, push_int, wrapped};

fn is_digit(byte: u8) -> bool {
    byte.is_ascii_digit()
}

fn is_login_character(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
}

pub fn is_word_character(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

pub fn end_of_run(text: &str, from: usize, belongs: fn(u8) -> bool) -> usize {
    text.as_bytes()[from..].iter().position(|&byte| !belongs(byte)).map_or(text.len(), |n| from + n)
}

/// The place of what is looked for at or behind `from`.
fn find_from(text: &str, wanted: &str, from: usize) -> Option<usize> {
    text.get(from..)?.find(wanted).map(|n| from + n)
}

fn render_inline(out: &mut String, text: &str, project_slug: &str) {
    let bytes = text.as_bytes();
    let (mut plain_from, mut at) = (0, 0);
    while at < bytes.len() {
        let mut end = None;
        match bytes[at] {
            b'`' => {
                if let Some(close) = find_from(text, "`", at + 1).filter(|&close| close > at + 1) {
                    escape(out, &text[plain_from..at]);
                    wrapped(out, "<code>", &text[at + 1..close], "</code>");
                    end = Some(close + 1);
                }
            }
            b'*' if bytes.get(at + 1) == Some(&b'*') => {
                if let Some(close) = find_from(text, "**", at + 2).filter(|&close| close > at + 2) {
                    escape(out, &text[plain_from..at]);
                    wrapped(out, "<strong>", &text[at + 2..close], "</strong>");
                    end = Some(close + 2);
                }
            }
            b'*' => {
                if let Some(close) = find_from(text, "*", at + 1).filter(|&close| close > at + 1) {
                    escape(out, &text[plain_from..at]);
                    wrapped(out, "<em>", &text[at + 1..close], "</em>");
                    end = Some(close + 1);
                }
            }
            b'[' => {
                if let Some(middle) = find_from(text, "](", at + 1).filter(|&middle| middle > at + 1) {
                    if let Some(close) = find_from(text, ")", middle + 2).filter(|&close| close > middle + 2) {
                        let url = &text[middle + 2..close];
                        if url.starts_with("https://") || url.starts_with("http://") {
                            escape(out, &text[plain_from..at]);
                            wrapped(out, "<a href=\"", url, "\" rel=\"nofollow\">");
                            wrapped(out, "", &text[at + 1..middle], "</a>");
                            end = Some(close + 1);
                        }
                    }
                }
            }
            sign @ (b'@' | b'#') if at == 0 || !is_word_character(bytes[at - 1]) => {
                let stop = end_of_run(text, at + 1, if sign == b'@' { is_login_character } else { is_digit });
                if stop > at + 1 {
                    let name = &text[at + 1..stop];
                    escape(out, &text[plain_from..at]);
                    if sign == b'@' {
                        out.push_str("<a class=\"mention\" href=\"/u/");
                        out.push_str(name);
                        out.push_str("\">@");
                    } else {
                        out.push_str("<a class=\"reference\" href=\"/p/");
                        out.push_str(project_slug);
                        out.push_str("/issues/");
                        out.push_str(name);
                        out.push_str("\">#");
                    }
                    out.push_str(name);
                    out.push_str("</a>");
                    end = Some(stop);
                }
            }
            _ => {}
        }
        match end {
            Some(end) => (at, plain_from) = (end, end),
            None => at += 1,
        }
    }
    escape(out, &text[plain_from..]);
}

fn is_ordered_item(line: &str) -> bool {
    let end = end_of_run(line, 0, is_digit);
    end > 0 && line[end..].starts_with(". ")
}

fn is_fence(line: &str) -> bool {
    line.starts_with("```")
}

fn is_no_fence(line: &str) -> bool {
    !is_fence(line)
}

fn is_quotation(line: &str) -> bool {
    line.starts_with("> ")
}

fn is_bullet_item(line: &str) -> bool {
    line.starts_with("- ")
}

fn is_heading(line: &str) -> bool {
    line.starts_with("# ") || line.starts_with("## ") || line.starts_with("### ")
}

fn is_paragraph_line(line: &str) -> bool {
    !line.is_empty() && !is_fence(line) && !is_heading(line) && !is_quotation(line) && !is_bullet_item(line) && !is_ordered_item(line)
}

/// The lines from `at` on that belong to one block. `at` moves behind them.
fn run<'a, 'b>(lines: &'b [&'a str], at: &mut usize, belongs: fn(&str) -> bool) -> &'b [&'a str] {
    let from = *at;
    while *at < lines.len() && belongs(lines[*at]) {
        *at += 1;
    }
    &lines[from..*at]
}

fn items(out: &mut String, open: &str, taken: &[&str], skip: fn(&str) -> usize, close: &str, project_slug: &str) {
    out.push_str(open);
    for line in taken {
        out.push_str("<li>");
        render_inline(out, &line[skip(line)..], project_slug);
        out.push_str("</li>");
    }
    out.push_str(close);
}

pub fn render_markdown(out: &mut String, source: &str, project_slug: &str) {
    let lines: Vec<&str> = source.split('\n').collect();
    let mut at = 0;
    while at < lines.len() {
        let line = lines[at];
        if line.is_empty() {
            at += 1;
        } else if is_fence(line) {
            at += 1;
            let code = run(&lines, &mut at, is_no_fence).join("\n");
            at += 1;
            wrapped(out, "<pre><code>", &code, "</code></pre>\n");
        } else if is_heading(line) {
            let level = line.find(' ').unwrap_or(0);
            out.push_str("<h");
            push_int(out, level + 2);
            out.push('>');
            render_inline(out, &line[level + 1..], project_slug);
            out.push_str("</h");
            push_int(out, level + 2);
            out.push_str(">\n");
            at += 1;
        } else if is_quotation(line) {
            let quoted: Vec<&str> = run(&lines, &mut at, is_quotation).iter().map(|line| &line[2..]).collect();
            out.push_str("<blockquote><p>");
            render_inline(out, &quoted.join("\n"), project_slug);
            out.push_str("</p></blockquote>\n");
        } else if is_bullet_item(line) {
            items(out, "<ul>", run(&lines, &mut at, is_bullet_item), |_| 2, "</ul>\n", project_slug);
        } else if is_ordered_item(line) {
            items(out, "<ol>", run(&lines, &mut at, is_ordered_item), |line| line.find(' ').map_or(0, |n| n + 1), "</ol>\n", project_slug);
        } else {
            let paragraph = run(&lines, &mut at, is_paragraph_line).join("\n");
            out.push_str("<p>");
            render_inline(out, &paragraph, project_slug);
            out.push_str("</p>\n");
        }
    }
}
