use crate::builtins::table::find_name;
use crate::ir::generated::{
    CheckFailure, InternalErrorKind, Module, ModuleExport, NameClass, ProgramList, SyntheticExport,
    check_program,
};
use crate::ir::ids::{Id, StringId};
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
fn hashed_writers_agree_with_intern() {
    let mut table = StringTable::default();
    let hash = StringTable::hash_of(b"a");
    let hashed = table.intern_hashed(hash, b"a");
    assert_eq!(table.intern(b"a"), hashed);
    assert_eq!(table.intern_hashed(hash, b"a"), hashed);
    let interned = table.intern(b"b");
    assert_ne!(interned, hashed);
    assert_eq!(
        table.intern_hashed(StringTable::hash_of(b"b"), b"b"),
        interned
    );
    assert_eq!(table.find(b"b"), Some(interned));
    assert_eq!(table.hash(interned), StringTable::hash_of(b"b"));
    assert_eq!(table.len(), 2);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn intern_hashed_rejects_surrogate_pair() {
    let mut table = StringTable::default();
    table.intern_hashed(StringTable::hash_of(SURROGATE_PAIR), SURROGATE_PAIR);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn intern_hashed_rejects_hash_of_other_bytes() {
    let mut table = StringTable::default();
    table.intern_hashed(StringTable::hash_of(b"a"), b"b");
}

#[test]
fn intern_hashed_stores_ill_formed_bytes_unchanged() {
    let mut table = StringTable::default();
    for &bytes in ILL_FORMED {
        assert!(!is_canonical_wtf8(bytes), "{bytes:x?}");
        let id = table.intern_hashed(StringTable::hash_of(bytes), bytes);
        assert_eq!(table.get(id), bytes, "{bytes:x?}");
        assert_eq!(table.intern(bytes), id, "{bytes:x?}");
    }
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
    let expected: [(&[u8], NameClass); 4] = [
        (b"length", NameClass::Length),
        (b"0", NameClass::Index),
        (b"x", NameClass::Ordinary),
        (b"-0", NameClass::CanonicalNumericString),
    ];
    for (text, class) in expected {
        let id = table.intern(text);
        assert_eq!(table.name_class(id), class);
    }
    let hashed = table.intern_hashed(StringTable::hash_of(b"then"), b"then");
    assert_eq!(table.name_class(hashed), NameClass::Then);
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
