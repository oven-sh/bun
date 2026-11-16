//! Styles, layout and display lists for the DOM of `bun:desktop`.
#![feature(cell_leak)]
#![cfg_attr(unix, feature(rt, update_panic_count))]
#![cfg_attr(unix, allow(internal_features))]

pub mod abi;
mod anchor;
mod animation;
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
mod document;
mod editing;
mod effects;
mod embedded;

mod columns;
mod flex;
mod float_area;
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
mod paint;
mod path;
mod platform;
mod positioned;
mod properties;
mod recovery;
mod restyle;
mod rules;
mod scan;
mod scroll;
mod segments;
mod selector;
mod selector_parser;
mod shapes;
mod sheet;
mod shorthand;
mod smil;
mod smil_values;
mod snap;
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
