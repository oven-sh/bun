use std::sync::OnceLock;

use super::entries::Prototype;
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

pub fn test_runner() -> Option<RuntimeModule> {
    found().test_runner
}

pub fn is_test_runner(module: RuntimeModule) -> bool {
    Some(module) == found().test_runner
}

pub fn is_of_test_runner(id: BuiltinId) -> bool {
    entry(root_of(id)).module.is_some_and(is_test_runner)
}

pub fn returns_test_runner(id: BuiltinId) -> bool {
    Some(canonical_id(id)) == found().jest
}

pub fn is_of_expect(id: BuiltinId) -> bool {
    let is_expect = |id: BuiltinId| Some(canonical_id(id)) == found().expect;
    let mut holder = Some(id);
    while let Some(held) = holder {
        let data = entry(held);
        // The `expect` of "vitest" is a function of its own that inherits from the constructor.
        if is_expect(held)
            || matches!(data.prototype, Prototype::Builtin(parent) if is_expect(parent))
        {
            return true;
        }
        holder = data.holder;
    }
    false
}

pub fn is_plugin(id: BuiltinId) -> bool {
    Some(canonical_id(id)) == found().plugin
}
