//! Turns schema errors for rule options into one readable message with a location. Used for bunfig.toml's `[lint.rules]`
//! and `--rule`, where the output doesn't have to match ESLint's.

use super::validate::{Of, SchemaError, Step, Why};
use crate::linter::message::write_json;
use crate::options::Json;
use bun_core::strings;
use std::cmp::Ordering;

/// Returned by [`mistake_in_options`](super::mistake_in_options).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OptionMistake {
    /// Path from the options array (without the severity) to the invalid value. The value may not exist.
    pub path: Vec<Step>,
    /// The last key in `path` is the problem, not its value.
    pub is_about_key: bool,
    /// The error, plus a second line with the expected values if they're known.
    pub message: Vec<u8>,
}

fn printed(value: &Json) -> Vec<u8> {
    let mut out = Vec::new();
    write_json(&mut out, value);
    out
}

fn string(text: &[u8]) -> Vec<u8> {
    printed(&Json::String(text.to_vec()))
}

/// `a`, `a or b`, `a, b, or c`
fn one_of(items: &[Vec<u8>]) -> Vec<u8> {
    match items {
        [] => Vec::new(),
        [one] => one.clone(),
        [one, other] => [&one[..], b" or ", other].concat(),
        [first @ .., last] => [&first.join(&b", "[..])[..], b", or ", last].concat(),
    }
}

fn counted(count: f64, noun: &str) -> Vec<u8> {
    let plural = if count == 1.0 { "" } else { "s" };
    [
        &printed(&Json::Number(count))[..],
        b" ",
        noun.as_bytes(),
        plural.as_bytes(),
    ]
    .concat()
}

/// Path to the value that caused `error`, and whether the problem is the key itself.
fn place_of(error: &SchemaError) -> (Vec<Step>, bool) {
    let mut path = error.path.clone();
    match &error.why {
        // Point at the first extra item.
        Why::Most(limit, Of::Items) => path.push(Step::Index(*limit as usize)),
        Why::Unknown(key, _) => path.push(Step::Key(key.clone())),
        _ => return (path, false),
    }
    (path, matches!(error.why, Why::Unknown(..)))
}

/// Orders error paths. A schema alternative that fails later or deeper matched more of the input, so its error is more useful.
fn compare(a: &[Step], b: &[Step]) -> Ordering {
    let differing = a.iter().zip(b).find_map(|steps| match steps {
        (Step::Index(a), Step::Index(b)) if a != b => Some(a.cmp(b)),
        _ => None,
    });
    differing.unwrap_or_else(|| a.len().cmp(&b.len()))
}

/// Adds what `why` expects to `into`. The items are printed after "Expected ".
fn expected_by(why: &Why, into: &mut Vec<Vec<u8>>) {
    let limit = |bound: &str, limit: f64, of: Of| match of {
        Of::Value => [
            b"a number that is ",
            bound.as_bytes(),
            b" ",
            &printed(&Json::Number(limit)),
        ]
        .concat(),
        Of::Characters => [bound.as_bytes(), b" ", &counted(limit, "character")].concat(),
        Of::Items => [bound.as_bytes(), b" ", &counted(limit, "item")].concat(),
        Of::Properties => [bound.as_bytes(), b" ", &counted(limit, "key")].concat(),
    };
    let all: Vec<Vec<u8>> = match why {
        Why::Allowed(values) => values.iter().map(printed).collect(),
        Why::Type(names) => (names.iter())
            .map(|name| match &name[..] {
                b"string" => b"a string".to_vec(),
                b"number" => b"a number".to_vec(),
                b"integer" => b"a whole number".to_vec(),
                b"boolean" => b"true or false".to_vec(),
                b"array" => b"an array".to_vec(),
                b"object" => b"an object".to_vec(),
                name => name.to_vec(),
            })
            .collect(),
        Why::Most(most, of) => vec![limit("at most", *most, *of)],
        Why::Least(least, of) => vec![limit("at least", *least, *of)],
        Why::Pattern(pattern) => vec![[b"a string that matches /", &pattern[..], b"/"].concat()],
        Why::Duplicates => vec![b"no item twice".to_vec()],
        Why::Missing(_) | Why::Unknown(..) | Why::Composite => Vec::new(),
    };
    for it in all {
        if !into.contains(&it) {
            into.push(it);
        }
    }
}

/// Picks the most useful of `errors` and describes it. `rule` is the rule name as the user wrote it.
pub(super) fn explain(rule: &[u8], errors: &[SchemaError]) -> OptionMistake {
    let mut telling = errors.iter().filter(|it| !matches!(it.why, Why::Composite));
    let Some(first) = telling.next() else {
        return OptionMistake {
            path: Vec::new(),
            is_about_key: false,
            message: [b"Invalid options for ", rule].concat(),
        };
    };
    let best = telling.fold(first, |best, it| {
        match compare(&place_of(it).0, &place_of(best).0) {
            Ordering::Greater => it,
            Ordering::Less | Ordering::Equal => best,
        }
    });
    let (path, is_about_key) = place_of(best);
    let key = path.iter().rev().find_map(|it| match it {
        Step::Key(key) => Some(string(key)),
        Step::Index(_) => None,
    });
    let mut expected = Vec::new();
    for error in errors.iter().filter(|it| place_of(it).0 == path) {
        expected_by(&error.why, &mut expected);
    }
    let expected = match expected.is_empty() {
        true => Vec::new(),
        false => [b"\n  Expected ", &one_of(&expected)[..]].concat(),
    };
    let message = match (&best.why, &key) {
        (Why::Unknown(name, known), _) => {
            let most = name.len().max(3) / 3;
            let distance = |it: &&Vec<u8>| strings::edit_distance(name.iter().copied(), &it[..]);
            let close = known.iter().min_by_key(distance);
            let names: Vec<Vec<u8>> = known.iter().map(|it| string(it)).collect();
            let hint = match close.filter(|it| distance(it) <= most) {
                Some(close) => [b"\n  Did you mean ", &string(close)[..], b"?"].concat(),
                None if names.is_empty() => Vec::new(),
                None => [b"\n  Expected ", &one_of(&names)[..]].concat(),
            };
            [b"Unknown option ", &string(name)[..], b" for ", rule, &hint].concat()
        }
        (Why::Missing(name), _) => [rule, b" needs the option ", &string(name)].concat(),
        (Why::Most(most, Of::Items), None) if *most == 0.0 => [rule, b" takes no options"].concat(),
        (Why::Most(most, Of::Items), None) => {
            [rule, b" takes at most ", &counted(*most, "option")].concat()
        }
        (Why::Least(least, Of::Items), None) if path.is_empty() => {
            [rule, b" needs at least ", &counted(*least, "option")].concat()
        }
        (Why::Most(_, Of::Items), Some(key)) => {
            [b"Too many items in ", &key[..], b" for ", rule, &expected].concat()
        }
        (_, None) => {
            let value = printed(&best.data);
            [&value[..], b" is not a valid option for ", rule, &expected].concat()
        }
        (_, Some(key)) => {
            let value = printed(&best.data);
            let said: [&[u8]; 6] = [&value, b" is not valid for ", key, b" of ", rule, &expected];
            said.concat()
        }
    };
    OptionMistake {
        path,
        is_about_key,
        message,
    }
}
