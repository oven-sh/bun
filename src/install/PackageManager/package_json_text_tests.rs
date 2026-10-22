//! A test gives a text and, as JSON, its tree after an edit. CI type-checks this file and does not run it.

// To run it, link the native symbols: add `bun_sema_standalone = { path = "../sema/standalone" }` to `[dev-dependencies]` and `use bun_sema_standalone as _;` here.

use super::*;

const PATH: &[u8] = b"package.json";

/// The tree of `text`, as a command has it when it has loaded a package.json.
fn parse(text: &[u8], bump: &bun_alloc::Arena) -> Expr {
    let source = Source::init_path_string(b"package.json", text);
    json::parse_package_json_utf8(&source, &mut Log::init(), bump)
        .unwrap_or_else(|_| panic!("the parser does not read {:?}", bstr::BStr::new(text)))
}

/// The text of `old` when its tree is what the JSON `now` says.
fn saved(old: &str, now: &str) -> String {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let root = parse(now.as_bytes(), &bump);
    let indentation = json::guess_indentation(old.as_bytes());
    let mut text = Text::new(old.as_bytes(), indentation);
    assert!(
        text.document(&root).is_ok(),
        "{old:?} is a text that is not written over"
    );
    let printed = print(PATH, old.as_bytes(), root, indentation).expect("prints");
    assert_eq!(bstr::BStr::new(&printed), bstr::BStr::new(&text.out.list));
    String::from_utf8(printed).expect("UTF-8")
}

/// The text of `text` when nothing has changed its tree.
fn unchanged(text: &[u8]) -> Vec<u8> {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let root = parse(text, &bump);
    print(PATH, text, root, json::guess_indentation(text)).expect("prints")
}

#[track_caller]
fn assert_unchanged(text: &str) {
    assert_eq!(
        bstr::BStr::new(&unchanged(text.as_bytes())),
        bstr::BStr::new(text)
    );
}

// ───── a text is the text of its own tree ─────

#[test]
fn a_text_that_no_edit_changed_is_the_same_bytes() {
    for text in [
        "{}",
        "[]",
        "{ }\n",
        "{\"a\":1}",
        "{\n  \"a\": 1\n}\n",
        "{\r\n  \"a\": 1,\r\n  \"b\": [1, 2, 3]\r\n}\r\n",
        "\u{feff}{\n  \"name\": \"app\"\n}\n",
        "// before\n{\n  // above\n  \"a\": 1, /* beside */\n\n  \"b\": 'single', // beside\n} // after\n",
        "{\"a\": 1, \"a\": 2, \"a\": {\"a\": 3, \"a\": 4}}",
        "{\"n\": [0x10, .5, 1_000, 010, 0b11, 0o17, 1e400, -0, 1.50, 1E3, - 1, 9007199254740993]}",
        "{\"s\": [\"caf\\u00e9\", \"\\ud83d\\ude00\", \"\\ud800\", \"a\\/b\", \"tab\\t\", '\"', \"\\x41\"]}",
        "{\"k\\u0065y\": true, \"\": null, \"t\": \\u0074rue}",
        "{\"a\": [], \"b\": {}, \"c\": [[]], \"d\": [{}], \"e\": [ /* none */ ], \"f\": {\n}}",
        "{\u{a0}\"a\"\u{2003}:\u{2028}1\u{3000}}",
        "[1, \"two\", [3, [4, {\"five\": 5}]], null, true, false]",
        "{\n\t\"a\": {\n\t\t\"b\": {\n\t\t\t\"c\": [\n\t\t\t\t1,\n\t\t\t\t2,\n\t\t\t],\n\t\t},\n\t},\n}\n",
        "{\"url\": \"https://example.com/a//b\", \"glob\": \"src/**/*.ts\", \"c\": \"/* no */\"}",
    ] {
        assert_unchanged(text);
    }
}

#[test]
fn an_empty_file_stays_empty_until_its_tree_has_a_member() {
    assert_eq!(unchanged(b""), b"");
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let root = parse(b"{\"name\": \"app\"}", &bump);
    let printed = print(PATH, b"", root, Indentation::default()).expect("prints");
    assert_eq!(bstr::BStr::new(&printed), "{\n  \"name\": \"app\"\n}");
}

// ───── the values ─────

#[test]
fn a_value_that_changes_is_the_only_text_that_changes() {
    assert_eq!(
        saved(
            "{\r\n  // the name\r\n  \"name\": 'app', /* beside */\r\n\r\n  \"n\": 1.50,\r\n}\r\n",
            r#"{"name": "lib", "n": 1.5}"#
        ),
        "{\r\n  // the name\r\n  \"name\": \"lib\", /* beside */\r\n\r\n  \"n\": 1.50,\r\n}\r\n"
    );
    assert_eq!(
        saved(
            "{ \"name\" /* a */ : /* b */ \"app\" /* c */ ,\n  \"n\": 1 }",
            r#"{"name": "lib", "n": 1}"#
        ),
        "{ \"name\" /* a */ : /* b */ \"lib\" /* c */ ,\n  \"n\": 1 }"
    );
}

#[test]
fn a_number_is_as_written_when_the_parser_reads_the_token_as_the_number() {
    let text = "{\n  \"n\": [0x10, .5, 1_000, 010, 1e400, -0, 1.50]\n}\n";
    // `1e400` is read as a number that JSON has no token for. The tree has it from this text.
    assert_unchanged(text);
    assert_eq!(
        saved(text, r#"{"n": [17, 0.5, 1000, 8, 0, 0, 1.5]}"#),
        "{\n  \"n\": [17, .5, 1_000, 010, 0, 0, 1.50]\n}\n"
    );
}

#[test]
fn a_keyword_and_a_string_are_as_written_when_the_parser_reads_them_as_the_value() {
    let text = "{\n  \"t\": \\u0074rue, \"s\": 'caf\\u00e9', \"k\\u0065y\": null\n}\n";
    assert_eq!(
        saved(text, "{\"t\": true, \"s\": \"caf\u{e9}\", \"key\": null}"),
        text
    );
    assert_eq!(
        saved(text, r#"{"t": false, "s": "cafe", "key": 1}"#),
        "{\n  \"t\": false, \"s\": \"cafe\", \"k\\u0065y\": 1\n}\n"
    );
}

#[test]
fn a_value_of_another_kind_is_printed() {
    assert_eq!(
        saved(
            "{\n  \"a\": [1, 2], // a\n  \"b\": {\"c\": 1}, // b\n  \"d\": \"e\" // d\n}\n",
            r#"{"a": {"x": 1}, "b": "text", "d": ["e"]}"#
        ),
        "{\n  \"a\": {\n    \"x\": 1\n  }, // a\n  \"b\": \"text\", // b\n  \"d\": [\"e\"] // d\n}\n"
    );
}

// ───── members on lines ─────

#[test]
fn a_new_member_gets_a_line_and_the_comma_goes_after_the_value_before_it() {
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\" // the name\n}\n",
            r#"{"name": "app", "version": "1.0.0"}"#
        ),
        "{\n  \"name\": \"app\", // the name\n  \"version\": \"1.0.0\"\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\" /* the name */\n}\n",
            r#"{"name": "app", "version": "1.0.0"}"#
        ),
        "{\n  \"name\": \"app\", /* the name */\n  \"version\": \"1.0.0\"\n}\n"
    );
    assert_eq!(
        saved("{\n  \"b\": 1\n}\n", r#"{"a": 0, "b": 1}"#),
        "{\n  \"a\": 0,\n  \"b\": 1\n}\n"
    );
}

#[test]
fn a_comment_before_the_closing_bracket_on_the_line_of_the_last_member_is_its_comment() {
    let old = "{\n  \"name\": \"app\" /* the name */ }";
    assert_eq!(
        saved(old, r#"{"name": "app", "version": "1.0.0"}"#),
        "{\n  \"name\": \"app\", /* the name */\n  \"version\": \"1.0.0\" }"
    );
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\", /* the name */ }",
            r#"{"name": "app", "version": "1.0.0"}"#
        ),
        "{\n  \"name\": \"app\", /* the name */\n  \"version\": \"1.0.0\", }"
    );
    // It goes with its member.
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\",\n  \"version\": \"1.0.0\" /* the version */ }",
            r#"{"name": "app"}"#
        ),
        "{\n  \"name\": \"app\"\n }"
    );
    assert_eq!(
        saved(
            "{\n  \"b\": 1, // b\n  \"a\": 0 /* a */ }",
            r#"{"a": 0, "b": 1}"#
        ),
        "{\n  \"a\": 0, /* a */\n  \"b\": 1 // b\n }"
    );
}

#[test]
fn a_trailing_comma_stays_a_trailing_comma() {
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\",\n}\n",
            r#"{"name": "app", "version": "1.0.0"}"#
        ),
        "{\n  \"name\": \"app\",\n  \"version\": \"1.0.0\",\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\",\n  \"version\": \"1.0.0\",\n}\n",
            r#"{"name": "app"}"#
        ),
        "{\n  \"name\": \"app\",\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\", // the name\n  \"version\": \"1.0.0\"\n}\n",
            r#"{"name": "app"}"#
        ),
        "{\n  \"name\": \"app\" // the name\n}\n"
    );
}

#[test]
fn a_removed_member_takes_its_line_and_leaves_the_comments_above_it() {
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\",\n\n  // what it is\n  /* and more */\n  \"description\": \"d\", // gone with its line\n  \"version\": \"1.0.0\"\n}\n",
            r#"{"name": "app", "version": "1.0.0"}"#
        ),
        "{\n  \"name\": \"app\",\n\n  // what it is\n  /* and more */\n  \"version\": \"1.0.0\"\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"scripts\": {\n    // how to build\n    \"build\": \"b\"\n  }\n}\n",
            r#"{"scripts": {}}"#
        ),
        "{\n  \"scripts\": {\n    // how to build\n  }\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"scripts\": {\n    \"build\": \"b\"\n  }\n}\n",
            r#"{"scripts": {}}"#
        ),
        "{\n  \"scripts\": {}\n}\n"
    );
}

#[test]
fn a_member_that_moves_takes_the_lines_above_it_and_the_comment_beside_it() {
    assert_eq!(
        saved(
            "{\n  \"dependencies\": {\n    // c is first here\n    \"c\": \"1\", // beside c\n    \"b\": \"2\" // beside b\n  }\n}\n",
            r#"{"dependencies": {"a": "0", "b": "2", "c": "1"}}"#
        ),
        "{\n  \"dependencies\": {\n    \"a\": \"0\",\n    \"b\": \"2\", // beside b\n    // c is first here\n    \"c\": \"1\" // beside c\n  }\n}\n"
    );
}

#[test]
fn a_new_member_has_the_indentation_and_the_line_ending_of_the_members_beside_it() {
    assert_eq!(
        saved(
            "{\r\n\t\"name\": \"app\"\r\n}\r\n",
            r#"{"name": "app", "a": {"b": "1"}}"#
        ),
        "{\r\n\t\"name\": \"app\",\r\n\t\"a\": {\r\n\t\t\"b\": \"1\"\r\n\t}\r\n}\r\n"
    );
    assert_eq!(
        saved(
            "{\n      \"name\": \"app\",\n\"main\": \"m\"\n  }",
            r#"{"name": "app", "main": "m", "version": "1.0.0"}"#
        ),
        "{\n      \"name\": \"app\",\n\"main\": \"m\",\n      \"version\": \"1.0.0\"\n  }"
    );
}

#[test]
fn a_key_that_is_there_twice_keeps_both_members() {
    assert_eq!(
        saved(
            "{\n  \"a\": 1, // first\n  \"a\": 2, // second\n  \"b\": 3\n}\n",
            r#"{"a": 1, "a": 2}"#
        ),
        "{\n  \"a\": 1, // first\n  \"a\": 2 // second\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"a\": 1, // first\n  \"a\": 2, // second\n  \"b\": 3\n}\n",
            r#"{"a": 2, "b": 3}"#
        ),
        "{\n  \"a\": 2, // first\n  \"b\": 3\n}\n"
    );
}

#[test]
fn a_key_that_is_there_twice_is_the_first_one_first() {
    assert_eq!(
        saved(
            "{\n  \"a\": 1, // first\n  \"b\": 2, // b\n  \"a\": 3 // second\n}\n",
            r#"{"b": 2, "a": 1, "a": 3}"#
        ),
        "{\n  \"b\": 2, // b\n  \"a\": 1, // first\n  \"a\": 3 // second\n}\n"
    );
}

// ───── arrays ─────

#[test]
fn an_item_of_an_array_is_the_item_with_its_value() {
    // The first one goes: the others keep their comments.
    assert_eq!(
        saved(
            "{\n  \"files\": [\n    \"a\", // the first\n    \"b\", // the second\n    \"c\" // the third\n  ]\n}\n",
            r#"{"files": ["b", "c", "d"]}"#
        ),
        "{\n  \"files\": [\n    \"b\", // the second\n    \"c\", // the third\n    \"d\"\n  ]\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"n\": [\n    1, // one\n    2, // two\n    3 // three\n  ]\n}\n",
            r#"{"n": [2, 3]}"#
        ),
        "{\n  \"n\": [\n    2, // two\n    3 // three\n  ]\n}\n"
    );
    // A number that changes is the number that the text has there.
    assert_eq!(
        saved(
            "{\n  \"n\": [1 /* one */,2 /* two */]\n}\n",
            r#"{"n": [5, 2]}"#
        ),
        "{\n  \"n\": [5 /* one */,2 /* two */]\n}\n"
    );
    // Items that change places take their comments along.
    assert_eq!(
        saved(
            "{\n  \"s\": [\n    \"b\", // b\n    \"a\" // a\n  ]\n}\n",
            r#"{"s": ["a", "b"]}"#
        ),
        "{\n  \"s\": [\n    \"a\", // a\n    \"b\" // b\n  ]\n}\n"
    );
}

#[test]
fn an_object_and_an_array_in_an_array_are_the_ones_that_the_text_has_there() {
    assert_unchanged("{\"a\": [{}], \"b\": [[]], \"c\": [{}, [], {}]}");
    assert_eq!(
        saved("{\n  \"a\": [{}]\n}\n", r#"{"a": [{}, {}]}"#),
        "{\n  \"a\": [{}, {}]\n}\n"
    );
    assert_eq!(
        saved("{\n  \"a\": [{}, 1]\n}\n", r#"{"a": [{}]}"#),
        "{\n  \"a\": [{}]\n}\n"
    );
    assert_eq!(
        saved("{\n  \"a\": []\n}\n", r#"{"a": [{}]}"#),
        "{\n  \"a\": [{}]\n}\n"
    );
    // The same on one line: the file is laid out, and `{}` is still in the array.
    assert_eq!(
        saved("{\"a\":[{}]}", r#"{"a": [{}], "b": 1}"#),
        "{\n  \"a\": [{}],\n  \"b\": 1\n}"
    );
    assert_eq!(
        saved("{\"a\":[{}, 1]}", r#"{"a": [{}]}"#),
        "{\n  \"a\": [{}]\n}"
    );
    assert_eq!(
        saved(
            "{\n  \"a\": [\n    { \"k\": 1 }, // first\n    { \"k\": 2 } // second\n  ]\n}\n",
            r#"{"a": [{"k": 1}, {"k": 3}, {"k": 4}]}"#
        ),
        "{\n  \"a\": [\n    { \"k\": 1 }, // first\n    { \"k\": 3 }, // second\n    {\n      \"k\": 4\n    }\n  ]\n}\n"
    );
}

#[test]
fn an_object_in_an_array_is_the_item_that_says_all_of_it() {
    let old = "{\n  \"contributors\": [\n    { \"name\": \"Ann\" }, // founder\n    { \"name\": \"Bob\" }, // maintainer\n    { \"name\": \"Carol\" } // docs\n  ]\n}\n";
    // The first one goes: the others keep their lines.
    assert_eq!(
        saved(
            old,
            r#"{"contributors": [{"name": "Bob"}, {"name": "Carol"}]}"#
        ),
        "{\n  \"contributors\": [\n    { \"name\": \"Bob\" }, // maintainer\n    { \"name\": \"Carol\" } // docs\n  ]\n}\n"
    );
    // An item that no item of the text says is read as the next one left: here the line of Ann.
    assert_eq!(
        saved(
            old,
            r#"{"contributors": [{"name": "Bob"}, {"name": "Carol"}, {"name": "Dan"}]}"#
        ),
        "{\n  \"contributors\": [\n    { \"name\": \"Bob\" }, // maintainer\n    { \"name\": \"Carol\" }, // docs\n    { \"name\": \"Dan\" } // founder\n  ]\n}\n"
    );
    // One that changes is the one that the text has there.
    assert_eq!(
        saved(
            old,
            r#"{"contributors": [{"name": "Ann"}, {"name": "Rob"}, {"name": "Carol"}]}"#
        ),
        old.replace("Bob", "Rob")
    );
}

#[test]
fn an_array_in_an_array_is_read_once() {
    // Two reads of each level are 2^64 reads of the innermost one.
    for (open, close, levels) in [
        ("[", "]", 64),
        ("[{\"a\":", "}]", 64),
        ("[[\"p\",{\"x\":", "}]]", 32),
    ] {
        let nested = |core: &str| format!("{}{core}{}", open.repeat(levels), close.repeat(levels));
        let deep = nested("1");
        let old = format!("{{\n  \"name\": \"app\",\n  \"deep\": {deep}\n}}\n");
        assert_unchanged(&old);
        assert_eq!(
            saved(&old, &format!("{{\"name\": \"lib\", \"deep\": {deep}}}")),
            old.replace("app", "lib")
        );
        assert_eq!(
            saved(
                &old,
                &format!("{{\"name\": \"app\", \"deep\": {}}}", nested("2"))
            ),
            old.replace(&deep, &nested("2"))
        );
    }
}

#[test]
fn a_name_that_is_there_many_times_is_looked_up_once() {
    // A look for the next one that starts at the first one is a walk over all that are taken.
    let count = 100_000;
    let old = format!("{{\n{}  \"a\": 0\n}}\n", "  \"a\": 0,\n".repeat(count - 1));
    let now = format!("{{{} \"b\": 1}}", "\"a\": 0,".repeat(count));
    assert_eq!(
        saved(&old, &now),
        old.replace("  \"a\": 0\n}", "  \"a\": 0,\n  \"b\": 1\n}")
    );
    let old = format!(
        "{{\n  \"n\": [\n{}    0\n  ]\n}}\n",
        "    0,\n".repeat(count - 1)
    );
    let now = format!("{{\"n\": [{} 1]}}", "0,".repeat(count));
    assert_eq!(
        saved(&old, &now),
        old.replace("    0\n  ]", "    0,\n    1\n  ]")
    );
}

// ───── names that have one hash ─────

/// The eight bytes of this number are the string, and the hash of a number is the hash of its bytes.
const TIED_NUMBER: &str = "2261634.5098039214";
const TIED_STRING: &str = "\"AAAAAAAA\"";
/// Two strings whose hash is 0.
const TIED_KEYS: [&str; 2] = ["\"IORK7qW3vZPGLwg7\"", "\"UynIw4a86y1UEOvU\""];

#[test]
fn the_names_of_the_tests_have_one_hash() {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let [a, b] = TIED_KEYS;
    let root = parse(
        format!("[{TIED_NUMBER}, {TIED_STRING}, {a}, {b}]").as_bytes(),
        &bump,
    );
    let entries = Entries::of(&root, b'[').expect("an array");
    let hash = |index| entries.name(index).expect("a name").hash();
    assert_eq!(hash(0), hash(1));
    assert_eq!((hash(2), hash(3)), (0, 0));
}

#[test]
fn a_container_where_a_look_meets_another_name_of_its_hash_is_printed() {
    let (number, string) = (TIED_NUMBER, TIED_STRING);
    let old = format!(
        "{{\n  // outside\n  \"n\": [\n    {number}, // 0\n    {string}, // 1\n    {string} // 2\n  ], // beside\n  \"m\": 1\n}}\n"
    );
    // The first one goes: the look for the string meets the number. No comment in the array is kept.
    assert_eq!(
        saved(&old, &format!("{{\"n\": [{string}, {string}], \"m\": 1}}")),
        format!("{{\n  // outside\n  \"n\": [{string}, {string}], // beside\n  \"m\": 1\n}}\n")
    );
    assert_eq!(
        saved(
            &old,
            &format!("{{\"n\": [{string}, {number}, {string}], \"m\": 1}}")
        ),
        format!(
            "{{\n  // outside\n  \"n\": [{string}, {number}, {string}], // beside\n  \"m\": 1\n}}\n"
        )
    );
    // The last one goes, or one more comes: each look meets its own name.
    assert_eq!(
        saved(&old, &format!("{{\"n\": [{number}, {string}], \"m\": 1}}")),
        old.replace(
            &format!("{string}, // 1\n    {string} // 2"),
            &format!("{string} // 1")
        )
    );
    assert_eq!(
        saved(
            &old,
            &format!("{{\"n\": [{number}, {string}, {string}, 7], \"m\": 1}}")
        ),
        old.replace("// 2", "// 2\n    7")
            .replace(&format!("{string} // 2"), &format!("{string}, // 2"))
    );
    // Keys, and a container in the one that is printed.
    let [a, b] = TIED_KEYS;
    let old = format!(
        "{{\n  // outside\n  \"n\": {{\n    {a}: 0, // a\n    {b}: {{\n      \"x\": 1 // x\n    }} // b\n  }}, // beside\n  \"m\": 1\n}}\n"
    );
    assert_eq!(
        saved(&old, &format!("{{\"n\": {{{b}: {{\"x\": 1}}}}, \"m\": 1}}")),
        format!(
            "{{\n  // outside\n  \"n\": {{\n    {b}: {{\n      \"x\": 1\n    }}\n  }}, // beside\n  \"m\": 1\n}}\n"
        )
    );
    assert_eq!(
        saved(&old, &format!("{{\"n\": {{{a}: 0}}, \"m\": 1}}")),
        format!(
            "{{\n  // outside\n  \"n\": {{\n    {a}: 0 // a\n  }}, // beside\n  \"m\": 1\n}}\n"
        )
    );
    // The root: what is before it and after it stays.
    assert_eq!(
        saved(
            &format!("// before\n{{\n  {a}: 0, // a\n  {b}: 1 // b\n}} // after\n"),
            &format!("{{{b}: 1}}")
        ),
        format!("// before\n{{\n  {b}: 1\n}} // after\n")
    );
}

#[test]
fn names_that_have_one_hash_are_not_walked() {
    // A walk passed the taken members behind the number again for every entry.
    let count = 100_000;
    let (number, string) = (TIED_NUMBER, TIED_STRING);
    let old = format!(
        "{{\n  \"n\": [\n    {number},\n{}    {string}\n  ]\n}}\n",
        format!("    {string},\n").repeat(count - 2)
    );
    let strings = vec![string; count - 1];
    assert_eq!(
        saved(&old, &format!("{{\"n\": [{}]}}", strings.join(","))),
        format!("{{\n  \"n\": [{}]\n}}\n", strings.join(", "))
    );
}

// ───── a container on one line ─────

#[test]
fn a_container_on_one_line_that_gets_or_loses_a_member_is_printed() {
    // It has no layout to keep. What is in it is printed: its comments and spellings go.
    assert_eq!(
        saved(
            "{\n  \"config\": { \"retries\": 1.50, \"caf\\u00e9\": true },\n  \"files\": [\"a\", \"b\"]\n}\n",
            "{\"config\": {\"retries\": 1.5, \"caf\u{e9}\": true, \"timeout\": 5}, \"files\": [\"a\", \"b\", \"c\"]}"
        ),
        "{\n  \"config\": {\n    \"retries\": 1.5,\n    \"caf\u{e9}\": true,\n    \"timeout\": 5\n  },\n  \"files\": [\"a\", \"b\", \"c\"]\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  // outside\n  \"files\": [\"a\" /* inside */, \"b\"] // beside\n}\n",
            r#"{"files": ["a", "b", "c"]}"#
        ),
        "{\n  // outside\n  \"files\": [\"a\", \"b\", \"c\"] // beside\n}\n"
    );
    assert_eq!(
        saved(
            "{\n  \"a\": { /* none yet */ },\n  \"b\": 1\n}\n",
            r#"{"a": {"x": 1}, "b": 1}"#
        ),
        "{\n  \"a\": {\n    \"x\": 1\n  },\n  \"b\": 1\n}\n"
    );
    // A value that changes in it is not a member that it gets or loses.
    assert_eq!(
        saved(
            "{\n  \"config\": { \"retries\": 1.50 /* why */, 's': 't' }\n}\n",
            r#"{"config": {"retries": 1.5, "s": "u"}}"#
        ),
        "{\n  \"config\": { \"retries\": 1.50 /* why */, 's': \"u\" }\n}\n"
    );
}

#[test]
fn a_container_that_loses_every_member_is_empty_and_has_no_byte_of_a_string_in_it() {
    // `//` and `/*` in a string are not a comment.
    assert_eq!(
        saved(
            "{\"dependencies\":{\"dep\":\"https://example.com/dep.tgz\"},\"a\":1}",
            r#"{"dependencies": {}, "a": 1}"#
        ),
        "{\n  \"dependencies\": {},\n  \"a\": 1\n}"
    );
    assert_eq!(
        saved(
            "{\n  \"c\": [ \"//x\", \"/* y */\" ], // beside c\n  \"d\": { \"u\": \"a//b\" /* u */ }\n}\n",
            r#"{"c": [], "d": {}}"#
        ),
        "{\n  \"c\": [], // beside c\n  \"d\": {}\n}\n"
    );
    // A container that was empty and stays empty is as written.
    assert_eq!(
        saved(
            "{\n  \"a\": { /* none yet */ }, \"b\": 1\n}\n",
            r#"{"a": {}, "b": 2}"#
        ),
        "{\n  \"a\": { /* none yet */ }, \"b\": 2\n}\n"
    );
}

#[test]
fn a_file_on_one_line_is_printed_by_its_first_edit() {
    // A file that is written on one line has no layout to keep. Main printed it like this.
    assert_eq!(
        saved("{\"name\":\"app\"}", r#"{"name": "lib"}"#),
        "{\n  \"name\": \"lib\"\n}"
    );
    assert_eq!(
        saved(
            "// before\n{ \"name\" /* a */ : \"app\", \"n\": 1.50 } // after\n",
            r#"{"name": "lib", "n": 1.5}"#
        ),
        "// before\n{\n  \"name\": \"lib\",\n  \"n\": 1.5\n} // after\n"
    );
    assert_unchanged("{\"name\":\"app\"}");
}

// ───── what is not the file that the tree is of ─────

#[test]
fn what_follows_the_root_is_not_written_back() {
    // The parser stops at the end of the root. A print of the whole file drops the rest.
    for old in [
        "{\n  \"name\": \"app\"\n}\n}\n",
        "{\n  \"name\": \"app\"\n}\n{\"second\": 1}\n",
    ] {
        assert_unchanged(old);
        bun_ast::initialize_store_or_reset();
        let bump = bun_alloc::Arena::new();
        let root = parse(b"{\"name\": \"app\", \"license\": \"MIT\"}", &bump);
        let printed = print(PATH, old.as_bytes(), root, Indentation::default()).expect("prints");
        assert_eq!(
            bstr::BStr::new(&printed),
            "{\n  \"name\": \"app\",\n  \"license\": \"MIT\"\n}\n"
        );
    }
    // Blanks and comments are written back.
    assert_eq!(
        saved(
            "{\n  \"name\": \"app\"\n}\n// the end\n",
            r#"{"name": "lib"}"#
        ),
        "{\n  \"name\": \"lib\"\n}\n// the end\n"
    );
}

#[test]
fn a_root_that_is_not_an_object_or_an_array_is_left_alone_by_a_command_that_changes_nothing() {
    // The parser reads the first value of a broken file as its root.
    for old in [
        "\"name\": \"app\",\n  \"version\": \"1.0.0\"\n}\n",
        "// todo\nnull\n",
        "1 // one\n",
        "true",
        "'s'\n",
    ] {
        assert_unchanged(old);
    }
}

#[test]
fn a_string_that_the_printer_cannot_write_is_written_as_the_printer_writes_it() {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let old = b"{\n  // c\n  \"name\": \"app\"\n}\n";
    // The parser takes the bytes of a string as they are. This one is not UTF-8.
    let root = parse(b"{\"name\": \"caf\xE9\"}", &bump);
    let printed = print(PATH, old, root, Indentation::default()).expect("prints");
    let whole = print_new_file(old, root, Indentation::default()).expect("prints");
    assert_eq!(bstr::BStr::new(&printed), bstr::BStr::new(&whole));
}

#[test]
fn an_edit_takes_the_byte_order_mark() {
    let text = "\u{feff}{\n  \"name\": \"app\"\n}\n";
    assert_unchanged(text);
    assert_eq!(
        saved(text, r#"{"name": "lib"}"#),
        "{\n  \"name\": \"lib\"\n}\n"
    );
}

#[test]
fn a_comment_that_ends_its_line_is_ended_before_what_follows_it() {
    // A `//` comment can end at U+2028. What is written after it starts a line.
    assert_eq!(
        saved("[\n  1, // c\u{2028}[\n    2\n  ]\n]\n", "[1, [], 4]"),
        "[\n  1,\n  // c\n  [],\n  4\n]\n"
    );
}

// ───── what the parser reads back ─────

#[test]
fn a_text_that_the_tree_was_not_parsed_from_is_printed_as_a_new_file() {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let root = parse(b"{\"name\": \"app\"}", &bump);
    let printed =
        print(PATH, b"[1, 2] // not this\n", root, Indentation::default()).expect("prints");
    assert_eq!(bstr::BStr::new(&printed), "{\n  \"name\": \"app\"\n}\n");
}

#[test]
fn the_tree_that_is_read_back_is_the_tree_that_was_saved() {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let old = b"{\n  // c\n  \"a\": 1,\n}\n";
    let root = parse(b"{\"a\": 1, \"b\": [true, null, \"s\"]}", &bump);
    let mut old_is_jsonc = None;
    let (text, read) =
        print_and_read(PATH, old, root, Indentation::default(), &mut old_is_jsonc).expect("prints");
    // The old text looks like a text with a comment, and the parser said that it is one.
    assert_eq!(old_is_jsonc, Some(true));
    assert_eq!(
        bstr::BStr::new(&text),
        "{\n  // c\n  \"a\": 1,\n  \"b\": [true, null, \"s\"],\n}\n"
    );
    assert!(is_tree(
        &read.expect("read back").root,
        &root,
        StackCheck::init()
    ));
    // Not another tree.
    for other in [
        &b"{\"a\": 1, \"b\": [true, null, \"t\"]}"[..],
        b"{\"b\": [true, null, \"s\"], \"a\": 1}",
        b"{\"a\": 1.0000000000000002, \"b\": [true, null, \"s\"]}",
        b"{\"a\": 1, \"b\": [true, null, \"s\"], \"c\": 0}",
        b"{\"a\": 1, \"b\": [true, null]}",
        b"[1]",
    ] {
        let other =
            super::read(other, json::PACKAGE_JSON_OPTS, Extent::Document, false).expect("reads");
        assert!(!is_tree(&other.root, &root, StackCheck::init()));
    }
}

#[test]
fn strict_json_stays_strict_json() {
    bun_ast::initialize_store_or_reset();
    let with_comment = b"{\"a\": [ // c\n] }";
    let with_comma = b"{\"a\": [1,], }";
    let strict = b"{\"a\": [1]}";
    let may_be = |new: &[u8], old: &[u8], looks_jsonc: bool| {
        let old = OldText {
            text: old,
            looks_jsonc,
            is_jsonc: &mut None,
        };
        read_new(new, old, false).is_some()
    };
    // Whatever the old text looks like, the parser says whether it has a comment.
    for looks_jsonc in [false, true] {
        for new in [&with_comment[..], with_comma] {
            assert!(may_be(new, with_comment, looks_jsonc));
            assert!(may_be(new, with_comma, looks_jsonc));
            assert!(!may_be(new, strict, looks_jsonc));
        }
        for old in [&with_comment[..], with_comma, strict] {
            assert!(may_be(strict, old, looks_jsonc));
        }
    }
}

#[test]
fn the_old_text_looks_like_what_it_is() {
    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    for (text, looks_jsonc) in [
        (
            &b"{\"a\": [1], \"url\": \"https://example.com\", \"c\": \"/* no */\"}"[..],
            false,
        ),
        (b"{\"a\": [1]} // after", true),
        (b"// before\n{\"a\": [1]}", true),
        (b"{\"a\": /* in */ [1]}", true),
        (b"{\"a\": [1,]}", true),
        (b"{\"a\": [1],}", true),
        (b"{\"a\": [1 // one\n]}", true),
    ] {
        let root = parse(text, &bump);
        let mut read = Text::new(text, Indentation::default());
        assert!(read.document(&root).is_ok());
        assert_eq!(read.looks_jsonc, looks_jsonc, "{:?}", bstr::BStr::new(text));
    }
}

// ───── many texts and many edits ─────

/// A value of JSON, for a text that is made from a seed.
#[derive(Clone, Debug)]
enum Value {
    Null,
    Boolean(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl PartialEq for Value {
    fn eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Boolean(a), Value::Boolean(b)) => a == b,
            (Value::Number(a), Value::Number(b)) => a.to_bits() == b.to_bits(),
            (Value::String(a), Value::String(b)) => a == b,
            (Value::Array(a), Value::Array(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => a == b,
            _ => false,
        }
    }
}

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, limit: usize) -> usize {
        (self.next() % limit as u64) as usize
    }

    fn one_in(&mut self, chances: usize) -> bool {
        self.below(chances) == 0
    }

    fn pick<'a>(&mut self, from: &[&'a str]) -> &'a str {
        from[self.below(from.len())]
    }
}

const KEYS: &[&str] = &[
    "a",
    "b",
    "c",
    "name",
    "dependencies",
    "k e y",
    "caf\u{e9}",
    "",
    "//",
    "/*",
    "a\"b",
    "x\\y",
];
const STRINGS: &[&str] = &[
    "",
    "a",
    "1.0.0",
    "^1.2.3",
    "https://example.com/a//b",
    "/* not a comment */",
    "// nor this",
    "caf\u{e9}",
    "\u{1f600}",
    "tab\tnew\nline",
    "quote\"back\\slash",
    "'",
    "]",
    "},{",
];
const NUMBERS: &[f64] = &[
    0.0,
    1.0,
    -1.0,
    1.5,
    16.0,
    1000.0,
    8.0,
    0.5,
    1e21,
    -0.0,
    123456789.0,
    1234567890.0,
];

fn value(random: &mut Random, depth: usize) -> Value {
    match random.below(if depth >= 3 { 4 } else { 7 }) {
        0 => Value::Null,
        1 => Value::Boolean(random.one_in(2)),
        2 => Value::Number(NUMBERS[random.below(NUMBERS.len())]),
        3 => Value::String(random.pick(STRINGS).to_owned()),
        4 => Value::Array(
            (0..random.below(4))
                .map(|_| value(random, depth + 1))
                .collect(),
        ),
        _ => Value::Object(
            (0..random.below(5))
                .map(|_| (random.pick(KEYS).to_owned(), value(random, depth + 1)))
                .collect(),
        ),
    }
}

fn string_token(random: &mut Random, string: &str, out: &mut String) {
    // The parser has no escape for `'`.
    let quote = if random.one_in(4) && !string.contains('\'') {
        '\''
    } else {
        '"'
    };
    out.push(quote);
    for char in string.chars() {
        match char {
            '"' if char == quote => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            char if !char.is_ascii() && random.one_in(2) => {
                let mut units = [0u16; 2];
                for unit in char.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            'a' if random.one_in(8) => out.push_str("\\u0061"),
            '/' if random.one_in(8) => out.push_str("\\/"),
            char => out.push(char),
        }
    }
    out.push(quote);
}

fn number_token(random: &mut Random, number: f64, out: &mut String) {
    let spellings: &[&str] = match number {
        number if number.to_bits() == (-0.0f64).to_bits() => &["-0", "-0.0", "- 0"],
        number if number == 0.0 => &["0", "0.0", "0e0", "0x0", ".0"],
        number if number == 1.0 => &["1", "1.0", "1e0", "0x1", "01", "0b1"],
        number if number == -1.0 => &["-1", "-1.0", "- 1", "-0x1"],
        number if number == 1.5 => &["1.5", "1.50", "15e-1"],
        number if number == 16.0 => &["16", "0x10", "0o20", "1_6", "16.0"],
        number if number == 1000.0 => &["1000", "1_000", "1e3", "1E+3"],
        number if number == 8.0 => &["8", "010", "0o10", "8.0"],
        number if number == 0.5 => &["0.5", ".5", "5e-1"],
        number if number == 1e21 => &["1e21", "1e+21", "1000000000000000000000"],
        number if number == 123456789.0 => &["123456789", "123_456_789"],
        _ => &["1234567890", "1234567890.0"],
    };
    out.push_str(random.pick(spellings));
}

/// A gap between two tokens: blanks, line breaks and, in a file with comments, comments.
fn gap(random: &mut Random, jsonc: bool, line_break: &str, out: &mut String) {
    loop {
        match random.below(if jsonc { 12 } else { 8 }) {
            0..=3 => return,
            4 => out.push(' '),
            5 => out.push_str("  "),
            6 => out.push_str(line_break),
            7 => out.push_str(random.pick(&[
                "\t", "\t", "\t", "\u{a0}", "\u{feff}", "\u{2028}", "\r", "\u{b}",
            ])),
            8 | 9 => {
                out.push_str(random.pick(&["/* c */", "/**/", "/* \" */", "/* , } ] */", "/*\n*/"]))
            }
            _ => {
                out.push_str(random.pick(&["// c", "//", "// \" { [ ,", "// */"]));
                out.push_str(random.pick(&[line_break, line_break, line_break, "\u{2028}", "\r"]));
            }
        }
    }
}

/// `value` as a text. `on_lines`: a line ends after every opening bracket.
fn text_of(
    random: &mut Random,
    value: &Value,
    jsonc: bool,
    on_lines: bool,
    line_break: &str,
    out: &mut String,
) {
    match value {
        Value::Null => out.push_str(if random.one_in(16) {
            "\\u006eull"
        } else {
            "null"
        }),
        Value::Boolean(true) => out.push_str(if random.one_in(16) {
            "\\u0074rue"
        } else {
            "true"
        }),
        Value::Boolean(false) => out.push_str("false"),
        Value::Number(number) => number_token(random, *number, out),
        Value::String(string) => string_token(random, string, out),
        Value::Array(items) => {
            out.push('[');
            if on_lines {
                out.push_str(line_break);
            }
            for (index, item) in items.iter().enumerate() {
                gap(random, jsonc, line_break, out);
                text_of(random, item, jsonc, on_lines, line_break, out);
                gap(random, jsonc, line_break, out);
                if index + 1 < items.len() || (jsonc && random.one_in(3)) {
                    out.push(',');
                }
            }
            gap(random, jsonc, line_break, out);
            out.push(']');
        }
        Value::Object(members) => {
            out.push('{');
            if on_lines {
                out.push_str(line_break);
            }
            for (index, (key, member)) in members.iter().enumerate() {
                gap(random, jsonc, line_break, out);
                string_token(random, key, out);
                gap(random, jsonc, line_break, out);
                out.push(':');
                gap(random, jsonc, line_break, out);
                text_of(random, member, jsonc, on_lines, line_break, out);
                gap(random, jsonc, line_break, out);
                if index + 1 < members.len() || (jsonc && random.one_in(3)) {
                    out.push(',');
                }
            }
            gap(random, jsonc, line_break, out);
            out.push('}');
        }
    }
}

/// `value` as strict JSON, the way a test says what a tree is.
fn json_of(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Boolean(boolean) => out.push_str(if *boolean { "true" } else { "false" }),
        Value::Number(number) if number.to_bits() == (-0.0f64).to_bits() => out.push_str("-0"),
        Value::Number(number) => out.push_str(&format!("{number:e}")),
        Value::String(string) => {
            out.push('"');
            for char in string.chars() {
                match char {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\t' => out.push_str("\\t"),
                    char => out.push(char),
                }
            }
            out.push('"');
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                json_of(item, out);
            }
            out.push(']');
        }
        Value::Object(members) => {
            out.push('{');
            for (index, (key, member)) in members.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                json_of(&Value::String(key.clone()), out);
                out.push(':');
                json_of(member, out);
            }
            out.push('}');
        }
    }
}

fn value_of(tree: &Expr) -> Value {
    match &tree.data {
        ExprData::ENull(_) => Value::Null,
        ExprData::EBoolean(boolean) => Value::Boolean(boolean.value),
        ExprData::ENumber(number) => Value::Number(number.value()),
        ExprData::EString(_) => Value::String(
            String::from_utf8(string_of(tree).expect("UTF-8").to_vec()).expect("UTF-8"),
        ),
        ExprData::EArray(array) => Value::Array(array.items.iter().map(value_of).collect()),
        ExprData::EObject(object) => Value::Object(
            object
                .properties
                .iter()
                .map(|member| {
                    let key = member.key.as_ref().expect("a key");
                    let Value::String(key) = value_of(key) else {
                        panic!("a key is a string");
                    };
                    (key, value_of(member.value.as_ref().expect("a value")))
                })
                .collect(),
        ),
        _ => panic!("not a value of JSON"),
    }
}

/// One edit of `value`, somewhere in it.
fn edit(random: &mut Random, value: &mut Value, depth: usize) {
    match value {
        Value::Array(items) if !items.is_empty() && random.one_in(2) => {
            let index = random.below(items.len());
            edit(random, &mut items[index], depth + 1);
        }
        Value::Object(members) if !members.is_empty() && random.one_in(2) => {
            let index = random.below(members.len());
            edit(random, &mut members[index].1, depth + 1);
        }
        Value::Array(items) => match random.below(6) {
            0 if !items.is_empty() => {
                let index = random.below(items.len());
                items.remove(index);
            }
            1 => items.clear(),
            2 if items.len() > 1 => {
                let (a, b) = (random.below(items.len()), random.below(items.len()));
                items.swap(a, b);
            }
            3 if !items.is_empty() => {
                let index = random.below(items.len());
                items[index] = self::value(random, depth + 1);
            }
            _ => {
                let index = random.below(items.len() + 1);
                items.insert(index, self::value(random, depth + 1));
            }
        },
        Value::Object(members) => match random.below(7) {
            0 if !members.is_empty() => {
                let index = random.below(members.len());
                members.remove(index);
            }
            1 => members.clear(),
            2 => members.sort_by(|a, b| a.0.cmp(&b.0)),
            3 if !members.is_empty() => {
                let index = random.below(members.len());
                members[index].1 = self::value(random, depth + 1);
            }
            4 if !members.is_empty() => {
                let index = random.below(members.len());
                members[index].0 = random.pick(KEYS).to_owned();
            }
            _ => {
                let index = random.below(members.len() + 1);
                members.insert(
                    index,
                    (random.pick(KEYS).to_owned(), self::value(random, depth + 1)),
                );
            }
        },
        _ => *value = self::value(random, depth + 1),
    }
}

/// One edit of `value` that takes nothing away and moves nothing.
fn grow(random: &mut Random, value: &mut Value, added: &mut usize) {
    match value {
        Value::Array(items) if !items.is_empty() && random.one_in(2) => {
            let index = random.below(items.len());
            if matches!(items[index], Value::Array(_) | Value::Object(_)) {
                grow(random, &mut items[index], added);
            }
        }
        Value::Object(members) if !members.is_empty() && random.one_in(2) => {
            let index = random.below(members.len());
            match &mut members[index].1 {
                member @ (Value::Array(_) | Value::Object(_)) => grow(random, member, added),
                member => *member = Value::Number(NUMBERS[random.below(NUMBERS.len())]),
            }
        }
        Value::Array(items) => {
            *added += 1;
            let index = random.below(items.len() + 1);
            items.insert(index, Value::String(format!("new item {added}")));
        }
        Value::Object(members) => {
            *added += 1;
            let index = random.below(members.len() + 1);
            members.insert(index, (format!("new key {added}"), self::value(random, 2)));
        }
        _ => {}
    }
}

/// The comments of `text`, in the order of the text.
fn comments_of(text: &[u8]) -> Vec<&[u8]> {
    let mut comments = Vec::new();
    let mut at = 0;
    while at < text.len() {
        match text[at] {
            b'"' | b'\'' => at = scan::string(text, at).expect("a string ends").end,
            b'/' => {
                let end = scan::comment_end(text, at).expect("a comment");
                comments.push(&text[at..end]);
                at = end;
            }
            _ => at += 1,
        }
    }
    comments
}

/// Edits the tree of a generated text and checks what is written. `grows`: no comment is lost.
fn check(seed: u64, edits: usize, grows: bool) {
    let mut random = Random(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let jsonc = grows || random.one_in(2);
    let line_break = if random.one_in(3) { "\r\n" } else { "\n" };
    let mut value = match self::value(&mut random, 0) {
        value @ (Value::Array(_) | Value::Object(_)) => value,
        other => Value::Object(vec![("name".to_owned(), other)]),
    };
    let mut old = String::new();
    if jsonc {
        gap(&mut random, jsonc, line_break, &mut old);
    }
    text_of(&mut random, &value, jsonc, grows, line_break, &mut old);
    gap(&mut random, jsonc, line_break, &mut old);
    if random.one_in(2) {
        old.push_str(line_break);
    }
    let old = old.as_bytes();

    bun_ast::initialize_store_or_reset();
    let bump = bun_alloc::Arena::new();
    let indentation = json::guess_indentation(old);
    let loaded = parse(old, &bump);
    assert_eq!(
        value_of(&loaded),
        value,
        "seed {seed}: the text is its value"
    );
    let is_strict = read(old, json::JSONOptions::DEFAULT, Extent::Document, false).is_some();
    assert!(jsonc || is_strict, "seed {seed}: strict JSON");
    assert!(
        !is_strict || comments_of(old).is_empty(),
        "seed {seed}: comments"
    );

    let mut added = 0;
    for _ in 0..edits {
        if grows {
            grow(&mut random, &mut value, &mut added);
        } else {
            edit(&mut random, &mut value, 0);
        }
    }
    let mut now = String::new();
    json_of(&value, &mut now);
    let root = parse(now.as_bytes(), &bump);
    assert_eq!(value_of(&root), value, "seed {seed}: the edit is its value");

    // The text is written over: a text of the parser is never printed as a new file.
    let mut text = Text::new(old, indentation);
    assert!(
        text.document(&root).is_ok(),
        "seed {seed}: not written over"
    );
    // A wrong text stops here, in `print_and_read`.
    let printed = print(PATH, old, root, indentation).expect("prints");
    let context = || {
        format!(
            "seed {seed}\n old: {:?}\n now: {now}\n new: {:?}",
            bstr::BStr::new(old),
            bstr::BStr::new(&printed)
        )
    };
    assert_eq!(
        bstr::BStr::new(&printed),
        bstr::BStr::new(&text.out.list),
        "{}",
        context()
    );
    for looks_jsonc in [false, true] {
        let old = OldText {
            text: old,
            looks_jsonc,
            is_jsonc: &mut None,
        };
        assert!(read_new(&printed, old, false).is_some(), "{}", context());
    }
    assert_eq!(text.looks_jsonc, !is_strict, "{}", context());
    assert_eq!(value_of(&parse(&printed, &bump)), value, "{}", context());
    if edits == 0 {
        assert_eq!(
            bstr::BStr::new(&printed),
            bstr::BStr::new(old),
            "{}",
            context()
        );
    }
    // No comment is made up, and none is there twice.
    let mut left = comments_of(old);
    for comment in comments_of(&printed) {
        let Some(index) = left.iter().position(|other| *other == comment) else {
            panic!(
                "a comment that the text does not have: {:?}\n{}",
                bstr::BStr::new(comment),
                context()
            );
        };
        left.remove(index);
    }
    if grows {
        assert!(
            left.is_empty(),
            "comments that are lost: {:?}\n{}",
            left.iter()
                .map(|comment| bstr::BStr::new(comment))
                .collect::<Vec<_>>(),
            context()
        );
    }
    // A second save of the same tree changes nothing.
    let again = print(PATH, &printed, root, indentation).expect("prints");
    assert_eq!(
        bstr::BStr::new(&again),
        bstr::BStr::new(&printed),
        "{}",
        context()
    );
}

#[test]
fn texts_that_no_edit_changed_are_the_same_bytes() {
    for seed in 0..4000 {
        check(seed, 0, false);
    }
}

#[test]
fn texts_with_one_edit_read_back_as_their_tree() {
    for seed in 0..8000 {
        check(seed, 1, false);
    }
}

#[test]
fn texts_with_many_edits_read_back_as_their_tree() {
    for seed in 0..4000 {
        check(seed, 2 + (seed % 5) as usize, false);
    }
}

#[test]
fn texts_that_only_grow_keep_every_comment() {
    for seed in 0..8000 {
        check(seed, 1 + (seed % 4) as usize, true);
    }
}

/// More seeds: `PJT_FROM=0 PJT_COUNT=1000000 cargo test -p bun_install --lib package_json_text -- --ignored`.
#[test]
#[ignore = "takes as long as it is asked to"]
fn more_texts_read_back_as_their_tree() {
    let number = |name: &str, or: u64| {
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(or)
    };
    let from = number("PJT_FROM", 0);
    for seed in from..from + number("PJT_COUNT", 100_000) {
        check(seed, (seed % 7) as usize, seed % 3 == 0);
    }
}
