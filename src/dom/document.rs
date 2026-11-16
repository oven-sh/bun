//! A document: what changes it, and what brings its styles and its layout up to date.

use core::cell::{Cell, RefCell};
use core::hash::BuildHasherDefault;
use std::rc::Rc;

use crate::abi;
use crate::animation::Animations;
use crate::boxes::{BoxId, Boxes, VIEWPORT};
use crate::cascade::Stylist;
use crate::color::Color;
use crate::editing::Marks;
use crate::name::{FastHasher, Map, Name, Set, is_name, name};
use crate::platform::{Fonts, Shaped};
use crate::properties::{Id, Style, initial_groups};
use crate::rules::{Classes, RuleSet};
use crate::scroll::Scrolling;
use crate::segments::Pictures;
use crate::selector::{List, Pseudo, filter, key};
use crate::sheet::{AtKind, Defined, FontFace, Prepared, Sheet, Within};
use crate::tree::{Attribute, DOCUMENT, Data, Element, Flags, Namespace, NodeId, Replaced, Tree};
use crate::types::{Contain, Families};
use crate::values::{Css, Ctx, Deps, Out, P, RootUnits, Str, commas, integer, parse_all};

#[derive(Clone, PartialEq)]
pub(crate) struct Environment {
    pub(crate) viewport: [f32; 2],
    pub(crate) screen: [f32; 2],
    /// Device pixels per CSS pixel.
    pub(crate) scale: f32,
    pub(crate) zoom: f32,
    pub(crate) dark: bool,
    /// What `color-scheme: normal` stands for.
    pub(crate) color_scheme: crate::types::ColorScheme,
    pub(crate) reduced_motion: bool,
    pub(crate) reduced_transparency: bool,
    /// In a frame with `scrolling=no`.
    pub(crate) cannot_scroll: bool,
    pub(crate) more_contrast: bool,
    pub(crate) fullscreen: bool,
    pub(crate) overlay_scrollbars: bool,
    pub(crate) is_active: bool,
    pub(crate) quirks: Quirks,
    pub(crate) has_math: bool,
    pub(crate) accent: u32,
    pub(crate) titlebar_area: Option<[f32; 4]>,
    pub(crate) root_font: RootUnits,
    /// Changes when values that were computed before are no longer right.
    pub(crate) generation: u32,
    /// Likewise, for those that depend on the viewport.
    pub(crate) viewport_generation: u32,
}

impl Environment {
    pub(crate) fn is_dark(&self, scheme: crate::types::ColorScheme) -> bool {
        use crate::types::ColorScheme;
        let scheme = if scheme.is_empty() {
            self.color_scheme
        } else {
            scheme
        };
        scheme.contains(ColorScheme::DARK) && (self.dark || !scheme.contains(ColorScheme::LIGHT))
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Quirks {
    #[default]
    None,
    Limited,
    All,
}

impl Environment {
    pub(crate) fn generations(&self) -> impl Fn(Deps) -> u32 + use<> {
        let (all, viewport) = (self.generation, self.viewport_generation);
        move |deps| {
            if deps.contains(Deps::VIEWPORT) {
                all.wrapping_add(viewport)
            } else {
                all
            }
        }
    }
}

/// About those of containers.
#[derive(Default)]
pub(crate) struct Queries {
    /// The elements that have got a style since the last layout.
    pub(crate) fresh: Vec<NodeId>,
    /// That many of them are in order, while styles change because of what layout has found.
    pub(crate) laid_out: usize,
}

pub(crate) struct Document {
    pub(crate) tree: Tree,
    pub(crate) environment: Environment,
    pub(crate) styles: Stylist,
    pub(crate) fonts: Fonts,
    pub(crate) boxes: Boxes,
    pub(crate) animations: Animations,
    pub(crate) scrolling: Scrolling,
    pub(crate) compositor: crate::compositor::Compositor,
    pub(crate) marks: Marks,
    pub(crate) pictures: Pictures,
    pub(crate) base_url: Rc<[u8]>,

    /// The names of elements and attributes.
    atoms: Map<Name, Str>,
    class_lists: Map<Name, Rc<Classes>>,
    pub(crate) sheets: Map<u32, Rc<Sheet>>,
    prepared: Vec<Prepared>,
    /// With the base URL, the media, the owner and the hash.
    unfinished_sheets: Map<u32, (Prepared, Box<[u8]>, Box<[u8]>, NodeId, u64)>,
    last_sheet: u32,
    shared_rules: Map<u64, Rc<RefCell<RuleSet>>>,
    registered_by_script: crate::custom::Registry,
    pub(crate) selectors: Map<u64, Option<List>>,
    /// How many elements have each `key::attribute` and `key::value`.
    pub(crate) attribute_keys: Map<Name, u32>,
    pub(crate) media_queries: Map<u64, crate::condition::Condition>,
    requested_fonts: Vec<Rc<FontFace>>,
    font_faces_changed: bool,
    pub(crate) shaped: RefCell<Map<u64, Rc<Shaped>>>,
    /// `None` until it has loaded.
    pub(crate) images: RefCell<Map<Str, Option<Replaced>>>,
    /// The floats that wait for them.
    shape_images: RefCell<Vec<(Str, NodeId)>>,
    pub(crate) changed_formulas: Set<NodeId>,
    pub(crate) requests: RefCell<Vec<Str>>,
    /// The elements of a JSON array.
    pub(crate) events: Out,

    pub(crate) top_layer: Vec<NodeId>,
    pub(crate) leaving_top_layer: Vec<NodeId>,
    pub(crate) containers: Set<NodeId>,
    /// And some that have been.
    pub(crate) viewport_users: Set<NodeId>,
    /// What viewport units leave out.
    pub(crate) root_scrollbars: [f32; 2],
    pub(crate) queries: Queries,
    pub(crate) carousels: crate::carousel::Carousels,
    /// Whether each is near the viewport.
    pub(crate) auto_visible: Map<NodeId, Option<bool>>,
    pub(crate) locks: crate::lock::Locks,
    pub(crate) anchored: Map<NodeId, crate::anchor::Anchoring>,
    pub(crate) anchors: Set<NodeId>,
    pub(crate) implicit_anchors: Map<NodeId, NodeId>,
    /// The `svg` elements that have what others refer to, and how often those have changed.
    /// With what refers to each.
    pub(crate) referenced_svgs: RefCell<Map<NodeId, Set<NodeId>>>,
    pub(crate) svg_generation: u32,
    /// By their data.
    pub(crate) paths: RefCell<Map<Name, crate::path::Path>>,
    /// Something outside of an `svg` has been looked for.
    pub(crate) svg_references: Cell<bool>,
    pub(crate) svg_ids: RefCell<Map<(NodeId, Name), Option<NodeId>>>,
    pub(crate) svg_budget: Cell<u32>,
    /// There has been a style for which the third dimension matters.
    pub(crate) has_depth: Cell<bool>,
    /// It is an image, or it has what another one refers to.
    pub(crate) is_embedded: bool,
    pub(crate) natural: Replaced,
    /// From `#svgView(transform())`.
    pub(crate) view_transform: crate::abi::Matrix,
    pub(crate) externals: Map<Str, Option<Box<Document>>>,
    pub(crate) wanted_externals: RefCell<Set<Str>>,
    /// How far the lines of the largest text decoration are from their text, if they do not follow from the font.
    pub(crate) decoration_reach: f32,
    pub(crate) view_transition: Option<Box<crate::view_transition::ViewTransition>>,
    pub(crate) animated_vectors: RefCell<Set<(u32, NodeId)>>,
    /// A transform may depend on a stroke that depends on the transform.
    pub(crate) is_measuring_stroke: Cell<bool>,
    pub(crate) is_measuring_text: Cell<bool>,
    pub(crate) svg_size_in_layout: Cell<Option<[f32; 2]>>,
    pub(crate) blends_in_svg: Cell<bool>,
    pub(crate) smil: crate::smil::Smil,
    /// From `currentScale` and `currentTranslate`.
    pub(crate) svg_zoom: crate::abi::Matrix,
    /// With the alternative text of their content.
    pub(crate) counter_users: Map<NodeId, String>,
    pub(crate) generated_images: Map<NodeId, (Str, f32)>,
    pub(crate) drawn_images: Map<NodeId, crate::types::Image>,
    /// What `content` hides.
    pub(crate) replacements: Map<NodeId, Option<Replaced>>,
    pub(crate) stale_directions: Set<NodeId>,
    pub(crate) has_base_selects: bool,
    pub(crate) has_auto_direction: bool,
    pub(crate) counters_are_stale: bool,
    pub(crate) needs_layout: bool,
    pub(crate) needs_frame: bool,
    pub(crate) layout_version: u32,
    /// Unlike `layout_version`, it stays when something scrolls.
    pub(crate) sizes_version: u32,

    pub(crate) doomed: Vec<BoxId>,
    pub(crate) ordinals: Vec<(NodeId, i32)>,
    /// Lists with items that are not their children.
    pub(crate) deep_lists: Set<NodeId>,
    pub(crate) stale_lists: Vec<NodeId>,
    /// How many of the layouts in progress only compute a size.
    pub(crate) measuring: u32,
    pub(crate) layout_pass: u32,
    pub(crate) moved_boxes_in_scrollers: Vec<BoxId>,
    pub(crate) changed_scrollbars: Vec<BoxId>,
    pub(crate) resized_scrollers: Vec<NodeId>,
    /// The elements whose transforms have changed.
    pub(crate) moved_boxes: Vec<NodeId>,
}

fn initial_style(fonts: &Fonts) -> Style {
    let groups = initial_groups();
    let font_id = fonts.describe(&groups, &Default::default());
    Style {
        metrics: fonts.metrics(font_id, groups.font.size.0),
        groups,
        customs: Default::default(),
        deps: Deps::empty(),
        font_id,
        zoom: 1.0,
        dark: false,
        has_absolute_font_size: false,
        was_inline: false,
        is_atomic: false,
        computed_sides: (crate::types::Float::None, crate::types::Clear::None),
        look: crate::theme::Look::None,
        plainness: Default::default(),
        animates: Default::default(),
    }
}

fn count_down(counts: &mut Map<Name, u32>, key: Name) {
    if key != Name::NONE
        && let Some(count) = counts.get_mut(&key)
    {
        *count -= 1;
        if *count == 0 {
            counts.remove(&key);
        }
    }
}

impl Document {
    pub(crate) fn new(font_scope: u32, base_url: &[u8]) -> Document {
        let fonts = Fonts::new(font_scope);
        let initial = initial_style(&fonts);
        let environment = Environment {
            viewport: [800.0, 600.0],
            screen: [800.0, 600.0],
            scale: 1.0,
            zoom: 1.0,
            dark: false,
            color_scheme: Default::default(),
            quirks: Quirks::None,
            has_math: false,
            reduced_motion: false,
            reduced_transparency: false,
            cannot_scroll: false,
            more_contrast: false,
            fullscreen: false,
            overlay_scrollbars: false,
            is_active: true,
            accent: 0x0075_ffff,
            titlebar_area: None,
            root_font: initial.root_units(),
            generation: 0,
            viewport_generation: 0,
        };
        let styles = Stylist::new(&environment, initial);
        let mut tree = Tree::new();
        tree[DOCUMENT].layout_box = VIEWPORT;
        Document {
            boxes: Boxes::new(&styles.initial),
            tree,
            environment,
            styles,
            fonts,
            animations: Default::default(),
            scrolling: Default::default(),
            compositor: Default::default(),
            marks: Default::default(),
            pictures: Pictures::default(),
            base_url: base_url.into(),
            atoms: Default::default(),
            class_lists: Default::default(),
            sheets: Default::default(),
            prepared: Vec::new(),
            unfinished_sheets: Default::default(),
            last_sheet: 0,
            shared_rules: Default::default(),
            registered_by_script: Default::default(),
            selectors: Default::default(),
            attribute_keys: Default::default(),
            media_queries: Default::default(),
            requested_fonts: Vec::new(),
            font_faces_changed: false,
            shaped: Default::default(),
            images: Default::default(),
            shape_images: Default::default(),
            changed_formulas: Default::default(),
            requests: Default::default(),
            events: Out::new(),
            top_layer: Vec::new(),
            leaving_top_layer: Vec::new(),
            containers: Default::default(),
            viewport_users: Default::default(),
            root_scrollbars: [0.0; 2],
            queries: Default::default(),
            carousels: Default::default(),
            auto_visible: Default::default(),
            locks: Default::default(),
            anchored: Default::default(),
            anchors: Default::default(),
            implicit_anchors: Default::default(),
            referenced_svgs: Default::default(),
            svg_generation: 0,
            paths: Default::default(),
            svg_references: Cell::new(false),
            svg_ids: Default::default(),
            svg_budget: Cell::new(0),
            has_depth: Cell::new(false),
            is_embedded: false,
            natural: Replaced::default(),
            view_transform: crate::types::IDENTITY,
            externals: Default::default(),
            wanted_externals: Default::default(),
            decoration_reach: 0.0,
            view_transition: None,
            animated_vectors: Default::default(),
            is_measuring_stroke: Cell::new(false),
            is_measuring_text: Cell::new(false),
            svg_size_in_layout: Cell::new(None),
            blends_in_svg: Cell::new(false),
            smil: Default::default(),
            svg_zoom: crate::types::IDENTITY,
            counter_users: Default::default(),
            generated_images: Default::default(),
            drawn_images: Default::default(),
            replacements: Default::default(),
            stale_directions: Default::default(),
            has_base_selects: false,
            has_auto_direction: false,
            counters_are_stale: false,
            needs_layout: true,
            needs_frame: false,
            layout_version: 0,
            sizes_version: 0,
            doomed: Vec::new(),
            ordinals: Vec::new(),
            deep_lists: Set::default(),
            stale_lists: Vec::new(),
            measuring: 0,
            layout_pass: 0,
            moved_boxes_in_scrollers: Vec::new(),
            changed_scrollbars: Vec::new(),
            resized_scrollers: Vec::new(),
            moved_boxes: Vec::new(),
        }
    }

    /// `rest` is JSON that starts with a comma.
    pub(crate) fn emit(&mut self, kind: &str, node: NodeId, rest: &str) {
        let separator = if self.events.is_empty() { "" } else { "," };
        self.events
            .extend(format!("{separator}[\"{kind}\",{node}{rest}]").bytes());
    }

    pub(crate) fn feature_changed(&mut self, id: NodeId, feature: Name) {
        if self.tree[id].scope != 0 {
            self.styles
                .dependencies
                .get_mut()
                .feature_changed(&self.tree, id, feature);
        }
    }

    // ───────────────────────────── the tree ─────────────────────────────

    pub(crate) fn attach_shadow(&mut self, host: NodeId, user_agent: bool) -> NodeId {
        let root = self.tree.create(Data::ShadowRoot { host, user_agent });
        self.tree[root].scope = root;
        let children: Vec<_> = self.tree.children(host).collect();
        children
            .into_iter()
            .for_each(|child| self.stop_rendering(child));
        if let Some(element) = self.tree.element_mut(host) {
            element.shadow_root = root;
        }
        self.tree[host].set(Flags::REDIRECTS_CHILDREN);
        self.tree.forget_unskipped();
        self.mark_parent_rebuild(host);
        self.mark_rebuild(host);
        root
    }

    fn children_changed(&mut self, child: NodeId) {
        let parent = self.tree[child].parent;
        self.text_changed_in(parent);
        if self.tree[parent].scope == 0 {
            return;
        }
        self.styles
            .dependencies
            .get_mut()
            .children_changed(&self.tree, child);
        if self.tree[parent].has(Flags::COUNTED_CHILDREN) {
            for it in self.tree.element_children(parent) {
                self.tree
                    .mark_style(it, Flags::REMATCH_SUBTREE | Flags::RECASCADE);
                let generated = self.tree.element(it).map_or([0; 4], |it| it.generated);
                generated
                    .into_iter()
                    .filter(|it| *it != 0)
                    .for_each(|it| self.tree.mark_style(it, Flags::RECASCADE));
                self.container_changed(it, false);
            }
        }
        (self.counters_are_stale, self.marks.are_stale) = (true, true);
        self.svg_changed(parent);
    }

    fn start_rendering(&mut self, id: NodeId) {
        match self.tree[id].data {
            Data::Text(_) => self.mark_parent_rebuild(id),
            _ => self.tree.mark_style(id, Flags::REMATCH),
        }
    }

    /// Forgets the styles, the boxes and the animations of the node and of what is in it.
    pub(crate) fn stop_rendering(&mut self, id: NodeId) {
        if self.tree[id].layout_box != 0 || self.tree.style(id).is_some() {
            self.mark_parent_rebuild(id);
        }
        self.detach_box(id);
        self.forget_style(id);
    }

    pub(crate) fn forget_style(&mut self, id: NodeId) {
        let Some(element) = self.tree.element_mut(id) else {
            self.tree[id].layout_box = 0;
            return;
        };
        (element.rules, element.base_style, element.container_size) = (None, None, None);
        element.scroll = [0.0; 2];
        if element.style.take().is_some() {
            self.forget_styles_below(id);
            self.cancel_css_animations(id);
            self.anchored.remove(&id);
            if self.tree[id].has(Flags::HAS_ANSWERED) {
                self.tree[id].unset(Flags::HAS_ANSWERED);
                self.styles.answers.get_mut().remove(&id);
            }
            self.auto_visible.remove(&id);
            for set in [
                &mut self.containers,
                &mut self.locks.remembering,
                &mut self.anchors,
            ] {
                set.remove(&id);
            }
        }
        self.detach_box(id);
        self.tree[id].unset(
            Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS | Flags::REBUILD | Flags::REBUILD_BELOW,
        );
        self.forget_lock(id);
    }

    pub(crate) fn forget_styles_below(&mut self, id: NodeId) {
        let generated = self
            .tree
            .element_mut(id)
            .map_or([0; 4], |it| core::mem::take(&mut it.generated));
        generated
            .into_iter()
            .filter(|it| *it != 0)
            .for_each(|it| self.free_subtree(it));
        if self.carousels.has(id) {
            self.drop_scroll_parts(id);
        }
        let children: Vec<_> = self.tree.flat_children(id).collect();
        children
            .into_iter()
            .for_each(|child| self.forget_style(child));
    }

    fn unlink(&mut self, id: NodeId) {
        self.stop_rendering(id);
        if self.tree[id].parent != 0 {
            self.children_changed(id);
        }
        let slot = core::mem::take(&mut self.tree[id].slot);
        if let Some(slot) = self.tree.element_mut(slot) {
            slot.assigned.retain(|it| *it != id);
        }
        self.tree.unlink(id);
    }

    pub(crate) fn insert(&mut self, parent: NodeId, child: NodeId, before: NodeId) {
        if self.tree[child].parent != 0 {
            self.unlink(child);
        }
        self.tree.link(parent, child, before);
        let scope = self.tree[parent].scope;
        if self.tree[child].scope != scope {
            let descendants: Vec<_> = self.tree.descendants(child).chain([child]).collect();
            for id in descendants {
                self.tree[id].scope = scope;
                if self.tree.element(id).is_some_and(|it| {
                    is_name!(
                        it.tag,
                        "td" | "th" | "colgroup" | "thead" | "tbody" | "tfoot" | "svg"
                    )
                }) {
                    self.update_hints(id);
                } else if self.tree.element(id).is_some_and(crate::smil::is_animation) {
                    self.smil.changed(id);
                }
            }
        }
        if scope != 0 || matches!(self.tree[parent].data, Data::Root) {
            self.update_derived_state(child, true);
        }
        self.children_changed(child);
        self.start_rendering(child);
    }

    /// Animations go on, and transitions start from the styles it has.
    pub(crate) fn move_node(&mut self, parent: NodeId, child: NodeId, before: NodeId) {
        let is_shown = |id: NodeId| {
            self.tree
                .style(id)
                .is_some_and(|it| it.display() != crate::types::Display::None)
        };
        let host_or_parent = Some(self.tree.host_of(parent))
            .filter(|it| *it != 0)
            .unwrap_or(parent);
        let redirects = |id: NodeId| self.tree[id].has(Flags::REDIRECTS_CHILDREN);
        if !is_shown(child)
            || !is_shown(host_or_parent)
            || redirects(parent)
            || redirects(self.tree[child].parent)
            || self.tree[child].scope != self.tree[parent].scope
        {
            return self.insert(parent, child, before);
        }
        self.mark_parent_rebuild(child);
        let mut ids = Vec::new();
        self.tree.visit_subtree(child, |id| {
            ids.extend(
                self.tree
                    .element(id)
                    .into_iter()
                    .flat_map(|it| it.generated)
                    .filter(|it| *it != 0),
            );
            ids.push(id);
        });
        for id in ids {
            self.detach_box(id);
            self.tree[id].unset(Flags::REBUILD | Flags::REBUILD_BELOW);
            self.forget_lock(id);
        }
        self.children_changed(child);
        self.tree.unlink(child);
        self.insert(parent, child, before);
        self.tree
            .mark_style(child, Flags::REMATCH_SUBTREE | Flags::RECASCADE_SUBTREE);
        self.mark_parent_rebuild(child);
    }

    pub(crate) fn remove(&mut self, id: NodeId) {
        self.unlink(id);
        self.free_subtree(id);
    }

    pub(crate) fn free_subtree(&mut self, root: NodeId) {
        self.forget_style(root);
        let mut ids = Vec::new();
        self.tree.visit_subtree(root, |id| ids.push(id));
        self.nodes_removed(&ids);
        for id in ids {
            if self.tree[id].text().is_some() {
                self.marks.forget(id);
                self.tree.free(id);
                continue;
            }
            let flags = self.tree[id].flags.get();
            if flags.contains(Flags::HAS_ANCHOR) {
                self.styles.has_results.get_mut().remove(&id);
            }
            if flags.intersects(Flags::ANIMATED | Flags::WATCHED_BY_TIMELINE) {
                self.orphan_animations(id);
            }
            if !self.top_layer.is_empty() {
                self.top_layer.retain(|it| *it != id);
                self.leaving_top_layer.retain(|it| *it != id);
            }
            self.implicit_anchors.remove(&id);
            if !self.deep_lists.is_empty() {
                self.deep_lists.remove(&id);
            }
            self.captured_node_freed(id);
            if !self.replacements.is_empty() && self.replacements.remove(&id).is_some() {
                self.generated_images.remove(&id);
                self.drawn_images.remove(&id);
            }
            match &self.tree[id].data {
                Data::ShadowRoot { .. } => _ = self.styles.scopes.remove(&id),
                Data::Element(element) if element.is_generated() => {
                    self.counter_users.remove(&id);
                    self.generated_images.remove(&id);
                    self.drawn_images.remove(&id);
                    self.shape_images.get_mut().retain(|it| it.1 != id);
                    self.changed_formulas.remove(&id);
                }
                Data::Element(element) if !element.assigned.is_empty() => {
                    for assigned in element.assigned.clone() {
                        self.tree[assigned].slot = 0;
                    }
                }
                _ => {}
            }
            self.stale_directions.remove(&id);
            self.scrolling.forget(id);
            self.carousels.forget(id);
            self.compositor.forget(id);
            self.marks.forget(id);
            if self
                .tree
                .element(id)
                .is_some_and(|it| it.namespace == Namespace::Svg)
            {
                self.smil.forget(id);
            }
            for it in self
                .tree
                .element(id)
                .into_iter()
                .flat_map(|it| &it.attributes)
            {
                [key::attribute(it.name), it.key]
                    .into_iter()
                    .for_each(|it| count_down(&mut self.attribute_keys, it));
            }
            self.tree.free(id);
        }
    }

    pub(crate) fn set_text(&mut self, id: NodeId, text: &[u8]) {
        let Data::Text(data) = &mut self.tree[id].data else {
            return;
        };
        let was_empty = data.is_empty();
        data.clear();
        data.extend_from_slice(text);
        let parent = self.tree[id].parent;
        if was_empty != text.is_empty() && self.tree[parent].has(Flags::EMPTINESS) {
            self.feature_changed(parent, key::STRUCTURE);
        }
        self.marks.are_stale = true;
        self.mark_parent_rebuild(id);
        self.text_changed_in(parent);
        self.slot_changed(self.tree[id].slot);
        self.svg_changed(parent);
    }

    pub(crate) fn set_attribute(&mut self, id: NodeId, qualified: &str, value: Option<&str>) {
        let (name, ignores_case) = (
            Name::new(qualified.as_bytes()),
            self.environment.quirks == Quirks::All,
        );
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        let index = element.attributes.iter().position(|it| it.name == name);
        if index.map(|it| &*element.attributes[it].value) == value {
            return;
        }
        let classes = value.filter(|_| name == name!("class")).map(|value| {
            let known = self.class_lists.entry(Name::new(value.as_bytes()));
            Rc::clone(known.or_insert_with(|| Rc::new(Classes::new(value, ignores_case))))
        });
        let shared = |value: &str| {
            classes
                .as_ref()
                .map_or_else(|| value.into(), |it| Rc::clone(&it.source))
        };
        let new_key = value.map_or(Name::NONE, |it| {
            key::value(qualified.as_bytes(), it.as_bytes())
        });
        let old_key = index.map_or(Name::NONE, |it| element.attributes[it].key);
        let own_key = |has: bool| {
            if has {
                key::attribute(name)
            } else {
                Name::NONE
            }
        };
        for (old, new) in [
            (own_key(index.is_some()), own_key(value.is_some())),
            (old_key, new_key),
        ]
        .into_iter()
        .filter(|it| it.0 != it.1)
        {
            count_down(&mut self.attribute_keys, old);
            if new != Name::NONE {
                *self.attribute_keys.entry(new).or_default() += 1;
            }
        }
        match (index, value) {
            (Some(index), Some(value)) => {
                (
                    element.attributes[index].value,
                    element.attributes[index].key,
                ) = (shared(value), new_key);
            }
            (None, Some(value)) => {
                let qualified =
                    Rc::clone(self.atoms.entry(name).or_insert_with(|| qualified.into()));
                element.attributes.reserve_exact(1);
                element.attributes.push(Attribute {
                    name,
                    qualified,
                    value: shared(value),
                    key: new_key,
                });
            }
            (index, None) => index
                .into_iter()
                .for_each(|it| _ = element.attributes.remove(it)),
        }
        let value = value.unwrap_or_default();
        let (old_id, old) = (element.id, element.classes.clone());
        if name == name!("class") {
            element.classes.clone_from(&classes);
        } else if name == name!("id") {
            element.id = if value.is_empty() {
                Name::NONE
            } else {
                Name::new(value.as_bytes())
            };
        }
        let new_id = element.id;
        self.tree[id].keys = element.classes.as_ref().map_or(0, |it| it.filter)
            | filter(key::besides_classes(element));
        self.tree[id].visit.set(0);
        if self.tree[id].scope != 0
            && (index.is_none() || new_key != Name::NONE || new_id != old_id || classes.is_some())
        {
            self.activate_rules(id);
        }
        if name == name!("class") {
            if self.tree[id].scope != 0 {
                let (old, new): (&[Name], &[Name]) = (
                    old.as_ref().map_or(&[], |it| it),
                    classes.as_ref().map_or(&[], |it| it),
                );
                let changed = old
                    .iter()
                    .filter(|it| !new.contains(it))
                    .chain(new.iter().filter(|it| !old.contains(it)));
                let dependencies = self.styles.dependencies.get_mut();
                changed.for_each(|it| {
                    dependencies.feature_changed_along_with(&self.tree, id, key::class(*it), old)
                });
            }
        } else if name == name!("id") {
            [old_id, new_id]
                .into_iter()
                .for_each(|it| self.feature_changed(id, key::id(it)));
        } else if name == name!("style") {
            let within = self.within();
            let block = self.styles.block(value.as_bytes(), within, &self.base_url);
            if let Some(element) = self.tree.element_mut(id) {
                element.inline_style = block;
            }
            self.tree.mark_style(id, Flags::REMATCH);
        }
        if self.tree[id].scope != 0 {
            [old_key, new_key]
                .into_iter()
                .filter(|it| *it != Name::NONE)
                .for_each(|it| self.feature_changed(id, it));
            self.feature_changed(id, key::attribute(Name::lowercase(qualified.as_bytes())));
            if bun_core::strings::contains_char(qualified.as_bytes(), b' ') {
                [name, name!("\0")]
                    .into_iter()
                    .for_each(|it| self.feature_changed(id, key::attribute(it)));
            }
        }
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let generated = element.generated.into_iter().filter(|it| *it != 0);
        for it in generated.chain([id]) {
            if self
                .tree
                .style(it)
                .is_some_and(|style| style.deps.contains(Deps::ATTRIBUTES))
            {
                self.tree.mark_style(it, Flags::RECASCADE);
            }
        }
        let (tag, is_math) = (element.html_tag(), element.namespace == Namespace::MathMl);
        if crate::hints::can_be_hint(element, name, qualified) {
            self.update_hints(id);
        }
        if is_math {
            self.math_changed(id);
        }
        if crate::hints::can_change_state(name) {
            self.update_derived_state(id, is_name!(tag, "fieldset" | "optgroup" | "select"));
        }
        if name == name!("dir") {
            self.text_changed_in(self.tree[id].parent);
            self.slot_changed(self.tree[id].slot);
        } else if name == name!("value") && self.tree[id].has(Flags::AUTO_DIRECTION) {
            self.stale_directions.insert(id);
        }
        if is_name!(name, "lang" | "lang http://www.w3.org/XML/1998/namespace")
            || name == name!("part")
        {
            self.tree.mark_style(id, Flags::REMATCH_SUBTREE);
        }
        if is_name!(name, "start" | "reversed" | "value") && is_name!(tag, "ol" | "li") {
            self.mark_rebuild(if tag == name!("li") {
                self.tree[id].parent
            } else {
                id
            });
            self.counters_are_stale = true;
        }
        if is_name!(
            name,
            "colspan"
                | "rowspan"
                | "span"
                | "size"
                | "cols"
                | "rows"
                | "multiple"
                | "type"
                | "viewBox"
                | "width"
                | "height"
        ) {
            self.relayout(id);
        }
        if is_name!(name, "cellpadding" | "border" | "bordercolor" | "rules")
            && tag == name!("table")
        {
            let cells: Vec<_> = self.tree.descendants(id).collect();
            cells.into_iter().for_each(|cell| self.update_hints(cell));
        }
        if name == name!("id") {
            self.id_changed(id);
        }
        if self.tree[id].scope != 0 && self.tree.element(id).is_some_and(crate::smil::is_animation)
        {
            self.smil.changed(id);
        }
        self.svg_changed(id);
    }

    pub(crate) fn relayout(&mut self, id: NodeId) {
        if let Some(own) = self.own_box(id) {
            let clipped = self.boxes[own].overflow[0] != crate::types::Overflow::Visible;
            self.update_box_style(own);
            let it = &self.boxes[own];
            if clipped != (it.overflow[0] != crate::types::Overflow::Visible)
                && it.style.layout.text_overflow != crate::types::TextOverflow::Clip
            {
                it.children
                    .clone()
                    .into_iter()
                    .for_each(|it| self.boxes[it].cache.clear());
            }
            self.boxes.mark_layout(own);
            self.needs_layout = self.needs_layout || !self.boxes.is_parked(own);
        }
    }

    pub(crate) fn set_pseudo(&mut self, id: NodeId, name: &[u8], originator: NodeId) {
        if let Some(element) = self.tree.element_mut(id) {
            (element.pseudo, element.originator) = (Pseudo::from_name(name), originator);
            self.tree.mark_style(id, Flags::REMATCH);
        }
    }

    pub(crate) fn assign_slot(&mut self, slot: NodeId, nodes: Vec<NodeId>) {
        let old: Vec<_> = self
            .tree
            .flat_children(slot)
            .filter(|it| !nodes.contains(it))
            .collect();
        for id in old {
            self.stop_rendering(id);
            self.tree[id].slot = 0;
        }
        for id in &nodes {
            let other = self.tree[*id].slot;
            if other != slot {
                self.stop_rendering(*id);
                self.tree
                    .element_mut(other)
                    .into_iter()
                    .for_each(|it| it.assigned.retain(|it| it != id));
                self.tree[*id].slot = slot;
            }
        }
        if let Some(element) = self.tree.element_mut(slot) {
            element.assigned = nodes;
        }
        self.tree[slot].set(Flags::REDIRECTS_CHILDREN);
        self.tree.forget_unskipped();
        self.slot_changed(slot);
        let new: Vec<_> = self.tree.flat_children(slot).collect();
        new.into_iter().for_each(|id| self.start_rendering(id));
        self.mark_rebuild(slot);
    }

    pub(crate) fn set_replaced(&mut self, id: NodeId, replaced: Option<Replaced>) {
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        let old = core::mem::replace(&mut element.replaced, replaced);
        self.repaint(id);
        match (old, replaced) {
            (Some(old), Some(new)) if (old.size, old.ratio) == (new.size, new.ratio) => {}
            (Some(_), Some(_)) => self.relayout(id),
            _ => {
                self.relayout(id);
                self.mark_parent_rebuild(id);
            }
        }
    }

    pub(crate) fn set_top_layer(&mut self, nodes: Vec<NodeId>) {
        self.leaving_top_layer = self
            .top_layer
            .iter()
            .copied()
            .filter(|it| !nodes.contains(it))
            .collect();
        for id in &nodes {
            if !self.top_layer.contains(id) {
                self.mark_parent_rebuild(*id);
                self.detach_box(*id);
                self.tree[*id].set(Flags::TOP_LAYER);
                self.tree.mark_style(*id, Flags::REMATCH | Flags::RECASCADE);
            }
        }
        let mut nodes = nodes.into_iter();
        let is_leaving = |it: &NodeId| self.leaving_top_layer.contains(it);
        let kept: Vec<_> = self
            .top_layer
            .iter()
            .filter_map(|it| {
                if is_leaving(it) {
                    Some(*it)
                } else {
                    nodes.next()
                }
            })
            .collect();
        self.top_layer = kept.into_iter().chain(nodes).collect();
        self.relevance_changed();
        self.mark_rebuild(DOCUMENT);
    }

    // ───────────────────────────── style sheets ─────────────────────────────

    fn within(&self) -> Within {
        if self.environment.quirks == Quirks::All {
            Within::Quirks
        } else {
            Within::Style
        }
    }

    pub(crate) fn create_sheet(
        &mut self,
        source: &[u8],
        base_url: &[u8],
        media: &[u8],
        owner: NodeId,
    ) -> u32 {
        self.last_sheet += 1;
        let hash = core::hash::BuildHasher::hash_one(
            &BuildHasherDefault::<FastHasher>::default(),
            (source, base_url, media, self.within()),
        );
        if let Some(sheet) = Sheet::shared(hash, owner) {
            self.sheets.insert(self.last_sheet, sheet);
        } else if source.len() >= Prepared::WORTHWHILE && Prepared::cannot_import(source) {
            let known = self
                .prepared
                .iter()
                .position(|it| it.source() == source)
                .map(|it| self.prepared.swap_remove(it));
            let prepared = known.unwrap_or_else(|| Prepared::new(source));
            self.unfinished_sheets.insert(
                self.last_sheet,
                (prepared, base_url.into(), media.into(), owner, hash),
            );
        } else {
            self.sheets.insert(
                self.last_sheet,
                Sheet::parse(source, base_url, media, owner, self.within()).share(hash, owner),
            );
        }
        self.last_sheet
    }

    pub(crate) fn prepare_sheet(&mut self, source: &[u8]) {
        let unfinished = self.unfinished_sheets.values().map(|it| it.0.source());
        let mut known = self
            .prepared
            .iter()
            .map(Prepared::source)
            .chain(unfinished)
            .chain(self.sheets.values().map(|it| it.source()));
        if source.len() >= Prepared::WORTHWHILE
            && self.prepared.len() < 8
            && Prepared::cannot_import(source)
            && !known.any(|it| it == source)
        {
            self.prepared.push(Prepared::new(source));
        }
    }

    pub(crate) fn has_prepared(&self, source: &[u8]) -> bool {
        self.prepared.iter().any(|it| it.source() == source)
    }

    fn finish_sheet(&mut self, id: u32) {
        if let Some((prepared, base_url, media, owner, hash)) = self.unfinished_sheets.remove(&id) {
            let sheet = Sheet::shared(hash, owner).unwrap_or_else(|| {
                Sheet::finish(prepared, &base_url, &media, owner, self.within()).share(hash, owner)
            });
            self.sheets.insert(id, sheet);
        }
    }

    pub(crate) fn sheet_source(&self, id: u32) -> &[u8] {
        let unfinished = || self.unfinished_sheets.get(&id).map(|it| it.0.source());
        self.sheets
            .get(&id)
            .map(|it| it.source())
            .or_else(unfinished)
            .unwrap_or_default()
    }

    pub(crate) fn release_sheet(&mut self, id: u32) {
        self.sheets.remove(&id);
        self.unfinished_sheets.remove(&id);
    }

    pub(crate) fn set_sheets(&mut self, scope: NodeId, ids: &[u32]) {
        ids.iter().for_each(|it| self.finish_sheet(*it));
        let sheets: Vec<_> = ids
            .iter()
            .filter_map(|id| self.sheets.get(id).cloned())
            .collect();
        let old: Vec<_> = (self.styles.scopes.get(&scope))
            .map_or(Vec::new(), |it| it.borrow().sheets().cloned().collect());
        if old.iter().map(Rc::as_ptr).eq(sheets.iter().map(Rc::as_ptr)) {
            return;
        }
        let is_in =
            |list: &[Rc<Sheet>], sheet: &Rc<Sheet>| list.iter().any(|it| Rc::ptr_eq(it, sheet));
        let changed: Vec<_> = (old.iter().filter(|it| !is_in(&sheets, it)))
            .chain(sheets.iter().filter(|it| !is_in(&old, it)))
            .collect();
        let dependencies = self.styles.dependencies.get_mut();
        let mut subjects = None;
        if scope == DOCUMENT {
            let rules = self.styles.scopes.entry(scope).or_default();
            subjects = rules
                .borrow_mut()
                .set_sheets(&sheets, &self.environment, dependencies);
            self.font_faces_changed |= changed.iter().any(|it| it.has(AtKind::FontFace));
            if changed
                .iter()
                .any(|it| it.has(AtKind::Property) || it.layers.len() > 1)
            {
                self.update_registry();
            }
        } else {
            let pointers: Vec<_> = sheets.iter().map(Rc::as_ptr).collect();
            let hash = core::hash::BuildHasher::hash_one(
                &BuildHasherDefault::<FastHasher>::default(),
                pointers,
            );
            let rules = self.shared_rules.entry(hash).or_insert_with(|| {
                let mut rules = RuleSet::default();
                rules.set_sheets(&sheets, &self.environment, dependencies);
                Rc::new(RefCell::new(rules))
            });
            self.styles.scopes.insert(scope, Rc::clone(rules));
        }
        let root = if scope == DOCUMENT {
            self.tree.root_element()
        } else {
            self.tree.host_of(scope)
        };
        if root == 0 {
            return;
        }
        self.forget_highlights();
        if changed.iter().any(|it| it.has(AtKind::CounterStyle)) {
            self.counters_are_stale = true;
            self.rebuild_everything();
        }
        if changed.iter().any(|it| it.has(AtKind::Function)) {
            self.recascade_everything();
        }
        match (subjects, self.styles.scopes.get(&scope)) {
            (Some(subjects), Some(rules)) => {
                let (mut rules, dependencies) =
                    (rules.borrow_mut(), self.styles.dependencies.get_mut());
                let mut marks: Map<_, _> = subjects
                    .into_iter()
                    .map(|key| (key, Flags::REMATCH))
                    .collect();
                for id in core::iter::once(root).chain(self.tree.descendants(root)) {
                    let Some(element) = self.tree.element(id).filter(|it| it.style.is_some())
                    else {
                        continue;
                    };
                    rules.activate(element, dependencies, |key, reaches_descendants| {
                        marks.insert(
                            key,
                            if reaches_descendants {
                                Flags::REMATCH_SUBTREE
                            } else {
                                Flags::REMATCH
                            },
                        );
                    });
                    key::of_element(element)
                        .filter_map(|key| marks.get(&key))
                        .for_each(|it| self.tree.mark_style(id, *it));
                }
            }
            _ => self.tree.mark_style(root, Flags::REMATCH_SUBTREE),
        }
        if changed
            .iter()
            .any(|it| it.has(AtKind::FontPaletteValues) || it.has(AtKind::FontFeatureValues))
        {
            self.recascade_everything();
        }
        if changed.iter().any(|it| it.has(AtKind::PositionTry)) {
            self.forget_position_options();
        }
        if changed.iter().any(|it| it.has(AtKind::Keyframes)) {
            self.tree.visit_subtree(root, |id| {
                let generated = self.tree.element(id).map_or([0; 4], |it| it.generated);
                for id in generated.into_iter().chain([id]) {
                    if self
                        .tree
                        .style(id)
                        .is_some_and(|it| it.animation.name.iter().any(|it| it.0.is_some()))
                    {
                        self.tree
                            .mark_style(id, Flags::KEYFRAMES_CHANGED | Flags::RECASCADE);
                    }
                }
            });
        }
    }

    /// With the tree that has the rule, which is `scope` or one around it.
    pub(crate) fn find_defined(
        &self,
        mut scope: NodeId,
        kind: AtKind,
        name: &str,
    ) -> Option<(Defined, NodeId)> {
        while scope != 0 {
            if let Some(found) = self
                .styles
                .scopes
                .get(&scope)
                .and_then(|it| it.borrow().defined(kind, Some(name)).pop())
            {
                return Some((found.1, scope));
            }
            scope = self.tree[self.tree.host_of(scope)].scope;
        }
        Some((
            self.styles
                .user_agent
                .borrow()
                .defined(kind, Some(name))
                .pop()?
                .1,
            0,
        ))
    }

    /// From the outermost tree to `scope`.
    fn all_defined(&self, scope: NodeId, kind: AtKind, name: Option<&str>) -> Vec<(Str, Defined)> {
        let scopes = core::iter::successors(Some(scope), |it| {
            Some(self.tree[self.tree.host_of(*it)].scope)
        })
        .take_while(|it| *it != 0);
        let scopes: Vec<_> = scopes
            .filter_map(|it| self.styles.scopes.get(&it))
            .collect();
        scopes
            .iter()
            .rev()
            .flat_map(|it| it.borrow().defined(kind, name))
            .collect()
    }

    pub(crate) fn defined_for_font(&self, id: NodeId, style: &Style) -> crate::platform::Defined {
        let mut defined = crate::platform::Defined::default();
        let used = |families: &str| {
            let listed = parse_all(families.as_bytes(), |p| Families::parse(p, &Ctx::dummy()))?;
            style
                .font
                .family
                .names()
                .find(|it| listed.names().any(|name| name.eq_ignore_ascii_case(it)))
        };
        let palette = |name: &str| match name {
            "light" => abi::PALETTE_LIGHT,
            "dark" => abi::PALETTE_DARK,
            index => index.parse().unwrap_or(0),
        };
        match style.other_if_set(Id::FontPalette) {
            Some(name) if name.starts_with("--") => {
                for (_, rule) in
                    self.all_defined(self.tree[id].scope, AtKind::FontPaletteValues, Some(name))
                {
                    let Defined::Descriptors(rule) = rule else {
                        continue;
                    };
                    let get =
                        |name: &str| rule.iter().find(|it| *it.0 == *name).map_or("", |it| &it.1);
                    let Some(family) = used(get("font-family")) else {
                        continue;
                    };
                    let entry = |p: &mut P| {
                        Some([
                            u32::try_from(integer(p, &Ctx::dummy())?).ok()?,
                            Color::parse(p, &Ctx::dummy())?.resolve(0),
                        ])
                    };
                    defined.palette_overrides =
                        parse_all(get("override-colors").as_bytes(), |p| commas(p, entry))
                            .unwrap_or_default();
                    (defined.palette_family, defined.palette) =
                        (family.to_vec(), palette(get("base-palette")));
                }
            }
            name => defined.palette = name.map_or(0, palette),
        }
        let Some(alternates) = style.other_if_set(Id::FontVariantAlternates) else {
            return defined;
        };
        let rules = self.all_defined(self.tree[id].scope, AtKind::FontFeatureValues, None);
        let values: Vec<_> = (rules.iter().filter(|it| used(&it.0).is_some()))
            .flat_map(|it| {
                if let Defined::FeatureValues(values) = &it.1 {
                    &values[..]
                } else {
                    &[]
                }
            })
            .collect();
        for function in bun_core::strings::tokenize(alternates.as_bytes(), b")") {
            let Some((kind, names)) = bun_core::strings::split_once_char(function, b'(') else {
                continue;
            };
            let kind = kind
                .rsplit(u8::is_ascii_whitespace)
                .next()
                .unwrap_or_default();
            for name in bun_core::strings::tokenize(names, b",") {
                let Some((.., numbers)) = values
                    .iter()
                    .rfind(|it| it.0.get(1..) == Some(kind) && it.1 == name.trim_ascii())
                else {
                    continue;
                };
                let numbered = |[a, b]: [u8; 2], number: u32| {
                    [
                        a,
                        b,
                        b'0' + (number / 10 % 10) as u8,
                        b'0' + (number % 10) as u8,
                    ]
                };
                let mut add = |tag, value: u32| {
                    defined.features.push(abi::FontSetting {
                        tag,
                        value: value as f32,
                    })
                };
                match (kind, &numbers[..]) {
                    (b"stylistic", [value]) => add(*b"salt", *value),
                    (b"swash", [value]) => [*b"swsh", *b"cswh"]
                        .into_iter()
                        .for_each(|tag| add(tag, *value)),
                    (b"ornaments", [value]) => add(*b"ornm", *value),
                    (b"annotation", [value]) => add(*b"nalt", *value),
                    (b"styleset", all) => all
                        .iter()
                        .filter(|it| **it < 100)
                        .for_each(|it| add(numbered(*b"ss", *it), 1)),
                    (b"character-variant", [number @ ..100, value @ ..]) => {
                        add(numbered(*b"cv", *number), *value.first().unwrap_or(&1))
                    }
                    _ => {}
                }
            }
        }
        defined
    }

    fn update_registry(&mut self) {
        let rules = self.styles.scopes.get(&DOCUMENT).map(|it| it.borrow());
        let from_sheets = rules
            .iter()
            .flat_map(|it| it.defined(AtKind::Property, None))
            .filter_map(|it| match it.1 {
                Defined::Property(registered) => {
                    Some((crate::custom::remember(it.0.as_bytes()), registered))
                }
                _ => None,
            });
        let registry = from_sheets
            .chain(self.registered_by_script.clone())
            .map(|it| (it.0, it.1.in_viewport(self.environment.viewport)))
            .collect();
        drop(rules);
        if core::mem::replace(&mut self.styles.registry, registry) != self.styles.registry {
            self.recascade_everything();
        }
    }

    pub(crate) fn register_property(
        &mut self,
        name: Name,
        registered: crate::custom::Registered,
    ) -> bool {
        let is_new = self
            .registered_by_script
            .try_insert(name, Rc::new(registered))
            .is_ok();
        self.update_registry();
        is_new
    }

    pub(crate) fn recascade_everything(&mut self) {
        self.environment.generation += 1;
        self.styles.forget_values();
        self.tree
            .mark_style(self.tree.root_element(), Flags::RECASCADE_SUBTREE);
    }

    pub(crate) fn set_environment(&mut self, new: Environment) {
        let old = core::mem::replace(&mut self.environment, new);
        let new = &self.environment;
        if old == *new {
            return;
        }
        self.needs_layout = true;
        self.marks.styles.get_mut().clear();
        match (
            old.zoom,
            old.overlay_scrollbars,
            old.scale,
            old.dark,
            old.accent,
        ) == (
            new.zoom,
            new.overlay_scrollbars,
            new.scale,
            new.dark,
            new.accent,
        ) {
            true => self.pictures.outdate(),
            false => self.pictures.discard(),
        }
        let mut affected = crate::rules::Subjects::default();
        self.styles
            .user_agent
            .get_mut()
            .evaluate_media(new, &mut affected);
        for rules in self
            .styles
            .scopes
            .get(&DOCUMENT)
            .into_iter()
            .chain(self.shared_rules.values())
        {
            rules.borrow_mut().evaluate_media(new, &mut affected);
        }
        if (old.quirks, old.has_math) != (new.quirks, new.has_math) {
            self.styles.set_user_agent_sheets(new);
            affected.is_everything |= old.quirks != new.quirks;
            self.class_lists.clear();
        }
        let root = self.tree.root_element();
        if affected.is_everything {
            self.font_faces_changed = true;
            self.tree.mark_style(root, Flags::REMATCH_SUBTREE);
        } else if root != 0 {
            affected.mark(&self.tree, root);
        }
        if old.scale != new.scale {
            self.fonts.device_scale = new.scale;
            self.fonts_changed();
        } else if (old.dark, old.accent, old.color_scheme)
            != (new.dark, new.accent, new.color_scheme)
        {
            self.recascade_everything();
        } else if (old.viewport, old.titlebar_area) != (new.viewport, new.titlebar_area) {
            self.environment.viewport_generation += 1;
            if self
                .styles
                .registry
                .values()
                .any(|it| it.depends_on_viewport())
            {
                self.update_registry();
            }
            let tree = &self.tree;
            self.viewport_users.retain(|it| {
                tree.contains(*it)
                    && tree
                        .style(*it)
                        .is_some_and(|it| it.deps.intersects(Deps::VIEWPORT | Deps::CONTAINER))
            });
            self.viewport_users
                .iter()
                .for_each(|it| tree.mark_style(*it, Flags::RECASCADE));
            let asked: Vec<NodeId> = self.styles.answers.get_mut().keys().copied().collect();
            asked
                .into_iter()
                .for_each(|it| self.container_changed(it, false));
        }
        let new = &self.environment;
        if (
            old.zoom,
            old.overlay_scrollbars,
            old.quirks,
            old.cannot_scroll,
        ) != (
            new.zoom,
            new.overlay_scrollbars,
            new.quirks,
            new.cannot_scroll,
        ) {
            self.rebuild_everything();
        }
    }

    fn rebuild_everything(&mut self) {
        self.mark_rebuild(DOCUMENT);
        for id in self
            .top_layer
            .clone()
            .into_iter()
            .chain([self.tree.root_element()])
        {
            self.detach_box(id);
        }
    }

    pub(crate) fn fonts_changed(&mut self) {
        self.fonts.forget_metrics();
        self.shaped.get_mut().clear();
        self.styles.initial = Rc::new(initial_style(&self.fonts));
        self.recascade_everything();
        self.rebuild_everything();
    }

    pub(crate) fn use_font(&mut self, family: &[u8], weight: u16, is_italic: bool) {
        let used = (
            Name::lowercase(family),
            [
                100.0,
                f32::from(is_italic) * FontFace::ITALIC,
                weight.into(),
            ]
            .map(f32::to_bits),
        );
        if self.fonts.used.get_mut().insert(used) {
            self.fonts.newly_used.get_mut().push(used);
        }
        self.request_fonts();
    }

    pub(crate) fn request_fonts(&mut self) {
        let newly_used = core::mem::take(self.fonts.newly_used.get_mut());
        let changed = core::mem::take(&mut self.font_faces_changed);
        if newly_used.is_empty() && !changed {
            return;
        }
        let Some(rules) = self.styles.scopes.get(&DOCUMENT) else {
            return;
        };
        let (faces, requests) = (rules.borrow().font_faces(), self.requests.get_mut());
        self.requested_fonts
            .retain(|face| faces.iter().any(|it| Rc::ptr_eq(it, face)));
        if changed {
            let all = faces
                .iter()
                .map(|it| &*it.json)
                .collect::<Vec<_>>()
                .join("\n");
            requests.extend(["faces".into(), all.into()]);
        }
        let used = if changed {
            self.fonts.used.get_mut().iter().copied().collect()
        } else {
            newly_used
        };
        for (family, wanted) in used {
            let of_family = || {
                faces
                    .iter()
                    .filter(|it| Name::lowercase(it.family.as_bytes()) == family)
            };
            let distance = |face: &FontFace| face.distance(wanted.map(f32::from_bits));
            let best = of_family().map(|it| distance(it)).min();
            for face in of_family().filter(|it| Some(distance(it)) == best) {
                if !self.requested_fonts.iter().any(|it| Rc::ptr_eq(it, face)) {
                    self.requested_fonts.push(Rc::clone(face));
                    requests.extend(["font".into(), Rc::clone(&face.json)]);
                }
            }
        }
    }

    /// Asks for it the first time.
    pub(crate) fn image(&self, url: &Str) -> Option<Replaced> {
        self.svg_references.set(true);
        *self
            .images
            .borrow_mut()
            .entry(Rc::clone(url))
            .or_insert_with(|| {
                self.requests
                    .borrow_mut()
                    .extend(["image".into(), Rc::clone(url)]);
                None
            })
    }

    pub(crate) fn shape_image(&self, url: &Str, user: NodeId) -> Option<Replaced> {
        let (image, mut waiting) = (self.image(url), self.shape_images.borrow_mut());
        if image.is_none() && !waiting.iter().any(|it| it.1 == user && it.0 == *url) {
            waiting.push((Rc::clone(url), user));
        }
        image.filter(|it| it.image != 0)
    }

    /// The URL says whether to ignore the orientation.
    pub(crate) fn oriented_image(&self, url: &Str, style: &Style) -> Option<Replaced> {
        match style.other_if_set(crate::properties::Id::ImageOrientation) {
            Some(_) if !self.is_cross_origin(url) => {
                self.image(&format!("unoriented:{url}").into())
            }
            _ => self.image(url),
        }
    }

    pub(crate) fn set_image(&mut self, url: &str, image: Replaced) {
        self.images.get_mut().insert(url.into(), Some(image));
        let users: Vec<_> = self
            .generated_images
            .iter()
            .filter(|it| &*it.1.0 == url)
            .map(|it| (*it.0, it.1.1))
            .collect();
        users.into_iter().for_each(|(id, resolution)| {
            self.set_replaced(id, Some(image.at_resolution(resolution)))
        });
        self.externals
            .values_mut()
            .flatten()
            .for_each(|it| it.set_image(url, image));
        let shaped: Vec<_> = self
            .shape_images
            .get_mut()
            .extract_if(.., |it| &*it.0 == url)
            .collect();
        shaped
            .into_iter()
            .for_each(|it| self.mark_parent_rebuild(it.1));
        self.referenced_svg_changed();
    }

    // ───────────────────────────── updates ─────────────────────────────

    pub(crate) fn update_layout(&mut self) {
        self.stop_forcing();
        self.update_forced_layout();
    }

    pub(crate) fn update_forced_layout(&mut self) {
        crate::layout::set_scale_of_units(self.environment.scale);
        for _ in 0..16 {
            self.update_style();
            if !self.needs_layout {
                self.update_scrollers_of_moved_boxes();
            }
            if !self.needs_layout {
                break;
            }
            if !self.carousels.is_empty() {
                self.assign_markers();
            }
            self.moved_boxes.clear();
            self.update_counters();
            let anchors = self.select_scroll_anchors();
            self.scrolling.repositioned.clear();
            self.rebuild_boxes();
            if !self.stale_lists.is_empty() {
                self.number_deep_lists();
                self.rebuild_boxes();
                self.stale_lists.clear();
            }
            self.lay_out_viewport();
            self.position_anchored_boxes();
            self.needs_layout = false;
            self.pictures.outdate();
            self.layout_version += 1;
            self.sizes_version += 1;
            if !self.carousels.is_empty() {
                self.update_column_parts();
            }
            self.adjust_scroll_positions(&anchors);
            self.update_containers();
            if self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS) {
                self.queries.fresh.sort_unstable();
                self.queries.laid_out = self.queries.fresh.len();
            }
        }
        self.queries.laid_out = 0;
        self.queries.fresh.clear();
        self.scrolling.repositioned.clear();
        self.request_fonts();
    }

    pub(crate) fn is_dirty(&self) -> bool {
        self.needs_layout
            || self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS)
            || self.styles.dependencies.borrow().has_pending()
            || !self.pictures.current().is_some_and(|it| it.is_submitted)
    }

    fn update_containers(&mut self) {
        let mut changed = Vec::new();
        for id in &self.containers {
            let contain = self
                .tree
                .style(*id)
                .map_or(Contain::empty(), |it| it.contain());
            let own = self
                .own_box(*id)
                .filter(|_| contain.intersects(Contain::SIZE | Contain::INLINE_SIZE));
            let size = own.map(|own| {
                let [_, _, width, height] = self.content_box(own);
                [width, height]
            });
            let axes = self
                .tree
                .style(*id)
                .map_or([false; 2], |it| it.queried_axes());
            if let Some(element) = self.tree.element_mut(*id) {
                let relevant = |size: Option<[f32; 2]>| {
                    size.map(|it| [0, 1].map(|axis| if axes[axis] { it[axis] } else { 0.0 }))
                };
                if relevant(element.container_size) != relevant(size) {
                    changed.push(*id);
                }
                element.container_size = size;
            }
        }
        changed
            .into_iter()
            .for_each(|id| self.container_changed(id, self.tree[id].has(Flags::IS_MEASURED)));
    }

    pub(crate) fn container_changed(&self, id: NodeId, is_resized: bool) {
        let has_new_answers = self.revise_answers(id);
        if has_new_answers || is_resized {
            self.mark_in_container(id, has_new_answers, is_resized);
        }
    }

    pub(crate) fn mark_in_container(&self, id: NodeId, has_new_answers: bool, is_resized: bool) {
        for child in self
            .rendered_children(id)
            .filter(|it| self.tree.style(*it).is_some())
        {
            let (queries, measures) = (
                self.tree[child].has(Flags::QUERIES_CONTAINER),
                self.tree[child].has(Flags::MEASURES_CONTAINER),
            );
            if measures && (is_resized || has_new_answers && queries) {
                self.tree.mark_style(child, Flags::RECASCADE);
            }
            self.mark_in_container(
                child,
                measures && is_resized && self.revise_answers(child) || has_new_answers,
                is_resized,
            );
        }
        if has_new_answers && self.tree[id].has(Flags::QUERIES_CONTAINER) {
            self.tree.mark_style(id, Flags::REMATCH);
        }
    }

    pub(crate) fn collect_garbage(&mut self) {
        let nodes = self.tree.len();
        self.styles.collect_garbage(nodes);
        let shaped = self.shaped.get_mut();
        if shaped.len() > nodes + 2048 {
            shaped.retain(|_, it| Rc::strong_count(it) > 1);
        }
        if self.class_lists.len() > nodes + 1024 {
            self.class_lists.retain(|_, it| Rc::strong_count(it) > 1);
        }
        if self.atoms.len() > 4096 {
            self.atoms.clear();
        }
        if self.shared_rules.len() > 8 {
            self.shared_rules
                .retain(|_, rules| Rc::strong_count(rules) > 1);
        }
        self.prepared.clear();
        crate::values::release_parser_memory();
    }

    pub(crate) fn create_element(&mut self, local_name: &str, namespace: Namespace) -> NodeId {
        if namespace == Namespace::MathMl && !self.environment.has_math {
            self.set_environment(Environment {
                has_math: true,
                ..self.environment.clone()
            });
        }
        let tag = Name::new(local_name.as_bytes());
        let id = self
            .tree
            .create(Data::Element(Box::new(Element::new(tag, namespace))));
        self.tree[id].keys = filter(core::iter::once(key::tag(tag)));
        id
    }
}
