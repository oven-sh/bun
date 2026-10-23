use super::*;

fn tokens_of_bytes(text: &[u8]) -> Vec<Token<'_>> {
    let mut lexer = Lexer::new(text);
    let mut tokens = Vec::new();
    loop {
        let token = lexer.next();
        tokens.push(token);
        if token.kind == TokenKind::EndOfFile {
            return tokens;
        }
    }
}

fn tokens(text: &str) -> Vec<Token<'_>> {
    tokens_of_bytes(text.as_bytes())
}

fn kinds(text: &str) -> Vec<TokenKind> {
    tokens(text).iter().map(|token| token.kind).collect()
}

fn first(text: &str) -> Token<'_> {
    tokens(text)[0]
}

fn positions(text: &str) -> Vec<(u32, u32)> {
    let positions = tokens(text).into_iter().map(|token| token.position);
    positions
        .map(|position| (position.line, position.column))
        .collect()
}

#[track_caller]
fn assert_single_token(text: &str, kind: TokenKind) {
    let expected = [kind, TokenKind::EndOfLine, TokenKind::EndOfFile];
    assert_eq!(kinds(text), expected, "{text}");
    assert_eq!(first(text).text, text.as_bytes(), "{text}");
}

#[test]
fn every_token_kind() {
    use TokenKind::*;
    let text = "w 5 1.5 \"s\" : = , ( ) [ ] { } < > | @ #\"p\" - -> $";
    let expected = [
        Word,
        Integer,
        Number,
        String,
        Colon,
        Equal,
        Comma,
        LeftParenthesis,
        RightParenthesis,
        LeftBracket,
        RightBracket,
        LeftBrace,
        RightBrace,
        LeftAngle,
        RightAngle,
        Bar,
        At,
        NumberSign,
        String,
        Minus,
        Arrow,
        Invalid,
        EndOfLine,
        EndOfFile,
    ];
    assert_eq!(kinds(text), expected);
}

#[test]
fn nothing_is_fused() {
    use TokenKind::*;
    assert_eq!(kinds("==L3"), [Equal, Equal, Word, EndOfLine, EndOfFile]);
    assert_eq!(
        kinds("@@a|b"),
        [At, At, Word, Bar, Word, EndOfLine, EndOfFile]
    );
    assert_eq!(
        kinds("a=1,b"),
        [Word, Equal, Integer, Comma, Word, EndOfLine, EndOfFile]
    );
}

#[test]
fn line_ends_collapse() {
    use TokenKind::*;
    let two_lines = [Word, EndOfLine, Word, EndOfLine, EndOfFile];
    assert_eq!(kinds(""), [EndOfFile]);
    assert_eq!(kinds(" \t "), [EndOfFile]);
    assert_eq!(kinds("\n\n# only a comment\n"), [EndOfFile]);
    assert_eq!(kinds("a\n\n  # comment\n\nb"), two_lines);
    assert_eq!(kinds("a\nb\n"), two_lines);
}

#[test]
fn carriage_return_is_blank() {
    use TokenKind::*;
    let two_lines = [Word, EndOfLine, Word, EndOfLine, EndOfFile];
    assert_eq!(kinds("a\r\nb\r\n"), two_lines);
    assert_eq!(kinds("a\r\n\r\nb"), two_lines);
}

#[test]
fn comment_runs_to_end_of_line() {
    use TokenKind::*;
    assert_eq!(kinds("# 2"), [EndOfFile]);
    assert_eq!(kinds("#2"), [EndOfFile]);
    assert_eq!(kinds("#"), [EndOfFile]);
    assert_eq!(kinds("# \"x\""), [EndOfFile]);
    assert_eq!(kinds("a # 2"), [Word, EndOfLine, EndOfFile]);
    assert_eq!(
        kinds("a # 2\nb"),
        [Word, EndOfLine, Word, EndOfLine, EndOfFile]
    );
}

#[test]
fn number_sign_before_quote_is_a_token() {
    use TokenKind::*;
    assert_eq!(kinds("#\"x\""), [NumberSign, String, EndOfLine, EndOfFile]);
    let private_name = [Word, NumberSign, String, At, Word, EndOfLine, EndOfFile];
    assert_eq!(kinds("a #\"x\"@L1 # rest"), private_name);
}

#[test]
fn words_hold_letters_digits_and_underscores() {
    for word in [
        "v12", "L3", "i32", "int", "_v1", "V1", "a_b9", "NaN", "Infinity",
    ] {
        assert_single_token(word, TokenKind::Word);
    }
}

#[test]
fn integers_fit_64_bits() {
    let integers = [
        ("0", 0),
        ("7", 7),
        ("007", 7),
        ("-5", -5),
        ("9223372036854775807", i64::MAX),
        ("-9223372036854775808", i64::MIN),
    ];
    for (text, integer) in integers {
        assert_single_token(text, TokenKind::Integer);
        assert_eq!(first(text).integer, integer, "{text}");
        assert_eq!(first(text).double(), Some(integer as f64), "{text}");
    }
    for text in ["9223372036854775808", "-9223372036854775809"] {
        assert_single_token(text, TokenKind::Number);
    }
    assert_eq!(
        first("9223372036854775808").double(),
        Some(9_223_372_036_854_775_808.0)
    );
}

#[test]
fn numbers() {
    let numbers = [
        ("1.5", 1.5),
        ("0.25", 0.25),
        ("1e+21", 1e21),
        ("1e21", 1e21),
        ("1E3", 1000.0),
        ("-2.5e-7", -2.5e-7),
        ("5e-324", 5e-324),
        ("-Infinity", f64::NEG_INFINITY),
    ];
    for (text, number) in numbers {
        assert_single_token(text, TokenKind::Number);
        assert_eq!(first(text).double(), Some(number), "{text}");
    }
}

#[test]
fn negative_zero_is_a_number() {
    assert_single_token("-0", TokenKind::Number);
    let zero = first("-0").double().expect("the token is a number");
    assert!(zero == 0.0 && zero.is_sign_negative());
    assert_single_token("0", TokenKind::Integer);
}

#[test]
fn number_words_have_a_double() {
    assert_eq!(first("Infinity").double(), Some(f64::INFINITY));
    assert!(first("NaN").double().is_some_and(f64::is_nan));
    for text in ["nan", "infinity", "x", "\"1\"", ":", "-", "12ab", ""] {
        assert_eq!(first(text).double(), None, "{text}");
    }
}

#[test]
fn integer_followed_by_word_byte_is_invalid() {
    for text in ["12ab", "12_", "0x10", "1e", "1e+", "1.5x", "1e5x", "-3a"] {
        let invalid = first(text);
        assert_eq!(invalid.kind, TokenKind::Invalid, "{text}");
        assert_eq!(invalid.position.column, 1, "{text}");
    }
    assert_single_token("12ab", TokenKind::Invalid);
}

#[test]
fn point_outside_a_fraction_is_invalid() {
    for text in ["1.", ".5", "1.5.2", "1.e5", "."] {
        assert!(kinds(text).contains(&TokenKind::Invalid), "{text}");
    }
}

#[test]
fn arrow_and_minus() {
    use TokenKind::*;
    assert_eq!(kinds("->"), [Arrow, EndOfLine, EndOfFile]);
    assert_eq!(kinds("-"), [Minus, EndOfLine, EndOfFile]);
    assert_eq!(kinds("- 5"), [Minus, Integer, EndOfLine, EndOfFile]);
    assert_eq!(kinds("-x"), [Minus, Word, EndOfLine, EndOfFile]);
    assert_eq!(kinds("-->"), [Minus, Arrow, EndOfLine, EndOfFile]);
    assert_eq!(kinds("a->b"), [Word, Arrow, Word, EndOfLine, EndOfFile]);
    assert_eq!(kinds("- >"), [Minus, RightAngle, EndOfLine, EndOfFile]);
}

#[test]
fn minus_joins_only_whole_word_infinity() {
    use TokenKind::*;
    for text in ["-Infinit", "-Infinitys", "-infinity", "-NaN", "- Infinity"] {
        assert_eq!(kinds(text), [Minus, Word, EndOfLine, EndOfFile], "{text}");
    }
    let word = tokens("-Infinitys")[1];
    assert_eq!(word.text, b"Infinitys");
    assert_eq!(word.position.column, 2);
}

#[test]
fn string_text_is_between_quotes() {
    let string = first("\"a b#c\" x");
    assert_eq!(string.kind, TokenKind::String);
    assert_eq!(string.text, b"a b#c");
    assert_eq!(string.position.column, 1);
    assert_eq!(first("\"\"").kind, TokenKind::String);
    assert_eq!(first("\"\"").text, b"");
    let escaped = first(r#""\x4a\u{e9}\q""#);
    assert_eq!(escaped.kind, TokenKind::String);
    assert_eq!(escaped.text, br"\x4a\u{e9}\q");
}

#[test]
fn escaped_quote_stays_inside() {
    use TokenKind::*;
    let string = first(r#""a\"b""#);
    assert_eq!(string.kind, String);
    assert_eq!(string.text, br#"a\"b"#);
    assert_eq!(kinds(r#""a\"b""#), [String, EndOfLine, EndOfFile]);

    let escaped_backslash = first(r#""a\\" b"#);
    assert_eq!(escaped_backslash.text, br"a\\");
    assert_eq!(kinds(r#""a\\" b"#), [String, Word, EndOfLine, EndOfFile]);
}

#[test]
fn unterminated_string_is_invalid_at_first_bad_byte() {
    let invalid_at = |text: &[u8]| {
        let token = tokens_of_bytes(text)[0];
        assert_eq!(token.kind, TokenKind::Invalid);
        token.position.column
    };
    assert_eq!(invalid_at(b"\"abc"), 5);
    assert_eq!(invalid_at(b"\""), 2);
    assert_eq!(invalid_at(b"\"ab\n\""), 4);
    assert_eq!(invalid_at(b"\"a\t\""), 3);
    assert_eq!(invalid_at(b"\"a\x01\""), 3);
    assert_eq!(invalid_at(b"\"a\\"), 3);
    assert_eq!(invalid_at(b"\"a\\\n\""), 3);
    assert_eq!(invalid_at(b"\"a\\\""), 5);
}

#[test]
fn high_bytes_are_valid_only_in_strings_and_comments() {
    assert_eq!(tokens_of_bytes(b"\x80")[0].kind, TokenKind::Invalid);
    assert_eq!(tokens_of_bytes(b"a\xC3\xA9")[1].kind, TokenKind::Invalid);
    assert_eq!(tokens_of_bytes(b"# \x80\n")[0].kind, TokenKind::EndOfFile);
    let string = tokens_of_bytes(b"\"\xC3\xA9\x80\"")[0];
    assert_eq!(string.kind, TokenKind::String);
    assert_eq!(string.text, b"\xC3\xA9\x80");
}

#[test]
fn positions_count_bytes_from_one() {
    let expected = [
        (1, 1),
        (1, 3),
        (1, 5),
        (2, 3),
        (2, 8),
        (3, 1),
        (3, 2),
        (3, 2),
    ];
    assert_eq!(positions("a bc\n  d # e\nf"), expected);
    assert_eq!(positions("\"\u{e9}\" x"), [(1, 1), (1, 6), (1, 7), (1, 7)]);
    assert_eq!(positions("\n\n  a"), [(3, 3), (3, 4), (3, 4)]);
}

#[test]
fn restore_repeats_tokens() {
    let mut lexer = Lexer::new(b"a\nb c\n");
    lexer.next();
    let state = lexer.state();
    let first_pass: Vec<TokenKind> = (0..5).map(|_| lexer.next().kind).collect();
    lexer.restore(state);
    let second_pass: Vec<TokenKind> = (0..5).map(|_| lexer.next().kind).collect();
    assert_eq!(first_pass, second_pass);
    assert_eq!(first_pass[0], TokenKind::EndOfLine);
}

#[test]
fn restore_keeps_position_inside_a_line() {
    let mut lexer = Lexer::new(b"a b");
    lexer.next();
    let state = lexer.state();
    assert_eq!(lexer.next().position, TextPosition { line: 1, column: 3 });
    assert_eq!(lexer.next().kind, TokenKind::EndOfLine);
    lexer.restore(state);
    let repeated = lexer.next();
    assert_eq!(repeated.text, b"b");
    assert_eq!(repeated.position, TextPosition { line: 1, column: 3 });
}

#[test]
fn end_of_file_repeats() {
    let mut lexer = Lexer::new(b"a");
    assert_eq!(lexer.next().kind, TokenKind::Word);
    assert_eq!(lexer.next().kind, TokenKind::EndOfLine);
    assert_eq!(lexer.next().kind, TokenKind::EndOfFile);
    assert_eq!(lexer.next().kind, TokenKind::EndOfFile);
}

#[test]
fn decode_string_escapes() {
    let decoded = decode_string(br#"a\"b\\c\n\u{7f}\u{e9}\u{1f600}\x41\xff"#);
    let expected = ["a\"b\\c\n\u{7f}\u{e9}\u{1f600}A".as_bytes(), b"\xff"].concat();
    assert_eq!(decoded, Some(expected));
    assert_eq!(decode_string(b""), Some(Vec::new()));
    assert_eq!(decode_string(br"\u{0}"), Some(vec![0]));
    assert_eq!(
        decode_string(br"\u{1F600}\u{000041}\x4A\x4a"),
        Some("\u{1f600}AJJ".into())
    );
    assert_eq!(decode_string(br"\u{10ffff}"), Some("\u{10ffff}".into()));
}

#[test]
fn decode_string_copies_other_bytes() {
    assert_eq!(
        decode_string("\u{e9} #{}".as_bytes()),
        Some("\u{e9} #{}".into())
    );
    assert_eq!(
        decode_string(b"\x80\xED\xA0\x80"),
        Some(b"\x80\xED\xA0\x80".to_vec())
    );
}

#[test]
fn decode_string_rejects() {
    let rejected: [&[u8]; 14] = [
        br"\q",
        br"\t",
        br"\0",
        br"\",
        br"a\",
        br"\u{}",
        br"\u{110000}",
        br"\u{0000041}",
        br"\u{g}",
        br"\u{41",
        br"\u41",
        br"\x4",
        br"\x4g",
        br"\x",
    ];
    for text in rejected {
        assert_eq!(decode_string(text), None, "{}", text.escape_ascii());
    }
}

#[test]
fn surrogate_escape_is_three_bytes() {
    assert_eq!(decode_string(br"\u{d800}"), Some(b"\xED\xA0\x80".to_vec()));
    assert_eq!(decode_string(br"\u{dfff}"), Some(b"\xED\xBF\xBF".to_vec()));
    let halves = decode_string(br"\u{d83d}\u{de00}");
    assert_eq!(halves, Some(b"\xED\xA0\xBD\xED\xB8\x80".to_vec()));
}

#[test]
fn decode_bytes_reads_hex_escapes_and_printable_bytes() {
    assert_eq!(decode_bytes(b""), Some(Vec::new()));
    assert_eq!(decode_bytes(b" az~{}"), Some(b" az~{}".to_vec()));
    assert_eq!(decode_bytes(br"a\x4a\x4A"), Some(b"aJJ".to_vec()));
    assert_eq!(
        decode_bytes(br"\x00\xff\x22\x5c"),
        Some(b"\x00\xff\"\\".to_vec())
    );
}

#[test]
fn decode_bytes_rejects_unicode_escape() {
    let rejected: [&[u8]; 10] = [
        br"\u{41}", br"\n", br#"\""#, br"\\", br"\", br"\x4", br"\x4g", b"\x7f", b"\x80", b"\n",
    ];
    for text in rejected {
        assert_eq!(decode_bytes(text), None, "{}", text.escape_ascii());
    }
}
