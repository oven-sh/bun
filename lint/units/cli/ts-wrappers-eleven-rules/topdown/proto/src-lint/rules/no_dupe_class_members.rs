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

/// What `property` is to the rule. `None`: ESLint's handler does not see it, or its name is not known without running the program.
fn member<'a>(context: &Context<'_, '_>, property: &'a G::Property) -> Option<Member<'a>> {
    let (clashes, defines) = match property.kind {
        // A field with `declare` is a field for ESLint.
        G::PropertyKind::Normal | G::PropertyKind::Declare => (INIT | GET | SET, INIT),
        G::PropertyKind::Get => (INIT | GET, GET),
        G::PropertyKind::Set => (INIT | SET, SET),
        // ESLint's rule visits methods and fields only: an auto-accessor, a static block and an abstract member are neither.
        _ => return None,
    };
    // The rule of this name of typescript-eslint does not look at a member with a computed key.
    if context.is_typescript() && property.flags.contains(Flag::IsComputed) {
        return None;
    }
    let key = property.key.as_ref()?;
    let name = ast_utils::get_static_key_name(context, property)?;
    let is_static = property.flags.contains(Flag::IsStatic);
    // Not static, not computed and named `constructor`: only the constructor parses so, and ESLint skips it.
    if !is_static && !property.flags.contains(Flag::IsComputed) && name.bytes() == b"constructor" {
        return None;
    }
    Some(Member {
        name,
        is_static,
        clashes,
        defines,
        at: key.loc,
    })
}

/// `class` is one class, declared or in an expression. What ESLint keeps on a stack of classes is local here.
pub(crate) fn class(context: &mut Context<'_, '_>, class: &G::Class) {
    let properties = class.properties.slice();
    // The fields with `declare` leave no node: the side table has them, each with its place among the others. A method without a body is not there: ESLint skips it.
    let declared: Vec<(u32, &G::Property)> = context.declared_fields(class).collect();
    // One member repeats no name.
    if properties.len() + declared.len() < 2 {
        return;
    }
    let mut members: Vec<Member<'_>> = Vec::with_capacity(properties.len() + declared.len());
    let mut declared = declared.into_iter().peekable();
    for (index, property) in properties.iter().enumerate() {
        while let Some((_, field)) = declared.next_if(|(before, _)| *before as usize <= index) {
            members.extend(member(context, field));
        }
        members.extend(member(context, property));
    }
    for (_, field) in declared {
        members.extend(member(context, field));
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
