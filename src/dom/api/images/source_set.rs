//! https://html.spec.whatwg.org/#images-processing-model

use super::before;
use crate::order::Order as _;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Descriptor {
    Density(f64),
    Width(f64),
}

pub(super) struct Candidate<'s> {
    pub(super) url: &'s str,
    pub(super) descriptor: Descriptor,
}

fn is_space(it: char) -> bool {
    it.is_ascii_whitespace()
}

fn are_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|it| it.is_ascii_digit())
}

/// https://html.spec.whatwg.org/#valid-floating-point-number
fn valid_float(text: &str) -> Option<f64> {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let mantissa = before(before(unsigned, b'e'), b'E');
    let whole = before(mantissa, b'.');
    let is_mantissa = mantissa.get(whole.len() + 1..).map_or_else(
        || are_digits(whole),
        |fraction| (whole.is_empty() || are_digits(whole)) && are_digits(fraction),
    );
    (is_mantissa
        && unsigned
            .get(mantissa.len() + 1..)
            .is_none_or(|it| are_digits(it.strip_prefix(['-', '+']).unwrap_or(it))))
    .then(|| text.parse().ok())?
}

/// Up to the first character outside of parentheses that ends it.
fn split_outside_of_parentheses(text: &str, ends: impl Fn(char) -> bool) -> (&str, &str) {
    let mut is_inside = false;
    let end = text.bytes().map(char::from).position(|it| {
        is_inside = if is_inside { it != ')' } else { it == '(' };
        !is_inside && ends(it)
    });
    text.split_at(end.unwrap_or(text.len()))
}

#[optimize(size)]
fn parse_descriptors(mut text: &str) -> Option<Descriptor> {
    let [mut width, mut height, mut density] = [None; 3];
    loop {
        let descriptor;
        (descriptor, text) =
            split_outside_of_parentheses(text.trim_start_matches(is_space), is_space);
        let Some(unit) = descriptor.chars().next_back() else {
            break;
        };
        let number = &descriptor[..descriptor.len() - unit.len_utf8()];
        let count = || {
            are_digits(number)
                .then(|| number.parse::<f64>().ok())
                .flatten()
                .filter(|it| *it > 0.0)
        };
        let (slot, value) = match unit {
            'w' => (&mut width, count()?),
            'h' => (&mut height, count()?),
            'x' => (&mut density, valid_float(number).filter(|it| *it >= 0.0)?),
            _ => return None,
        };
        slot.replace(value).is_none().then_some(())?;
    }
    match (width, height, density) {
        (Some(width), _, None) => Some(Descriptor::Width(width)),
        (None, None, density) => Some(Descriptor::Density(density.unwrap_or(1.0))),
        _ => None,
    }
}

/// https://html.spec.whatwg.org/#parse-a-srcset-attribute
#[optimize(size)]
pub(super) fn parse(mut text: &str) -> impl Iterator<Item = Candidate<'_>> {
    core::iter::from_fn(move || {
        loop {
            text = text.trim_start_matches(|it| is_space(it) || it == ',');
            let (url, rest) = text.split_at(
                bun_core::strings::index_of_any(text.as_bytes(), b"\t\n\x0c\r ")
                    .map_or(text.len(), |it| it as usize),
            );
            let trimmed = url.trim_end_matches(',');
            let descriptors;
            (descriptors, text) = if trimmed.len() == url.len() {
                split_outside_of_parentheses(rest, |it| it == ',')
            } else {
                ("", rest)
            };
            (!url.is_empty()).then_some(())?;
            if let Some(descriptor) = parse_descriptors(descriptors) {
                return Some(Candidate {
                    url: trimmed,
                    descriptor,
                });
            }
        }
    })
}

/// https://html.spec.whatwg.org/#select-an-image-source-from-a-source-set. They have a URL and a density.
#[optimize(size)]
pub(super) fn select<'s>(
    mut candidates: Vec<(&'s str, f64)>,
    scale: f64,
    mut is_available: impl FnMut(&str) -> bool,
) -> Option<(&'s str, f64)> {
    candidates.order_by(|a, b| a.1.total_cmp(&b.1));
    candidates.dedup_by(|later, earlier| later.1 == earlier.1);
    let Some(wanted) = candidates.iter().position(|it| it.1 >= scale) else {
        return candidates.pop();
    };
    candidates[wanted + 1..]
        .iter()
        .rfind(|it| is_available(it.0))
        .or_else(|| candidates.get(wanted))
        .copied()
}
