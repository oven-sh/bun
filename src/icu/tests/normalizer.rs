use bun_engine_standalone as _;
use bun_icu::Buffer;
use bun_icu::normalizer::Form;

fn normalize(form: Form, text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut out = Buffer::new();
    form.normalize(&units, &mut out).unwrap();
    String::from_utf16(&out).unwrap()
}

#[test]
fn each_form() {
    let text = "\u{1e9b}\u{323}";
    assert_eq!(normalize(Form::Nfc, text), "\u{1e9b}\u{323}");
    assert_eq!(normalize(Form::Nfd, text), "\u{17f}\u{323}\u{307}");
    assert_eq!(normalize(Form::Nfkc, text), "\u{1e69}");
    assert_eq!(normalize(Form::Nfkd, text), "s\u{323}\u{307}");
}

#[test]
fn results_of_any_length() {
    for count in [0, 1, 15, 16, 17, 1000] {
        assert_eq!(
            normalize(Form::Nfd, &"\u{e9}".repeat(count)),
            "e\u{301}".repeat(count)
        );
    }
}

#[test]
fn any_number_of_marks() {
    for count in [255, 256, 257, 511, 512, 513, 100_000] {
        let text = format!("xa{}z", "\u{301}\u{1d16d}\u{323}".repeat(count));
        let marks = |dots, acutes| {
            [
                "\u{323}".repeat(dots),
                "\u{1d16d}".repeat(count),
                "\u{301}".repeat(acutes),
            ]
            .concat()
        };
        assert_eq!(
            normalize(Form::Nfd, &text),
            format!("xa{}z", marks(count, count))
        );
        assert_eq!(
            normalize(Form::Nfkc, &text),
            format!("x\u{1ea1}{}z", marks(count - 1, count))
        );
        assert_eq!(
            normalize(Form::Nfd, &"\u{f73}".repeat(count)),
            "\u{f71}".repeat(count) + &"\u{f72}".repeat(count)
        );
    }
}

#[test]
fn any_number_of_starters_that_combine_backwards() {
    for count in [510, 511, 512, 1023, 1024, 1025, 5000] {
        let vowels = "\u{1161}".repeat(count);
        assert_eq!(
            normalize(Form::Nfc, &format!("\u{1100}\u{1161}{vowels}\u{11a8}")),
            format!("\u{ac00}{vowels}\u{11a8}")
        );
        let marks = "\u{301}".repeat(count);
        assert_eq!(
            normalize(Form::Nfc, &format!("\u{dd9}\u{dcf}\u{dca}{marks}\u{dcf}")),
            format!("\u{ddd}{marks}\u{dcf}")
        );
    }
}

#[test]
fn pairs_of_surrogates_stay_together() {
    for offset in 0..2 {
        let text = "a".repeat(offset) + &"\u{1d15e}".repeat(1000);
        let expected = "a".repeat(offset) + &"\u{1d157}\u{1d165}".repeat(1000);
        assert_eq!(normalize(Form::Nfc, &text), expected);
    }
}
