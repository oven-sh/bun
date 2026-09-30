//! Ported from ESLint lib/rules/no-dupe-class-members.js.

use bun_ast::flags::Property as Flag;
use bun_ast::{G, Loc};

use crate::ast_utils::{self, Name};
use crate::context::Context;
use crate::rule::{Rule, RuleCategory};
use crate::rules::text;

static RULE: Rule = Rule {
    name: "no-dupe-class-members",
    category: RuleCategory::Correctness,
};

/// `state.init` of ESLint: a method or a field has the name.
const INIT: u8 = 1;
const GET: u8 = 2;
const SET: u8 = 4;

/// A method, an accessor or a field whose name is known without running the program.
struct Member<'a> {
    name: Name<'a>,
    is_static: bool,
    /// What of the state of its name makes it a duplicate.
    clashes: u8,
    /// What it adds to that state.
    defines: u8,
    at: Loc,
}

impl Member<'_> {
    /// ESLint keeps one state for a name of the static members and another for that name of the others.
    fn state_key(&self) -> (&[u8], bool) {
        (self.name.bytes(), self.is_static)
    }
}

/// `class` is one class, declared or in an expression. What ESLint keeps on a stack of classes is local here.
pub(crate) fn class(context: &mut Context<'_, '_>, class: &G::Class) {
    let properties = class.properties.slice();
    // One member repeats no name.
    if properties.len() < 2 {
        return;
    }
    let mut members: Vec<Member<'_>> = Vec::with_capacity(properties.len());
    for property in properties {
        let (clashes, defines) = match property.kind {
            G::PropertyKind::Normal => (INIT | GET | SET, INIT),
            G::PropertyKind::Get => (INIT | GET, GET),
            G::PropertyKind::Set => (INIT | SET, SET),
            // ESLint's rule visits methods and fields only: an auto-accessor and a static block are neither.
            _ => continue,
        };
        let Some(key) = &property.key else {
            continue;
        };
        let Some(name) = ast_utils::get_static_string_value(key) else {
            continue;
        };
        let is_static = property.flags.contains(Flag::IsStatic);
        // Not static, not computed and named `constructor`: only the constructor parses so, and ESLint skips it.
        if !is_static
            && !property.flags.contains(Flag::IsComputed)
            && name.bytes() == b"constructor"
        {
            continue;
        }
        members.push(Member {
            name,
            is_static,
            clashes,
            defines,
            at: key.loc,
        });
    }
    // A stable sort: the members of one name stay in the order they were written.
    members.sort_by(|a, b| a.state_key().cmp(&b.state_key()));
    for same_key in members.chunk_by(|a, b| a.state_key() == b.state_key()) {
        let mut defined = 0u8;
        for member in same_key {
            if defined & member.clashes != 0 {
                context.report(
                    &RULE,
                    member.at,
                    text(&[b"Duplicate name '", member.name.bytes(), b"'."]),
                );
            }
            defined |= member.defines;
        }
    }
}
