//! What cannot be seen from outside of the crate.

use crate::{
    Answer, Dialect, Guest, Guests, Language, Options, OwnLosses, Quick, Sink, format,
    has_lost_something, lose, why,
};
use bun_sema_standalone as _;

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

/// Stands for a formatter of Markdown that finds code in the text.
struct RunsAnother {
    loses_first: bool,
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
        sink.text(b"b");
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

    let printed = print_with_guest(RunsAnother { loses_first: false });
    assert_eq!(printed.as_deref(), Ok(&b"x = markdown`\nb\n`;\n"[..]));
    let printed = print_with_guest(RunsAnother { loses_first: true });
    assert_eq!(printed, Err(why::LOST));
}
