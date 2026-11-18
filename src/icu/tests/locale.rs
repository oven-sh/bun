use bun_engine_standalone as _;
use bun_icu::number_format::NumberFormatter;
use bun_icu::{CText, Error, collator, locale};

#[test]
fn language_tags() {
    assert_eq!(
        &*locale::to_language_tag(c"sr_Latn_RS@calendar=gregorian;numbers=latn").unwrap(),
        b"sr-Latn-RS-u-ca-gregory-nu-latn"
    );
}

#[test]
fn identifiers_end_at_their_only_zero() {
    assert_eq!(&*CText::new(b"en").unwrap(), c"en");
    assert!(CText::new(b"e\0n").is_err());
}

#[test]
fn syntax_of_identifiers() {
    for id in locale::available().chain(collator::available_locales()) {
        assert!(locale::to_language_tag(id).is_ok(), "{id:?}");
    }
    for id in [
        c"",
        c"root",
        c"root@numbers=arab",
        c"_US",
        c"en__POSIX",
        c"zh-Hant-TW",
        c"abcdefgh_419_12345678",
        c"@calendar=ethiopic-amete-alem",
        c"en-US@calendar=roc;hours=h23;numbers=arab",
    ] {
        assert!(NumberFormatter::open(&[], id).is_ok(), "{id:?}");
    }
    let of_length = |length: usize| {
        let mut id = b"en@fw=".to_vec();
        id.resize(length, b'a');
        CText::new(&id).unwrap()
    };
    assert!(NumberFormatter::open(&[], &of_length(95)).is_ok());
    for id in [
        &*of_length(96),
        c"e",
        c"e1",
        c"Latn",
        c"root_US",
        c"abcdefghi",
        c"en_123456789",
        c"en-u-ca-roc",
        c"en_US.UTF-8",
        c"en US",
        c"en@",
        c"en@euro",
        c"en@fw=",
        c"en@=sun",
        c"en@fw=sun;",
        c"en@fw=sun@",
        c"en@timezone=Europe/Paris",
    ] {
        let error = NumberFormatter::open(&[], id).err();
        assert_eq!(error, Some(Error::ILLEGAL_ARGUMENT), "{id:?}");
    }
}
