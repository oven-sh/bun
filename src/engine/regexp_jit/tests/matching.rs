mod support;

use std::cell::Cell;
use std::rc::Rc;

use bun_engine_asm::Features;
use bun_engine_regexp::program::UNSET;
use bun_engine_regexp::{Context, Mode, Notes, Outcome, Racing, Search};
use bun_engine_regexp_jit::{Compiler, Options};
use bun_engine_text::Text;
use support::{in_each_width, natives, program, rivals};

include!("../../regexp/tests/support/cases.rs");

fn assert_same_as_interpreter(source: &str, letters: &str, subject: Text<'_>, starts: &[u32]) {
    let mut context = Context::new();
    for mode in [Mode::MatchOnly, Mode::Captures] {
        let program = program(source, letters, subject, mode);
        let entries = match mode {
            Mode::MatchOnly => 0,
            Mode::Captures => program.capture_entries(),
        };
        for native in natives(&program) {
            for &start in starts {
                let (mut expected, mut found) = (vec![7; entries], vec![8; entries]);
                let outcome = program.exec(subject, start, &mut expected, &mut context);
                assert_eq!(
                    native.exec(subject, start, &mut found, &mut context),
                    outcome,
                    "/{source}/{letters} on {subject:?} from {start}"
                );
                if outcome != Outcome::NoMatch {
                    assert_eq!(
                        found, expected,
                        "/{source}/{letters} on {subject:?} from {start}"
                    );
                }
            }
        }
    }
}

#[test]
fn known_answers() {
    for &(source, letters, subject, start, expected) in CASES {
        in_each_width(subject, |subject| {
            let program = program(source, letters, subject, Mode::MatchOnly);
            let outcome = program.exec(subject, start, &mut [], &mut Context::new());
            assert_eq!(outcome == Outcome::NoMatch, expected.is_empty());
            let starts: Vec<u32> = (0..subject.len() as u32 + 2).collect();
            assert_same_as_interpreter(source, letters, subject, &starts);
        });
    }
}

#[test]
fn every_unit_against_classes() {
    let units: Vec<u16> = (0..=u16::MAX).collect();
    let starts: Vec<u32> = (0..0x400)
        .chain((0x400..0x10000).step_by(7))
        .chain(0x2000..0x2060)
        .collect();
    let characters: Vec<u8> = (0..=u8::MAX).collect();
    for class in [
        r"\d",
        r"\D",
        r"\w",
        r"\W",
        r"\s",
        r"\S",
        ".",
        "[a-zA-Z]",
        "[^a-zA-Z]",
        "[+*/%&-]",
        r"[^\\\x22]",
        r"[\0-\x1f]",
        r"[\x80-￿]",
        "[a-fxz\u{e9}\u{3b1}-\u{3c9}]",
        r"\p{L}",
        r"\P{L}",
        r"[\p{L}_]",
        r"[\p{Lu}\p{Nd}]",
    ] {
        assert_same_as_interpreter(class, "uy", Text::Utf16(&units), &starts);
        assert_same_as_interpreter(class, "uy", Text::Latin1(&characters), &starts[..0x100]);
    }
}

#[test]
fn more_cells_than_registers() {
    for count in [10, 200] {
        let source = format!(
            "(?:{}x|y|{})*z",
            "(a*)ab".repeat(count),
            "aab".repeat(count)
        );
        let subject = format!("y{0}x{0}{0}x{0}z", "aab".repeat(count));
        in_each_width(&subject, |subject| {
            assert_same_as_interpreter(&source, "", subject, &[0, 1]);
        });
    }
}

#[test]
fn the_stack_grows_up_to_a_limit() {
    let subject = [b'a'; 50_000];
    let subject = Text::Latin1(&subject);
    let program = program("^(?:a|ab)*bc", "", subject, Mode::MatchOnly);
    for native in natives(&program) {
        let mut context = Context::new();
        assert_eq!(
            native.exec(subject, 0, &mut [], &mut context),
            Outcome::NoMatch
        );
        context.set_max_stack_size(4096);
        assert_eq!(
            native.exec(subject, 0, &mut [], &mut context),
            Outcome::OutOfMemory
        );
    }
}

#[test]
fn a_long_match_is_interrupted() {
    let subject = "ab".repeat(20_000);
    let subject = Text::from_ascii(&subject);
    for source in [
        r"^(ab|abab)+\1c".into(),
        "(?=[ab]{2}c)|(?![ab]{2})c|".repeat(200) + "c",
        "(?=(?:c|b?){99999}a)(?=c)".into(),
        format!("^(?:{}ab|a)*(?=c)", "(c)|".repeat(500)),
        format!("^(?:{}c)", "(?=[ab]*c)|".repeat(500)),
        format!("(?={}c)", "ab".repeat(2000)),
        "(?=[ab]{1000}c)".into(),
        "a*(?![ab]*$)".into(),
    ] {
        let program = program(&source, "", subject, Mode::Captures);
        for native in natives(&program) {
            let polls = Rc::new(Cell::new(0));
            let seen = Rc::clone(&polls);
            let mut context = Context::new();
            context.set_poll(Box::new(move || {
                seen.set(seen.get() + 1);
                seen.get() == 2
            }));
            let captures = &mut vec![0; program.capture_entries()];
            let outcome = native.exec(subject, 0, captures, &mut context);
            let found = (outcome, polls.get());
            assert_eq!(found, (Outcome::Interrupted, 2), "/{source:.40}/");
        }
    }
}

#[test]
fn a_match_that_takes_too_long_is_handed_back() {
    let subject = [b'a'; 5000];
    let subject = Text::Latin1(&subject);
    let mut context = Context::new();
    for source in [
        "^(a|aa)+b",
        "(?=a+x)|!!",
        r"(a+)\1b",
        "a{2000}b|!!",
        "$(?<=x(a|aa)+)",
    ] {
        let program = program(source, "", subject, Mode::MatchOnly);
        for native in natives(&program) {
            let outcome = native.exec(subject, 0, &mut [], &mut context);
            assert_eq!(outcome, Outcome::TooSlow, "/{source}/");
        }
    }
}

#[test]
fn and_is_finished_in_a_race() {
    let subject = format!("{0}b{0}!", "a".repeat(3000));
    let subject = Text::from_ascii(&subject);
    for (source, expected) in [
        ("(a|aa)+x|(!)", [6001, 6002, UNSET, UNSET, 6001, 6002]),
        ("(?<!x(a|aa)+)(!)", [6001, 6002, UNSET, UNSET, 6001, 6002]),
        (r"(a+)(b)\1a", [1, 6001, 1, 3000, 3000, 3001]),
        (
            r"(?:(a)*x|a*)(?<=b(a+))!",
            [3001, 6002, UNSET, UNSET, 3001, 6001],
        ),
    ] {
        let rivals = rivals(source, subject);
        for native in natives(rivals.plain()) {
            let mut run = |start: u32, captures: &mut [u32], racing: &mut Racing<'_>| {
                native.exec(subject, start, captures, racing)
            };
            let search = Search {
                subject,
                start: 0,
                has_been_too_slow: false,
            };
            let (mut context, mut notes, mut captures) = (Context::new(), Notes::new(), [0; 4]);
            let raced = context.race(&rivals, Some(&mut run), &mut notes, search, &mut captures);
            let [start, end, groups @ ..] = expected;
            let found = (raced.outcome, captures);
            assert_eq!(found, (Outcome::Match { start, end }, groups), "/{source}/");
        }
    }
}

#[test]
fn a_race_is_polled_whatever_is_passed_without_a_test() {
    let subject = format!("{}{}", "a".repeat(60), "b".repeat(100));
    let subject = Text::from_ascii(&subject);
    let rivals = rivals("^(?:a+(?![^]{0,60}$)(?![^]*$$x))+x", subject);
    for native in natives(rivals.plain()) {
        let mut run = |start: u32, captures: &mut [u32], racing: &mut Racing<'_>| {
            native.exec(subject, start, captures, racing)
        };
        let search = Search {
            subject,
            start: 0,
            has_been_too_slow: false,
        };
        let raced =
            Context::new().race(&rivals, Some(&mut run), &mut Notes::new(), search, &mut []);
        assert_eq!(raced.outcome, Outcome::NoMatch);
    }
}

#[test]
fn all_that_needs_a_register_together() {
    let source = format!(r"e(.?){}(?:a+|.b+)*\1(?=%)", r"(?:\d*|\d*x)".repeat(140));
    let subject = "the quick brown fox jumps over the lazy dog ".repeat(4);
    in_each_width(&subject, |subject| {
        assert_same_as_interpreter(&source, "", subject, &[0]);
        natives(rivals(&source, subject).plain());
    });
}

#[test]
fn the_size_of_the_code_has_a_limit() {
    let program = program(&"a*b".repeat(100), "", Text::EMPTY, Mode::MatchOnly);
    let options = Options {
        features: Features::host(),
        seed: 1,
        max_code_size: 1000,
        max_units: None,
    };
    let mut compiler = Compiler::default();
    assert!((compiler.compile(program.verify().unwrap(), &options)).is_err());
}
