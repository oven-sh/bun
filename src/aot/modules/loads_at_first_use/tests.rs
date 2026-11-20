use super::*;

#[test]
fn the_list_names_modules_of_the_table() {
    assert!(SPECIFIERS_OF_QUIET_LOADS.is_sorted());
    for specifier in SPECIFIERS_OF_QUIET_LOADS {
        let module = table::module_by_specifier(specifier);
        assert!(module.is_some_and(loads_quietly));
    }
    let of = |specifier: &[u8]| table::module_by_specifier(specifier).unwrap();
    assert!(loads_quietly(of(b"node:os")));
    assert!(!loads_quietly(of(b"node:http")));
}
