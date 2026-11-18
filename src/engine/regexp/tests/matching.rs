mod support;

use std::cell::Cell;
use std::rc::Rc;

use bun_engine_regexp::program::UNSET;
use bun_engine_regexp::{
    Compiler, Context, Error, Mode, Notes, Options, Outcome, Patient, Pattern, Program, Rivals,
    Search, Width, compile,
};
use bun_engine_text::Text;
use support::{flags, in_each_width};

fn pattern(source: &str, letters: &str) -> Pattern {
    let units: Vec<u16> = source.encode_utf16().collect();
    Pattern::new(Text::Utf16(&units), flags(letters)).unwrap()
}

fn options(subject: Text<'_>, mode: Mode) -> Options<'_> {
    Options {
        width: if subject.is_latin1() {
            Width::Latin1
        } else {
            Width::Utf16
        },
        mode,
        sample: subject,
        stack_limit: 0,
    }
}

fn program(source: &str, letters: &str, subject: Text<'_>, mode: Mode) -> Program {
    let program = compile(pattern(source, letters).tree(), &options(subject, mode)).unwrap();
    assert!(program.verify().is_some(), "/{source}/{letters}");
    program
}

/// And how often it has been asked.
fn context_that_stops_after(polls: u32) -> (Context, Rc<Cell<u32>>) {
    let (mut context, count) = (Context::new(), Rc::new(Cell::new(0)));
    let seen = Rc::clone(&count);
    context.set_poll(Box::new(move || {
        seen.set(seen.get() + 1);
        seen.get() >= polls
    }));
    (context, count)
}

include!("support/cases.rs");

#[test]
fn known_answers() {
    let mut context = Context::new();
    for &(source, letters, subject, start, expected) in CASES {
        in_each_width(subject, |subject| {
            let outcome = match *expected {
                [start, end, ..] => Outcome::Match {
                    start: start as u32,
                    end: end as u32,
                },
                _ => Outcome::NoMatch,
            };
            let quick = program(source, letters, subject, Mode::MatchOnly);
            let found = quick.exec(subject, start, &mut [], &mut context);
            assert_eq!(found, outcome, "/{source}/{letters} on {subject:?}");

            let full = program(source, letters, subject, Mode::Captures);
            let mut captures = vec![7; full.capture_entries()];
            let found = full.exec(subject, start, &mut captures, &mut context);
            assert_eq!(found, outcome, "/{source}/{letters} on {subject:?}");
            if let [_, _, groups @ ..] = expected {
                let groups = groups.iter().map(|&it| u32::try_from(it).unwrap_or(UNSET));
                assert_eq!(
                    captures,
                    groups.collect::<Vec<_>>(),
                    "/{source}/{letters} on {subject:?}"
                );
            }
        });
    }
}

#[test]
fn a_compiler_is_used_again() {
    let mut compiler = Compiler::default();
    for &(source, letters, subject, ..) in CASES {
        in_each_width(subject, |subject| {
            let (pattern, options) = (pattern(source, letters), options(subject, Mode::Captures));
            let alone = compile(pattern.tree(), &options).unwrap();
            let lent = compiler.compile_and_verify(pattern.tree(), &options);
            assert_eq!(lent.unwrap().ops(), alone.ops());
            let kept = compiler.compile(pattern.tree(), &options).unwrap();
            assert_eq!(compiler.verify(&kept).unwrap().ops(), alone.ops());
        });
    }
}

#[test]
fn a_long_match_is_interrupted() {
    let subject = [b'a'; 64];
    let subject = Text::Latin1(&subject);
    let program = program(r"^(a|aa)+\1b", "", subject, Mode::MatchOnly);
    let (mut context, polls) = context_that_stops_after(2);
    let outcome = program.exec(subject, 0, &mut [], &mut context);
    assert_eq!((outcome, polls.get()), (Outcome::Interrupted, 2));
    assert!(context.take_work() > 0);
}

#[test]
fn a_search_takes_time_in_proportion_to_the_subject() {
    const LENGTH: u32 = 5000;
    let subject = format!("{}!", "a".repeat(LENGTH as usize));
    let subject = Text::from_ascii(&subject);
    let whole = Outcome::Match {
        start: 0,
        end: LENGTH + 1,
    };
    for (source, expected) in [
        ("^(a|aa)+$", Outcome::NoMatch),
        ("^(?:(a|aa)+x|a+!)$", whole),
        (r"^(\w+\s?)*$", Outcome::NoMatch),
        ("^(.*){6}x", Outcome::NoMatch),
        ("^(.*?){6}x", Outcome::NoMatch),
        ("^.*a.*a.*a.*x", Outcome::NoMatch),
        ("((a*)*)*[ab][b-z]", Outcome::NoMatch),
        ("(?:a||(?=a)){20}[b-z]", Outcome::NoMatch),
        ("(?=a+x)|!!", Outcome::NoMatch),
        ("^(?!(a|aa)+$)a+!", whole),
        ("$(?<=x(a|aa)+!)", Outcome::NoMatch),
        ("(?=(?:aa|b)*a?!)a(?=x)", Outcome::NoMatch),
        (r"((?:aa|b)+)(?=x)\1", Outcome::NoMatch),
        (r"(a)(?:\\.|.|\n)*?\1(?=x)", Outcome::NoMatch),
        ("(?:aa|b){1,9999}(?=x)", Outcome::NoMatch),
        (r"\s*(?:aa)+(?=x)", Outcome::NoMatch),
        ("b*(?![ab]*!)(?=a)", Outcome::NoMatch),
    ] {
        let (pattern, options) = (pattern(source, ""), options(subject, Mode::Captures));
        let captures = &mut [0; 4][..usize::from(pattern.group_count()) * 2];
        let usual = compile(pattern.tree(), &options).unwrap();
        let outcome = usual.exec(subject, 0, captures, &mut Context::new());
        assert_eq!(outcome, Outcome::TooSlow, "/{source}/");
        let (patient, tree) = (Patient::new(pattern.tree(), &options), pattern.tree());
        let context = &mut context_that_stops_after(LENGTH).0;
        let outcome = (patient.unwrap()).exec(tree, || 0, subject, 0, captures, context);
        assert_eq!(outcome, expected, "/{source}/");
    }
}

#[test]
fn so_do_all_searches_of_a_subject_together() {
    const LINES: u32 = 500;
    let subject = format!("{}!\n", "a".repeat(40)).repeat(LINES as usize);
    let subject = Text::from_ascii(&subject);
    let pattern = pattern(r"(?:a|aa|!|\n)+(?=x)|!", "");
    let mut compiler = Compiler::default();
    let options = options(subject, Mode::MatchOnly);
    let rivals = Rivals::new(&mut compiler, pattern.tree(), &options).unwrap();
    let (mut context, mut notes) = (context_that_stops_after(LINES * 4).0, Notes::new());
    for line in 0..LINES {
        let search = Search {
            subject,
            start: (line * 42).saturating_sub(1),
            has_been_too_slow: false,
        };
        let raced = context.race(&rivals, None, &mut notes, search, &mut []);
        let (start, end) = (line * 42 + 40, line * 42 + 41);
        assert_eq!(raced.outcome, Outcome::Match { start, end });
    }
}

#[test]
fn either_side_of_a_race_is_interrupted() {
    let subject = [b'a'; 3000];
    let subject = Text::Latin1(&subject);
    let pattern = pattern(r"^(?:(a+)(a+))+\1\2x", "");
    let patient = Patient::new(pattern.tree(), &options(subject, Mode::MatchOnly)).unwrap();
    for polls in 200..204 {
        let (mut context, count) = context_that_stops_after(polls);
        let outcome = patient.exec(pattern.tree(), || 0, subject, 0, &mut [], &mut context);
        assert_eq!((outcome, count.get()), (Outcome::Interrupted, polls));
    }
}

#[test]
fn a_race_needs_little_memory() {
    let subject = format!("{}{}", "ab".repeat(20_000), "x".repeat(60));
    let subject = Text::from_ascii(&subject);
    let pattern = pattern("^(?:ab|c)*(?:x+x+)+(?=y)", "");
    let patient = Patient::new(pattern.tree(), &options(subject, Mode::MatchOnly)).unwrap();
    let mut context = Context::new();
    context.set_max_stack_size(1 << 16);
    let outcome = patient.exec(pattern.tree(), || 0, subject, 0, &mut [], &mut context);
    assert_eq!(outcome, Outcome::NoMatch);
}

#[test]
fn large_patterns_compile() {
    let nested = |open: &str, close: &str| format!("{}a{}", open.repeat(300), close.repeat(300));
    for source in [
        r"\b".repeat(50_000),
        format!("{}(?:{}b)", "()".repeat(5000), "ac|ad|ae|".repeat(2000)),
        format!("(?:{}|b){{30}}", "a".repeat(600_000)),
        nested("(?:ab|", ")"),
        nested("(|", ")*"),
        nested("(?<!(?:b|bc)*d", ")"),
    ] {
        program(&source, "", Text::EMPTY, Mode::Captures);
    }
}

#[test]
fn the_stack_has_a_limit() {
    let subject = [b'a'; 5000];
    let subject = Text::Latin1(&subject);
    let program = program("^(?:a|ab)*bc", "", subject, Mode::MatchOnly);
    let mut context = Context::new();
    assert_eq!(
        program.exec(subject, 0, &mut [], &mut context),
        Outcome::NoMatch
    );
    context.set_max_stack_size(4096);
    assert_eq!(
        program.exec(subject, 0, &mut [], &mut context),
        Outcome::OutOfMemory
    );
}

#[test]
fn nesting_ends_at_the_limit_of_the_native_stack() {
    let source = format!("{}a{}", "(".repeat(5000), ")*".repeat(5000));
    let pattern = Pattern::new(Text::from_ascii(&source), flags("")).unwrap();
    let here = 0u8;
    let options = Options {
        width: Width::Latin1,
        mode: Mode::Captures,
        sample: Text::EMPTY,
        stack_limit: (&raw const here).addr() - (64 << 10),
    };
    let error = compile(pattern.tree(), &options).err();
    assert_eq!(error, Some(Error::TooDeeplyNested));
}
