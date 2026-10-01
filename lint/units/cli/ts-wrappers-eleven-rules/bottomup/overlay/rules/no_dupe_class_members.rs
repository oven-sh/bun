//! Ported from ESLint lib/rules/no-dupe-class-members.js; in a TypeScript file from the rule of that name of typescript-eslint.

use bun_ast::flags::Property as Flag;
use bun_ast::{G, Loc};
use bun_js_parser::parse::erased::ErasedFlags;

use crate::ast_utils::{self, Name};
use crate::context::{self, Context};
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

/// What ESLint's handler reads of a `MethodDefinition` or of a `PropertyDefinition`. `None`: it is neither, or its name is not static.
fn member<'e>(
    context: &Context<'_, '_>,
    property: &'e G::Property,
    is_static: bool,
) -> Option<Member<'e>> {
    let (clashes, defines) = match property.kind {
        // A field with `declare` and a decorator stays in the tree as `Declare`.
        G::PropertyKind::Normal | G::PropertyKind::Declare => (INIT | GET | SET, INIT),
        G::PropertyKind::Get => (INIT | GET, GET),
        G::PropertyKind::Set => (INIT | SET, SET),
        // ESLint's rule visits methods and fields only: an auto-accessor, a static block and an abstract member are neither.
        _ => return None,
    };
    let key = property.key.as_ref()?;
    let is_computed = property.flags.contains(Flag::IsComputed);
    // The rule of typescript-eslint leaves out every computed member.
    if is_computed && context.is_typescript() {
        return None;
    }
    let name = ast_utils::get_static_string_value(context, key)?;
    // Not static, not computed and named `constructor`: only the constructor parses so, and ESLint skips it.
    if !is_static && !is_computed && name.bytes() == b"constructor" {
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
    // The fields with `declare` are not in the tree: each stands before the member of the tree at its index.
    let declared: Vec<(usize, bool, &G::Property)> = context
        .erased_members_of(class.body_loc)
        .filter_map(|erased| {
            let field = context::declared_field(erased)?;
            let is_static =
                erased.flags.contains(ErasedFlags::STATIC) || field.flags.contains(Flag::IsStatic);
            Some((erased.index as usize, is_static, field))
        })
        .collect();
    // One member repeats no name.
    if properties.len() + declared.len() < 2 {
        return;
    }
    let mut members: Vec<Member<'_>> = Vec::with_capacity(properties.len() + declared.len());
    let mut declared = declared.into_iter().peekable();
    for (index, property) in properties.iter().enumerate() {
        while let Some((_, is_static, field)) = declared.next_if(|(before, ..)| *before <= index) {
            members.extend(member(context, field, is_static));
        }
        let is_static = property.flags.contains(Flag::IsStatic);
        members.extend(member(context, property, is_static));
    }
    for (_, is_static, field) in declared {
        members.extend(member(context, field, is_static));
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
