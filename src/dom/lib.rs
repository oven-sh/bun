//! Styles, layout and display lists for the DOM of `bun:desktop`.
#![feature(cell_leak, hint_prefetch, thread_local)]
#![cfg_attr(unix, feature(rt, update_panic_count))]
#![cfg_attr(unix, allow(internal_features))]

mod abi;
mod abi_graphics;
mod accessibility;
mod anchor;
mod animation;
mod api;
mod background;
mod bindings;
mod block;
mod boxes;
mod calc;
mod carousel;
mod cascade;
mod characters;
mod color;
mod compositor;
mod computed;
mod condition;
mod contentful;
mod contour;
mod counter_style;
mod counters;
mod cssom;
mod custom;
mod declarations;
mod document;
mod drag_image;
mod editing;
mod effects;
mod embedded;
mod engine_event;

mod columns;
mod flex;
mod float_area;
mod font_face;
mod forecast;
mod fragment;
mod generated_bindgen;
mod geometry;
mod grammar;
mod grid;
mod hints;
mod hooks;
mod inline;
mod layout;
mod lines;
mod lock;
mod math;
mod motion;
mod name;
mod nine_pieces;
mod order;
mod paint;
mod path;
mod plain;
mod platform;
mod positioned;
mod prelude;
mod properties;
mod recovery;
mod restyle;
mod rule_tree;
mod rules;
mod scan;
mod scroll;
mod search;
mod segments;
mod selector;
mod selector_parser;
mod sequence;
mod shapes;
mod sheet;
mod shorthand;
mod smil;
mod smil_values;
mod snap;
mod style_sheet;
mod svg;
mod svg_filter;
mod svg_paint;
mod svg_text;
mod svg_values;
mod table;
mod text;
mod theme;
mod three_d;
mod timeline;
mod transform;
mod tree;
mod types;
mod values;
mod view_transition;
mod writing;

fn json_string(text: &[u8], out: &mut Vec<u8>) {
    out.push(b'"');
    for byte in text {
        match byte {
            b'"' | b'\\' => out.extend([b'\\', *byte]),
            0..0x20 => out.extend(format!("\\u{byte:04x}").bytes()),
            _ => out.push(*byte),
        }
    }
    out.push(b'"');
}
