use crate::builtins::table::find_name;
use crate::ir::generated::{
    CheckFailure, InternalErrorKind, Module, ModuleExport, NameClass, ProgramList, SyntheticExport,
    check_program,
};
use crate::ir::ids::{Id, StringId};
use crate::ir::parallel::{InParallel, run_serially};
use crate::ir::program::Program;
use crate::ir::strings::StringTable;
use crate::ir::wtf8::is_canonical_wtf8;

const HIGH_SURROGATE: &[u8] = b"\xED\xA0\xBD";
const LOW_SURROGATE: &[u8] = b"\xED\xB8\x80";
const SURROGATE_PAIR: &[u8] = b"\xED\xA0\xBD\xED\xB8\x80";
const JOINED_PAIR: &[u8] = "\u{1F600}".as_bytes();
const ILL_FORMED: &[&[u8]] = &[
    b"\xED\xA0\xBD\xED\xB8",
    b"\xED\xA0\xBD\xED\xB8A",
    b"\xED\xA0A\xED\xB8\x80",
    b"\xED",
    b"\x80\xC0\x80",
];

fn intern_and_get(bytes: &[u8]) -> Vec<u8> {
    let mut table = StringTable::default();
    let id = table.intern(bytes);
    table.get(id).to_vec()
}

fn run_in_reverse(count: usize, work: &(dyn Fn(usize) + Sync)) {
    for index in (0..count).rev() {
        work(index);
    }
}

#[track_caller]
fn assert_same_answers(table: &StringTable, expected: &StringTable) {
    assert_eq!(table.len(), expected.len());
    assert_eq!(table.byte_len(), expected.byte_len());
    assert_eq!(table.bytes(), expected.bytes());
    for id in expected.ids() {
        let text = expected.get(id);
        assert_eq!(table.get(id), text, "{id}");
        assert_eq!(table.hash(id), expected.hash(id), "{id}");
        assert_eq!(table.name_class(id), expected.name_class(id), "{id}");
        assert_eq!(table.builtin_name(id), expected.builtin_name(id), "{id}");
        assert_eq!(table.find(text), Some(id), "{id}");
    }
}

#[test]
fn equal_bytes_have_one_id() {
    let mut table = StringTable::default();
    let name = table.intern(b"name");
    let other = table.intern(b"other");
    assert_ne!(name, other);
    assert_eq!(table.intern(b"name"), name);
    assert_eq!(table.len(), 2);
    assert_eq!(table.get(name), b"name");
    assert_eq!(table.get(other), b"other");
    assert_eq!(table.hash(name), StringTable::hash_of(b"name"));
}

#[test]
fn interns_empty_string() {
    let mut table = StringTable::default();
    assert!(table.is_empty());
    assert_eq!(table.find(b""), None);
    let before = table.intern(b"a");
    let empty = table.intern(b"");
    let after = table.intern(b"b");
    assert!(!table.is_empty());
    assert_eq!(table.get(before), b"a");
    assert_eq!(table.get(empty), b"");
    assert_eq!(table.get(after), b"b");
    assert_eq!(table.intern(b""), empty);
    assert_eq!(table.find(b""), Some(empty));
}

#[test]
fn empty_string_can_be_first() {
    let mut table = StringTable::default();
    let empty = table.intern(b"");
    let next = table.intern(b"next");
    assert_eq!(table.get(empty), b"");
    assert_eq!(table.get(next), b"next");
}

#[test]
fn find_returns_interned_strings_only() {
    let mut table = StringTable::default();
    assert_eq!(table.find(b"x"), None);
    let id = table.intern(b"x");
    assert_eq!(table.find(b"x"), Some(id));
    assert_eq!(table.find(b"y"), None);
    assert_eq!(table.len(), 1);
}

#[test]
fn ids_survive_index_growth() {
    let mut table = StringTable::default();
    let texts: Vec<String> = (0..2000).map(|index| format!("string {index}")).collect();
    for (index, text) in texts.iter().enumerate() {
        assert_eq!(table.intern(text.as_bytes()).index(), index);
    }
    for (index, text) in texts.iter().enumerate() {
        let id = StringId::new(index);
        assert_eq!(table.find(text.as_bytes()), Some(id));
        assert_eq!(table.get(id), text.as_bytes());
    }
    assert_eq!(table.len(), texts.len());
}

#[test]
fn surrogate_pair_has_id_of_joined_form() {
    let mut table = StringTable::default();
    let pair = table.intern(SURROGATE_PAIR);
    assert_eq!(pair, table.intern(JOINED_PAIR));
    assert_eq!(table.get(pair), JOINED_PAIR);
    assert_eq!(table.hash(pair), StringTable::hash_of(JOINED_PAIR));
    assert_eq!(table.len(), 1);
    assert_eq!(table.find(SURROGATE_PAIR), None);
}

#[test]
fn interned_surrogates_are_canonical() {
    let halves = [HIGH_SURROGATE, LOW_SURROGATE];
    for first in halves {
        for second in halves {
            for third in halves {
                let interned = intern_and_get(&[first, second, third].concat());
                assert!(is_canonical_wtf8(&interned), "{interned:x?}");
            }
        }
    }
}

#[test]
fn ill_formed_bytes_are_stored_unchanged() {
    for &bytes in ILL_FORMED {
        assert_eq!(intern_and_get(bytes), bytes, "{bytes:x?}");
    }
}

#[test]
fn name_class_is_stored() {
    let mut table = StringTable::default();
    let expected: [(&[u8], NameClass); 5] = [
        (b"length", NameClass::Length),
        (b"0", NameClass::Index),
        (b"x", NameClass::Ordinary),
        (b"-0", NameClass::CanonicalNumericString),
        (b"then", NameClass::Then),
    ];
    for (text, class) in expected {
        let id = table.intern(text);
        assert_eq!(table.name_class(id), class);
    }
}

#[test]
fn builtin_name_is_stored() {
    let mut table = StringTable::default();
    let prototype = table.intern(b"prototype");
    assert!(find_name(b"prototype").is_some());
    assert_eq!(table.builtin_name(prototype), find_name(b"prototype"));
    let unknown = table.intern(b"no built-in has this name");
    assert_eq!(table.builtin_name(unknown), None);
}

#[test]
fn bytes_are_back_to_back_in_id_order() {
    let mut table = StringTable::default();
    for text in [&b"name"[..], b"", b"other", b"name", b"x"] {
        table.intern(text);
    }
    assert_eq!(table.bytes(), b"nameotherx");
    assert_eq!(table.byte_len(), 10);
    let mut start = 0;
    for id in table.ids() {
        let text = table.get(id);
        assert_eq!(&table.bytes()[start..start + text.len()], text);
        start += text.len();
    }
    assert_eq!(start, table.byte_len());
}

#[test]
fn ids_lists_every_id() {
    let mut table = StringTable::default();
    assert_eq!(table.ids().len(), 0);
    let interned = [b"a", b"b", b"c"].map(|text| table.intern(text));
    assert_eq!(table.ids().len(), 3);
    assert_eq!(table.ids().collect::<Vec<_>>(), interned);
}

#[test]
fn table_of_distinct_strings_answers_like_one_that_interned_them() {
    let mut texts: Vec<Vec<u8>> = (0..5000)
        .map(|index| ("x".repeat(index % 7) + &index.to_string()).into_bytes())
        .collect();
    let classified: [&[u8]; 7] = [
        b"length",
        b"then",
        b"prototype",
        b"-0",
        b"",
        JOINED_PAIR,
        HIGH_SURROGATE,
    ];
    texts.extend(classified.iter().chain(ILL_FORMED).map(|text| text.to_vec()));
    let mut sources = [StringTable::default(), StringTable::default()];
    let mut places: Vec<(usize, StringId)> = Vec::new();
    for (index, text) in texts.iter().enumerate() {
        let source = index % 2;
        if index % 3 == 0 {
            sources[source].intern(format!("left out {index}").as_bytes());
        }
        places.push((source, sources[source].intern(text)));
    }
    places.reverse();
    let string_at = |index: usize| (&sources[places[index].0], places[index].1);
    let schedules: [InParallel<'_>; 2] = [&run_serially, &run_in_reverse];
    for in_parallel in schedules {
        let mut table = StringTable::of_distinct_strings(places.len(), &string_at, in_parallel);
        let mut expected = StringTable::default();
        for index in 0..places.len() {
            let (source, id) = string_at(index);
            assert_eq!(expected.intern(source.get(id)).index(), index);
        }
        assert_same_answers(&table, &expected);
        let added = (0..3000).map(|index| format!("added {index}"));
        for text in added.chain(["length".to_string(), String::new()]) {
            let id = table.intern(text.as_bytes());
            assert_eq!(id, expected.intern(text.as_bytes()));
        }
        assert_same_answers(&table, &expected);
        let empty = StringTable::of_distinct_strings(0, &string_at, in_parallel);
        assert_same_answers(&empty, &StringTable::default());
    }
}

fn create_program(interned: &[&[u8]]) -> Program {
    let mut program = Program::new();
    let path = program.strings.intern(b"/main.js");
    for name in interned {
        program.strings.intern(name);
    }
    program.modules.push(Module {
        path,
        display_path: path,
        ..Module::default()
    });
    program
}

fn program_with_exports(interned: &[&[u8]], exported: &[&[u8]]) -> Program {
    let mut program = create_program(interned);
    for name in exported {
        let name = program.strings.intern(name);
        program.modules[0].exports.push(ModuleExport {
            name,
            ..ModuleExport::default()
        });
    }
    program
}

fn program_with_synthetic_exports(interned: &[&[u8]], exported: &[&[u8]]) -> Program {
    let mut program = create_program(interned);
    for name in exported {
        let name = program.strings.intern(name);
        program.modules[0].synthetic_exports.push(SyntheticExport {
            name,
            ..SyntheticExport::default()
        });
    }
    program
}

fn export_ids(program: &Program) -> Vec<StringId> {
    let exports = program.modules[0].exports.iter();
    exports.map(|export| export.name).collect()
}

const UNSORTED_MODULE: Result<(), CheckFailure> = Err(CheckFailure {
    kind: InternalErrorKind::UnsortedList,
    list: ProgramList::Modules,
    record: 0,
});

#[test]
fn exports_ascending_by_text_pass_although_ids_descend() {
    let program = program_with_exports(&[b"b", b"a"], &[b"a", b"b"]);
    let ids = export_ids(&program);
    assert!(ids[0] > ids[1]);
    assert_eq!(check_program(&program), Ok(()));
}

#[test]
fn exports_ascending_by_id_but_not_by_text_are_unsorted() {
    let program = program_with_exports(&[b"b", b"a"], &[b"b", b"a"]);
    let ids = export_ids(&program);
    assert!(ids[0] < ids[1]);
    assert_eq!(check_program(&program), UNSORTED_MODULE);
}

#[test]
fn repeated_export_is_rejected() {
    let program = program_with_exports(&[], &[b"a", b"a"]);
    let failure = check_program(&program).expect_err("an export name occurs once");
    assert_eq!((failure.list, failure.record), (ProgramList::Modules, 0));
}

#[test]
fn exports_are_ordered_by_utf16_code_units() {
    let supplementary = "\u{1F600}".as_bytes();
    let last_in_basic_plane = "\u{FFFF}".as_bytes();
    assert!(supplementary > last_in_basic_plane);
    let by_code_units = program_with_exports(&[], &[supplementary, last_in_basic_plane]);
    assert_eq!(check_program(&by_code_units), Ok(()));
    let by_bytes = program_with_exports(&[], &[last_in_basic_plane, supplementary]);
    assert_eq!(check_program(&by_bytes), UNSORTED_MODULE);
}

#[test]
fn synthetic_exports_are_ordered_by_text() {
    let sorted = program_with_synthetic_exports(&[b"x", b"default"], &[b"default", b"x"]);
    assert_eq!(check_program(&sorted), Ok(()));
    let unsorted = program_with_synthetic_exports(&[b"x", b"default"], &[b"x", b"default"]);
    assert_eq!(check_program(&unsorted), UNSORTED_MODULE);
}

#[test]
fn failure_names_module_index() {
    let mut program = program_with_exports(&[], &[b"a", b"b"]);
    let mut unsorted = program.modules[0].clone();
    unsorted.exports.reverse();
    program.modules.push(unsorted);
    let failure = CheckFailure {
        kind: InternalErrorKind::UnsortedList,
        list: ProgramList::Modules,
        record: 1,
    };
    assert_eq!(check_program(&program), Err(failure));
}
