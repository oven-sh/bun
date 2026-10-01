//! ESLint: lib/rules/no-dupe-keys.js
use crate::context::Context;
use crate::names::static_key_name;
use bun_ast::flags::Property as Flag;
use bun_ast::{E, G};
use std::collections::HashMap;

const NAME: &str = "no-dupe-keys";

pub(crate) fn e_object(cx: &mut Context<'_, '_>, node: &E::Object, is_target: bool) {
    // The keys of a pattern name what is read, not what is defined.
    if is_target || node.properties.len() < 2 {
        return;
    }
    // Per name: a getter or a value is defined, a setter or a value is defined.
    let mut defined: HashMap<Vec<u8>, (bool, bool)> = HashMap::new();
    let mut name = Vec::new();
    for property in node.properties.iter() {
        let Some(key) = &property.key else { continue };
        let (gets, sets) = match property.kind {
            G::PropertyKind::Normal => (true, true),
            G::PropertyKind::Get => (true, false),
            G::PropertyKind::Set => (false, true),
            _ => continue,
        };
        let computed = property.flags.contains(Flag::IsComputed);
        if !static_key_name(key, computed, cx.arena(), &mut name) {
            continue;
        }
        // `__proto__: value` sets the prototype: two of them are a syntax error of their own.
        if name == b"__proto__"
            && property.kind == G::PropertyKind::Normal
            && !computed
            && !property.flags.contains(Flag::WasShorthand)
            && !property.flags.contains(Flag::IsMethod)
        {
            continue;
        }
        let entry = defined.entry(name.clone()).or_insert((false, false));
        if (gets && entry.0) || (sets && entry.1) {
            cx.report(NAME, key.loc, format_args!("Duplicate key '{}'.", crate::names::display(&name)));
        }
        let entry = defined.entry(name.clone()).or_insert((false, false));
        entry.0 |= gets;
        entry.1 |= sets;
    }
}
