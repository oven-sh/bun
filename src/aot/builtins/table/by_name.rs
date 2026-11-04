//! The test runner and `Bun.plugin`, found in the table under the names that a program has for them. Whoever asks here writes no id of theirs, so the code
//! is the same for a table that lists neither.

use std::sync::OnceLock;

use super::ids::{BuiltinId, RuntimeModule};
use super::lookup::{
    canonical_id, entry, find_name, module_by_specifier, namespace_of, own_member, root_of,
};

struct Found {
    test_runner: Option<RuntimeModule>,
    jest: Option<BuiltinId>,
    plugin: Option<BuiltinId>,
    expect: Option<BuiltinId>,
}

fn found() -> &'static Found {
    static FOUND: OnceLock<Found> = OnceLock::new();
    FOUND.get_or_init(|| {
        let member_of_bun = |name: &[u8]| {
            let member = own_member(BuiltinId::Bun, find_name(name)?)?;
            Some(canonical_id(member))
        };
        let test_runner = module_by_specifier(b"bun:test");
        let export_of_runner = |name: &[u8]| {
            let export = own_member(namespace_of(test_runner?), find_name(name)?)?;
            Some(canonical_id(export))
        };
        Found {
            test_runner,
            jest: member_of_bun(b"jest"),
            plugin: member_of_bun(b"plugin"),
            expect: export_of_runner(b"expect"),
        }
    })
}

/// `bun:test`.
pub fn test_runner() -> Option<RuntimeModule> {
    found().test_runner
}

pub fn is_test_runner(module: RuntimeModule) -> bool {
    Some(module) == found().test_runner
}

/// What `bun:test` exports, and all that hangs below it.
pub fn is_of_test_runner(id: BuiltinId) -> bool {
    entry(root_of(id)).module.is_some_and(is_test_runner)
}

/// `Bun.jest(path)` answers the object of the test runner.
pub fn returns_test_runner(id: BuiltinId) -> bool {
    Some(canonical_id(id)) == found().jest
}

/// `expect` of `bun:test`, and all that hangs below it.
pub fn is_of_expect(id: BuiltinId) -> bool {
    let mut holder = Some(id);
    while let Some(held) = holder {
        if Some(canonical_id(held)) == found().expect {
            return true;
        }
        holder = entry(held).holder;
    }
    false
}

/// `Bun.plugin`.
pub fn is_plugin(id: BuiltinId) -> bool {
    Some(canonical_id(id)) == found().plugin
}
