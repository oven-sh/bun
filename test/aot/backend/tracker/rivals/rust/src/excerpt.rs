use crate::format::{escape, wrapped};

/// The first words of a text.
pub fn summary(text: &str, most: usize) -> String {
    let mut words = text.split_whitespace();
    let mut short = String::new();
    for (i, word) in words.by_ref().take(most).enumerate() {
        if i > 0 {
            short.push(' ');
        }
        short.push_str(word);
    }
    if words.next().is_some() {
        short.push_str(" ...");
    }
    short
}

fn begins_with_term(word: &str, terms: &[String]) -> bool {
    let lower = word.to_lowercase();
    terms.iter().any(|term| lower.starts_with(term.as_str()))
}

/// Some thirty words around the first one that begins with a term that was searched for, with those words marked.
pub fn push_marked_excerpt(out: &mut String, text: &str, terms: &[String]) {
    let words: Vec<&str> = text.split_whitespace().collect();
    let first = words.iter().position(|word| begins_with_term(word, terms)).unwrap_or(0);
    let from = first.saturating_sub(8);
    let to = words.len().min(from + 30);
    if from > 0 {
        out.push_str("... ");
    }
    for (i, word) in words[from..to].iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        if begins_with_term(word, terms) {
            wrapped(out, "<mark>", word, "</mark>");
        } else {
            escape(out, word);
        }
    }
    if to < words.len() {
        out.push_str(" ...");
    }
}
