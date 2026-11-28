use bun_core::strings;
use bun_dotenv::Loader;

fn value_of_a(parts: &[&[u8]]) -> Option<Vec<u8>> {
    let mut loader = Loader::init();
    loader
        .load_from_string::<true, false>(&parts.concat())
        .unwrap();
    loader.get(b"A").map(Vec::from)
}

#[test]
fn blanks() {
    for byte in (0..=255).filter(|&it| it != b'=') {
        let is_blank = matches!(byte, b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ');
        assert_eq!(strings::is_all_whitespace(&[b' ', byte, b' ']), is_blank);
        let expected = |value: &[u8]| is_blank.then(|| value.to_vec());
        assert_eq!(value_of_a(&[b"A", &[byte; 2], b"=1"]), expected(b"1"));
        assert_eq!(value_of_a(&[b"A:", &[byte], b"1"]), expected(b"1"));
        assert_eq!(value_of_a(&[b"A:", &[byte]]), expected(b""));
    }
    assert_eq!(value_of_a(&[b"A:"]), None);
    assert!(strings::is_all_whitespace(b""));
}

#[test]
fn values_without_quotes() {
    for byte in (0..=255).filter(|it| !matches!(it, b'#' | b'\r' | b'\n')) {
        for value in [1, 20, 100].map(|len| [&vec![b'x'; len][..], &[byte, b'y']].concat()) {
            assert_eq!(value_of_a(&[b"A=", &value]), Some(value));
        }
    }
    for value in (0..200).map(|len| vec![b'x'; len]) {
        for end in [&b""[..], b"#y", b" #y", b"\ry", b"\ny"] {
            assert_eq!(value_of_a(&[b"A= ", &value, end]).as_ref(), Some(&value));
        }
    }
}
