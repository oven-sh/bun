//! The trees of a window's surfaces, as one tree.

use std::cell::Cell;

use crate::hash::FastMap;
use crate::json::{Value, json, record};
use crate::window::{self, WindowState};
use crate::{bridge, surface};

record! {
    default
    /// `{ nodes, focus }` of `internal/desktop/dom/a11y.ts`. The first node is the root.
    #[derive(Default)]
    pub struct Tree {
        nodes: Vec<Value>,
        focus: Option<u32>,
    }
}

/// The nodes as JavaScript wrote them, but for `id` and `children`, which are of the window, and `bounds`, which are in it.
pub struct Update {
    pub roots: Vec<u64>,
    pub nodes: Vec<Value>,
    pub focus: Option<u64>,
}

fn node_id(surface: u32, node: u64) -> u64 {
    u64::from(surface) << 32 | node & 0xFFFF_FFFF
}

fn tree_update(state: &WindowState) -> Update {
    let mut update = Update {
        roots: Vec::new(),
        nodes: Vec::new(),
        focus: None,
    };
    let id_of = |node: &Value| node["id"].as_u64().unwrap_or(0);
    for surface in surface::in_window(state) {
        let surface = surface.borrow();
        let tree = &surface.accessibility;
        let Some(first) = tree.nodes.first().filter(|_| surface.is_visible) else {
            continue;
        };
        let mut unplaced: FastMap<_, _> =
            tree.nodes.iter().map(|node| (id_of(node), node)).collect();
        unplaced.remove(&id_of(first));
        update.roots.push(node_id(surface.id, id_of(first)));
        let mut pending = vec![first];
        while let Some(from) = pending.pop() {
            let children = from["children"].as_array().into_iter().flatten();
            let children: Vec<_> = children
                .filter_map(|child| unplaced.remove(&child.as_u64()?))
                .collect();
            let [x, y, width, height] =
                [0, 1, 2, 3].map(|index| from["bounds"][index].as_f64().unwrap_or(0.));
            let mut node = from.clone();
            node["id"] = node_id(surface.id, id_of(from)).into();
            node["children"] = children
                .iter()
                .map(|child| node_id(surface.id, id_of(child)))
                .collect::<Vec<_>>()
                .into();
            node["bounds"] = json!([
                x + f64::from(surface.rect.x),
                y + f64::from(surface.rect.y),
                width,
                height
            ]);
            if state.focused_surface.get() == Some(surface.id)
                && tree.focus.map(u64::from) == Some(id_of(from))
            {
                update.focus = Some(node_id(surface.id, id_of(from)));
            }
            update.nodes.push(node);
            pending.extend(children);
        }
    }
    update
}

pub fn update(state: &WindowState) {
    if let Some(window) = window::platform_window(state.id).filter(|_| state.is_accessible.get()) {
        window.set_accessibility_tree(&tree_update(state));
    }
}

/// Whether someone is interested in the tree of the window.
#[cfg_attr(
    not(target_os = "macos"),
    expect(dead_code, reason = "only AppKit is served")
)]
pub fn set_active(window: u32, is_active: bool) {
    thread_local! {
        static IS_ACTIVE: Cell<bool> = const { Cell::new(false) };
    }
    let Some(state) = window::state(window)
        .ok()
        .filter(|it| it.is_accessible.replace(is_active) != is_active)
    else {
        return;
    };
    update(&state);
    let states = window::ids()
        .into_iter()
        .filter_map(|id| window::state(id).ok());
    let is_active = states.into_iter().any(|state| state.is_accessible.get());
    if IS_ACTIVE.replace(is_active) != is_active {
        bridge::emit(json!({ "t": "a11y", "active": is_active }));
    }
}

/// click, focus, blur, setValue, increment, decrement, expand, collapse, scrollIntoView or showContextMenu.
#[cfg_attr(
    not(target_os = "macos"),
    expect(dead_code, reason = "only AppKit is served")
)]
pub fn perform(node: u64, action: &str, data: Value) {
    bridge::emit(
        json!({ "t": "a11yAction", "s": node >> 32, "node": node as u32, "action": action, "data": data }),
    );
}
