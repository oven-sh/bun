//! Ported from ESLint lib/rules/no-dupe-keys.js.

use bun_ast::flags::Property as Flag;
use bun_ast::{E, Expr, G};

use crate::lint::ast_utils::{self, Name};
use crate::lint::context::Context;
use crate::lint::rule::{Rule, RuleCategory};
use crate::lint::rules::text;

static RULE: Rule = Rule {
    name: "no-dupe-keys",
    category: RuleCategory::Correctness,
};

const GET: u8 = 1;
const SET: u8 = 2;

/// `node` is an object literal, not a pattern.
pub(crate) fn e_object(context: &mut Context<'_, '_>, node: &E::Object) {
    let mut keys: Vec<(Name<'_>, u8, &Expr)> = Vec::new();
    for property in node.properties.as_slice() {
        let defines = match property.kind {
            G::PropertyKind::Normal => GET | SET,
            G::PropertyKind::Get => GET,
            G::PropertyKind::Set => SET,
            _ => continue,
        };
        let Some(key) = &property.key else {
            continue;
        };
        let Some(name) = ast_utils::get_static_string_value(key) else {
            continue;
        };
        // `__proto__: value` sets the prototype: it is not a key.
        if name.bytes() == b"__proto__"
            && defines == GET | SET
            && !property.flags.contains(Flag::IsComputed)
            && !property.flags.contains(Flag::WasShorthand)
            && !property.flags.contains(Flag::IsMethod)
        {
            continue;
        }
        keys.push((name, defines, key));
    }
    if keys.len() < 2 {
        return;
    }
    // A stable sort: the keys of one name stay in the order they were written.
    keys.sort_by(|a, b| a.0.bytes().cmp(b.0.bytes()));
    let mut defined = 0u8;
    let mut previous: &[u8] = b"";
    for (index, (name, defines, key)) in keys.iter().enumerate() {
        if index == 0 || name.bytes() != previous {
            defined = 0;
            previous = name.bytes();
        }
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
