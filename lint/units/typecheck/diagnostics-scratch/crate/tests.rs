use crate::ast::diagnostic::{
    Arg, DiagnosticStore, Diagnostics, DiagnosticsCollection, SourceFiles,
};
use crate::compiler::program::sort_and_deduplicate_diagnostics;
use crate::core::{TextRange, compute_ecma_line_starts};
use crate::diagnostics::{self, Category, Locale};
use crate::diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use crate::ids::{DiagnosticId, NodeId};

struct TestFile {
    name: &'static [u8],
    text: &'static [u8],
    lines: Vec<i32>,
}

struct TestFiles(Vec<TestFile>);

impl TestFiles {
    fn new(files: &[(&'static [u8], &'static [u8])]) -> Self {
        Self(
            files
                .iter()
                .map(|(name, text)| TestFile {
                    name,
                    text,
                    lines: compute_ecma_line_starts(text),
                })
                .collect(),
        )
    }
    fn get(&self, file: NodeId) -> Option<&TestFile> {
        (file.0 as usize).checked_sub(1).and_then(|i| self.0.get(i))
    }
}

impl SourceFiles for TestFiles {
    fn file_name(&self, file: NodeId) -> &[u8] {
        self.get(file).map_or(b"", |f| f.name)
    }
    fn path(&self, file: NodeId) -> &[u8] {
        self.get(file).map_or(b"", |f| f.name)
    }
    fn text(&self, file: NodeId) -> &[u8] {
        self.get(file).map_or(b"", |f| f.text)
    }
    fn ecma_line_map(&self, file: NodeId) -> &[i32] {
        self.get(file).map_or(&[], |f| &f.lines)
    }
}

fn plain(store: &DiagnosticStore, files: &TestFiles, list: &[DiagnosticId]) -> Vec<u8> {
    let mut out = Vec::new();
    let identity = |name: &[u8]| name.to_vec();
    let opts = FormattingOptions {
        locale: Locale::DEFAULT,
        new_line: b"\n",
        convert_to_relative_path: &identity,
    };
    write_format_diagnostics(&mut out, Diagnostics { store, files }, list, &opts);
    out
}

#[test]
fn first_visible_result() {
    let files = TestFiles::new(&[(b"min.ts", b"const x: number = \"s\";\n")]);
    let mut store = DiagnosticStore::default();
    let mut collection = DiagnosticsCollection::default();
    let d = store.new_diagnostic(
        NodeId(1),
        TextRange::new(6, 7),
        diagnostics::Type_0_is_not_assignable_to_type_1,
        &["string".into(), "number".into()],
    );
    let added = collection.add(
        Diagnostics {
            store: &store,
            files: &files,
        },
        d,
    );
    assert_eq!(added, d);
    let list = collection.get_diagnostics_for_file(
        Diagnostics {
            store: &store,
            files: &files,
        },
        NodeId(1),
    );
    assert_eq!(
        plain(&store, &files, &list),
        b"min.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"
    );
}

#[test]
fn chain_related_and_columns() {
    let files = TestFiles::new(&[
        (
            b"a.ts",
            "let \u{1F600}\u{e9} = 1;\r\nlet y: { a: number } = { a: \"\" };\u{2028}z".as_bytes(),
        ),
        (b"b.ts", b"x"),
    ]);
    let mut store = DiagnosticStore::default();
    let tail = store.new_diagnostic(
        NodeId(1),
        TextRange::new(30, 31),
        diagnostics::Type_0_is_not_assignable_to_type_1,
        &["string".into(), "number".into()],
    );
    let mid = store.new_diagnostic_chain(
        tail,
        diagnostics::Types_of_property_0_are_incompatible,
        &["a".into()],
    );
    let head = store.new_diagnostic_chain(
        mid,
        diagnostics::Type_0_is_not_assignable_to_type_1,
        &["{ a: string; }".into(), "{ a: number; }".into()],
    );
    let related = store.new_diagnostic(
        NodeId(2),
        TextRange::new(0, 1),
        diagnostics::X_0_is_declared_here,
        &["a".into()],
    );
    store.add_related_info(head, related);
    store.add_related_info(head, DiagnosticId::NIL);
    assert_eq!(store[head].related_information().len(), 1);
    assert_eq!(store[head].pos(), 30);
    let global = store.new_compiler_diagnostic(diagnostics::Found_0_errors, &[Arg::Int(3)]);
    assert_eq!(
        (store[global].pos(), store[global].category()),
        (-1, Category::Message)
    );
    let wide = store.new_diagnostic(
        NodeId(1),
        TextRange::new(11, 12),
        diagnostics::Identifier_expected,
        &[],
    );
    let after_separator = store.new_diagnostic(
        NodeId(1),
        TextRange::new(53, 54),
        diagnostics::Identifier_expected,
        &[],
    );
    let view = Diagnostics {
        store: &store,
        files: &files,
    };
    let mut list = vec![after_separator, head, wide, global];
    crate::slices::sort_stable_func(&mut list, |a, b| view.compare_diagnostics(a, b));
    assert_eq!(list, vec![global, wide, head, after_separator]);
    assert_eq!(
        plain(&store, &files, &list),
        b"message TS6217: Found 3 errors.\n\
         a.ts(1,9): error TS1003: Identifier expected.\n\
         a.ts(2,14): error TS2322: Type '{ a: string; }' is not assignable to type '{ a: number; }'.\n  Types of property 'a' are incompatible.\n    Type 'string' is not assignable to type 'number'.\n\
         a.ts(3,1): error TS1003: Identifier expected.\n"
    );
}

#[test]
fn collection_deduplicates_at_add_and_program_merges() {
    let files = TestFiles::new(&[(b"a.ts", b"aaaa\nbbbb\n"), (b"b.ts", b"x")]);
    let mut store = DiagnosticStore::default();
    let mut collection = DiagnosticsCollection::default();
    let error = |store: &mut DiagnosticStore,
                 collection: &mut DiagnosticsCollection,
                 pos: i32,
                 name: &str| {
        let d = store.new_diagnostic(
            NodeId(1),
            TextRange::new(pos, pos + 1),
            diagnostics::Duplicate_identifier_0,
            &[name.into()],
        );
        collection.add(
            Diagnostics {
                store,
                files: &files,
            },
            d,
        )
    };
    let first = error(&mut store, &mut collection, 5, "b");
    let again = error(&mut store, &mut collection, 5, "b");
    assert_eq!(first, again);
    let other_args = error(&mut store, &mut collection, 5, "c");
    assert_ne!(first, other_args);
    let related = store.new_diagnostic(
        NodeId(2),
        TextRange::new(0, 1),
        diagnostics::X_0_was_also_declared_here,
        &["b".into()],
    );
    store.add_related_info(first, related);
    let third = error(&mut store, &mut collection, 5, "b");
    assert_ne!(first, third);
    let related_again = store.new_diagnostic(
        NodeId(2),
        TextRange::new(0, 1),
        diagnostics::X_0_was_also_declared_here,
        &["b".into()],
    );
    store.add_related_info(third, related_again);
    let earlier = error(&mut store, &mut collection, 0, "a");
    let list = collection.get_diagnostics_for_file(
        Diagnostics {
            store: &store,
            files: &files,
        },
        NodeId(1),
    );
    assert_eq!(list, vec![earlier, first, third, other_args]);
    let found = collection.lookup(
        Diagnostics {
            store: &store,
            files: &files,
        },
        third,
    );
    assert_eq!(found, first);
    let merged = sort_and_deduplicate_diagnostics(&mut store, &files, &list);
    assert_eq!(merged.len(), 3);
    let kept = merged.get(1).copied().unwrap_or_default();
    assert_eq!(store[kept].related_information().len(), 1);
    let view = Diagnostics {
        store: &store,
        files: &files,
    };
    assert!(view.equal_diagnostics_no_related_info(kept, first));
    assert_eq!(view.compare_diagnostics(first, third), 0);
    assert_eq!(
        plain(&store, &files, &merged),
        b"a.ts(1,1): error TS2300: Duplicate identifier 'a'.\na.ts(2,1): error TS2300: Duplicate identifier 'b'.\na.ts(2,1): error TS2300: Duplicate identifier 'c'.\n"
    );
}

#[test]
fn ad_hoc_and_out_of_range() {
    let files = TestFiles::new(&[(b"a.ts", b"ab")]);
    let mut store = DiagnosticStore::default();
    let ad_hoc = store.new_ad_hoc_diagnostic(
        NodeId::NIL,
        TextRange::undefined(),
        b"internal: bad cast {0}",
    );
    let beyond = store.new_diagnostic(
        NodeId(1),
        TextRange::new(40, 50),
        diagnostics::Identifier_expected,
        &[],
    );
    let negative = store.new_diagnostic(
        NodeId(1),
        TextRange::undefined(),
        diagnostics::Identifier_expected,
        &[],
    );
    let short = store.new_diagnostic(
        NodeId(1),
        TextRange::new(0, 1),
        diagnostics::Type_0_is_not_assignable_to_type_1,
        &["x".into()],
    );
    let faults = store.take_faults();
    assert_eq!(store.fault_count(), 1);
    assert_eq!(
        faults
            .first()
            .map(|f| (f.diagnostic, f.message, f.argument_count)),
        Some((short, diagnostics::Type_0_is_not_assignable_to_type_1, 1))
    );
    assert_eq!(
        plain(&store, &files, &[ad_hoc, beyond, negative, short]),
        b"error TS-1: internal: bad cast {0}\na.ts(1,3): error TS1003: Identifier expected.\na.ts(1,1): error TS1003: Identifier expected.\na.ts(1,1): error TS2322: Type 'x' is not assignable to type '{1}'.\n"
    );
}

// The shape of `switch r.getChainMessage(0) { case diagnostics.A, diagnostics.B: ... }` and of `message == nil`.
fn is_excess_property_message(message: diagnostics::MessageId) -> bool {
    matches!(
        message,
        diagnostics::Object_literal_may_only_specify_known_properties_and_0_does_not_exist_in_type_1
            | diagnostics::Object_literal_may_only_specify_known_properties_but_0_does_not_exist_in_type_1_Did_you_mean_to_write_2
    )
}

#[test]
fn messages_compare_by_id() {
    let mut message = diagnostics::MessageId::NIL;
    assert!(message.is_nil());
    if message.is_nil() {
        message = diagnostics::Type_0_is_not_assignable_to_type_1;
    }
    assert!(message == diagnostics::Type_0_is_not_assignable_to_type_1);
    assert!(message != diagnostics::Type_0_is_not_comparable_to_type_1);
    assert!(!is_excess_property_message(message));
    assert!(is_excess_property_message(
        diagnostics::Object_literal_may_only_specify_known_properties_and_0_does_not_exist_in_type_1
    ));
    assert_eq!(message.argument_count(), 2);
    assert_eq!(diagnostics::MessageId::AD_HOC.code(), -1);
    assert_eq!(diagnostics::MessageId::AD_HOC.key(), b"-1");
}
