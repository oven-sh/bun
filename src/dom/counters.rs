//! Generated content: list markers, counters and quotes.

use std::rc::Rc;

use bun_collections::hashbrown::HashMap;
use bun_core::strings;

use crate::boxes::Child;
use crate::counter_style::CounterStyle;
use crate::document::Document;
use crate::name::{SecretHasher, name};
use crate::order::Order as _;
use crate::properties::Style;
use crate::tree::{DOCUMENT, Data, Element, Flags, MARKER, Namespace, NodeId, Replaced};
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
    let locale = locale.trim_matches('"').to_ascii_lowercase();
    let locale = strings::replace_owned(locale.as_bytes(), b"_", b"-");
    let mut tags = core::iter::successors(Some(&*locale), |it| {
        Some(strings::rsplit_once_char(it, b'-')?.0)
    });
    tags.find_map(|tag| {
        QUOTES
            .iter()
            .find(|it| strings::split(it.1.as_bytes(), b" ").any(|it| it == tag))
    })
    .map_or("“”‘’", |it| it.0)
}

struct InScope {
    value: i32,
    /// Of the element that made it.
    parent: NodeId,
    containments: u32,
}

#[derive(Default)]
struct Counters {
    /// The names that are shown, and where they are in `in_scope`.
    shown: HashMap<Str, usize, SecretHasher>,
    in_scope: Vec<Vec<InScope>>,
    /// What ends with the parent of the element that made it.
    of_siblings: Vec<usize>,
    /// What ends with the element that made it, because it hides a counter of an ancestor.
    nested: Vec<usize>,
    /// How many elements with style containment are around.
    containments: u32,
    quote_depth: usize,
    /// Only what has `Flags::VISITED` matters.
    are_unseen: bool,
    shows_items: bool,
}

impl Counters {
    fn reset(&mut self, name: &Str, value: i32, parent: NodeId) {
        let (Some(&at), containments) = (self.shown.get(name), self.containments) else {
            return;
        };
        match self.in_scope[at]
            .last_mut()
            .filter(|it| it.containments == containments)
        {
            Some(sibling) if sibling.parent == parent => return sibling.value = value,
            Some(_) => self.nested.push(at),
            None => self.of_siblings.push(at),
        }
        self.in_scope[at].push(InScope {
            value,
            parent,
            containments,
        });
    }

    fn change(&mut self, name: &Str, parent: NodeId, change: impl FnOnce(i32) -> i32) {
        let Some(&at) = self.shown.get(name) else {
            return;
        };
        match self.in_scope[at]
            .last_mut()
            .filter(|it| it.containments == self.containments)
        {
            Some(counter) => counter.value = change(counter.value),
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
                let values = self
                    .shown
                    .get(name)
                    .map_or(&[][..], |it| &self.in_scope[*it]);
                match (separator, values.last()) {
                    (_, None) => represent(0, kind),
                    (None, Some(last)) => represent(last.value, kind),
                    (Some(separator), _) => values
                        .iter()
                        .map(|it| represent(it.value, kind))
                        .collect::<Vec<_>>()
                        .join(separator),
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

    fn set_generated_text(&mut self, id: NodeId, text: &str) {
        if self.tree[id].text() != Some(text.as_bytes()) {
            self.tree[id].data = Data::Text(text.into());
            self.mark_rebuild(self.tree[id].parent);
        }
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
        let shown = self.show_image(
            child,
            image,
            style,
            if is_marker { None } else { Some(0.0) },
        );
        self.tree
            .element_to_style(child)
            .into_iter()
            .for_each(|it| it.rare_mut().replaced = Some(shown));
    }

    /// `size` is that of an image that is drawn.
    fn show_image(
        &mut self,
        id: NodeId,
        image: &Image,
        style: &Style,
        size: Option<f32>,
    ) -> Replaced {
        self.generated_images.remove(&id);
        self.drawn_images.remove(&id);
        if let Some((Image::Url(url), resolution)) =
            image.chosen(self.environment.scale * self.environment.zoom)
        {
            let url = self.oriented_url(url, style);
            self.generated_images
                .insert(id, (Rc::clone(&url), resolution));
            return self.image(&url).map_or_else(
                || Replaced {
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

    /// An element whose `content` is one image is replaced by it, and an image that ignores its orientation by another decoding.
    pub(crate) fn update_replacement(&mut self, id: NodeId, style: &Style) {
        let Some(element) = self
            .tree
            .element(id)
            .filter(|it| !it.is_generated() && it.namespace == Namespace::Html)
        else {
            return;
        };
        let turned = element
            .attribute(name!("turned source"))
            .filter(|_| {
                style
                    .other_if_set(crate::properties::Id::ImageOrientation)
                    .is_some()
            })
            .map(|it| Image::Url(format!("unoriented:{it}").into()));
        let image = match &style.rare.content {
            Content::Items(items, _) if let [ContentItem::Image(image)] = &**items => Some(image),
            _ => turned.as_ref(),
        };
        let Some(image) = image else {
            return self.end_replacement(id);
        };
        let own = *self.replacements.entry(id).or_insert(element.replaced);
        let shown = self.show_image(id, image, style, Some(0.0));
        let is_pending =
            shown.image == 0 && turned.as_ref().is_some_and(|it| core::ptr::eq(it, image));
        self.set_replaced(id, if is_pending { own } else { Some(shown) });
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
        if let Some(style) = self
            .tree
            .style(id)
            .filter(|it| {
                it.other_if_set(crate::properties::Id::ImageOrientation)
                    .is_some()
            })
            .cloned()
        {
            self.update_replacement(id, &style);
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
                self.append_generated(id, Data::Text(" ".into()));
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
                    _ = self.append_generated(id, Data::Text((&**string).into()))
                }
                _ => {
                    self.append_generated(id, Data::Text(Default::default()));
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
        match self.list_around(parent, items.clone().next().is_some()) {
            Some((list, true)) => self.stale_lists.push(list),
            Some((list, false)) => {
                self.number(list, &items.collect::<smallvec::SmallVec<[_; 16]>>())
            }
            None => {}
        }
    }

    /// And whether it has items that are not its children.
    fn list_around(&mut self, parent: NodeId, has_items: bool) -> Option<(NodeId, bool)> {
        (has_items || !self.deep_lists.is_empty()).then_some(())?;
        let list = core::iter::once(parent)
            .chain(self.tree.flat_ancestors(parent))
            .find(|it| self.owns_items(*it))
            .unwrap_or(parent);
        if has_items && list != parent {
            self.deep_lists.insert(list);
        }
        Some((list, self.deep_lists.contains(&list)))
    }

    /// A child comes or goes without the others being made again.
    pub(crate) fn renumber_around(&mut self, parent: NodeId, is_item: bool) {
        let list = self
            .list_around(parent, is_item)
            .filter(|it| (is_item || it.1) && self.stale_lists.last() != Some(&it.0));
        self.stale_lists.extend(list.map(|it| it.0));
    }

    pub(crate) fn number_stale_lists(&mut self) {
        let mut lists = core::mem::take(&mut self.stale_lists);
        lists.order_by(Ord::cmp);
        lists.dedup();
        for list in lists {
            let (mut items, mut pending, is_deep) =
                (Vec::new(), vec![list], self.deep_lists.contains(&list));
            while let Some(id) = pending.pop() {
                let Some(style) = self
                    .tree
                    .style(id)
                    .filter(|it| it.display() != Display::None)
                else {
                    continue;
                };
                items.extend((id != list && style.display().is_list_item()).then_some(id));
                if id == list
                    || style.display() == Display::Contents
                    || is_deep && !self.owns_items(id)
                {
                    let first = pending.len();
                    pending.extend(self.tree.flat_children(id));
                    pending[first..].reverse();
                }
            }
            self.number(list, &items);
        }
    }

    fn number(&mut self, list: NodeId, items: &[NodeId]) {
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
        fn of_items(all: &[Counter], missing: i32) -> impl DoubleEndedIterator<Item = i32> {
            all.iter()
                .filter(|it| &*it.0 == "list-item")
                .map(move |it| it.1.unwrap_or(missing))
        }
        let first = start.map_or(if step < 0 { items.len() as i32 } else { 1 }, |it| {
            it as i32
        });
        let reset = self
            .tree
            .style(list)
            .and_then(|it| of_items(&it.rare.counter_reset, 0).next_back());
        let mut last = reset.unwrap_or_else(|| first.saturating_sub(step));
        for element in items.iter().filter_map(|it| self.tree.element(*it)) {
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
                .reduce(i32::saturating_add)
                .unwrap_or(step);
            let next = || {
                of_items(&rare.counter_reset, 0)
                    .next_back()
                    .unwrap_or(last)
                    .saturating_add(added)
            };
            last = of_items(&rare.counter_set, 0)
                .next_back()
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
            let digits = self.tree[self.tree[marker].first_child]
                .text()
                .and_then(|it| it.strip_suffix(b". "))
                .filter(|it| matches!(it, [b'1'..=b'9', ..]));
            if is_named(style, &["decimal"])
                && digits.and_then(|it| crate::values::text(it).parse().ok()) == Some(value)
            {
                continue;
            }
            let text = self.represent(marker, value, &style.text.list_type, true);
            match self.tree[marker].first_child {
                0 => {
                    self.append_generated(marker, Data::Text(text.as_str().into()));
                    self.mark_parent_rebuild(marker);
                }
                child if self.tree[child].text() == Some(text.as_bytes()) => {}
                child => self.set_generated_text(child, &text),
            }
        }
    }

    pub(crate) fn update_counters(&mut self) {
        if core::mem::take(&mut self.counters_are_stale) && !self.counter_users.is_empty() {
            let shown = self.counter_users.keys().filter_map(|it| {
                if let Content::Items(items, alt) = &self.tree.style(*it)?.rare.content {
                    Some(items.iter().chain(alt.iter().flat_map(|it| it.iter())))
                } else {
                    None
                }
            });
            let mut counters = Counters::default();
            for name in shown.flatten().filter_map(|it| {
                if let ContentItem::Counter(name, ..) = it {
                    Some(name)
                } else {
                    None
                }
            }) {
                let next = counters.shown.len();
                counters.shown.entry(Rc::clone(name)).or_insert(next);
            }
            counters
                .in_scope
                .resize_with(counters.shown.len(), Vec::new);
            let are_unseen = counters.shown.is_empty() && self.carousels.is_empty();
            (counters.are_unseen, counters.shows_items) =
                (are_unseen, counters.shown.contains_key("list-item"));
            let (mut texts, mut paths) = (Vec::new(), Vec::new());
            for user in self.counter_users.keys().copied().filter(|_| are_unseen) {
                let path = core::iter::once(user)
                    .chain(self.tree.flat_ancestors(user))
                    .take_while(|it| !self.tree[*it].has(Flags::VISITED));
                paths.extend(path.inspect(|it| self.tree[*it].set(Flags::VISITED)));
            }
            self.count(DOCUMENT, &mut counters, &mut texts);
            paths
                .into_iter()
                .for_each(|it| self.tree[it].unset(Flags::VISITED));
            for (id, text) in texts {
                match self.counter_users.get_mut(&id) {
                    Some(alt) => *alt = text,
                    None => self.set_generated_text(id, &text),
                }
            }
        }
    }

    fn apply_counters(&self, id: NodeId, style: &Style, parent: NodeId, counters: &mut Counters) {
        let (rare, list_item) = (&style.rare, || Str::from("list-item"));
        let mentions_items = |all: &[Counter]| all.iter().any(|it| &*it.0 == "list-item");
        let tag = if counters.shows_items {
            self.tree.html_tag(id)
        } else {
            name!("")
        };
        if crate::name::is_name!(tag, "ol" | "ul" | "menu") && !mentions_items(&rare.counter_reset)
        {
            let (start, step) = self.list_start(id);
            counters.reset(&list_item(), start.saturating_sub(step), parent);
        }
        rare.counter_reset
            .iter()
            .for_each(|it| counters.reset(&it.0, it.1.unwrap_or(0), parent));
        if counters.shows_items
            && style.display().is_list_item()
            && !mentions_items(&rare.counter_increment)
        {
            let step = self.list_step(self.list_of(id));
            counters.change(&list_item(), parent, |value| value.saturating_add(step));
        }
        for it in rare.counter_increment.iter() {
            counters.change(&it.0, parent, |value| {
                value.checked_add(it.1.unwrap_or(1)).unwrap_or(value)
            });
        }
        if let Some(value) = self
            .tree
            .element(id)
            .filter(|_| tag == name!("li") && !mentions_items(&rare.counter_set))
            .and_then(|it| it.number(name!("value")))
        {
            counters.change(&list_item(), parent, |_| value as i32);
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
        let outer = counters.of_siblings.len();
        self.count_children(parent, parent, counters, texts);
        counters
            .of_siblings
            .drain(outer..)
            .for_each(|it| _ = counters.in_scope[it].pop());
    }

    /// `parent` is what has the boxes of the children of `of`.
    fn count_children(
        &self,
        of: NodeId,
        parent: NodeId,
        counters: &mut Counters,
        texts: &mut Vec<(NodeId, String)>,
    ) {
        for id in self
            .carousels
            .markers_of(of)
            .into_iter()
            .chain(self.rendered_children(of))
        {
            if counters.are_unseen && !self.tree[id].has(Flags::VISITED) {
                continue;
            }
            let Some(style) = self
                .tree
                .style(id)
                .filter(|it| it.display() != Display::None)
            else {
                continue;
            };
            let (rare, quote_depth, outer) =
                (&style.rare, counters.quote_depth, counters.nested.len());
            if style.display() == Display::Contents && !self.counter_users.contains_key(&id) {
                self.count_children(id, parent, counters, texts);
                continue;
            }
            if style.display() != Display::Contents && !counters.are_unseen {
                self.apply_counters(id, style, parent, counters);
            }
            let is_contained =
                style.contain().contains(Contain::STYLE) && style.display() != Display::Contents;
            counters.containments += u32::from(is_contained);
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
                (counters.containments, counters.quote_depth) =
                    (counters.containments - 1, quote_depth);
            }
            counters
                .nested
                .drain(outer..)
                .for_each(|it| _ = counters.in_scope[it].pop());
        }
    }
}
