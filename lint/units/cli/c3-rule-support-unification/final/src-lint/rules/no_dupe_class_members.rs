//! Ported from ESLint lib/rules/no-dupe-class-members.js.

use bun_ast::flags::Property as Flag;
use bun_ast::{Expr, G};

use crate::ast_utils::{self, Name};
use crate::context::Context;
use crate::rule::{Rule, RuleCategory};
use crate::rules::text;

static RULE: Rule = Rule {
    name: "no-dupe-class-members",
    category: RuleCategory::Correctness,
};

const INIT: u8 = 1;
const GET: u8 = 2;
const SET: u8 = 4;

pub(crate) fn class(context: &mut Context<'_, '_>, class: &G::Class) {
    // Per member: its name, whether it is static, what it is duplicated by, what it defines, its key.
    let mut members: Vec<(Name<'_>, bool, u8, u8, &Expr)> = Vec::new();
    for property in class.properties.slice() {
        let is_method = property.flags.contains(Flag::IsMethod);
        let (clashes, defines) = match property.kind {
            G::PropertyKind::Get => (INIT | GET, GET),
            G::PropertyKind::Set => (INIT | SET, SET),
            G::PropertyKind::Normal => (INIT | GET | SET, INIT),
            _ => continue,
        };
        let Some(key) = &property.key else {
            continue;
        };
        let Some(name) = ast_utils::get_static_string_value(key) else {
            continue;
        };
        let is_static = property.flags.contains(Flag::IsStatic);
        if is_method
            && !is_static
            && !property.flags.contains(Flag::IsComputed)
            && matches!(property.kind, G::PropertyKind::Normal)
            && name.bytes() == b"constructor"
        {
            continue;
        }
        members.push((name, is_static, clashes, defines, key));
    }
    if members.len() < 2 {
        return;
    }
    // A stable sort: the members of one name stay in the order they were written.
    members.sort_by(|a, b| (a.0.bytes(), a.1).cmp(&(b.0.bytes(), b.1)));
    let mut defined = 0u8;
    let mut previous: (&[u8], bool) = (b"", false);
    for (index, (name, is_static, clashes, defines, key)) in members.iter().enumerate() {
        if index == 0 || (name.bytes(), *is_static) != previous {
            defined = 0;
            previous = (name.bytes(), *is_static);
        }
        if defined & clashes != 0 {
            context.report(
                &RULE,
                key.loc,
                text(&[b"Duplicate name '", name.bytes(), b"'."]),
            );
        }
        defined |= defines;
    }
}
