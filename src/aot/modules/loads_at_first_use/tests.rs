use super::*;

#[test]
fn a_line_with_nothing_but_named_reads_is_quiet() {
    for line in [
        &b"node:os"[..],
        b"node:os reads:AggregateError reads:Error.captureStackTrace",
        b"node:os reads:Error # reads:Error in a Worker only",
    ] {
        assert_eq!(specifier_of_quiet_load(line), Some(&b"node:os"[..]));
    }
}

#[test]
fn a_line_with_a_kind_is_not_quiet() {
    for line in [
        &b"node:fs tick reads:Error"[..],
        b"node:events chain",
        b"node:http env channel reads:Date.now",
        b"node:console reads reads:console.log",
        b"node:os reads@win32",
        b"# node:os",
        b"",
    ] {
        assert_eq!(specifier_of_quiet_load(line), None);
    }
}

#[test]
fn the_list_names_modules_of_the_table() {
    let quiet = quiet_specifiers();
    assert!(quiet.is_sorted());
    for specifier in quiet {
        let module = table::module_by_specifier(specifier);
        assert!(module.is_some_and(loads_quietly));
    }
    let of = |specifier: &[u8]| table::module_by_specifier(specifier).unwrap();
    assert!(loads_quietly(of(b"node:os")));
    assert!(!loads_quietly(of(b"node:http")));
}
