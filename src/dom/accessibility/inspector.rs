//! https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/#type-AXNode

use std::io::Write as _;

use super::Sent;
use super::build::Output;
use crate::abi::accessibility::{self as abi, Number, Relation, Role, Text};
use crate::json_string;
use crate::name::Map;

fn value(kind: &str, text: &[u8], out: &mut Vec<u8>) {
    _ = write!(out, r#"{{"type":"{kind}","value":"#);
    json_string(text, out);
    out.push(b'}');
}

struct Properties<'a>(&'a mut Vec<u8>);

impl Properties<'_> {
    fn start(&mut self, name: &str) -> &mut Vec<u8> {
        if self.0.last() != Some(&b'[') {
            self.0.push(b',');
        }
        _ = write!(self.0, r#"{{"name":"{name}","value":"#);
        self.0
    }

    fn raw(&mut self, name: &str, kind: &str, raw: impl core::fmt::Display) {
        _ = write!(self.start(name), r#"{{"type":"{kind}","value":{raw}}}}}"#);
    }

    fn text(&mut self, name: &str, kind: &str, text: &[u8]) {
        value(kind, text, self.start(name));
        self.0.push(b'}');
    }
}

fn properties(node: &abi::Node, from: &Output, sent: &Sent, out: &mut Properties) {
    let has = |state| node.states & state != 0;
    let flags = [
        (abi::FOCUSABLE, "focusable"),
        (abi::DISABLED, "disabled"),
        (abi::READ_ONLY, "readonly"),
        (abi::REQUIRED, "required"),
        (abi::MULTILINE, "multiline"),
        (abi::MULTISELECTABLE, "multiselectable"),
        (abi::MODAL, "modal"),
        (abi::BUSY, "busy"),
        (abi::LIVE_ATOMIC, "atomic"),
    ];
    flags
        .iter()
        .filter(|it| has(it.0))
        .for_each(|it| out.raw(it.1, "boolean", true));
    if node.id == sent.focus {
        out.raw("focused", "booleanOrUndefined", true);
    }
    if has(abi::EDITABLE) {
        out.text(
            "editable",
            "token",
            if has(abi::RICHLY_EDITABLE) {
                b"richtext"
            } else {
                b"plaintext"
            },
        );
    }
    if has(abi::SELECTABLE) {
        out.raw("selected", "booleanOrUndefined", has(abi::SELECTED));
    }
    if has(abi::EXPANDED | abi::COLLAPSED) {
        out.raw("expanded", "booleanOrUndefined", has(abi::EXPANDED));
    }
    if has(abi::CHECKABLE) {
        let state: &[u8] = if has(abi::MIXED) {
            b"mixed"
        } else if has(abi::CHECKED) {
            b"true"
        } else {
            b"false"
        };
        out.text(
            if node.role == Role::Button {
                "pressed"
            } else {
                "checked"
            },
            "tristate",
            state,
        );
    }
    let tokens = [
        (abi::LIVE_POLITE, "live", "polite"),
        (abi::LIVE_ASSERTIVE, "live", "assertive"),
        (abi::HORIZONTAL, "orientation", "horizontal"),
        (abi::VERTICAL, "orientation", "vertical"),
    ];
    tokens
        .iter()
        .filter(|it| has(it.0))
        .for_each(|it| out.text(it.1, "token", it.2.as_bytes()));
    for entry in &from.texts[node.texts.range()] {
        let name = match entry.key {
            Text::Url => "url",
            Text::RoleDescription => "roledescription",
            Text::Invalid => "invalid",
            Text::HasPopup => "hasPopup",
            Text::Autocomplete => "autocomplete",
            Text::KeyShortcuts => "keyshortcuts",
            Text::LiveRelevant => "relevant",
            _ => continue,
        };
        out.text(name, "string", &from.bytes[entry.value.range()]);
    }
    for entry in &from.numbers[node.numbers.range()] {
        let name = match entry.key {
            Number::Level => "level",
            Number::Min => "valuemin",
            Number::Max => "valuemax",
            _ => continue,
        };
        out.raw(name, "number", entry.value);
    }
    for entries in from.relations[node.relations.range()].chunk_by(|a, b| a.key == b.key) {
        let name = match entries[0].key {
            Relation::ActiveDescendant => "activedescendant",
            Relation::Controls => "controls",
            Relation::DescribedBy => "describedby",
            Relation::Details => "details",
            Relation::ErrorMessage => "errormessage",
            Relation::FlowTo => "flowto",
            Relation::LabelledBy => "labelledby",
            Relation::Owns => "owns",
            _ => continue,
        };
        let related = entries
            .iter()
            .map(|it| format!(r#"{{"backendDOMNodeId":{}}}"#, sent.nodes[&it.node]))
            .collect::<Vec<_>>();
        _ = write!(
            out.start(name),
            r#"{{"type":"idrefList","relatedNodes":[{}]}}}}"#,
            related.join(",")
        );
    }
}

fn text_in(node: &abi::Node, from: &Output, nodes: &Map<u32, &abi::Node>, out: &mut Vec<u8>) {
    if matches!(node.role, Role::StaticText | Role::LineBreak) {
        from.texts[node.texts.range()]
            .iter()
            .filter(|it| it.key == Text::Name)
            .for_each(|it| out.extend(&from.bytes[it.value.range()]));
    }
    from.children[node.children.range()]
        .iter()
        .filter_map(|it| nodes.get(it))
        .for_each(|it| text_in(it, from, nodes, out));
}

pub(super) fn write(from: &Output, sent: &Sent) -> Vec<u8> {
    let (mut out, nodes) = (
        vec![b'['],
        from.nodes.iter().map(|it| (it.id, it)).collect(),
    );
    for node in from.nodes.iter().rev() {
        let text = |key| {
            from.texts[node.texts.range()]
                .iter()
                .find(|it| it.key == key)
                .map(|it| &from.bytes[it.value.range()])
        };
        let now = from.numbers[node.numbers.range()]
            .iter()
            .find(|it| it.key == Number::Now)
            .map(|it| it.value.to_string());
        if out.len() > 1 {
            out.push(b',');
        }
        _ = write!(
            out,
            r#"{{"nodeId":"{}","ignored":false,"backendDOMNodeId":{},"role":"#,
            node.id, sent.nodes[&node.id]
        );
        value("role", node.role.name().as_bytes(), &mut out);
        out.extend(br#","name":"#);
        value(
            "computedString",
            text(Text::Name).unwrap_or_default(),
            &mut out,
        );
        let mut typed = Vec::new();
        if node.states & abi::TEXT_FIELD != 0 {
            text_in(node, from, &nodes, &mut typed);
        }
        if let Some(it) = text(Text::Value)
            .or_else(|| now.as_ref().map(String::as_bytes))
            .or_else(|| Some(&typed[..]).filter(|it| !it.is_empty()))
        {
            out.extend(br#","value":"#);
            value("string", it, &mut out);
        }
        if let Some(it) = text(Text::Description) {
            out.extend(br#","description":"#);
            value("computedString", it, &mut out);
        }
        let children = from.children[node.children.range()]
            .iter()
            .map(|it| format!(r#""{it}""#))
            .collect::<Vec<_>>();
        _ = write!(
            out,
            r#","childIds":[{}],"properties":["#,
            children.join(",")
        );
        properties(node, from, sent, &mut Properties(&mut out));
        out.extend(b"]}");
    }
    out.push(b']');
    out
}
