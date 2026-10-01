//! Ported from ESLint lib/rules/no-dupe-keys.js.

use bun_ast::flags::Property as Flag;
use bun_ast::{E, Expr, G};

use crate::ast_utils::{self, Name};
use crate::context::Context;
use crate::rule::{Rule, RuleCategory};
use crate::rules::text;

static RULE: Rule = Rule {
    name: "no-dupe-keys",
    category: RuleCategory::Correctness,
};

/// What a property defines of its name: `GET_KIND` is `init` or `get`, `SET_KIND` is `init` or `set`.
const GET: u8 = 1;
const SET: u8 = 2;

/// `node` is an object literal, not a pattern.
pub(crate) fn e_object(context: &mut Context<'_, '_>, node: &E::Object) {
    let properties = node.properties.as_slice();
    // Fewer than two properties repeat no key.
    if properties.len() < 2 {
        return;
    }
    let mut keys: Vec<(Name<'_>, u8, &Expr)> = Vec::with_capacity(properties.len());
    for property in properties {
        let defines = match property.kind {
            G::PropertyKind::Normal => GET | SET,
            G::PropertyKind::Get => GET,
            G::PropertyKind::Set => SET,
            _ => continue,
        };
        let Some(key) = &property.key else {
            continue;
        };
        let Some(name) = ast_utils::get_static_key_name(context, property) else {
            continue;
        };
        // `__proto__: value` sets the prototype: it is not a key.
        if name.bytes() == b"__proto__"
            && matches!(property.kind, G::PropertyKind::Normal)
            && !property.flags.contains(Flag::IsComputed)
            && !property.flags.contains(Flag::WasShorthand)
            && !property.flags.contains(Flag::IsMethod)
        {
            continue;
        }
        keys.push((name, defines, key));
    }
    // A stable sort: the keys of one name stay in the order they were written.
    keys.sort_by(|a, b| a.0.bytes().cmp(b.0.bytes()));
    for same_name in keys.chunk_by(|a, b| a.0.bytes() == b.0.bytes()) {
        let mut defined = 0u8;
        for (name, defines, key) in same_name {
            if defined & defines != 0 {
                context.report(
                    &RULE,
                    key.loc,
                    text(&[b"Duplicate key '", name.bytes(), b"'."]),
                );
            }
            defined |= defines;
        }
    }
}
