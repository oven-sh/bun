//! What ends a run that would take too much. Here the buffers are small (`LARGEST`), so that small texts come to their limits.

use crate::root::LONGEST_FILE;
use crate::{
    Answer, Dialect, Guest, Guests, LARGEST, Language, Options, OwnLosses, Quick, Sink, format,
    grow, has_lost_something, larger, lose, why,
};
use bun_sema_standalone as _;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// What is printed, or why nothing is.
fn print_with(
    scratch: &mut Quick,
    name: &str,
    text: &[u8],
    options: &Options,
) -> Result<Vec<u8>, i32> {
    let language = if name.ends_with(".ts") {
        Language::TypeScript
    } else {
        Language::JavaScript
    };
    let mut out = Vec::new();
    match format(
        text,
        Dialect::of_name(language, name.as_bytes()),
        options,
        scratch,
        &mut out,
    ) {
        Ok(()) => Ok(out),
        Err(_) => Err(scratch.why()),
    }
}

fn print(name: &str, text: &[u8]) -> Result<Vec<u8>, i32> {
    print_with(&mut Quick::new(), name, text, &Options::default())
}

fn lines_of(printed: &Result<Vec<u8>, i32>) -> usize {
    printed
        .as_ref()
        .map_or(0, |out| out.iter().filter(|&&c| c == b'\n').count())
}

#[test]
fn a_buffer_grows_to_the_limit_and_no_further() {
    assert_eq!(larger(16, 17), Some(128));
    assert_eq!(larger(0, 1), Some(16));
    assert_eq!(larger(LARGEST / 2, LARGEST / 2 + 1), Some(LARGEST));
    assert_eq!(larger(LARGEST - 1, LARGEST), Some(LARGEST));
    assert_eq!(larger(LARGEST, LARGEST), Some(LARGEST));
    for need in [LARGEST + 1, i32::MAX, -1, i32::MIN] {
        assert_eq!(larger(16, need), None);
        assert_eq!(larger(LARGEST, need), None);
    }

    let mut buffer = vec![7u8; 16];
    assert!(grow(&mut buffer, 4, 100, 8));
    assert_eq!(buffer.len(), 128 + 8);
    assert_eq!(buffer.get(..6), Some(&[7, 7, 7, 7, 0, 0][..]));
    assert!(!grow(&mut buffer, 4, LARGEST + 1, 8));
    assert_eq!(buffer.len(), 128 + 8);
}

#[test]
fn a_run_that_is_ended_finds_no_room_on_the_stack() {
    let mut scratch = Quick::new();
    scratch.start_run();
    assert!(scratch.stack().is_ok());
    assert!(scratch.nothing_lost().is_ok());
    scratch.end_run(why::TOO_LARGE);
    assert!(scratch.stack().is_err());
    assert_eq!(scratch.why(), why::TOO_LARGE);
    assert!(scratch.nothing_lost().is_err());
    scratch.start_run();
    assert!(scratch.stack().is_ok());
}

#[test]
fn a_text_that_is_too_long_is_refused() {
    let line = b"a;\n";
    let fits = line.repeat(LONGEST_FILE / line.len());
    assert_eq!(print("a.js", &fits).as_deref(), Ok(&fits[..]));
    let mut too_long = fits;
    too_long.extend_from_slice(b"bcd;\n");
    assert_eq!(print("a.js", &too_long), Err(why::TOO_LARGE));
}

#[test]
fn a_document_that_is_too_long_is_refused() {
    // more than five words of the document for each byte
    let statement = b"a().b().c();";
    assert_eq!(lines_of(&print("a.js", &statement.repeat(1000))), 1000);
    let count = LONGEST_FILE / statement.len();
    assert_eq!(print("a.js", &statement.repeat(count)), Err(why::TOO_LARGE));

    let hole = b"${a + b}";
    let template = |count: usize| [&b"x = `"[..], &hole.repeat(count), b"`;\n"].concat();
    assert_eq!(print("a.js", &template(1000)), Ok(template(1000)));
    assert_eq!(
        print("a.js", &template(LONGEST_FILE / hole.len() - 2)),
        Err(why::TOO_LARGE)
    );
}

#[test]
fn a_tree_that_is_too_large_is_refused() {
    // five words of the tree for each byte, two of the document
    let options = Options {
        no_short_cuts: true,
        ..Options::default()
    };
    let print =
        |count: usize| print_with(&mut Quick::new(), "a.js", &b"a;".repeat(count), &options);
    assert_eq!(lines_of(&print(1000)), 1000);
    assert_eq!(print(LONGEST_FILE / 2), Err(why::TOO_LARGE));
}

#[test]
fn an_output_that_is_too_long_is_refused() {
    let nest = |depth: usize| [&b"f(".repeat(depth)[..], &b")".repeat(depth), b";\n"].concat();
    let options = Options {
        tab_width: 64,
        ..Options::default()
    };
    let print = |depth: usize| print_with(&mut Quick::new(), "a.js", &nest(depth), &options);
    assert_eq!(lines_of(&print(50)), 99);
    // two lines for each level, each indented by its depth
    assert_eq!(print(100), Err(why::TOO_LARGE));
}

#[test]
fn what_a_large_text_needed_is_given_back() {
    let mut scratch = Quick::new();
    let small = scratch.d.len();
    let text = b"a().b().c();".repeat(2000);
    assert_eq!(
        lines_of(&print_with(
            &mut scratch,
            "a.js",
            &text,
            &Options::default()
        )),
        2000
    );
    assert_eq!(scratch.d.len(), small);
    assert_eq!(
        print_with(&mut scratch, "a.js", b"a  =  1", &Options::default()).as_deref(),
        Ok(&b"a = 1;\n"[..])
    );
}

/// Stands for a formatter of Markdown that finds code in the text.
struct RunsAnother {
    loses_first: bool,
    text_length: usize,
}

impl Guests for RunsAnother {
    fn knows(&self, _: Guest) -> bool {
        true
    }

    fn format<'q>(&mut self, _: Guest, _: &'q [u8], sink: &mut Sink<'q>) -> Answer {
        if self.loses_first {
            lose();
        }
        assert_eq!(print("a.js", b"a  =  1").as_deref(), Ok(&b"a = 1;\n"[..]));
        sink.text(&b"b".repeat(self.text_length));
        Answer::Written
    }
}

fn print_with_guest(guest: RunsAnother) -> Result<Vec<u8>, i32> {
    let mut scratch = Quick::new();
    scratch.lend_guests(Some(Box::new(guest)));
    print_with(
        &mut scratch,
        "a.js",
        b"x = markdown`a`;\n",
        &Options::default(),
    )
}

#[test]
fn a_run_in_a_run_has_losses_of_its_own() {
    assert!(!has_lost_something());
    {
        let _inner = OwnLosses::start();
        lose();
        assert!(has_lost_something());
    }
    assert!(!has_lost_something());
    {
        let _outer = OwnLosses::start();
        lose();
        {
            let _inner = OwnLosses::start();
            assert!(!has_lost_something());
        }
        assert!(has_lost_something());
    }
    assert!(!has_lost_something());

    let printed = print_with_guest(RunsAnother {
        loses_first: false,
        text_length: 1,
    });
    assert_eq!(printed.as_deref(), Ok(&b"x = markdown`\nb\n`;\n"[..]));
    let printed = print_with_guest(RunsAnother {
        loses_first: true,
        text_length: 1,
    });
    assert_eq!(printed, Err(why::LOST));
}

#[test]
fn a_guest_that_writes_too_much_text_is_refused() {
    for text_length in [LARGEST as usize, LARGEST as usize * 2] {
        let printed = print_with_guest(RunsAnother {
            loses_first: false,
            text_length,
        });
        assert_eq!(printed, Err(why::TOO_LARGE));
    }
}

#[test]
fn what_a_trial_has_made_is_gone_when_it_fails() {
    // each `<` is tried as the start of type arguments, up to the end of the list
    let count = 50;
    let text = [&b"x = ["[..], &b"a < b, ".repeat(count), b"];\n"].concat();
    let mut scratch = Quick::new();
    let options = Options {
        no_short_cuts: true,
        ..Options::default()
    };
    let printed = print_with(&mut scratch, "a.ts", &text, &options);
    assert_eq!(lines_of(&printed), count + 2);
    assert!(scratch.arena.n_pos < count as i32 * 32);
    assert!(scratch.wasted > count as i32 * count as i32);
}

#[test]
fn trials_that_cost_too_much_end_the_run() {
    let mut scratch = Quick::new();
    scratch.start_run();
    scratch.allow_waste_for(100);
    let allowance = scratch.allowance;
    assert!(scratch.waste(allowance).is_ok());
    assert!(scratch.stack().is_ok());
    assert!(scratch.waste(1).is_err());
    assert_eq!(scratch.why(), why::TOO_LARGE);
    assert!(scratch.stack().is_err());
    scratch.allow_waste_for(i32::MAX);
    assert!(scratch.waste(i32::MAX).is_ok());
    assert!(scratch.waste(i32::MAX).is_ok());

    let list = |count: usize| [&b"x = ["[..], &b"a < b, ".repeat(count), b"];\n"].concat();
    assert_eq!(print("a.ts", &list(2000)), Err(why::TOO_LARGE));
}

#[test]
fn a_trial_in_a_trial_is_not_tried_twice() {
    let nest = |depth: usize| {
        [
            &b"x = "[..],
            &b"<T>(a = ".repeat(depth),
            b"1",
            &b")".repeat(depth),
            b";\n",
        ]
        .concat()
    };
    let mut scratch = Quick::new();
    let printed = print_with(&mut scratch, "a.ts", &nest(30), &Options::default());
    assert!(printed.is_ok());
    // (the square of the depth, not a power of two)
    assert!(scratch.wasted < 30 * 30 * 32);
}

/// Stands for a formatter that finds a syntax error in every text.
struct ReadsNothing {
    asked: Arc<AtomicUsize>,
}

impl Guests for ReadsNothing {
    fn knows(&self, _: Guest) -> bool {
        true
    }

    fn format<'q>(&mut self, _: Guest, _: &'q [u8], _: &mut Sink<'q>) -> Answer {
        self.asked.fetch_add(1, Ordering::Relaxed);
        Answer::NotRead
    }
}

#[test]
fn a_template_that_its_guest_cannot_read_is_tried_once() {
    let depth = 20;
    let text = [
        &b"x = "[..],
        &b"css`a${".repeat(depth),
        b"1",
        &b"}`".repeat(depth),
        b";\n",
    ]
    .concat();
    let asked = Arc::new(AtomicUsize::new(0));
    let mut scratch = Quick::new();
    scratch.lend_guests(Some(Box::new(ReadsNothing {
        asked: asked.clone(),
    })));
    let printed = print_with(&mut scratch, "a.js", &text, &Options::default());
    assert_eq!(printed.as_deref(), Ok(&text[..]));
    assert_eq!(asked.load(Ordering::Relaxed), depth);
}
