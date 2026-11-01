use crate::ir::generated::{Layout, LayoutFlags, LayoutKind};
use crate::ir::{Id, LayoutId, Program};
use crate::link::Linked;
use crate::link::testing::link_sources;
use crate::load::ProjectId;

const MAIN: &str = r#"
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Bus extends EventEmitter { constructor() { super(); this.sent = 0; } }
class Numbers extends Readable { constructor() { super(); this.n = 0; } }
function Old() { EventEmitter.call(this); this.old = 1; }
Object.setPrototypeOf(Old.prototype, EventEmitter.prototype);
class Either extends (Math.random() < 0.5 ? EventEmitter : Readable) {}
globalThis.kept = [new Bus(), new Numbers(), new Old(), new Either()];
"#;

fn name_of<'a>(program: &'a Program, layout: &Layout) -> &'a [u8] {
    layout.name.map_or(&[], |name| program.strings.get(name))
}

fn find_instance_layout<'a>(program: &'a Program, name: &str) -> &'a Layout {
    let mut layouts = program.layouts.iter();
    let found = layouts.find(|layout| {
        layout.kind == LayoutKind::Instance && name_of(program, layout) == name.as_bytes()
    });
    found.expect(name)
}

// The names of the layouts above `name`, each of which has to be a constructor function of Bun's own modules.
fn names_above<'a>(linked: &'a Linked, name: &str) -> Vec<&'a [u8]> {
    let program = &linked.program;
    let mut names = Vec::new();
    let mut base: Option<LayoutId> = find_instance_layout(program, name).base;
    while let Some(id) = base {
        let layout = &program.layouts[id.index()];
        assert!(
            layout.flags.contains(LayoutFlags::IS_CONSTRUCTOR_FUNCTION),
            "{name}"
        );
        assert_eq!(
            linked.keys.layouts[id.index()].project,
            ProjectId::Runtime,
            "{name}"
        );
        names.push(name_of(program, layout));
        base = layout.base;
    }
    names
}

#[test]
fn what_extends_a_function_of_the_library_has_its_layout_as_base() {
    let linked = link_sources(&[("main.mjs", MAIN)]).expect("the program links");
    assert_eq!(names_above(&linked, "Bus"), [b"EventEmitter"]);
    assert_eq!(names_above(&linked, "Old"), [b"EventEmitter"]);
    let chain: [&[u8]; 3] = [b"Readable", b"Stream", b"EventEmitter"];
    assert_eq!(names_above(&linked, "Numbers"), chain);
    assert_eq!(find_instance_layout(&linked.program, "Either").base, None);
}

#[test]
fn what_is_below_a_function_begins_with_the_fields_of_that_function() {
    let linked = link_sources(&[("main.mjs", MAIN)]).expect("the program links");
    let keys_of = |name: &str| -> Vec<_> {
        let fields = find_instance_layout(&linked.program, name).fields.iter();
        fields.map(|field| field.key).collect()
    };
    for (name, base) in [
        ("Bus", "EventEmitter"),
        ("Old", "EventEmitter"),
        ("Numbers", "Readable"),
    ] {
        let (keys, base_keys) = (keys_of(name), keys_of(base));
        assert!(!base_keys.is_empty(), "{base}");
        assert_eq!(keys[..base_keys.len()], base_keys[..], "{name}");
        assert_eq!(keys.len(), base_keys.len() + 1, "{name}");
    }
}
