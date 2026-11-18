//! The domain CSS.

use core::ops::Range;

use bun_core::strings;
use bun_jsc::bindgen::JsInterface as _;

use super::outline::{Outline, longhands_of};
use super::*;
use crate::api::cssom::{
    CSSStyleSheet, OF_INSPECTOR, get_computed_style, inject_sheet, inline_style, sheets_of,
};
use crate::api::ui::layout;
use crate::generated_bindgen::cssom::js_StyleSheet;
use crate::name::Set;
use crate::rules::{Level, Matched};
use crate::scan;
use crate::selector::Pseudo;
use crate::sheet::{Block, Source};
use crate::tree::State;
use crate::values::Out;

struct Sheet {
    number: u32,
    object: Weak<()>,
    sources: Vec<Source>,
    outline: Rc<Outline>,
}

#[derive(Default)]
pub(super) struct Reported {
    is_enabled: Cell<bool>,
    /// By their addresses.
    sheets: RefCell<Map<usize, Sheet>>,
    last_sheet: Cell<u32>,
    own_sheet: Cell<u32>,
    /// Of the user agent.
    foreign: RefCell<Vec<(Source, Rc<Outline>)>>,
    /// The states that the element would not have.
    forced: RefCell<Map<u32, State>>,
    tracked: RefCell<Vec<String>>,
    tracked_values: RefCell<Map<u32, u64>>,
    /// The id, and the address of its style.
    watched: Cell<(u32, usize)>,
}

impl Reported {
    /// The ids of the sheets.
    pub(super) fn forget(&self) -> Vec<String> {
        drop((
            self.forced.take(),
            self.tracked_values.take(),
            self.own_sheet.take(),
        ));
        self.sheets
            .take()
            .into_values()
            .map(|it| it.number.to_string())
            .collect()
    }

    pub(super) fn stop_forcing(&self, cx: Cx<'_, '_>) {
        for (id, states) in self.forced.take() {
            Target::with_id(&cx.heap, id)
                .and_then(|it| it.element().ok())
                .inspect(|it| it.set_state(cx, states, false));
        }
    }
}

const PSEUDOS: [(Pseudo, &str); 11] = [
    (Pseudo::FirstLine, "first-line"),
    (Pseudo::FirstLetter, "first-letter"),
    (Pseudo::Before, "before"),
    (Pseudo::After, "after"),
    (Pseudo::Marker, "marker"),
    (Pseudo::Backdrop, "backdrop"),
    (Pseudo::Selection, "selection"),
    (Pseudo::Scrollbar, "scrollbar"),
    (Pseudo::ScrollbarThumb, "scrollbar-thumb"),
    (Pseudo::ScrollbarTrack, "scrollbar-track"),
    (Pseudo::ScrollbarCorner, "scrollbar-corner"),
];

fn state_named(name: &str) -> State {
    match name {
        "visited" => State::empty(),
        "autofill" | "read-only" => State::empty(),
        name => State::from_name(
            &name
                .chars()
                .map(|it| {
                    if it == '-' {
                        '_'
                    } else {
                        it.to_ascii_uppercase()
                    }
                })
                .collect::<String>(),
        )
        .unwrap_or_default(),
    }
}

fn address_of(sheet: &CSSStyleSheet) -> usize {
    sheet.to_js().encoded()
}

fn with_imports<'a>(
    heap: &JsHeap<'a>,
    sheet: &'a CSSStyleSheet,
    visit: &mut dyn FnMut(&'a CSSStyleSheet),
) {
    sheet
        .imports(heap)
        .for_each(|it| with_imports(heap, it, visit));
    visit(sheet);
}

fn inline_outline<'a>(cx: Cx<'_, 'a>, element: &'a Element) -> Outline {
    element.flush_style(cx);
    let text = element.attr(atom!("style")).unwrap_or_default();
    Outline::of_declarations(
        text.to_utf8().as_bytes().to_vec(),
        Some(format!("style-{}", id_of(element))),
    )
}

fn inline_style_of<'a>(cx: Cx<'_, 'a>, element: &'a Element) -> Value {
    let outline = inline_outline(cx, element);
    outline.style(0..outline.text.len())
}

fn hints_among(matched: &[Matched]) -> Value {
    let hints = matched
        .iter()
        .find(|it| it.level == Level::Hints)
        .map(|it| Outline::of_declarations(it.block.editable().list.serialize(), None));
    hints.map(|it| it.style(0..it.text.len())).into()
}

/// What `matches()` understands, unless it gets too long.
fn standalone(outline: &Outline, rule: usize, selector: Range<usize>) -> Option<Out> {
    let selector = &outline.text[selector];
    let selector = &selector[..strings::index_of(selector, b"::").unwrap_or(selector.len())];
    let Some(outer) = outline
        .lineage(rule)
        .skip(1)
        .find(|it| outline.at_rule(*it).0.is_empty())
    else {
        return Some(if selector.is_empty() { b"*" } else { selector }.to_vec());
    };
    let outer = [
        b":is(",
        &*standalone(outline, outer, outline.rules[outer].prelude.clone())?,
        b")",
    ]
    .concat();
    let parts = strings::split(selector, b"&").collect::<Vec<_>>();
    (parts.len() * outer.len() <= 1 << 16).then(|| {
        if parts.len() > 1 {
            parts.join(&*outer)
        } else {
            [&outer, &b" "[..], selector].concat()
        }
    })
}

fn describe_rule(outline: &Outline, rule: usize, at: usize, origin: &str) -> Value {
    let mut it = record! { "styleSheetId": outline.id.as_deref(), "origin": origin, "style": outline.style(outline.declarations_at(rule, at)) };
    let is_bare = !outline.at_rule(rule).0.is_empty();
    it.set(
        "selectorList",
        if is_bare {
            record! { "selectors": list![record! { "text": "&" }], "text": "&" }
        } else {
            outline.selector_list(outline.rules[rule].prelude.clone())
        },
    );
    let mut groups: [(&str, Vec<Value>); 8] = [
        "media",
        "containerQueries",
        "supports",
        "layers",
        "scopes",
        "startingStyles",
        "nestingSelectors",
        "ruleTypes",
    ]
    .map(|it| (it, Vec::new()));
    for outer in outline.lineage(rule).skip(usize::from(!is_bare)) {
        let (name, rest) = outline.at_rule(outer);
        let located = outline.located(&rest);
        let (group, kind, described) = match &*name {
            b"media" => (0, "MediaRule", located.with("source", "mediaRule")),
            b"container" => (1, "ContainerRule", located),
            b"supports" => (2, "SupportsRule", located.with("active", true)),
            b"layer" => (3, "LayerRule", located),
            b"scope" => (4, "ScopeRule", located),
            b"starting-style" => (5, "StartingStyleRule", located),
            b"" => (6, "StyleRule", located["text"].clone()),
            _ => continue,
        };
        groups[group].1.push(described);
        groups[7].1.push(kind.into());
    }
    groups
        .into_iter()
        .fold(it, |it, (name, all)| it.with(name, Value::List(all)))
}

impl Inspector {
    fn header(&self, sheet: &CSSStyleSheet, outline: &Outline, origin: &str) -> Value {
        let (named, [line, column]) = (
            outline.magic_comment("sourceURL"),
            outline.position(outline.text.len()),
        );
        record! {
            "styleSheetId": outline.id.as_deref(), "frameId": self.session.frame(), "origin": origin, "sourceURL": lossy(named.or_else(|| sheet.get_href()).unwrap_or_default()),
            "hasSourceURL": named.is_some(), "sourceMapURL": outline.magic_comment("sourceMappingURL").map(lossy), "ownerNode": js_StyleSheet::owner_node(sheet).map(id_of),
            "title": utf8(&sheet.title.borrow()), "disabled": sheet.get().is_disabled.get(),
            "isInline": false, "isMutable": false, "isConstructed": sheet.get().is_constructed(), "startLine": 0, "startColumn": 0, "length": outline.text.len(), "endLine": line, "endColumn": column,
        }
    }

    fn origin_of(&self, outline: &Outline, level: Level) -> &'static str {
        match level {
            Level::UserAgent => "user-agent",
            Level::User => "injected",
            _ if outline.id == Some(self.styles.own_sheet.get().to_string()) => "inspector",
            _ => "regular",
        }
    }

    fn compare_sheet(&self, sheet: &CSSStyleSheet) {
        let (mut all, sources) = (self.styles.sheets.borrow_mut(), sheet.get().sources());
        let outline = |number: u32| {
            Rc::new(Outline::of_sheet(
                sheet.get().text(),
                Some(number.to_string()),
            ))
        };
        match all.get_mut(&address_of(sheet)) {
            Some(known)
                if known
                    .sources
                    .iter()
                    .map(|it| &raw const **it)
                    .eq(sources.iter().map(|it| &raw const **it)) => {}
            Some(known) => {
                (known.sources, known.outline) = (sources, outline(known.number));
                self.emit(
                    "CSS.styleSheetChanged",
                    record! { "styleSheetId": known.outline.id.as_deref() },
                );
            }
            None => {
                self.styles.last_sheet.update(|it| it + 1);
                let number = self.styles.last_sheet.get();
                let made = Sheet {
                    number,
                    object: Weak::create_passive(sheet.to_js(), main_global()),
                    sources,
                    outline: outline(number),
                };
                self.emit("CSS.styleSheetAdded", record! { "header": self.header(sheet, &made.outline, self.origin_of(&made.outline, Level::Own)) });
                all.insert(address_of(sheet), made);
            }
        }
    }

    pub(super) fn compare_styles<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
        let reported = &self.styles;
        if !reported.is_enabled.get() {
            return false;
        }
        doc.sync(cx);
        let scopes: Vec<_> = doc.engine(|engine, _| engine.styles.scopes.keys().copied().collect());
        let scopes = [&**doc].into_iter().chain(
            scopes
                .into_iter()
                .filter_map(|it| doc.rendered_node(it))
                .filter(|it| !it.has(NodeFlags::USER_AGENT)),
        );
        let (now, mut seen) = (List::new(&cx.heap), Set::default());
        for sheet in scopes.flat_map(|it| sheets_of(&cx.heap, it)) {
            with_imports(&cx.heap, sheet, &mut |it| {
                if seen.insert(address_of(it)) {
                    now.push(&cx.heap, it.to_js());
                }
            });
        }
        let gone: Vec<_> = reported
            .sheets
            .borrow_mut()
            .extract_if(|address, it| !seen.contains(address) || it.object.get().is_none())
            .collect();
        gone.into_iter().for_each(|it| {
            self.emit(
                "CSS.styleSheetRemoved",
                record! { "styleSheetId": it.1.outline.id.as_deref() },
            )
        });
        now.values()
            .filter_map(|it| CSSStyleSheet::from_js(&cx.heap, it))
            .for_each(|it| self.compare_sheet(it));
        for (id, states) in reported.forced.borrow().clone() {
            Target::with_id(&cx.heap, id)
                .and_then(|it| it.element().ok())
                .filter(|it| !it.state().contains(states))
                .inspect(|it| it.set_state(cx, states, true));
        }
        let (id, before) = reported.watched.get();
        if let Some(target) = Target::with_id(&cx.heap, id) {
            let style = target.node.read(|tree, id| {
                tree.style(target.in_engine(tree, id))
                    .map_or(0, |it| core::ptr::from_ref(&**it).addr())
            });
            reported.watched.set((id, style));
            if style != before && before != 0 {
                self.emit("CSS.computedStyleUpdated", record! { "nodeId": id });
            }
        }
        true
    }

    /// The sheet, and where in it. Trees that have the same text share what is compiled of it.
    fn locate<'a>(
        &self,
        heap: &JsHeap<'a>,
        node: &'a Node,
        it: &Matched,
    ) -> Option<(Rc<Outline>, usize)> {
        if it.level == Level::UserAgent {
            let ((source, at), mut foreign) = (it.block.place(), self.styles.foreign.borrow_mut());
            if !foreign
                .iter()
                .any(|it| core::ptr::eq(&raw const *it.0, &raw const **source))
            {
                foreign.push((
                    source.clone(),
                    Rc::new(Outline::of_sheet(source.to_vec(), None)),
                ));
            }
            return foreign
                .iter()
                .find(|it| core::ptr::eq(&raw const *it.0, &raw const **source))
                .map(|it| (Rc::clone(&it.1), at));
        }
        let all = self.styles.sheets.borrow();
        let find = |sheet: &CSSStyleSheet, block: &Rc<Block>| {
            Some((
                Rc::clone(&all.get(&address_of(sheet))?.outline),
                sheet.get().place_of(block)?,
            ))
        };
        let near = [
            node.scope(),
            node.as_element()
                .and_then(Element::shadow_root)
                .map(|it| &***it),
        ]
        .into_iter()
        .flatten()
        .flat_map(|it| sheets_of(heap, it));
        let any = all
            .values()
            .filter_map(|it| CSSStyleSheet::from_js(heap, it.object.get()?));
        near.chain(any).find_map(|sheet| find(sheet, &it.block))
    }

    fn matches<'a>(&self, cx: Cx<'_, 'a>, element: &'a Element, matched: &[Matched]) -> Value {
        let mut all = Vec::new();
        for (index, it) in matched
            .iter()
            .enumerate()
            .filter(|it| it.1.level != Level::Hints && !it.1.is_inline())
        {
            if matched[index + 1..]
                .iter()
                .any(|later| Rc::ptr_eq(&later.block, &it.block))
            {
                continue;
            }
            let Some((outline, at)) = self.locate(&cx.heap, element, it) else {
                continue;
            };
            let Some(rule) = outline.rule_at(at) else {
                continue;
            };
            let selectors = outline.selectors(outline.rules[rule].prelude.clone());
            let mut fits = |it: &Range<usize>| {
                let Some(selector) = standalone(&outline, rule, it.clone()) else {
                    return false;
                };
                let selector = DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(&*selector))
                    .to_js(&cx.heap);
                let matches = element.matches(cx, selector);
                or_message(cx, matches) == Ok(true)
            };
            let fitting: Vec<usize> = (0..selectors.len())
                .filter(|it| selectors.len() > 1 && fits(&selectors[*it]))
                .collect();
            let fitting = if fitting.is_empty() {
                (0..selectors.len().max(1)).collect()
            } else {
                fitting
            };
            all.push(record! { "rule": describe_rule(&outline, rule, at, self.origin_of(&outline, it.level)), "matchingSelectors": fitting.into_iter().collect::<Value>() });
        }
        Value::List(all)
    }

    fn at_rules(&self, name: &[u8], mut visit: impl FnMut(&Outline, usize, Range<usize>)) {
        let all = self.styles.sheets.borrow();
        let mut all: Vec<_> = all.values().collect();
        all.sort_by_key(|it| it.number);
        for outline in all.into_iter().map(|it| &*it.outline) {
            for (rule, (_, rest)) in (0..outline.rules.len())
                .map(|it| (it, outline.at_rule(it)))
                .filter(|it| it.1.0 == name)
            {
                visit(outline, rule, rest);
            }
        }
    }

    fn keyframes<'a>(&self, cx: Cx<'_, 'a>, element: &'a Element) -> Value {
        let (names, mut all) = (layout::computed(cx, element, "animation-name"), Vec::new());
        if names != b"none" {
            self.at_rules(b"keyframes", |outline, rule, name| {
                if strings::split(&names, b", ").any(|it| *it == outline.text[name.clone()]) {
                    let frames = outline.rules.iter().filter(|it| it.parent == Some(rule));
                    let describe = |it: &outline::Rule| record! { "styleSheetId": outline.id.as_deref(), "origin": "regular", "keyText": outline.located(&it.prelude), "style": outline.style(it.body.clone()) };
                    all.push(record! { "animationName": outline.located(&name), "keyframes": frames.map(describe).collect::<Value>() });
                }
            });
        }
        Value::List(all)
    }

    fn matched_styles<'a>(&self, cx: Cx<'_, 'a>, target: Target<'a>) -> Outcome {
        let element = target.element()?;
        self.compare_styles(cx, element.doc());
        let rules = |cx: Cx<'_, 'a>, it: Target<'a>, pseudo| {
            layout::styled(cx, it.node, |engine, id| {
                engine.rules_for_inspector(it.in_engine(&engine.tree, id), pseudo)
            })
        };
        let own = rules(cx, target, Pseudo::None);
        let mut result = record! { "matchedCSSRules": self.matches(cx, element, &own), "cssKeyframesRules": self.keyframes(cx, element), "inheritedPseudoElements": list![] };
        let mut pseudos = Vec::new();
        if target.slot.is_none() {
            result.set("inlineStyle", inline_style_of(cx, element));
            result.set("attributesStyle", hints_among(&own));
            for (pseudo, name) in PSEUDOS {
                let matched = rules(cx, target, pseudo);
                if matched.iter().any(|it| it.level != Level::UserAgent) {
                    pseudos.push(record! { "pseudoType": name, "matches": self.matches(cx, element, &matched) });
                }
            }
        }
        let ancestors = core::iter::successors(Some(target.node), |it| it.flat_parent())
            .skip(usize::from(target.slot.is_none()))
            .filter(|it| it.is_element());
        let ancestors = Rooted::from_nodes(&cx.heap, ancestors);
        let mut inherited = Vec::new();
        for it in ancestors.iter().filter_map(Node::as_element) {
            let matched = rules(cx, (&**it).into(), Pseudo::None);
            inherited.push(record! { "inlineStyle": it.has_attr(atom!("style")).then(|| inline_style_of(cx, it)), "matchedCSSRules": self.matches(cx, it, &matched) });
        }
        let parent = ancestors.iter().find(|it| {
            it.as_element()
                .is_some_and(|it| layout::computed(cx, it, "display") != b"contents")
        });
        Ok(result.and(&record! { "pseudoElements": Value::List(pseudos), "inherited": Value::List(inherited), "parentLayoutNodeId": parent.map(|it| self.push(cx, it.into())) }))
    }

    fn computed_style<'a>(&self, cx: Cx<'_, 'a>, target: Target<'a>) -> Outcome {
        let style = get_computed_style(
            &cx.heap,
            target.element()?,
            target.pseudo().as_ref().map(String::as_bytes),
        );
        let describe = |index| {
            let name = style.item(cx, index);
            let value = style.get_property_value(cx, &name);
            let value = DomString::from_js_string(&cx.heap, value);
            Ok(record! { "name": lossy(&name), "value": utf8(&or_message(cx, value)?) })
        };
        let all = (0..style.indexed_length())
            .map(describe)
            .collect::<Outcome>()?;
        Ok(record! { "computedStyle": all, "extraFields": record! { "isAppearanceBase": false } })
    }

    fn outline<'a>(&self, cx: Cx<'_, 'a>, id: &Value) -> Result<Rc<Outline>, String> {
        let found = match id.text().strip_prefix("style-") {
            Some(node) => node.parse().ok().and_then(|it| {
                Some(Rc::new(inline_outline(
                    cx,
                    Target::with_id(&cx.heap, it)?.element().ok()?,
                )))
            }),
            None => self
                .styles
                .sheets
                .borrow()
                .values()
                .find(|it| id.as_text() == it.outline.id.as_deref())
                .map(|it| Rc::clone(&it.outline)),
        };
        found.ok_or_else(|| "No style sheet with given id found".into())
    }

    fn set_text<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        id: &Value,
        text: &[u8],
    ) -> Result<Rc<Outline>, String> {
        if let Some(node) = id.text().strip_prefix("style-") {
            let element = node
                .parse()
                .ok()
                .and_then(|it| Target::with_id(&cx.heap, it))
                .ok_or("No node with given id found")?
                .element()?;
            let checks = doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES);
            doc.set_doc_flags(DocFlags::CHECKS_STYLE_ATTRIBUTES, false);
            element.set_attr(
                cx,
                atom!("style"),
                DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(text)),
            );
            doc.set_doc_flags(DocFlags::CHECKS_STYLE_ATTRIBUTES, checks);
        } else {
            let sheet = self
                .styles
                .sheets
                .borrow()
                .values()
                .find(|it| id.as_text() == it.outline.id.as_deref())
                .and_then(|it| it.object.get());
            sheet
                .and_then(|it| CSSStyleSheet::from_js(&cx.heap, it))
                .ok_or("No style sheet with given id found")?
                .replace_source(cx, Source::copy_of(text));
            self.compare_styles(cx, doc);
        }
        self.outline(cx, id)
    }

    /// Returns where the new text is.
    fn splice<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        params: &Value,
        range: &str,
        text: &str,
    ) -> Result<(Rc<Outline>, Range<usize>), String> {
        let (outline, text) = (
            self.outline(cx, &params["styleSheetId"])?,
            params[text].text().as_bytes(),
        );
        let range = outline.range_from(&params[range])?;
        if scan::end_of_block(&[b"{", text, b"\n}"].concat(), 0).0 != text.len() + 2 {
            return Err("SyntaxError: The text is not valid".into());
        }
        let whole = [
            &outline.text[..range.start],
            text,
            &outline.text[range.end..],
        ]
        .concat();
        Ok((
            self.set_text(cx, doc, &params["styleSheetId"], &whole)?,
            range.start..range.start + text.len(),
        ))
    }

    fn add_rule<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc, params: &Value) -> Outcome {
        let (outline, range) = self.splice(cx, doc, params, "location", "ruleText")?;
        let rule = outline
            .rules
            .iter()
            .position(|it| range.contains(&it.prelude.start))
            .ok_or("SyntaxError: Rule text is not valid.")?;
        Ok(
            record! { "rule": describe_rule(&outline, rule, outline.rules[rule].body.start, self.origin_of(&outline, Level::Own)) },
        )
    }

    fn set_selector<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc, params: &Value) -> Outcome {
        let unnested: Vec<u8> = params["selector"]
            .text()
            .bytes()
            .map(|it| if it == b'&' { b'*' } else { it })
            .collect();
        let is_valid = crate::selector_parser::Parser::default()
            .serialize(&unnested)
            .is_some();
        is_valid.ok_or("SyntaxError: Selector or media text is not valid.")?;
        let (outline, range) = self.splice(cx, doc, params, "range", "selector")?;
        Ok(record! { "selectorList": outline.selector_list(range) })
    }

    fn create_sheet<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) -> Outcome {
        if self.styles.own_sheet.get() == 0 {
            self.compare_styles(cx, doc);
            self.styles.own_sheet.set(self.styles.last_sheet.get() + 1);
            inject_sheet(cx, doc, OF_INSPECTOR, Some((b"", false)));
            self.compare_styles(cx, doc);
        }
        Ok(record! { "styleSheetId": self.styles.own_sheet.get().to_string() })
    }

    fn force<'a>(&self, cx: Cx<'_, 'a>, element: &'a Element, names: &[Value]) -> Outcome {
        let before = self
            .styles
            .forced
            .borrow_mut()
            .remove(&id_of(element))
            .unwrap_or_default();
        element.set_state(cx, before, false);
        let wanted = names
            .iter()
            .fold(State::empty(), |all, it| all | state_named(it.text()))
            - element.state();
        element.set_state(cx, wanted, true);
        self.styles
            .forced
            .borrow_mut()
            .extend((!wanted.is_empty()).then(|| (id_of(element), wanted)));
        empty()
    }

    fn take_updates<'a>(&self, cx: Cx<'_, 'a>) -> Outcome {
        let (names, mut changed) = (self.styles.tracked.borrow().clone(), Vec::new());
        let before = self.styles.tracked_values.take();
        for id in self.nodes.ids() {
            let Some(element) = Target::with_id(&cx.heap, id).and_then(|it| it.element().ok())
            else {
                continue;
            };
            let values = bun_wyhash::hash(
                &names
                    .iter()
                    .map(|it| layout::computed(cx, element, it))
                    .collect::<Vec<_>>()
                    .join(&b';'),
            );
            changed.extend(before.get(&id).filter(|it| **it != values).map(|_| id));
            self.styles.tracked_values.borrow_mut().insert(id, values);
        }
        Ok(record! { "nodeIds": changed.into_iter().collect::<Value>() })
    }

    fn class_names<'a>(&self, cx: Cx<'_, 'a>, params: &Value) -> Outcome {
        let (outline, mut names) = (
            self.outline(cx, &params["styleSheetId"])?,
            Set::<Out>::default(),
        );
        for rule in outline
            .rules
            .iter()
            .map(|it| &outline.text[it.prelude.clone()])
            .filter(|it| !it.starts_with(b"@"))
        {
            let is_part =
                |it: &&u8| it.is_ascii_alphanumeric() || matches!(it, b'-' | b'_' | 0x80..);
            names.extend(
                strings::split(rule, b".")
                    .skip(1)
                    .map(|it| it.iter().take_while(is_part).copied().collect::<Out>())
                    .filter(|it| !it.is_empty()),
            );
        }
        Ok(record! { "classNames": names.iter().map(|it| lossy(it)).collect::<Value>() })
    }

    fn about_style_of<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &str,
        target: Target<'a>,
        params: &Value,
    ) -> Outcome {
        let element = target.element()?;
        match name {
            "getMatchedStylesForNode" => self.matched_styles(cx, target),
            "getComputedStyleForNode" => self.computed_style(cx, target),
            "getInlineStylesForNode" => {
                let matched = layout::styled(cx, element, |engine, id| {
                    engine.rules_for_inspector(id, Pseudo::None)
                });
                Ok(
                    record! { "inlineStyle": inline_style_of(cx, element), "attributesStyle": hints_among(&matched) },
                )
            }
            "forcePseudoState" => self.force(cx, element, params["forcedPseudoClasses"].items()),
            _ => {
                let set = inline_style(&cx.heap, element).set_property(
                    cx,
                    params["propertyName"].text().as_bytes(),
                    params["value"].text().as_bytes(),
                    b"",
                );
                or_message(cx, set).and_then(|_| empty())
            }
        }
    }

    pub(super) fn about_styles<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        name: &str,
        params: &Value,
    ) -> Option<Outcome> {
        let mut set_prelude = |text: &str, result: &str| {
            self.splice(cx, doc, params, "range", text)
                .map(|(outline, range)| {
                    Value::empty().with(
                        result,
                        outline
                            .located(&range)
                            .with("source", "mediaRule")
                            .with("active", true),
                    )
                })
        };
        Some(match name {
            "setMediaText" => set_prelude("text", "media"),
            "setContainerQueryText" => set_prelude("text", "containerQuery"),
            "setSupportsText" => set_prelude("text", "supports"),
            "setScopeText" => set_prelude("text", "scope"),
            "setKeyframeKey" => set_prelude("keyText", "keyText"),
            "enable" | "disable" => {
                self.styles.stop_forcing(cx);
                self.styles.forget();
                self.styles.is_enabled.set(name == "enable");
                self.compare_styles(cx, doc);
                empty()
            }
            "getMatchedStylesForNode"
            | "getComputedStyleForNode"
            | "getInlineStylesForNode"
            | "forcePseudoState"
            | "setEffectivePropertyValueForNode" => self
                .target(&cx.heap, params)
                .and_then(|it| self.about_style_of(cx, name, it, params)),
            "getStyleSheetText" => self
                .outline(cx, &params["styleSheetId"])
                .map(|it| record! { "text": lossy(&it.text) }),
            "setStyleSheetText" => self
                .set_text(
                    cx,
                    doc,
                    &params["styleSheetId"],
                    params["text"].text().as_bytes(),
                )
                .and_then(|_| empty()),
            "setStyleTexts" => {
                let styles = params["edits"].items().iter().map(|it| {
                    self.splice(cx, doc, it, "range", "text")
                        .map(|(outline, range)| outline.style(range))
                });
                styles
                    .collect::<Result<Value, _>>()
                    .map(|it| record! { "styles": it })
            }
            "setRuleSelector" => self.set_selector(cx, doc, params),
            "addRule" => self.add_rule(cx, doc, params),
            "createStyleSheet" => self.create_sheet(cx, doc),
            "collectClassNames" => self.class_names(cx, params),
            "getMediaQueries" => {
                let mut all = Vec::new();
                self.at_rules(b"media", |outline, _, rest| {
                    all.push(outline.located(&rest).with("source", "mediaRule"))
                });
                Ok(record! { "medias": Value::List(all) })
            }
            "getLonghandProperties" => Ok(
                record! { "longhandProperties": longhands_of(params["shorthandName"].text().as_bytes(), params["value"].text().as_bytes()) },
            ),
            "resolveValues" => Ok(record! { "results": &params["values"] }),
            "trackComputedStyleUpdates" => {
                let names: Set<_> = params["propertiesToTrack"]
                    .items()
                    .iter()
                    .map(|it| it["name"].text().to_owned())
                    .collect();
                self.styles.tracked.replace(names.into_iter().collect());
                self.styles.tracked_values.take();
                empty()
            }
            "takeComputedStyleUpdates" => self.take_updates(cx),
            "trackComputedStyleUpdatesForNode" => {
                self.styles
                    .watched
                    .set((params["nodeId"].number() as u32, 0));
                empty()
            }
            "getPlatformFontsForNode" => Ok(record! { "fonts": list![] }),
            "getEnvironmentVariables" => Ok(record! { "environmentVariables": Value::empty() }),
            "getAnimatedStylesForNode" | "getBackgroundColors" => empty(),
            _ => return None,
        })
    }
}
