//! Random programs give every rule of `simplify` an occasion to apply.

#![cfg(debug_assertions)]
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

mod support;

use std::collections::BTreeMap;
use std::sync::Mutex;

use bun_engine_codegen::passes::Analyses;
use support::generator::Shape;
use support::harness::{Case, Subject, World, campaign, pass_named, setting, shape_for};
use support::random::Random;

macro_rules! sources {
    ($($name:literal),* $(,)?) => {
        [$((
            concat!($name, ".rs"),
            include_str!(concat!("../passes/simplify/", $name, ".rs")),
        )),*]
    };
}

const SOURCES: [(&str, &str); 21] = sources![
    "arithmetic",
    "bitwise",
    "blocks",
    "bytes",
    "checked",
    "comparisons",
    "conditions",
    "control",
    "conversions",
    "demanded",
    "division",
    "float_comparisons",
    "floats",
    "memory",
    "mod",
    "params",
    "promises",
    "selects",
    "shifts",
    "shuffles",
    "vectors",
];

/// By file, line and column.
type Hits = BTreeMap<(&'static str, u32, u32), u64>;

fn rules() -> Hits {
    const ANSWERS: [&str; 8] = [
        ".hit()",
        ".is(",
        ".is_int(",
        ".is_bits(",
        ".is_bool(",
        ".is_vector(",
        ".to(",
        ".to_",
    ];
    let mut rules = Hits::new();
    for (file, text) in SOURCES {
        for (number, line) in (1..).zip(text.lines()) {
            let calls = ANSWERS.iter().flat_map(|answer| line.match_indices(answer));
            let by_self = calls.filter(|&(start, _)| line[..start].ends_with("self"));
            rules.extend(by_self.map(|(start, _)| ((file, number, start as u32 + 2), 0)));
        }
    }
    rules
}

struct Counting<'a> {
    own: Hits,
    total: &'a Mutex<Hits>,
    analyses: Analyses,
}

impl Subject for Counting<'_> {
    fn world(&mut self, seed: u64) -> World {
        World::imaginary(seed)
    }

    fn shape(&mut self, seed: u64) -> Shape {
        if seed.is_multiple_of(2) {
            shape_for(seed / 2)
        } else {
            let shape = Shape::of_profile("templates", &mut Random::new(seed));
            Shape { size: 30, ..shape }
        }
    }

    fn test(&mut self, case: &Case) -> Result<(), String> {
        let mut function = case.program.function.clone();
        self.analyses.invalidate();
        self.analyses.take_fired_rules();
        pass_named("simplify").run(&mut function, &mut self.analyses, case.world.target);
        for place in self.analyses.take_fired_rules() {
            let file = place.file().rsplit(['/', '\\']).next().unwrap();
            *self
                .own
                .entry((file, place.line(), place.column()))
                .or_default() += 1;
        }
        let before = &case.program.function;
        case.check(&function)
            .map_err(|problem| format!("{problem}\nafter:\n{function:?}\nbefore:\n{before:?}"))
    }
}

impl Drop for Counting<'_> {
    fn drop(&mut self) {
        let mut total = self.total.lock().unwrap();
        for (&place, &count) in &self.own {
            *total.get_mut(&place).expect("the rule is in the sources") += count;
        }
    }
}

#[test]
fn every_rule_applies_to_some_program() {
    let total = Mutex::new(rules());
    campaign(20_000, || Counting {
        own: Hits::new(),
        total: &total,
        analyses: Analyses::default(),
    });
    let mut counts: Vec<_> = total.into_inner().unwrap().into_iter().collect();
    counts.sort_by_key(|&(_, count)| count);
    let shown = setting("RAREST").map_or(0, |text| text.parse().unwrap());
    for &((file, line, column), count) in counts.iter().take(shown) {
        let text = SOURCES.iter().find(|&&(name, _)| name == file).unwrap().1;
        let text = text.lines().nth(line as usize - 1).unwrap().trim();
        eprintln!("{count:8} {file}:{line}:{column} {text}");
    }
    let idle = counts.iter().filter(|&&(_, count)| count == 0);
    let idle: Vec<_> = idle.map(|&(place, _)| place).collect();
    assert!(
        idle.is_empty(),
        "{} of {}: {idle:?}",
        idle.len(),
        counts.len()
    );
}
