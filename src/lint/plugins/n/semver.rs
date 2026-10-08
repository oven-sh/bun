//! `Range` and `subset` of node-semver, without `loose` and `includePrerelease`.

use bun_core::strings;
use std::cmp::Ordering;

#[derive(Clone, PartialEq, Eq, Debug)]
enum Identifier {
    Number(u64),
    Text(Vec<u8>),
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub(crate) struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Vec<Identifier>,
}

impl Version {
    pub(crate) fn new([major, minor, patch]: [u16; 3]) -> Version {
        Version::of(u64::from(major), u64::from(minor), u64::from(patch))
    }

    fn of(major: u64, minor: u64, patch: u64) -> Version {
        Version {
            major,
            minor,
            patch,
            prerelease: Vec::new(),
        }
    }

    /// `major.minor.patch-0`
    fn before(major: u64, minor: u64, patch: u64) -> Version {
        Version {
            prerelease: vec![Identifier::Number(0)],
            ..Version::of(major, minor, patch)
        }
    }

    fn has_same_tuple(&self, other: &Version) -> bool {
        (self.major, self.minor, self.patch) == (other.major, other.minor, other.patch)
    }

    fn compare(&self, other: &Version) -> Ordering {
        let main =
            (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch));
        main.then_with(
            || match (self.prerelease.is_empty(), other.prerelease.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => {
                    for (a, b) in self.prerelease.iter().zip(&other.prerelease) {
                        let order = match (a, b) {
                            (Identifier::Number(a), Identifier::Number(b)) => a.cmp(b),
                            (Identifier::Number(_), Identifier::Text(_)) => Ordering::Less,
                            (Identifier::Text(_), Identifier::Number(_)) => Ordering::Greater,
                            (Identifier::Text(a), Identifier::Text(b)) => a.cmp(b),
                        };
                        if order != Ordering::Equal {
                            return order;
                        }
                    }
                    self.prerelease.len().cmp(&other.prerelease.len())
                }
            },
        )
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Operator {
    Greater,
    GreaterOrEqual,
    Less,
    LessOrEqual,
    Equal,
}

/// `None`: `ANY`, which every version satisfies.
#[derive(Clone, PartialEq, Eq, Debug)]
struct Comparator(Option<(Operator, Version)>);

impl Comparator {
    fn new(operator: Operator, version: Version) -> Comparator {
        Comparator(Some((operator, version)))
    }

    /// `<0.0.0-0`
    fn is_null_set(&self) -> bool {
        *self == Comparator::new(Operator::Less, Version::before(0, 0, 0))
    }

    fn test(&self, version: &Version) -> bool {
        let Some((operator, own)) = &self.0 else {
            return true;
        };
        let order = version.compare(own);
        match operator {
            Operator::Greater => order == Ordering::Greater,
            Operator::GreaterOrEqual => order != Ordering::Less,
            Operator::Less => order == Ordering::Less,
            Operator::LessOrEqual => order != Ordering::Greater,
            Operator::Equal => order == Ordering::Equal,
        }
    }

    /// `satisfies(version, String(comparator))`
    fn is_satisfied_by(&self, version: &Version) -> bool {
        self.test(version)
            && (version.prerelease.is_empty()
                || self
                    .0
                    .as_ref()
                    .is_some_and(|it| !it.1.prerelease.is_empty() && it.1.has_same_tuple(version)))
    }
}

/// A part of a version: a number, or `x`, `X`, `*` or nothing.
type Part = Option<u64>;

/// `XRANGEPLAIN`: `[v=\s]*1.2.3-pre+build`, of which the parts can be missing or `x`.
struct Partial {
    major: Part,
    minor: Part,
    patch: Part,
    prerelease: Vec<Identifier>,
}

fn parse_identifiers(text: &[u8]) -> Option<Vec<Identifier>> {
    let mut identifiers = Vec::new();
    for part in strings::split(text, b".") {
        if part.is_empty()
            || !part
                .iter()
                .all(|it| it.is_ascii_alphanumeric() || *it == b'-')
        {
            return None;
        }
        identifiers.push(match part.iter().all(u8::is_ascii_digit) {
            // A number has no leading zeros.
            true if part.len() > 1 && part[0] == b'0' => return None,
            true => Identifier::Number(std::str::from_utf8(part).ok()?.parse().ok()?),
            false => Identifier::Text(part.to_vec()),
        });
    }
    Some(identifiers)
}

fn parse_partial(text: &[u8]) -> Option<Partial> {
    let text = &text[text
        .iter()
        .take_while(|it| matches!(it, b'v' | b'='))
        .count()..];
    let (text, build) = match strings::index_of_char_usize(text, b'+') {
        Some(plus) => (&text[..plus], Some(&text[plus + 1..])),
        None => (text, None),
    };
    if build.is_some_and(|it| {
        it.is_empty()
            || !it
                .iter()
                .all(|it| it.is_ascii_alphanumeric() || matches!(it, b'-' | b'.'))
    }) {
        return None;
    }
    let (numbers, prerelease) = match strings::index_of_char_usize(text, b'-') {
        Some(dash) => (&text[..dash], Some(&text[dash + 1..])),
        None => (text, None),
    };
    let mut parts = [None; 3];
    let mut count = 0;
    for part in strings::split(numbers, b".") {
        let slot = parts.get_mut(count)?;
        count += 1;
        *slot = match part {
            b"x" | b"X" | b"*" => None,
            _ if part.is_empty()
                || !part.iter().all(u8::is_ascii_digit)
                || part.len() > 1 && part[0] == b'0' =>
            {
                return None;
            }
            _ => Some(std::str::from_utf8(part).ok()?.parse().ok()?),
        };
    }
    // Only a whole version has more.
    if (prerelease.is_some() || build.is_some()) && count < 3 {
        return None;
    }
    Some(Partial {
        major: parts[0],
        minor: parts[1],
        patch: parts[2],
        prerelease: match prerelease {
            Some(prerelease) => parse_identifiers(prerelease)?,
            None => Vec::new(),
        },
    })
}

use Operator::{Equal, Greater, GreaterOrEqual, Less, LessOrEqual};

/// `replaceCaret`, `replaceTilde` and `replaceXRange`: adds the comparators that `operator` and `version` stand for.
fn desugar(operator: &[u8], version: &Partial, out: &mut Vec<Comparator>) -> Option<()> {
    let Partial {
        major,
        minor,
        patch,
        prerelease,
    } = version;
    let from =
        |major, minor, patch| Comparator::new(GreaterOrEqual, Version::of(major, minor, patch));
    let below = |major, minor, patch| Comparator::new(Less, Version::before(major, minor, patch));
    let exact = |major, minor, patch| Version {
        prerelease: prerelease.clone(),
        ..Version::of(major, minor, patch)
    };
    match (operator, *major, *minor, *patch) {
        (b"^" | b"~" | b"~>", None, ..) => out.push(Comparator(None)),
        (b"^" | b"~" | b"~>", Some(major), None, _) => {
            out.extend([from(major, 0, 0), below(major + 1, 0, 0)])
        }
        (b"^", Some(0), Some(minor), None) => {
            out.extend([from(0, minor, 0), below(0, minor + 1, 0)])
        }
        (b"^", Some(major), Some(minor), None) => {
            out.extend([from(major, minor, 0), below(major + 1, 0, 0)])
        }
        (b"~" | b"~>", Some(major), Some(minor), None) => {
            out.extend([from(major, minor, 0), below(major, minor + 1, 0)])
        }
        (b"^", Some(major), Some(minor), Some(patch)) => {
            out.push(Comparator::new(GreaterOrEqual, exact(major, minor, patch)));
            out.push(match (major, minor) {
                (0, 0) => below(0, 0, patch + 1),
                (0, _) => below(0, minor + 1, 0),
                _ => below(major + 1, 0, 0),
            });
        }
        (b"~" | b"~>", Some(major), Some(minor), Some(patch)) => {
            out.extend([
                Comparator::new(GreaterOrEqual, exact(major, minor, patch)),
                below(major, minor + 1, 0),
            ]);
        }
        (b">" | b"<", None, ..) => out.push(below(0, 0, 0)),
        (_, None, ..) => out.push(Comparator(None)),
        (b"" | b"=", Some(major), None, _) => {
            out.extend([from(major, 0, 0), below(major + 1, 0, 0)])
        }
        (b"" | b"=", Some(major), Some(minor), None) => {
            out.extend([from(major, minor, 0), below(major, minor + 1, 0)])
        }
        (b">", Some(major), None, _) => out.push(from(major + 1, 0, 0)),
        (b">", Some(major), Some(minor), None) => out.push(from(major, minor + 1, 0)),
        (b"<=", Some(major), None, _) => out.push(below(major + 1, 0, 0)),
        (b"<=", Some(major), Some(minor), None) => out.push(below(major, minor + 1, 0)),
        (b"<", Some(major), minor, None) => out.push(below(major, minor.unwrap_or(0), 0)),
        (b">=", Some(major), minor, None) => out.push(from(major, minor.unwrap_or(0), 0)),
        (_, Some(major), Some(minor), Some(patch)) => {
            let operator = match operator {
                b">" => Greater,
                b">=" => GreaterOrEqual,
                b"<" => Less,
                b"<=" => LessOrEqual,
                b"" | b"=" => Equal,
                _ => return None,
            };
            out.push(Comparator::new(operator, exact(major, minor, patch)));
        }
        _ => return None,
    }
    Some(())
}

fn words_of(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    strings::split_any(text, b" \t\n\r\x0B\x0C").filter(|it| !it.is_empty())
}

/// `parseRange`: what is between two `||`.
fn parse_set(text: &[u8]) -> Option<Vec<Comparator>> {
    let words: Vec<&[u8]> = words_of(text).collect();
    let mut comparators = Vec::new();
    if let [from, b"-", to] = words[..] {
        // `hyphenReplace`
        let (from, to) = (parse_partial(from)?, parse_partial(to)?);
        if from.major.is_some() {
            desugar(b">=", &from, &mut comparators)?;
        }
        if to.major.is_some() {
            desugar(b"<=", &to, &mut comparators)?;
        }
        if comparators.is_empty() {
            comparators.push(Comparator(None));
        }
    } else {
        let mut words = words.into_iter();
        while let Some(word) = words.next() {
            let operator = word
                .iter()
                .take_while(|it| matches!(it, b'<' | b'>' | b'=' | b'~' | b'^'))
                .count();
            let (operator, version) = word.split_at(operator);
            // `> 1.2.3` is `>1.2.3`.
            let version = if version.is_empty() && !operator.is_empty() {
                words.next()?
            } else {
                version
            };
            desugar(operator, &parse_partial(version)?, &mut comparators)?;
        }
        if comparators.is_empty() {
            comparators.push(Comparator(None));
        }
    }
    // `replaceGTE0`
    for comparator in &mut comparators {
        if *comparator == Comparator::new(GreaterOrEqual, Version::of(0, 0, 0)) {
            *comparator = Comparator(None);
        }
    }
    if let Some(null) = comparators.iter().find(|it| it.is_null_set()) {
        return Some(vec![null.clone()]);
    }
    let mut unique: Vec<Comparator> = Vec::new();
    for comparator in comparators {
        if !unique.contains(&comparator) {
            unique.push(comparator);
        }
    }
    if unique.len() > 1 {
        unique.retain(|it| it.0.is_some());
    }
    Some(unique)
}

#[derive(Clone, Debug)]
pub(crate) struct Range {
    /// As it is written, with single spaces.
    pub(crate) raw: Vec<u8>,
    set: Vec<Vec<Comparator>>,
}

impl Range {
    /// `None` where `new Range(text)` throws.
    pub(crate) fn parse(text: &[u8]) -> Option<Range> {
        let raw = words_of(text).collect::<Vec<_>>().join(&b" "[..]);
        let mut set = Vec::new();
        for part in strings::split(&raw, b"||") {
            set.push(parse_set(part)?);
        }
        if set.len() > 1 {
            let first = set[0].clone();
            set.retain(|it| !matches!(&it[..], [only] if only.is_null_set()));
            if set.is_empty() {
                set.push(first);
            } else if let Some(any) = set
                .iter()
                .find(|it| matches!(&it[..], [Comparator(None)]))
                .cloned()
            {
                set = vec![any];
            }
        }
        Some(Range { raw, set })
    }

    /// `>=version`
    pub(crate) fn at_least(version: [u16; 3]) -> Range {
        Range {
            raw: format!(">={}.{}.{}", version[0], version[1], version[2]).into_bytes(),
            set: vec![vec![Comparator::new(GreaterOrEqual, Version::new(version))]],
        }
    }

    /// `^a || ^b || >=latest`, for `versions` of which the first is the latest.
    pub(crate) fn since(versions: &[[u16; 3]]) -> Option<Range> {
        let latest = Version::new(*versions.first()?);
        let mut set = Vec::new();
        for &version in versions {
            let partial = Partial {
                major: Some(u64::from(version[0])),
                minor: Some(u64::from(version[1])),
                patch: Some(u64::from(version[2])),
                prerelease: Vec::new(),
            };
            let mut comparators = Vec::new();
            desugar(b"^", &partial, &mut comparators)?;
            set.push(comparators);
        }
        set.push(vec![match latest == Version::of(0, 0, 0) {
            true => Comparator(None),
            false => Comparator::new(GreaterOrEqual, latest),
        }]);
        Some(Range {
            raw: Vec::new(),
            set,
        })
    }

    /// `subset(self, dom)`: every version that satisfies `self` satisfies `dom`.
    pub(crate) fn is_subset_of(&self, dom: &Range) -> bool {
        let mut saw_non_null = false;
        'outer: for simple_sub in &self.set {
            for simple_dom in &dom.set {
                let is_sub = simple_subset(simple_sub, simple_dom);
                saw_non_null |= is_sub.is_some();
                if is_sub == Some(true) {
                    continue 'outer;
                }
            }
            // The null set is a subset of everything.
            if saw_non_null {
                return false;
            }
        }
        true
    }
}

type Bound<'c> = Option<(Operator, &'c Version)>;

fn higher_gt<'c>(a: Bound<'c>, b: (Operator, &'c Version)) -> (Operator, &'c Version) {
    let Some(a) = a else {
        return b;
    };
    match a.1.compare(b.1) {
        Ordering::Greater => a,
        Ordering::Less => b,
        Ordering::Equal if b.0 == Greater && a.0 == GreaterOrEqual => b,
        Ordering::Equal => a,
    }
}

fn lower_lt<'c>(a: Bound<'c>, b: (Operator, &'c Version)) -> (Operator, &'c Version) {
    let Some(a) = a else {
        return b;
    };
    match a.1.compare(b.1) {
        Ordering::Less => a,
        Ordering::Greater => b,
        Ordering::Equal if b.0 == Less && a.0 == LessOrEqual => b,
        Ordering::Equal => a,
    }
}

/// `None`: nothing satisfies `sub`.
fn simple_subset(sub: &[Comparator], dom: &[Comparator]) -> Option<bool> {
    let minimum = [Comparator::new(GreaterOrEqual, Version::of(0, 0, 0))];
    let is_any = |set: &[Comparator]| matches!(set, [Comparator(None)]);
    if is_any(sub) && is_any(dom) {
        return Some(true);
    }
    let sub = if is_any(sub) { &minimum[..] } else { sub };
    let dom = if is_any(dom) { &minimum[..] } else { dom };

    let (mut gt, mut lt): (Bound, Bound) = (None, None);
    let mut eq: Option<&Version> = None;
    for (operator, version) in sub.iter().filter_map(|it| it.0.as_ref()) {
        match operator {
            Greater | GreaterOrEqual => gt = Some(higher_gt(gt, (*operator, version))),
            Less | LessOrEqual => lt = Some(lower_lt(lt, (*operator, version))),
            Equal if eq.is_some_and(|it| it != version) => return None,
            Equal => eq = Some(version),
        }
    }
    let gtlt = gt.zip(lt).map(|(gt, lt)| gt.1.compare(lt.1));
    match gtlt {
        Some(Ordering::Greater) => return None,
        Some(Ordering::Equal)
            if gt.is_some_and(|it| it.0 != GreaterOrEqual)
                || lt.is_some_and(|it| it.0 != LessOrEqual) =>
        {
            return None;
        }
        _ => {}
    }
    let as_comparator = |bound: (Operator, &Version)| Comparator::new(bound.0, bound.1.clone());
    if let Some(eq) = eq {
        if [gt, lt]
            .into_iter()
            .flatten()
            .any(|it| !as_comparator(it).is_satisfied_by(eq))
        {
            return None;
        }
        return Some(dom.iter().all(|it| it.is_satisfied_by(eq)));
    }

    // A prerelease in the subset needs a comparator in the superset with the same tuple and a prerelease.
    let mut need_dom_lt_pre = lt.map(|it| it.1).filter(|it| !it.prerelease.is_empty());
    let mut need_dom_gt_pre = gt.map(|it| it.1).filter(|it| !it.prerelease.is_empty());
    // `<1.2.3-0` is the same as `<1.2.3`.
    if lt.is_some_and(|it| it.0 == Less)
        && need_dom_lt_pre.is_some_and(|it| it.prerelease == [Identifier::Number(0)])
    {
        need_dom_lt_pre = None;
    }
    let (mut has_dom_lt, mut has_dom_gt) = (false, false);
    for comparator in dom {
        let Some((operator, version)) = &comparator.0 else {
            continue;
        };
        has_dom_gt |= matches!(operator, Greater | GreaterOrEqual);
        has_dom_lt |= matches!(operator, Less | LessOrEqual);
        let has_pre_of =
            |needed: &Version| !version.prerelease.is_empty() && version.has_same_tuple(needed);
        if let Some(gt) = gt {
            if need_dom_gt_pre.is_some_and(has_pre_of) {
                need_dom_gt_pre = None;
            }
            if matches!(operator, Greater | GreaterOrEqual) {
                let higher = higher_gt(Some(gt), (*operator, version));
                if higher == (*operator, version) && higher != gt {
                    return Some(false);
                }
            } else if gt.0 == GreaterOrEqual && !comparator.is_satisfied_by(gt.1) {
                return Some(false);
            }
        }
        if let Some(lt) = lt {
            if need_dom_lt_pre.is_some_and(has_pre_of) {
                need_dom_lt_pre = None;
            }
            if matches!(operator, Less | LessOrEqual) {
                let lower = lower_lt(Some(lt), (*operator, version));
                if lower == (*operator, version) && lower != lt {
                    return Some(false);
                }
            } else if lt.0 == LessOrEqual && !comparator.is_satisfied_by(lt.1) {
                return Some(false);
            }
        }
        if *operator == Equal && (lt.is_some() || gt.is_some()) && gtlt != Some(Ordering::Equal) {
            return Some(false);
        }
    }
    let is_unbounded =
        gt.is_some() && has_dom_lt && lt.is_none() || lt.is_some() && has_dom_gt && gt.is_none();
    Some(
        !(is_unbounded && gtlt != Some(Ordering::Equal))
            && need_dom_gt_pre.is_none()
            && need_dom_lt_pre.is_none(),
    )
}
