//! What `syntax.txt` cannot express.

use bun_core::strings;

use crate::calc::{Kind, Node, Options, Unit};
use crate::color::{Color, Specified};
use crate::grammar::{Matcher, Mode, definition, is_reserved, split_list};
use crate::properties::{Id, Prop};
use crate::types::{Areas, DisplayValue, Easing, corners};
use crate::values::*;

pub(crate) type Leaf = fn(&mut Matcher, &mut P) -> Option<()>;
/// With the start of what has been written, and the source.
pub(crate) type Hook = fn(&mut Matcher, usize, &[u8]) -> Option<()>;

fn typed<T: Css>(m: &mut Matcher, p: &mut P) -> Option<()> {
    let value = T::parse(p, &Ctx::dummy())?;
    m.write(|out| value.write(out));
    Some(())
}

fn write_link(m: &mut Matcher, link: &[u8]) -> Option<()> {
    match m.mode {
        Mode::Computed(cx) => m.write(|out| write_url(&cx.url(link), out)),
        _ => m.write(|out| write_url(text(link), out)),
    }
    Some(())
}

fn sum(m: &mut Matcher, p: &mut P, options: &Options) -> Option<()> {
    let node = Node::parse_sum(p, options)?;
    m.write(|out| node.simplified(None, false).write_inner(out, false));
    Some(())
}

pub(crate) const LEAVES: &[(&str, Leaf)] = &[
    ("zero-angle", |m, p| {
        p.expect_number().ok().filter(|it| *it == 0.0)?;
        m.write(|out| out.extend_from_slice(b"0deg"));
        Some(())
    }),
    ("alpha", |m, p| {
        let start = m.out.len();
        m.named("<factor>", p).then_some(())?;
        if m.is_computed() {
            rewrite::<Alpha>(m, start);
        }
        Some(())
    }),
    ("url", |m, p| {
        let (url, modifiers) = link(p)?;
        write_link(m, url)?;
        if !modifiers.is_empty() {
            let modifiers = definition("<url-modifiers>")?.write(modifiers, Mode::Specified)?;
            m.out.pop();
            m.out.extend(
                [
                    if modifiers.is_empty() { &b""[..] } else { b" " },
                    &modifiers,
                    b")",
                ]
                .concat(),
            );
        }
        Some(())
    }),
    ("string-url", |m, p| write_link(m, string(p)?)),
    ("string", |m, p| {
        string(p).map(|it| m.write(|out| write_string(it, out)))
    }),
    ("any", typed::<Raw>),
    ("interpolation", |m, p| {
        Interpolation::parse(p).map(|it| m.write(|out| it.write(out)))
    }),
    ("path-data", |m, p| {
        let path = path_data(string(p)?, m.is_computed())?;
        m.write(|out| write_string(&path, out));
        Some(())
    }),
    ("size-sum", |m, p| sum(m, p, &Options::CALC_SIZE)),
    ("sum", |m, p| sum(m, p, &Options::LENGTH_PERCENTAGE)),
    ("display", |m, p| {
        let state = p.state();
        if ident(p).is_some_and(|it| it.starts_with(b"-")) {
            p.reset(&state);
            return m.named("<prefixed-display>", p).then_some(());
        }
        p.reset(&state);
        typed::<DisplayValue>(m, p)
    }),
    ("family-name", |m, p| {
        let state = p.state();
        if m.named("<generic-family>", p) {
            return Some(());
        }
        p.reset(&state);
        family_name(p).map(|it| m.write(|out| write_family(&it, out)))
    }),
    ("tag", |m, p| {
        let tag = string(p)
            .filter(|it| it.len() == 4 && it.iter().all(|it| (0x20..0x7f).contains(it)))?;
        m.write(|out| write_string(tag, out));
        Some(())
    }),
    ("keyframes-name", |m, p| {
        let name = string(p)
            .filter(|it| !it.is_empty())
            .or_else(|| ident(p).filter(|it| !is_reserved(it)))?;
        m.write(|out| write_keyframes_name(name, out));
        Some(())
    }),
    ("areas", typed::<Areas>),
    ("zero", |m, p| {
        p.expect_number()
            .ok()
            .filter(|it| *it == 0.0)
            .map(|_| m.write(|out| out.push(b'0')))
    }),
    ("face-name", |m, p| {
        let state = p.state();
        let is_generic = m.named("<generic-family>", p) && p.is_exhausted();
        p.reset(&state);
        family_name(p)
            .filter(|_| !is_generic)
            .map(|it| m.write(|out| write_family(&it, out)))
    }),
    ("font-sources", |m, p| {
        let all = Raw::parse(p, &Ctx::dummy())?;
        let valid: Vec<_> = split_list(all.0.as_bytes())
            .iter()
            .filter_map(|it| definition("<font-source>")?.write(it, m.mode))
            .collect();
        (!valid.is_empty()).then(|| m.write(|out| out.extend(valid.join(&b", "[..]))))
    }),
    ("unicode-ranges", |m, p| {
        let all = Raw::parse(p, &Ctx::dummy())?;
        let ranges: Vec<_> = split_list(all.0.as_bytes())
            .into_iter()
            .map(unicode_range)
            .collect::<Option<_>>()?;
        let one = |[a, b]: &[u32; 2], out: &mut Out| {
            out.extend(
                if a == b {
                    format!("U+{a:X}")
                } else {
                    format!("U+{a:X}-{b:X}")
                }
                .bytes(),
            )
        };
        m.write(|out| write_list(&ranges, ", ", out, one));
        Some(())
    }),
    ("position-area", position_area),
];

fn unicode_range(source: &[u8]) -> Option<[u32; 2]> {
    let [b'u' | b'U', b'+', digits @ ..] = crate::scan::trim(source) else {
        return None;
    };
    let hex = |it: &[u8]| {
        ((1..=6).contains(&it.len()) && it.iter().all(u8::is_ascii_hexdigit))
            .then(|| u32::from_str_radix(text(it), 16).ok())?
    };
    let known = digits.iter().take_while(|it| **it != b'?').count();
    let filled = |with: u8| hex(&[&digits[..known], &vec![with; digits.len() - known]].concat());
    let range = match strings::split_once_char(digits, b'-') {
        Some((first, last)) => [hex(first)?, hex(last)?],
        None => digits[known..]
            .iter()
            .all(|it| *it == b'?')
            .then_some([filled(b'0')?, filled(b'f')?])?,
    };
    (range[0] <= range[1] && range[1] <= 0x10ffff).then_some(range)
}

pub(crate) fn write_keyframes_name(name: &[u8], out: &mut Out) {
    if is_reserved(name) || eq(name, "none") {
        write_string(name, out)
    } else {
        write_ident(name, out)
    }
}

pub(crate) fn family_name(p: &mut P) -> Option<Out> {
    if let Some(name) = string(p) {
        return Some(name.to_vec());
    }
    let words: Vec<_> = core::iter::from_fn(|| ident(p)).collect();
    (words.len() > 1 || !is_reserved(words.first()?)).then(|| words.join(&b' '))
}

pub(crate) fn write_family(name: &[u8], out: &mut Out) {
    let start = out.len();
    write_ident(name, out);
    let is_generic = [
        "serif",
        "sans-serif",
        "cursive",
        "fantasy",
        "monospace",
        "system-ui",
        "math",
    ]
    .iter()
    .any(|it| eq(name, it));
    if out[start..] != *name || name.is_empty() || is_generic || is_reserved(name) {
        out.truncate(start);
        write_string(name, out);
    }
}

/// With a function that does it.
pub(crate) fn mixed(id: Id, from: &[u8], to: &[u8], t: Mixing) -> Option<Out> {
    let Mixing::Lerp(t) = t else { return None };
    let one = |(from, to): (&[u8], &[u8])| {
        let is_image = |it: &[u8]| {
            it.starts_with(b"url(")
                || id != Id::BackgroundImage && strings::contains(it, b"gradient(")
        };
        (matches!(id, Id::FontPalette | Id::DynamicRangeLimit) || is_image(from) && is_image(to))
            .then_some(())?;
        let (from, to, [a, b]) = (text(from), text(to), [100.0 - t * 100.0, t * 100.0]);
        Some(match id {
            _ if t <= 0.0 || from == to => from.to_owned(),
            _ if t >= 1.0 => to.to_owned(),
            Id::FontPalette => format!("palette-mix(in oklab, {from} {a}%, {to} {b}%)"),
            Id::DynamicRangeLimit => format!("dynamic-range-limit-mix({from} {a}%, {to} {b}%)"),
            _ => format!("-webkit-cross-fade({from}, {to}, {t})"),
        })
    };
    let (from, to) = (split_list(from), split_list(to));
    (from.len() == to.len()).then_some(())?;
    Some(
        from.into_iter()
            .zip(to)
            .map(one)
            .collect::<Option<Vec<_>>>()?
            .join(", ")
            .into_bytes(),
    )
}

pub(crate) fn lerp_whole(from: &[u8], to: &[u8], t: Mixing) -> Option<Out> {
    let [of_from, of_to] = t.weights();
    if let ([b'"', from @ .., b'"'], [b'"', to @ .., b'"']) = (from, to) {
        return crate::path::mix_paths(text(from), text(to), of_from, of_to)
            .map(|it| written(|out| write_string(it.as_bytes(), out)));
    }
    if let Some([off, on]) = [[&b"ccw"[..], b"cw"], [b"small", b"large"]]
        .into_iter()
        .find(|it| it.contains(&from))
    {
        let [from, to] = [from, to].map(|it| f32::from(it == on));
        return Some(if t.of(from, to) > 0.0 { on } else { off }.to_vec());
    }
    if from.starts_with(b"superellipse(") {
        // https://drafts.csswg.org/css-borders-4/#superellipse-interpolation
        let [from, to] = [from, to].map(|it| {
            let parameter: f64 = text(it.get(13..it.len() - 1)?).parse().ok()?;
            let convex = 0.5f64.powf(0.5f64.powf(parameter.abs()));
            Some(if parameter < 0.0 {
                1.0 - convex
            } else {
                convex
            })
        });
        let half = (from? * f64::from(of_from) + to? * f64::from(of_to)).clamp(0.0, 1.0);
        let parameter = (0.5f64.ln() / half.max(1.0 - half).ln())
            .abs()
            .log2()
            .copysign(half - 0.5);
        return Some(
            format!("superellipse({})", parameter + 0.0)
                .replace("inf", "infinity")
                .into_bytes(),
        );
    }
    let color = |source| parse_all(source, |p| Color::parse(p, &Ctx::dummy()));
    Some(color(from)?.lerp(&color(to)?, t)?.written())
}

fn path_data(source: &[u8], is_absolute: bool) -> Option<Out> {
    let (mut rest, mut out, mut command) = (source.trim_ascii_start(), Out::new(), 0);
    let (mut at, mut first) = ([0.0; 2], [0.0; 2]);
    while let Some(next) = rest.first() {
        if next.is_ascii_alphabetic() {
            (command, rest) = (*next, rest[1..].trim_ascii_start());
        } else if matches!(command, b'm' | b'M') {
            command -= 1;
        } else if matches!(command, 0 | b'z' | b'Z') {
            return None;
        }
        let upper = command.to_ascii_uppercase();
        (!out.is_empty() || upper == b'M').then_some(())?;
        let arguments: &[u8] = match upper {
            b'M' | b'L' | b'T' => b"xy",
            b'H' => b"x",
            b'V' => b"y",
            b'C' => b"xyxyxy",
            b'S' | b'Q' => b"xyxy",
            b'A' => b"nnnffxy",
            b'Z' => b"",
            _ => return None,
        };
        out.extend([
            if is_absolute || upper == b'Z' {
                upper
            } else {
                command
            },
            b' ',
        ]);
        let origin = if command == upper { [0.0; 2] } else { at };
        for argument in arguments {
            let mut length = usize::from(matches!(rest.first(), Some(b'+' | b'-')));
            let digits = |from: usize| {
                rest[from.min(rest.len())..]
                    .iter()
                    .take_while(|it| it.is_ascii_digit())
                    .count()
            };
            length += digits(length);
            if rest.get(length) == Some(&b'.') {
                length += 1 + digits(length + 1);
            }
            if matches!(rest.get(length), Some(b'e' | b'E')) {
                let sign = usize::from(matches!(rest.get(length + 1), Some(b'+' | b'-')));
                length += 1 + sign + digits(length + 1 + sign);
            }
            if *argument == b'f' {
                length = usize::from(matches!(rest.first(), Some(b'0' | b'1')));
            }
            let mut value: f64 = text(&rest[..length]).parse().ok()?;
            rest = rest[length..].trim_ascii_start();
            rest = rest
                .strip_prefix(b",")
                .map_or(rest, <[u8]>::trim_ascii_start);
            if let Some(axis) = argument.checked_sub(b'x') {
                at[usize::from(axis)] = origin[usize::from(axis)] + value;
                value = if is_absolute {
                    at[usize::from(axis)]
                } else {
                    value
                };
            }
            write_double(value, &mut out);
            out.push(b' ');
        }
        match upper {
            b'M' => first = at,
            b'Z' => at = first,
            _ => {}
        }
    }
    out.pop().map(|_| out)
}

fn position_area(m: &mut Matcher, p: &mut P) -> Option<()> {
    /// The axes that can be combined have the same letter, and the lowercase one comes first.
    const AXES: [(&str, u8); 16] = [
        ("left right", b'p'),
        ("top bottom", b'P'),
        ("x-", b'p'),
        ("y-", b'P'),
        ("self-x-", b'p'),
        ("self-y-", b'P'),
        ("block-", b'l'),
        ("inline-", b'L'),
        ("self-block-", b's'),
        ("self-inline-", b'S'),
        ("start end", b'0'),
        ("self-start self-end", b'1'),
        ("center", b'*'),
        ("all", b'*'),
        ("x-self-", b'p'),
        ("y-self-", b'P'),
    ];
    let keyword = |p: &mut P| {
        attempt(p, |p| {
            let name = ident(p)?.to_ascii_lowercase();
            let plain = name.strip_prefix(b"span-");
            (plain != Some(b"center") && name != b"all").then_some(())?;
            let plain = plain.unwrap_or(&name);
            let is_on = |(names, _): &&(&str, u8)| match names.ends_with('-') {
                true => matches!(
                    plain.strip_prefix(names.as_bytes()),
                    Some(b"start" | b"end")
                ),
                false => names
                    .split_ascii_whitespace()
                    .any(|it| it.as_bytes() == plain),
            };
            let axis = AXES[..14].iter().find(is_on)?.1;
            Some((name, axis))
        })
    };
    let mut first = keyword(p)?;
    let mut second = keyword(p);
    if let Some(second) = &mut second {
        let (a, b) = (first.1, second.1);
        (a == b'*'
            || b == b'*'
            || if a.is_ascii_digit() {
                a == b
            } else {
                a == b ^ 0x20
            })
        .then_some(())?;
        if a.is_ascii_uppercase() || b.is_ascii_lowercase() {
            core::mem::swap(&mut first, second);
        }
    }
    let renamed = |name: &[u8], from: &str, to: &str| {
        strings::replace_owned(name, from.as_bytes(), to.as_bytes())
    };
    let is_all = |it: &(Out, u8)| it.0 == b"span-all";
    let names = match second {
        Some(second) if first.0 == second.0 || is_all(&second) && first.1.is_ascii_alphabetic() => {
            vec![first.0]
        }
        Some(second) if is_all(&first) && second.1.is_ascii_alphabetic() => vec![second.0],
        Some(second)
            if m.is_computed()
                && (is_all(&first) || is_all(&second))
                && first.1 != second.1
                && first.1.min(second.1) == b'*' =>
        {
            let (other, axis) = if is_all(&first) {
                (second, "inline-")
            } else {
                (first, "block-")
            };
            let edge = if other.0.ends_with(b"end") {
                "end"
            } else {
                "start"
            };
            vec![renamed(
                &other.0,
                edge,
                text(&[axis.as_bytes(), edge.as_bytes()].concat()),
            )]
        }
        Some(second) if m.is_computed() => {
            let [a, b] =
                [first.0, second.0].map(|it| renamed(&renamed(&it, "block-", ""), "inline-", ""));
            if a == b { vec![a] } else { vec![a, b] }
        }
        second => [first].into_iter().chain(second).map(|it| it.0).collect(),
    };
    m.write(|out| out.extend(names.join(&b' ')));
    Some(())
}

/// What has been written, without the space.
fn take(m: &mut Matcher, start: usize) -> Out {
    let taken = m.out.get(start + 1..).unwrap_or_default().to_vec();
    m.out.truncate(start);
    taken
}

fn replace(m: &mut Matcher, start: usize, change: impl FnOnce(Out) -> Out) -> Option<()> {
    if m.writes() {
        let changed = change(take(m, start));
        m.write(|out| out.extend(changed));
    }
    Some(())
}

fn replace_computed(
    m: &mut Matcher,
    start: usize,
    change: impl FnOnce(Out, &Ctx) -> Option<Out>,
) -> Option<()> {
    let Mode::Computed(cx) = m.mode else {
        return Some(());
    };
    replace(m, start, |written| {
        change(written.clone(), cx).unwrap_or(written)
    })
}

fn written(write: impl FnOnce(&mut Out)) -> Out {
    let mut out = Out::new();
    write(&mut out);
    out
}

fn rewrite<T: Css>(m: &mut Matcher, start: usize) -> Option<()> {
    replace(m, start, |it| {
        parse_all(&it, |p| T::parse(p, &Ctx::dummy())).map_or(it, |it| written(|out| it.write(out)))
    })
}

/// The components that are not in a function.
pub(crate) fn words(source: &[u8]) -> Vec<&[u8]> {
    with_parser(source, |p| {
        let mut starts = Vec::new();
        loop {
            p.skip_whitespace();
            starts.push(p.position());
            if p.next().is_err() {
                return starts
                    .iter()
                    .zip(&starts[1..])
                    .map(|(start, end)| source[*start..*end].trim_ascii_end())
                    .collect();
            }
        }
    })
}

fn without_last<'a>(mut words: Vec<&'a [u8]>, is_default: impl Fn(&[&[u8]]) -> bool) -> Out {
    while words.len() > 1 && is_default(&words) {
        words.pop();
    }
    words.join(&b' ')
}

fn literal(source: &[u8]) -> Option<f64> {
    text(source.strip_suffix(b"%").unwrap_or(source))
        .parse()
        .ok()
}

fn has_modern_color(p: &mut P) -> bool {
    loop {
        match Specified::parse(p) {
            Some(color) if !color.is_legacy() => return true,
            None if p.next().is_err() => return false,
            _ => {}
        }
    }
}

fn to_inset(source: &[u8]) -> Option<Out> {
    let cx = Ctx::dummy();
    parse_all(source, |p| {
        let is_rect = eq(function(p)?, "rect");
        nested(p, |p| {
            let mut next = || Some(Auto::<Lp>::parse(p, &cx)?.0);
            let [a, b, c, d] = [next()?, next()?, next()?, next()?];
            let near = |it: Option<Lp>| it.unwrap_or(Lp::Fraction(0.0));
            let far = |it: Option<Lp>| it.map_or(Lp::Fraction(0.0), |it| it.from_end());
            let sides = match is_rect {
                true => [near(a), far(b), far(c), near(d)],
                false => [
                    b.clone()?,
                    far(a.clone()?.lerp(&c?, Mixing::Add)),
                    far(b?.lerp(&d?, Mixing::Add)),
                    a?,
                ],
            };
            let mut out = b"inset(".to_vec();
            write_list(&sides, " ", &mut out, Lp::write);
            out.extend(
                Raw::parse(p, &cx)
                    .iter()
                    .flat_map(|it| [b" ", it.0.as_bytes()].concat()),
            );
            out.push(b')');
            crate::grammar::definition("<basic-shape>")?.write(&out, Mode::Computed(&cx))
        })
    })
}

fn limit_shares(source: &[u8], weight: f64, shares: &mut [f64; 3]) -> Option<()> {
    const NAMES: [&str; 3] = ["standard", "constrained", "no-limit"];
    if let Some(index) = NAMES.iter().position(|it| it.as_bytes() == source) {
        shares[index] += weight;
        return Some(());
    }
    let items =
        split_list(&source[strings::index_of_char_usize(source, b'(')? + 1..source.len() - 1]);
    let items: Vec<_> = items
        .into_iter()
        .map(words)
        .map(|it| Some((it[0], literal(it.get(1)?)?)))
        .collect::<Option<_>>()?;
    let total: f64 = items.iter().map(|it| it.1).sum();
    items.iter().try_for_each(|it| {
        limit_shares(
            it.0,
            if total > 0.0 {
                weight * it.1 / total
            } else {
                0.0
            },
            shares,
        )
    })
}

pub(crate) const HOOKS: &[(&str, Hook)] = &[
    ("fraction", |m, start, _| {
        replace(m, start, |it| {
            literal(&it).map_or(it, |value| written(|out| write_double(value / 100.0, out)))
        })
    }),
    ("snap", |m, start, _| {
        replace_computed(m, start, |it, _| {
            let px: f32 = text(it.strip_suffix(b"px")?).parse().ok()?;
            Some(written(|out| {
                write_px(
                    if px > 0.0 && px < 1.0 {
                        1.0
                    } else {
                        px.floor()
                    },
                    out,
                )
            }))
        })
    }),
    ("px", |m, start, _| {
        replace_computed(m, start, |it, _| Some([&it[..], b"px"].concat()))
    }),
    ("position", |m, start, _| {
        if m.is_computed() {
            rewrite::<Position>(m, start)
        } else {
            Some(())
        }
    }),
    ("counter-style", |m, start, _| {
        replace(m, start, |it| {
            crate::counter_style::canonical_name(&text(&it).into())
                .as_bytes()
                .to_vec()
        })
    }),
    ("symbols", |_, _, source| {
        let inside = source.get(8..)?.trim_ascii_start();
        let needs_two = ["alphabetic", "numeric"]
            .iter()
            .any(|it| inside.len() > it.len() && eq(&inside[..it.len()], it));
        (!needs_two || words(&source[8..source.len() - 1]).len() > 2).then_some(())
    }),
    ("unprefix", |m, start, _| {
        replace(m, start, |it| {
            it.strip_prefix(b"-webkit-").unwrap_or(&it).to_vec()
        })
    }),
    ("gradient", |m, start, _| {
        replace(m, start, |it| {
            let is_modern = parse_all(&it, |p| {
                function(p).and_then(|_| {
                    nested(p, |p| {
                        Some((has_modern_color(p), Raw::parse(p, &Ctx::dummy())))
                    })
                })
            });
            let default = if is_modern.is_some_and(|it| it.0) {
                "in oklab,"
            } else {
                "in srgb,"
            };
            let Some(at) = strings::index_of(&it, default.as_bytes())
                .filter(|at| !strings::contains_char(&it[..*at], b','))
            else {
                return it;
            };
            let end = at + default.len();
            if it[at - 1] == b'(' {
                [&it[..at], &it[end + 1..]].concat()
            } else {
                [&it[..at - 1], &it[end - 1..]].concat()
            }
        })
    }),
    ("stops", |_, _, source| {
        let is_hint = |it: &&[u8]| with_parser(it, |p| Specified::parse(p).is_none());
        let hints: Vec<_> = split_list(source).iter().map(is_hint).collect();
        (!hints[0]
            && !hints[hints.len() - 1]
            && !hints.iter().zip(&hints[1..]).any(|it| *it.0 && *it.1))
        .then_some(())
    }),
    ("stop", |m, start, _| {
        replace(m, start, |it| {
            if let [color, a, b] = words(&it)[..] {
                [color, b" ", a, b", ", color, b" ", b].concat()
            } else {
                it
            }
        })
    }),
    ("old-stop", |m, start, _| {
        replace(m, start, |it| match it.strip_prefix(b"color-stop(") {
            Some([b'0', b',', b' ', rest @ ..]) => [b"from(", rest].concat(),
            Some([b'1', b',', b' ', rest @ ..]) => [b"to(", rest].concat(),
            _ => it,
        })
    }),
    ("to-inset", |m, start, _| {
        replace_computed(m, start, |it, _| to_inset(&it))
    }),
    ("radii", |m, start, _| {
        if let Mode::Expanded = m.mode {
            return replace(m, start, |it| {
                let all = parse_all(&it, |p| corners(p, &Ctx::dummy()));
                written(|out| {
                    write_list(
                        all.as_ref().map_or(&[][..], |it| it),
                        " ",
                        out,
                        |it, out| it.0.write(out),
                    );
                    out.extend_from_slice(b" / ");
                    write_list(
                        all.as_ref().map_or(&[][..], |it| it),
                        " ",
                        out,
                        |it, out| it.1.write(out),
                    );
                })
            });
        }
        replace(m, start, |it| match strings::index_of(&it, b" / ") {
            Some(at) if it[..at] == it[at + 3..] => it[..at].to_vec(),
            _ => it,
        })
    }),
    ("linear", |m, start, source| {
        if strings::contains(source, b"calc(") && !m.is_computed() {
            Some(())
        } else {
            rewrite::<Easing>(m, start)
        }
    }),
    ("limit", |m, start, _| {
        replace(m, start, |it| match (literal(&it), it.ends_with(b"%")) {
            (Some(100.0..), true) => b"100%".to_vec(),
            (Some(1.0..), false) => b"1".to_vec(),
            _ => it,
        })
    }),
    ("integers", |m, start, _| {
        let whole = |it: &[u8]| {
            literal(it).map_or(it.to_vec(), |it| {
                written(|out| write_double(it.trunc(), out))
            })
        };
        if m.out.len() > start {
            replace(m, start, |it| {
                words(&it)
                    .into_iter()
                    .map(whole)
                    .collect::<Vec<_>>()
                    .join(&b' ')
            })
        } else {
            Some(())
        }
    }),
    ("format", |m, start, source| {
        let name = with_parser(source, |p| {
            string(p)
                .or_else(|| ident(p))
                .map(<[u8]>::to_ascii_lowercase)
        })?;
        definition("<font-format>")?
            .accepts(name.strip_suffix(b"-variations").unwrap_or(&name))
            .then_some(())?;
        replace(m, start, |_| written(|out| write_string(&name, out)))
    }),
    ("quoted", |m, start, source| {
        replace(m, start, |_| {
            written(|out| write_string(&with_parser(source, family_name).unwrap_or_default(), out))
        })
    }),
    ("descending", |_, _, source| {
        let weights: Vec<_> = split_list(source)
            .into_iter()
            .map(|it| {
                with_parser(it, |p| {
                    core::iter::from_fn(|| {
                        integer(p, &Ctx::dummy())
                            .map(Some)
                            .or_else(|| p.next().ok().map(|_| None))
                    })
                    .flatten()
                    .next()
                })
            })
            .collect();
        weights.is_sorted_by(|a, b| a > b).then_some(())
    }),
    ("ascending", |_, _, source| match words(source)[..] {
        [a, b] => (!literal(a)
            .zip(literal(b))
            .is_some_and(|(a, b)| a.is_finite() && a > b))
        .then_some(()),
        _ => None,
    }),
    ("absolute", |_, _, source| {
        let cx = Ctx::dummy();
        parse_all(source, |p| Color::parse(p, &cx))
            .filter(|it| !it.uses_current() && !cx.deps.get().contains(Deps::VIEWPORT))
            .map(|_| ())
    }),
    ("not-ua", |_, _, source| {
        (!words(source)
            .iter()
            .any(|it| it.len() > 3 && eq(&it[..4], "-ua-")))
        .then_some(())
    }),
    ("not-zero", |_, _, source| {
        (literal(source) != Some(0.0)).then_some(())
    }),
    ("not-number", |_, _, source| {
        text(source).trim().parse::<f64>().is_err().then_some(())
    }),
    ("as-written", |m, start, source| {
        replace(m, start, |_| words(source).join(&b' ').to_ascii_lowercase())
    }),
    ("palette-mix", |m, start, source| {
        let shares = |it: &[u8]| {
            split_list(it)
                .iter()
                .rev()
                .take(2)
                .map(|it| literal(words(it).get(1)?))
                .collect::<Vec<_>>()
        };
        let inner = |it: &[u8]| it[12..it.len() - 1].to_vec();
        (shares(&inner(source)) != [Some(0.0); 2]).then_some(())?;
        replace(m, start, |it| {
            let inner = inner(&it);
            let (items, [b, a]) = (split_list(&inner), [shares(&inner)[0], shares(&inner)[1]]);
            if items[1..]
                .iter()
                .any(|it| it.ends_with(b"%)") && words(it).len() > 1)
            {
                return it;
            }
            let (a, b) = (
                a.unwrap_or(100.0 - b.unwrap_or(50.0)),
                b.unwrap_or(100.0 - a.unwrap_or(50.0)),
            );
            written(|out| {
                out.extend([b"palette-mix(", items[0]].concat());
                for (item, share) in items[1..].iter().zip([a, b]) {
                    out.extend([b", ", words(item)[0]].concat());
                    if (a, b) != (50.0, 50.0) {
                        out.push(b' ');
                        Node::Value(share, Unit::Percent).write(out);
                    }
                }
                out.push(b')');
            })
        })
    }),
    ("limit-mix", |m, start, source| {
        let items = split_list(&source[24..source.len() - 1]);
        (!items
            .iter()
            .all(|it| words(it).iter().any(|it| literal(it) == Some(0.0))))
        .then_some(())?;
        replace_computed(m, start, |it, _| {
            let mut shares = [0.0; 3];
            limit_shares(&it, 100.0, &mut shares)?;
            let items: Vec<_> = ["standard", "constrained", "no-limit"]
                .into_iter()
                .zip(shares)
                .filter(|it| it.1 > 0.0)
                .collect();
            Some(written(|out| match items[..] {
                [] => out.extend_from_slice(b"no-limit"),
                [only] => out.extend_from_slice(only.0.as_bytes()),
                _ => {
                    out.extend_from_slice(b"dynamic-range-limit-mix(");
                    write_list(&items, ", ", out, |it, out| {
                        out.extend([it.0.as_bytes(), b" "].concat());
                        Node::Value(it.1, Unit::Percent).write(out);
                    });
                    out.push(b')');
                }
            }))
        })
    }),
    ("light-dark", |m, start, _| {
        replace_computed(m, start, |it, cx| {
            cx.uses(Deps::INHERITED);
            let chosen = *split_list(&it[11..it.len() - 1]).get(usize::from(cx.dark))?;
            Some(
                if chosen == b"none" {
                    b"image(rgba(0, 0, 0, 0))"
                } else {
                    chosen
                }
                .to_vec(),
            )
        })
    }),
    ("bg-size", |m, start, _| {
        replace(m, start, |it| match words(&it)[..] {
            [b"auto", b"auto"] | [b"auto"] => b"auto".to_vec(),
            [width] => [width, b" auto"].concat(),
            _ => it,
        })
    }),
    ("fill", |m, start, _| {
        replace(m, start, |it| {
            if it.ends_with(b"fill") {
                it
            } else {
                [&it[..], b" fill"].concat()
            }
        })
    }),
    ("one-auto", |_, _, source| {
        let is_auto = |it: &&&[u8]| {
            with_parser(it, |p| {
                function(p).is_some()
                    && nested(p, |p| {
                        Some((keyword(p, "auto"), Raw::parse(p, &Ctx::dummy())?))
                    })
                    .is_some_and(|it| it.0)
            })
        };
        (split_list(source).iter().filter(is_auto).count() < 2).then_some(())
    }),
    ("commas", |m, start, _| {
        replace(m, start, |it| {
            [
                b"rect(",
                &words(&it[5..it.len() - 1]).join(&b", "[..])[..],
                b")",
            ]
            .concat()
        })
    }),
    ("language", |m, start, source| {
        let tag = with_parser(source, |p| string(p).map(|it| it.trim_ascii_end().to_vec()));
        let tag = tag.filter(|it| {
            (1..=4).contains(&it.len()) && it.iter().all(|it| (0x20..0x7f).contains(it))
        })?;
        replace(m, start, |_| written(|out| write_string(&tag, out)))
    }),
    ("from-font", |m, start, source| {
        replace_computed(m, start, |_, cx| {
            cx.uses(Deps::INHERITED);
            let (metrics, words) = ((cx.metrics)(), words(source));
            let is = |name| words.first().is_some_and(|it| eq(it, name));
            let metric = match () {
                _ if !eq(words.last()?, "from-font") => return None,
                () if is("cap-height") => metrics.cap_height,
                () if is("ch-width") => metrics.zero_advance,
                () if is("ic-width") || is("ic-height") => metrics.ideograph_advance,
                () => metrics.x_height,
            };
            let start = if words.len() > 1 && !is("ex-height") {
                [words[0], b" "].concat().to_ascii_lowercase()
            } else {
                Out::new()
            };
            Some(
                [
                    start,
                    written(|out| write_number(metric / cx.font.size.max(f32::EPSILON), out)),
                ]
                .concat(),
            )
        })
    }),
    ("limit-chars", |m, start, _| {
        replace_computed(m, start, |it, _| {
            Some(without_last(words(&it), |it| {
                it.last() == Some(&&b"auto"[..])
            }))
        })
    }),
    ("math-depth", |m, start, _| {
        replace_computed(m, start, |it, cx| {
            let added = match &it[..] {
                b"auto-add" => {
                    i32::from((cx.parent)(crate::properties::Id::MathStyle) == b"compact")
                }
                it => text(it.strip_prefix(b"add(")?.strip_suffix(b")")?)
                    .parse()
                    .ok()?,
            };
            let inherited: i32 = text(&(cx.parent)(crate::properties::Id::MathDepth))
                .parse()
                .ok()?;
            cx.uses(Deps::INHERITED);
            Some(written(|out| inherited.saturating_add(added).write(out)))
        })
    }),
    ("not-path", |_, _, source| {
        (!source.get(..5).is_some_and(|it| eq(it, "path("))).then_some(())
    }),
    ("offset-rotate", |m, start, _| {
        replace_computed(m, start, |it, _| {
            let turn = if it.starts_with(b"reverse") {
                180.0
            } else {
                it.starts_with(b"auto").then_some(0.0)?
            };
            let angle = words(&it)
                .get(1)
                .and_then(|it| literal(it.strip_suffix(b"deg")?))
                .unwrap_or(0.0);
            Some(
                [
                    b"auto ".to_vec(),
                    written(|out| Node::Value(angle + turn, Unit::Deg).write(out)),
                ]
                .concat(),
            )
        })
    }),
    ("paint-order", |m, start, source| {
        replace(m, start, |_| {
            let lowercase = source.to_ascii_lowercase();
            let words = words(&lowercase);
            let next: &[u8] = if words[0] == b"fill" {
                b"stroke"
            } else {
                b"fill"
            };
            words[..if words.get(1).is_some_and(|it| *it != next) {
                2
            } else {
                1
            }]
                .join(&b' ')
        })
    }),
    ("rotate", |m, start, _| {
        replace(m, start, |it| {
            let words = words(&it);
            let (axis, angle) = (
                words
                    .iter()
                    .take(3)
                    .map(|it| literal(it))
                    .collect::<Vec<_>>(),
                words[words.len() - 1],
            );
            let (name, along): (&[u8], _) = match axis[..] {
                _ if words[0] == b"z" => (b"", 1.0),
                [Some(x), Some(0.0), Some(0.0)] if x != 0.0 => (b"x ", x),
                [Some(0.0), Some(y), Some(0.0)] if y != 0.0 => (b"y ", y),
                [Some(0.0), Some(0.0), Some(z)] if z != 0.0 => (b"", z),
                _ => return it.clone(),
            };
            let node = parse_all(angle, |p| Node::parse(p, &Options::new(Kind::Angle)));
            [
                name,
                &written(|out| {
                    node.into_iter().for_each(|it| {
                        it.times(along.signum())
                            .as_specified(true)
                            .write_specified(out)
                    })
                }),
            ]
            .concat()
        })
    }),
    ("scale", |m, start, _| {
        replace(m, start, |it| {
            without_last(words(&it), |it| {
                if it.len() == 3 {
                    it[2] == b"1"
                } else {
                    it[0] == it[1]
                }
            })
        })
    }),
    ("translate", |m, start, _| {
        replace(m, start, |it| {
            without_last(words(&it), |it| it.last() == Some(&&b"0px"[..]))
        })
    }),
    ("dashes", |m, start, source| {
        (!source.trim_ascii_end().ends_with(b",")).then_some(())?;
        replace(m, start, |it| {
            words(&it)
                .into_iter()
                .filter(|it| *it != b",")
                .collect::<Vec<_>>()
                .join(&b", "[..])
        })
    }),
    ("emphasis", |m, start, _| {
        replace_computed(m, start, |it, cx| {
            cx.uses(Deps::INHERITED);
            let mark: &[u8] = if cx.flow.is_vertical() {
                b"sesame"
            } else {
                b"dot"
            };
            Some(match &it[..] {
                b"filled" => mark.to_vec(),
                b"open" => [b"open ", mark].concat(),
                it => it.strip_prefix(b"filled ")?.to_vec(),
            })
        })
    }),
    ("property", |m, start, _| {
        replace(m, start, |it| {
            if matches!(Prop::from_name(&it), None | Some(Prop::Custom(_))) {
                it
            } else {
                it.to_ascii_lowercase()
            }
        })
    }),
];
