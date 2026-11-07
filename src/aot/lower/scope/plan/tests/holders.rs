use super::{Probe, analyze_files};

const NAMES: (&str, &str) = ("names.cjs", "exports.f = () => 1; exports.n = 2;");
const ES_NAMES: (&str, &str) = ("names.mjs", "export const f = () => 1; export let n = 2;");

fn is_initialized_holder(probe: &Probe<'_, '_, '_>, function: &str, name: &str) -> bool {
    let key = probe.key(probe.function(function));
    probe.is_initialized_holder(key, probe.symbol(name))
}

#[test]
fn holder_is_not_captured_by_a_function_made_behind_it() {
    let cases = [
        ("const", NAMES),
        ("let", NAMES),
        ("var", NAMES),
        ("const", ES_NAMES),
    ];
    for (declaration, target) in cases {
        let source = format!(
            "{declaration} a = require('./{}'); \
             module.exports = function later() {{ return a.f() + a.n; }};",
            target.0
        );
        analyze_files(&[("main.cjs", source.as_str()), target], |probe| {
            assert!(probe.captures_of("later").is_empty(), "{source}");
            assert!(is_initialized_holder(probe, "later", "a"), "{source}");
        });
    }
}

#[test]
fn hoisted_function_asks_whether_the_holder_is_initialized() {
    let source = "function hoisted() { return a.f(); } const a = require('./names.cjs'); \
                  module.exports = hoisted;";
    analyze_files(&[("main.cjs", source), NAMES], |probe| {
        assert!(!is_initialized_holder(probe, "hoisted", "a"));
        assert!(!probe.captures_of("hoisted").is_empty());
        assert!(probe.placement_of("a").is_shared);
    });
}

#[test]
fn holder_that_is_a_value_is_captured() {
    let source = "const a = require('./names.cjs'); \
                  module.exports = function later() { return a; };";
    analyze_files(&[("main.cjs", source), NAMES], |probe| {
        assert!(!is_initialized_holder(probe, "later", "a"));
        assert_eq!(probe.captures_of("later"), [probe.copy_of("a")]);
    });
}

#[test]
fn var_holder_initialized_in_a_branch_is_read() {
    let source = "if (process.argv.length) { var a = require('./names.cjs'); } \
                  module.exports = function later() { return a.f(); };";
    analyze_files(&[("main.cjs", source), NAMES], |probe| {
        assert!(!is_initialized_holder(probe, "later", "a"));
        assert!(!probe.captures_of("later").is_empty());
    });
}

#[test]
fn holder_that_is_stored_again_is_an_ordinary_variable() {
    let source = "let a = require('./names.cjs'); \
                  module.exports = function later() { return a.f(); }; a = null;";
    analyze_files(&[("main.cjs", source), NAMES], |probe| {
        assert!(!is_initialized_holder(probe, "later", "a"));
        assert!(!probe.captures_of("later").is_empty());
    });
}

#[test]
fn require_in_a_function_captures_nothing() {
    let source = "module.exports = function load() { return require('./names.cjs').n; };";
    analyze_files(&[("main.cjs", source), NAMES], |probe| {
        assert!(probe.captures_of("load").is_empty());
    });
    let wrapped = "'use strict'; arguments; \
                   module.exports = function load() { return require('./names.cjs').n; };";
    analyze_files(&[("main.cjs", wrapped), NAMES], |probe| {
        assert!(probe.has_wrapper_parameters());
        assert!(probe.captures_of("load").is_empty());
    });
}
