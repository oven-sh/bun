//! ESLint: lib/rules/no-dupe-class-members.js
use crate::context::Context;
use crate::names::static_key_name;
use bun_ast::G;
use bun_ast::flags::Property as Flag;
use std::collections::HashMap;

const NAME: &str = "no-dupe-class-members";

#[derive(Default)]
struct State {
    init: bool,
    get: bool,
    set: bool,
}

pub(crate) fn class(cx: &mut Context<'_, '_>, class: &G::Class) {
    let properties = class.properties.slice();
    if properties.len() < 2 {
        return;
    }
    // Static and instance members are apart.
    let mut states: HashMap<(Vec<u8>, bool), State> = HashMap::new();
    let mut name = Vec::new();
    for property in properties {
        let Some(key) = &property.key else { continue };
        if !matches!(property.kind, G::PropertyKind::Normal | G::PropertyKind::Get | G::PropertyKind::Set) {
            continue;
        }
        let computed = property.flags.contains(Flag::IsComputed);
        let is_static = property.flags.contains(Flag::IsStatic);
        let is_method = property.flags.contains(Flag::IsMethod);
        // A private name has no static name: two of them are a syntax error.
        if !static_key_name(key, computed, cx.arena(), &mut name) {
            continue;
        }
        if is_method && !is_static && !computed && property.kind == G::PropertyKind::Normal && name == b"constructor" {
            continue;
        }
        let state = states.entry((name.clone(), is_static)).or_default();
        let duplicate = match property.kind {
            G::PropertyKind::Get => {
                let duplicate = state.init || state.get;
                state.get = true;
                duplicate
            }
            G::PropertyKind::Set => {
                let duplicate = state.init || state.set;
                state.set = true;
                duplicate
            }
            _ => {
                let duplicate = state.init || state.get || state.set;
                state.init = true;
                duplicate
            }
        };
        if duplicate {
            cx.report(NAME, key.loc, format_args!("Duplicate name '{}'.", crate::names::display(&name)));
        }
    }
}
