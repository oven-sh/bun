use super::{analyze_source, is_field, storage_in};
use crate::lower::scope::Storage;

fn storage_of_c(statements: &str) -> Storage {
    let source = format!("export function g(n, f) {{ {statements} }}");
    storage_in("main.mjs", &source, "c")
}

#[test]
fn parameter_stored_before_the_closure_is_copied() {
    let source = "export function g(options) { options = options || {}; return () => options.x; }";
    analyze_source("main.mjs", source, |probe| {
        assert_eq!(probe.placement_of("options").storage, Storage::Local);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("options")]);
    });
}

#[test]
fn closure_behind_the_last_store_copies() {
    let copied = [
        "let c = 0; c = n; return () => c;",
        "let c = 0; c++; return () => c;",
        "let c = 0; c += n; c -= 1; return () => c;",
        "let c = 0; if (n) c = 3; return () => c;",
        "let c = 0; [c] = f(); return () => c;",
        "let c = 0; ({ c } = f()); return () => c;",
        "let c = 0; for (let i = 0; i < n; i++) c += i; return () => c;",
        "let c = 0; while (n--) { c = n; } return () => c;",
        "let c = 0; try { c = f(); } catch { c = 1; } return () => c;",
        "let c = 0; c = 7; return () => () => c;",
        "var c; c = n; return () => c;",
    ];
    for statements in copied {
        assert_eq!(storage_of_c(statements), Storage::Local, "{statements}");
    }
}

#[test]
fn closure_that_a_store_can_follow_shares() {
    let shared = [
        "let c = 0; const early = () => c; c = n; return early;",
        "let c = 0; c = 1; const early = () => c; c = 2; return [early, () => c];",
        "let c = 0; const all = []; for (let i = 0; i < n; i++) { c += i; all.push(() => c); } return all;",
        "let c = 0; const all = []; while (n--) { all.push(() => c); c = n; } return all;",
        "let c = () => 0; c = () => c; return c;",
        "let c = 0; c = f(() => c); return () => c;",
        "let c = 0; c = 1; f(() => { c++; }); return () => c;",
        "let c = 0; let read; try { c = 1; read = () => c; } finally { c = 2; } return read;",
        "let c = 0; let read; switch (n) { case 0: read = () => c; case 1: c = 9; } return read;",
        "let c = 0; c = 5; return inner; function inner() { return c; }",
        "let c = 0; c = 1; class A { static { c = 2; } } return () => c;",
        "let c = 0; c = 1; eval(n); return () => c;",
    ];
    for statements in shared {
        assert!(is_field(storage_of_c(statements)), "{statements}");
    }
}
