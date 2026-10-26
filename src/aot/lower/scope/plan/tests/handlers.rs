use std::fmt::Write;

use super::{is_field, storage_in};
use crate::lower::scope::Storage;

// `count` variables in front of a `try` that stores to each of them once.
fn write_stores_in_try(count: usize, handler: &str) -> String {
    let mut source = String::from("export function g(f) { let inner_sum = 0; ");
    for index in 0..count {
        write!(source, "let v{index} = 0; ").unwrap();
    }
    source.push_str("try { let inside = 0; inside = f(); ");
    for index in 0..count {
        write!(source, "v{index} = f(); ").unwrap();
    }
    write!(source, "}} {handler} return v0 + inner_sum; }}").unwrap();
    source
}

#[test]
fn few_variables_stored_in_try_are_locals() {
    let source = write_stores_in_try(100, "catch { inner_sum = v1; }");
    assert_eq!(storage_in("main.mjs", &source, "v0"), Storage::Local);
    assert_eq!(storage_in("main.mjs", &source, "v99"), Storage::Local);
}

#[test]
fn many_variables_stored_in_try_are_fields() {
    for handler in ["catch { inner_sum = v1; }", "finally { inner_sum = v1; }"] {
        let source = write_stores_in_try(200, handler);
        assert!(is_field(storage_in("main.mjs", &source, "v0")));
        assert!(is_field(storage_in("main.mjs", &source, "v199")));
    }
}

#[test]
fn variables_the_handler_cannot_see_are_locals() {
    let source = write_stores_in_try(200, "catch { inner_sum = v1; }");
    assert_eq!(storage_in("main.mjs", &source, "inside"), Storage::Local);
    assert_eq!(storage_in("main.mjs", &source, "inner_sum"), Storage::Local);
}

#[test]
fn few_variables_stored_very_often_in_try_are_locals() {
    let mut source = String::from("export function g(f) { let sum = 0; try { ");
    for _ in 0..20_000 {
        source.push_str("sum = f(sum); ");
    }
    source.push_str("} catch { sum = -sum; } return sum; }");
    assert_eq!(storage_in("main.mjs", &source, "sum"), Storage::Local);
}
