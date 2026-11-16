//! Generated content: list markers, counters and quotes.

use std::rc::Rc;

use crate::boxes::Child;
use crate::counter_style::CounterStyle;
use crate::document::Document;
use crate::name::name;
use crate::properties::Style;
use crate::tree::{AFTER, BEFORE, DOCUMENT, Data, Element, MARKER, Namespace, NodeId, Replaced};
use crate::types::*;
use crate::values::Str;

fn is_named(style: &Style, names: &[&str]) -> bool {
    matches!(&style.text.list_type, ListStyleType::Named(name) if names.contains(&&**name))
}

pub(crate) fn is_disclosure(style: &Style) -> bool {
    is_named(style, &["disclosure-open", "disclosure-closed"])
}

pub(crate) fn bullet_size(style: &Style, scale: f32) -> f32 {
    ((((style.metrics.ascent * scale).round() * 2.0 / 3.0).floor() + 1.0) / 2.0).floor() / scale
}

/// From CLDR, for the languages that differ from English.
const QUOTES: [(&str, &str); 22] = [
    ("«»‹›", "am fa fr-ch rm ti-er"),
    ("”“’‘", "ar ur"),
    ("«»„“", "be os ru sah uk kk-kz"),
    ("„“„“", "bg lt"),
    ("«»“”", "ast br ca el es-es eu it pt-pt sc sq"),
    ("„“‚‘", "bs-cyrl cs de dsb et hr hsb is lb mk sk sl"),
    ("„”‘’", "bs"),
    ("””’’", "fi he se sv"),
    ("«»«»", "fr hy"),
    ("«»”“", "fr-ca"),
    ("„”»«", "hu"),
    ("「」『』", "ja yue zh-hant zh-hk zh-mo zh-tw"),
    ("„“«»", "ka"),
    ("«»“”", "kk"),
    ("«»„“", "ky"),
    ("‘’‘’", "nl"),
    ("«»‘’", "nb nn no"),
    ("„”«»", "pl ro"),
    ("„“‘‘", "sr"),
    ("»«›‹", "ug"),
    ("“”’‘", "uz"),
    ("«»„”", "shi zgh"),
];

fn quotes_for(locale: &str) -> &'static str {
    let locale = locale
        .trim_matches('"')
        .to_ascii_lowercase()
        .replace('_', "-");
    let mut tags = core::iter::successors(Some(&*locale), |it| Some(it.rsplit_once('-')?.0));
    tags.find_map(|tag| QUOTES.iter().find(|it| it.1.split(' ').any(|it| it == tag)))
        .map_or("“”‘’", |it| it.0)
}

#[derive(Default)]
struct Counters {
    /// The name, the value, and the parent of the element that made it.
    in_scope: Vec<(Str, i32, NodeId)>,
    /// Those before this are outside of the nearest style containment.
    contained_from: usize,
    quote_depth: usize,
}

impl Counters {
    fn reset(&mut self, name: &Str, value: i32, parent: NodeId) {
        match self.in_scope[self.contained_from..]
            .iter_mut()
            .rfind(|it| it.0 == *name)
            .filter(|it| it.2 == parent)
        {
            Some(sibling) => sibling.1 = value,
            None => self.in_scope.push((Rc::clone(name), value, parent)),
        }
    }

    fn change(&mut self, name: &Str, parent: NodeId, change: impl FnOnce(i32) -> i32) {
        match self.in_scope[self.contained_from..]
            .iter_mut()
            .rfind(|it| it.0 == *name)
        {
            Some(counter) => counter.1 = change(counter.1),
            None => self.reset(name, change(0), parent),
        }
    }

    fn text(
        &mut self,
        item: &ContentItem,
        style: &Style,
        locale: &str,
        represent: impl Fn(i32, &ListStyleType) -> String,
    ) -> String {
        match item {
            ContentItem::String(string) => string.to_string(),
            ContentItem::Image(_) => String::new(),
            ContentItem::Counter(name, separator, kind) => {
                let values: Vec<_> = self
                    .in_scope
                    .iter()
                    .filter(|it| it.0 == *name)
                    .map(|it| represent(it.1, kind))
                    .collect();
                match (separator, values.last()) {
                    (_, None) => represent(0, kind),
                    (None, Some(last)) => last.clone(),
                    (Some(separator), _) => values.join(separator),
                }
            }
            ContentItem::Quote { open, visible } => {
                if !open {
                    let Some(depth) = self.quote_depth.checked_sub(1) else {
                        return String::new();
                    };
                    self.quote_depth = depth;
                }
                let side = usize::from(!open);
                let quote = match &style.text.quotes.0 {
                    _ if !visible => String::new(),
                    None => quotes_for(locale)
                        .chars()
                        .skip(self.quote_depth.min(1) * 2 + side)
                        .take(1)
                        .collect(),
                    Some(quotes) => {
                        let pair = self.quote_depth.min((quotes.len() / 2).saturating_sub(1));
                        quotes
                            .get(pair * 2 + side)
                            .map_or_else(String::new, |it| it.to_string())
                    }
                };
                self.quote_depth += usize::from(*open);
                quote
            }
        }
    }
}

impl Document {
    fn represent(&self, id: NodeId, value: i32, kind: &ListStyleType, is_marker: bool) -> String {
        match (kind, self.counter_style_of(id, kind)) {
            (ListStyleType::String(string), _) => string.to_string(),
            (_, Some((style, scope))) if is_marker => {
                style.around(&self.represent_with(&style, scope, value))
            }
            (_, Some((style, scope))) => self.represent_with(&style, scope, value),
            (ListStyleType::Named(_), None) if is_marker => format!("{value}. "),
            (ListStyleType::Named(_), None) => value.to_string(),
            _ => String::new(),
        }
    }

    /// `None` for `decimal`, too.
    fn counter_style_of(
        &self,
        id: NodeId,
        kind: &ListStyleType,
    ) -> Option<(Rc<CounterStyle>, NodeId)> {
        match kind {
            ListStyleType::Named(name) if **name != *"decimal" => {
                self.counter_style(self.tree[id].scope, name)
            }
            ListStyleType::Symbols(style) => Some((Rc::clone(style), 0)),
            _ => None,
        }
    }

    fn set_generated_text(&mut self, id: NodeId, text: String) {
        if self.tree[id].text() != Some(text.as_bytes()) {
            self.tree[id].data = Data::Text(text.into_bytes());
            self.mark_rebuild(self.tree[id].parent);
        }
    }

    /// For the accessible name.
    pub(crate) fn generated_text(&self, id: NodeId, pseudo: &[u8]) -> Vec<u8> {
        let index = match pseudo {
            b"::before" => BEFORE,
            b"::after" => AFTER,
            _ => MARKER,
        };
        let generated = self.tree.element(id).map_or(0, |it| it.generated[index]);
        let Some(style) = self
            .tree
            .style(generated)
            .filter(|it| it.is_visible() && it.rare.content != Content::Normal)
        else {
            return Vec::new();
        };
        if let (Content::Items(_, Some(_)), Some(alt)) =
            (&style.rare.content, self.counter_users.get(&generated))
        {
            return [b" ", alt.as_bytes(), b" "].concat();
        }
        let space: &[u8] = if style.display() == Display::Inline {
            b""
        } else {
            b" "
        };
        let texts = self
            .tree
            .children(generated)
            .filter_map(|it| self.tree[it].text());
        core::iter::once(space)
            .chain(texts)
            .chain([space])
            .collect::<Vec<_>>()
            .concat()
    }

    fn append_generated(&mut self, parent: NodeId, data: Data) -> NodeId {
        let child = self.tree.create(data);
        self.tree.link(parent, child, 0);
        self.tree[child].scope = self.tree[parent].scope;
        child
    }

    fn append_generated_image(&mut self, parent: NodeId, image: &Image, style: &Style) {
        let mut element = Element::new(name!(""), Namespace::Html);
        element.style = Some(self.anonymous_style(style, Display::InlineBlock));
        let is_marker = self
            .tree
            .element(parent)
            .is_some_and(|it| it.pseudo == crate::selector::Pseudo::Marker);
        let child = self.append_generated(parent, Data::Element(Box::new(element)));
        let shown = self.show_image(child, image, if is_marker { None } else { Some(0.0) });
        self.tree
            .element_mut(child)
            .into_iter()
            .for_each(|it| it.replaced = Some(shown));
    }

    /// `size` is that of an image that is drawn.
    fn show_image(&mut self, id: NodeId, image: &Image, size: Option<f32>) -> Replaced {
        self.generated_images.remove(&id);
        self.drawn_images.remove(&id);
        if let Some((Image::Url(url), resolution)) =
            image.chosen(self.environment.scale * self.environment.zoom)
        {
            self.generated_images
                .insert(id, (Rc::clone(url), resolution));
            return self.image(url).map_or(
                Replaced {
                    size: [Some(0.0); 2],
                    ..Default::default()
                },
                |it| it.at_resolution(resolution),
            );
        }
        self.drawn_images.insert(id, image.clone());
        Replaced {
            size: [size; 2],
            ..Default::default()
        }
    }

    /// An element whose `content` is one image is replaced by it.
    pub(crate) fn update_replacement(&mut self, id: NodeId, style: &Style) {
        let Some(element) = self
            .tree
            .element(id)
            .filter(|it| !it.is_generated() && it.namespace == Namespace::Html)
        else {
            return;
        };
        match &style.rare.content {
            Content::Items(items, _) if let [ContentItem::Image(image)] = &**items => {
                self.replacements.entry(id).or_insert(element.replaced);
                let shown = self.show_image(id, image, Some(0.0));
                self.set_replaced(id, Some(shown));
            }
            _ => self.end_replacement(id),
        }
    }

    pub(crate) fn end_replacement(&mut self, id: NodeId) {
        let Some(own) = self.replacements.remove(&id) else {
            return;
        };
        self.generated_images.remove(&id);
        self.drawn_images.remove(&id);
        self.set_replaced(id, own);
    }

    /// What the element shows by itself.
    pub(crate) fn set_own_replaced(&mut self, id: NodeId, replaced: Option<Replaced>) {
        match self.replacements.get_mut(&id) {
            Some(own) => *own = replaced,
            None => self.set_replaced(id, replaced),
        }
    }

    /// Makes the children of a pseudo-element. Those of a marker without `content` are left to `number_list_items`.
    pub(crate) fn generate_content(&mut self, id: NodeId, style: &Style) {
        if self
            .tree
            .element(id)
            .is_some_and(|it| matches!(it.pseudo, crate::selector::Pseudo::Transition(..)))
        {
            return;
        }
        while self.tree[id].first_child != 0 {
            self.remove(self.tree[id].first_child);
        }
        self.counter_users.remove(&id);
        let Content::Items(items, alt) = &style.rare.content else {
            if let Some(image) = &style.text.list_image.0 {
                self.append_generated_image(id, image, style);
                self.append_generated(id, Data::Text(b" ".to_vec()));
            }
            return;
        };
        if alt.is_some() {
            self.counter_users.insert(id, String::new());
            self.counters_are_stale = true;
        }
        for item in items.iter() {
            match item {
                ContentItem::Image(image) => self.append_generated_image(id, image, style),
                ContentItem::String(string) => {
                    _ = self.append_generated(id, Data::Text(string.as_bytes().to_vec()))
                }
                _ => {
                    self.append_generated(id, Data::Text(Vec::new()));
                    self.counter_users.insert(id, String::new());
                    self.counters_are_stale = true;
                }
            }
        }
    }

    pub(crate) fn number_list_items(&mut self, parent: NodeId, children: &[Child]) {
        let items = children.iter().filter_map(|child| match child {
            Child::Element(id, style) if style.display().is_list_item() => Some(*id),
            _ => None,
        });
        let has_items = items.clone().next().is_some();
        if !has_items && self.deep_lists.is_empty() {
            return;
        }
        let list = core::iter::once(parent)
            .chain(self.tree.flat_ancestors(parent))
            .find(|it| self.owns_items(*it))
            .unwrap_or(parent);
        if has_items && list != parent {
            self.deep_lists.insert(list);
        }
        match self.deep_lists.contains(&list) {
            true => self.stale_lists.push(list),
            false => self.number(list, items),
        }
    }

    pub(crate) fn number_deep_lists(&mut self) {
        let mut lists = core::mem::take(&mut self.stale_lists);
        lists.sort_unstable();
        lists.dedup();
        for list in lists {
            let (mut items, mut pending) = (Vec::new(), vec![list]);
            while let Some(id) = pending.pop() {
                let Some(style) = self
                    .tree
                    .style(id)
                    .filter(|it| it.display() != Display::None)
                else {
                    continue;
                };
                items.extend((id != list && style.display().is_list_item()).then_some(id));
                if id == list || !self.owns_items(id) {
                    let first = pending.len();
                    pending.extend(self.tree.flat_children(id));
                    pending[first..].reverse();
                }
            }
            self.number(list, items.iter().copied());
        }
    }

    fn number(&mut self, list: NodeId, items: impl Iterator<Item = NodeId> + Clone) {
        let ordered = self
            .tree
            .element(list)
            .filter(|it| it.html_tag() == name!("ol"));
        let step = if ordered.is_some_and(|it| it.has(name!("reversed"))) {
            -1
        } else {
            1
        };
        let start = ordered.and_then(|it| it.number(name!("start")));
        let of_items = |all: &[Counter], missing| {
            all.iter()
                .filter(|it| &*it.0 == "list-item")
                .map(|it| it.1.unwrap_or(missing))
                .collect::<Vec<i32>>()
        };
        let first = start.map_or_else(
            || {
                if step < 0 {
                    items.clone().count() as i32
                } else {
                    1
                }
            },
            |it| it as i32,
        );
        let reset = self
            .tree
            .style(list)
            .and_then(|it| of_items(&it.rare.counter_reset, 0).pop());
        let mut last = reset.unwrap_or_else(|| first.saturating_sub(step));
        for element in items.filter_map(|it| self.tree.element(it)) {
            let Some(rare) = element.style.as_ref().map(|it| &it.rare) else {
                continue;
            };
            let value = || {
                element
                    .number(name!("value"))
                    .filter(|_| element.html_tag() == name!("li"))
                    .map(|it| it as i32)
            };
            let added = of_items(&rare.counter_increment, 1)
                .into_iter()
                .reduce(i32::saturating_add)
                .unwrap_or(step);
            let next = || {
                of_items(&rare.counter_reset, 0)
                    .pop()
                    .unwrap_or(last)
                    .saturating_add(added)
            };
            last = of_items(&rare.counter_set, 0)
                .pop()
                .or_else(value)
                .unwrap_or_else(next);
            self.ordinals.push((element.generated[MARKER], last));
        }
        for (marker, value) in core::mem::take(&mut self.ordinals) {
            let Some(style) = self.tree.style(marker) else {
                continue;
            };
            if style.rare.content != Content::Normal
                || style.text.list_image.0.is_some()
                || is_disclosure(style)
                || is_named(style, &["disc", "circle", "square"])
            {
                continue;
            }
            let text = self.represent(marker, value, &style.text.list_type, true);
            match self.tree[marker].first_child {
                0 => {
                    self.append_generated(marker, Data::Text(text.into_bytes()));
                    self.mark_parent_rebuild(marker);
                }
                child if self.tree[child].text() == Some(text.as_bytes()) => {}
                child => self.set_generated_text(child, text),
            }
        }
    }

    pub(crate) fn update_counters(&mut self) {
        if core::mem::take(&mut self.counters_are_stale) && !self.counter_users.is_empty() {
            let mut texts = Vec::new();
            self.count(DOCUMENT, &mut Counters::default(), &mut texts);
            for (id, text) in texts {
                match self.counter_users.get_mut(&id) {
                    Some(alt) => *alt = text,
                    None => self.set_generated_text(id, text),
                }
            }
        }
    }

    fn apply_counters(&self, id: NodeId, style: &Style, parent: NodeId, counters: &mut Counters) {
        let (rare, list_item) = (&style.rare, || Str::from("list-item"));
        let mentions_items = |all: &[Counter]| all.iter().any(|it| &*it.0 == "list-item");
        let number = |name| {
            self.tree
                .element(id)
                .and_then(|it| it.number(name))
                .map(|it| it as i32)
        };
        if crate::name::is_name!(self.tree.html_tag(id), "ol" | "ul" | "menu")
            && !mentions_items(&rare.counter_reset)
        {
            let (start, step) = self.list_start(id);
            counters.reset(&list_item(), start.saturating_sub(step), parent);
        }
        rare.counter_reset
            .iter()
            .for_each(|it| counters.reset(&it.0, it.1.unwrap_or(0), parent));
        if style.display().is_list_item() && !mentions_items(&rare.counter_increment) {
            let step = self.list_step(self.list_of(id));
            counters.change(&list_item(), parent, |value| value.saturating_add(step));
        }
        for it in rare.counter_increment.iter() {
            counters.change(&it.0, parent, |value| {
                value.checked_add(it.1.unwrap_or(1)).unwrap_or(value)
            });
        }
        if let Some(value) = number(name!("value"))
            .filter(|_| self.tree.html_tag(id) == name!("li") && !mentions_items(&rare.counter_set))
        {
            counters.change(&list_item(), parent, |_| value);
        }
        rare.counter_set
            .iter()
            .for_each(|it| counters.change(&it.0, parent, |_| it.1.unwrap_or(0)));
    }

    fn list_of(&self, item: NodeId) -> NodeId {
        self.tree
            .flat_ancestors(item)
            .find(|it| self.owns_items(*it))
            .unwrap_or_else(|| self.tree.flat_parent(item))
    }

    fn owns_items(&self, id: NodeId) -> bool {
        let is_list = crate::name::is_name!(self.tree.html_tag(id), "ol" | "ul" | "menu");
        self.tree.style(id).is_some_and(|it| {
            it.display() != Display::Contents && (is_list || it.contain().contains(Contain::STYLE))
        })
    }

    fn list_step(&self, list: NodeId) -> i32 {
        let is_reversed = self
            .tree
            .element(list)
            .is_some_and(|it| it.html_tag() == name!("ol") && it.has(name!("reversed")));
        if is_reversed { -1 } else { 1 }
    }

    /// The first ordinal, and what is added to it for each item.
    fn list_start(&self, list: NodeId) -> (i32, i32) {
        let start = self
            .tree
            .element(list)
            .filter(|it| it.html_tag() == name!("ol"))
            .and_then(|it| it.number(name!("start")));
        let is_item = |it: &NodeId| {
            self.tree
                .style(*it)
                .is_some_and(|it| it.display().is_list_item())
                && self.list_of(*it) == list
        };
        let step = self.list_step(list);
        (
            start.map_or_else(
                || {
                    if step < 0 {
                        self.tree.descendants(list).filter(is_item).count() as i32
                    } else {
                        1
                    }
                },
                |it| it as i32,
            ),
            step,
        )
    }

    fn count(&self, parent: NodeId, counters: &mut Counters, texts: &mut Vec<(NodeId, String)>) {
        let outer = counters.in_scope.len();
        self.count_children(parent, parent, outer, counters, texts);
        counters.in_scope.truncate(outer);
    }

    /// `parent` is what has the boxes of the children of `of`.
    fn count_children(
        &self,
        of: NodeId,
        parent: NodeId,
        outer: usize,
        counters: &mut Counters,
        texts: &mut Vec<(NodeId, String)>,
    ) {
        for id in self
            .carousels
            .markers_of(of)
            .into_iter()
            .chain(self.rendered_children(of))
        {
            let Some(style) = self
                .tree
                .style(id)
                .filter(|it| it.display() != Display::None)
            else {
                continue;
            };
            let (rare, contained) = (&style.rare, (counters.contained_from, counters.quote_depth));
            if style.display() == Display::Contents && !self.counter_users.contains_key(&id) {
                self.count_children(id, parent, outer, counters, texts);
                continue;
            }
            if style.display() != Display::Contents {
                self.apply_counters(id, style, parent, counters);
            }
            let is_contained =
                style.contain().contains(Contain::STYLE) && style.display() != Display::Contents;
            if is_contained {
                counters.contained_from = counters.in_scope.len();
            }
            match &rare.content {
                Content::Items(items, alt) if self.counter_users.contains_key(&id) => {
                    let represent =
                        |value, kind: &ListStyleType| self.represent(id, value, kind, false);
                    let outside = Some(of)
                        .filter(|it| self.tree.html_tag(*it) == name!("q"))
                        .and_then(|it| self.tree.style(self.tree.flat_parent(it)));
                    let locale = &outside.unwrap_or(style).font.locale.0;
                    for (item, child) in items.iter().zip(self.tree.children(id)) {
                        if self.tree[child].text().is_some() {
                            texts.push((child, counters.text(item, style, locale, represent)));
                        }
                    }
                    if let Some(alt) = alt {
                        texts.push((
                            id,
                            alt.iter()
                                .map(|it| counters.text(it, style, locale, represent))
                                .collect(),
                        ));
                    }
                }
                _ => self.count(id, counters, texts),
            }
            if is_contained {
                (counters.contained_from, counters.quote_depth) = contained;
            }
            let (above, own) = counters.in_scope.split_at(outer);
            let from = counters.contained_from.min(outer);
            if own
                .iter()
                .any(|it| above[from..].iter().any(|above| above.0 == it.0))
            {
                let own = counters.in_scope.split_off(outer);
                let kept: Vec<_> = own
                    .into_iter()
                    .filter(|it| {
                        !counters.in_scope[from..]
                            .iter()
                            .any(|above| above.0 == it.0)
                    })
                    .collect();
                counters.in_scope.extend(kept);
            }
        }
    }
}
