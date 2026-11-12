use bun_sema::atom::{Atom, Interner, known};
use bun_sema::erasure::ReplacedText;
use bun_sema::hir::{
    ExprId, ExprKind, File, JsxId, PropKey, PropKind, is_intrinsic_jsx_name, jsx_expression_around,
};
use bun_sema::import_sites::{
    JsxCallee, JsxImport, JsxMode, has_static_children, is_ignored_key, jsx_callee,
};
use bun_sema::resolve::JsxSettings;
use rustc_hash::FxHashMap;

use super::text::print_string;

struct Writer<'a, 's> {
    hir: &'a File<'s>,
    atoms: &'a Interner<'s>,
    mode: JsxMode,
    settings: &'a JsxSettings,
    written_in_front: FxHashMap<ExprId, (&'static str, u32)>,
    replaced: Vec<ReplacedText>,
}

fn is_written_as_name(key: &[u8]) -> bool {
    let is_part = |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
    key.first().is_some_and(|first| !first.is_ascii_digit()) && key.iter().all(is_part)
}

impl Writer<'_, '_> {
    fn replace(&mut self, start: u32, end: u32, text: Vec<u8>) {
        let text = text.into_boxed_slice();
        self.replaced.push(ReplacedText { start, end, text });
    }

    fn leave_out(&mut self, start: u32, end: u32) {
        self.replace(start, end, Vec::new());
    }

    fn find_intrinsic_tag_name(&self, tag: ExprId) -> Option<Atom> {
        match self.hir[tag].kind {
            ExprKind::String(name) => Some(name),
            ExprKind::This => Some(known::this),
            ExprKind::Ident(name) => is_intrinsic_jsx_name(self.atoms.bytes(name)).then_some(name),
            _ => None,
        }
    }

    fn write_callee(&self, callee: JsxCallee) -> Vec<u8> {
        match callee {
            JsxCallee::Factory => self.settings.factory.join(&b"."[..]),
            JsxCallee::Import(import) => [b"$", import.export_name()].concat(),
        }
    }

    fn write_fragment(&self) -> Vec<u8> {
        match self.mode {
            JsxMode::Classic => self.settings.fragment.join(&b"."[..]),
            JsxMode::Automatic(_) => self.write_callee(JsxCallee::Import(JsxImport::Fragment)),
        }
    }

    fn write_attributes(&mut self, jsx: JsxId, end_of_tag: u32) -> (bool, u32) {
        let hir = self.hir;
        let (mut has_props, mut start) = (false, end_of_tag);
        for attribute in hir[jsx].attrs.iter() {
            let prop = hir[attribute];
            let start = core::mem::replace(&mut start, prop.end);
            if is_ignored_key(hir, attribute) {
                self.leave_out(start, prop.end);
                continue;
            }
            let mut text = match has_props {
                true => b", ".to_vec(),
                false => b", { ".to_vec(),
            };
            has_props = true;
            let PropKey::Name(name) = prop.key else {
                debug_assert_eq!(prop.kind, PropKind::Spread);
                self.replace(start, prop.start + 1, text);
                self.leave_out(prop.end - 1, prop.end);
                continue;
            };
            match self.atoms.bytes(name) {
                name if is_written_as_name(name) => text.extend(name),
                name => text.extend(print_string(name)),
            }
            text.extend(b": ");
            let value = prop.value.some();
            let braces = value.and_then(|value| jsx_expression_around(hir, value));
            match (value.map(|value| hir[value]), braces) {
                (None, _) => {
                    text.extend(b"true");
                    self.replace(start, prop.end, text);
                }
                (Some(_), Some((open, close))) => {
                    self.replace(start, open + 1, text);
                    self.leave_out(close - 1, close);
                }
                (Some(value), None) if matches!(value.kind, ExprKind::String(_)) => {
                    text.extend(print_string(
                        self.atoms.bytes(hir.jsx_attribute_text(prop.value)),
                    ));
                    self.replace(start, prop.end, text);
                }
                (Some(value), None) => self.replace(start, value.pos, text),
            }
        }
        (has_props, start)
    }

    fn write_children(&mut self, jsx: JsxId, first: &'static str) -> (bool, u32) {
        let hir = self.hir;
        let (mut in_front, mut has_children) = (first, false);
        let mut start = hir[jsx].opening_end;
        for child in hir.ids(hir[jsx].children) {
            let braces = jsx_expression_around(hir, child);
            let end = braces.map_or(hir[child].end, |(_, close)| close);
            let start = core::mem::replace(&mut start, end);
            match (hir[child].kind, braces) {
                (ExprKind::Missing, _) => {
                    self.leave_out(start, end);
                    continue;
                }
                (_, Some((open, close))) => {
                    self.replace(start, open + 1, in_front.into());
                    self.leave_out(close - 1, close);
                }
                (ExprKind::JsxText(text), None) => {
                    let text =
                        [in_front.as_bytes(), &print_string(self.atoms.bytes(text))].concat();
                    self.replace(start, end, text);
                }
                (_, None) => {
                    self.written_in_front.insert(child, (in_front, start));
                }
            }
            (in_front, has_children) = (", ", true);
        }
        (has_children, start)
    }

    fn write_element(&mut self, expression: ExprId, jsx: JsxId) {
        let hir = self.hir;
        let element = hir[jsx];
        let callee = jsx_callee(hir, self.mode, jsx);
        let takes_children_as_arguments = matches!(
            callee,
            JsxCallee::Factory | JsxCallee::Import(JsxImport::CreateElement)
        );
        let in_front = self.written_in_front.get(&expression).copied();
        let (in_front, start) = in_front.unwrap_or(("", hir[expression].pos));
        let mut head = [in_front.as_bytes(), &self.write_callee(callee), b"("].concat();
        let end_of_tag = match element.tag.some() {
            None => {
                head.extend(self.write_fragment());
                start
            }
            Some(tag) => {
                let end_of_head = match self.find_intrinsic_tag_name(tag) {
                    Some(name) => {
                        head.extend(print_string(self.atoms.bytes(name)));
                        hir[tag].end
                    }
                    None => hir[tag].pos,
                };
                self.replace(start, end_of_head, core::mem::take(&mut head));
                hir[tag].end
            }
        };
        let (has_props, end_of_attributes) = self.write_attributes(jsx, end_of_tag);
        let is_static = has_static_children(hir, jsx);
        let first = match (takes_children_as_arguments, has_props, is_static) {
            (true, ..) => ", ",
            (false, true, false) => ", children: ",
            (false, true, true) => ", children: [",
            (false, false, false) => ", { children: ",
            (false, false, true) => ", { children: [",
        };
        let (has_children, end_of_children) = self.write_children(jsx, first);
        let end_of_props = match (takes_children_as_arguments, has_props, has_children) {
            (true, true, _) | (false, true, false) => &b" }"[..],
            (true, false, _) => b", null",
            (false, false, false) => b", {}",
            (false, _, true) => b"",
        };
        head.extend(end_of_props);
        let tail = match (takes_children_as_arguments, has_children, is_static) {
            (true, ..) | (false, false, _) => &b")"[..],
            (false, true, false) => b" })",
            (false, true, true) => b"] })",
        };
        if element.close_pos == u32::MAX {
            head.extend(tail);
        } else {
            self.replace(end_of_children, element.end, tail.to_vec());
        }
        self.replace(end_of_attributes, element.opening_end, head);
    }
}

pub(super) fn find_text_written_for_jsx<'s>(
    hir: &File<'s>,
    atoms: &Interner<'s>,
    mode: JsxMode,
    settings: &JsxSettings,
) -> Vec<ReplacedText> {
    if hir.jsx.is_empty() {
        return Vec::new();
    }
    let mut writer = Writer {
        hir,
        atoms,
        mode,
        settings,
        written_in_front: FxHashMap::default(),
        replaced: Vec::new(),
    };
    for (index, expression) in hir.exprs.iter().enumerate().rev() {
        if let ExprKind::Jsx(jsx) = expression.kind {
            writer.write_element(ExprId(index as u32), jsx);
        }
    }
    writer.replaced
}

#[cfg(test)]
mod tests {
    use bun_sema::erasure::find_type_ranges_beside;
    use bun_sema::import_sites::AutomaticJsx;
    use bun_sema::session::Session;
    use bun_sema_parser::{CompileParseOptions, parse_for_compile};

    use super::*;

    fn write(text: &str, is_classic: bool) -> String {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let options = CompileParseOptions {
            path: b"a.tsx",
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            ignores_pure_comments: false,
        };
        let mut hir = parse_for_compile(session.arena(), &options, text.as_bytes(), &atoms);
        assert!(hir.syntax_errors().next().is_none());
        hir.text = text.as_bytes().into();
        let settings = JsxSettings {
            factory: vec![b"own".to_vec(), b"h".to_vec()],
            fragment: vec![b"frag".to_vec()],
            ..JsxSettings::default()
        };
        let mode = match is_classic {
            true => JsxMode::Classic,
            false => JsxMode::Automatic(AutomaticJsx {
                runtime_specifier: Atom::NONE,
                package_specifier: Atom::NONE,
                is_development: false,
            }),
        };
        let replaced = find_text_written_for_jsx(&hir, &atoms, mode, &settings);
        let packed = find_type_ranges_beside(&hir, replaced).pack();
        let mut kept = vec![0; packed.kept_len(text.len())];
        packed.remove_from(text.as_bytes(), &mut kept);
        String::from_utf8(kept).unwrap()
    }

    #[test]
    fn a_written_factory_takes_the_children_as_arguments() {
        let written = [
            ("<a />", "own.h(\"a\", null)"),
            ("<a></a>", "own.h(\"a\", null)"),
            ("<A.B<T> />", "own.h(A.B, null)"),
            (
                "<a-b c:d=\"&lt;\" e />",
                "own.h(\"a-b\", { \"c:d\": \"<\", e: true })",
            ),
            (
                "<a b={c as T} {...d} key={e}>f{g!}{}{...h}<i /></a>",
                "own.h(\"a\", { b: c, ...d, key: e }, \"f\", g, ...h, own.h(\"i\", null))",
            ),
            ("<>{a}</>", "own.h(frag, null, a)"),
            (
                "<a b=<c /> key />",
                "own.h(\"a\", { b: own.h(\"c\", null) })",
            ),
        ];
        for (text, expected) in written {
            assert_eq!(write(text, true), expected, "{text}");
        }
    }

    #[test]
    fn the_runtime_takes_the_children_among_the_props() {
        let written = [
            ("<a />", "$jsx(\"a\", {})"),
            ("<a>b</a>", "$jsx(\"a\", { children: \"b\" })"),
            (
                "<a b=\"c\">{d}</a>",
                "$jsx(\"a\", { b: \"c\", children: d })",
            ),
            (
                "<A b>{c}d</A>",
                "$jsxs(A, { b: true, children: [c, \"d\"] })",
            ),
            ("<a>{...b}</a>", "$jsxs(\"a\", { children: [...b] })"),
            (
                "<a {...b} key=\"c\" />",
                "$createElement(\"a\", { ...b, key: \"c\" })",
            ),
            (
                "<><a /></>",
                "$jsx($Fragment, { children: $jsx(\"a\", {}) })",
            ),
        ];
        for (text, expected) in written {
            assert_eq!(write(text, false), expected, "{text}");
        }
    }
}
