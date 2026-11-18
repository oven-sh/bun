//! A document: what changes it, and what brings its styles and its layout up to date.

use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use smallvec::SmallVec;

use crate::api::core::{Atom, DomString, Known, Meaning, Ns, StoredText, atom};
use crate::tree::Space;

use crate::abi;
use crate::animation::Animations;
use crate::boxes::{BoxId, Boxes, VIEWPORT};
use crate::cascade::Stylist;
use crate::color::Color;
use crate::declarations::InlineBlocks;
use crate::editing::Marks;
use crate::engine_event::{EngineEvent, ForNode};
use crate::font_face::{Coverage, FontFace};
use crate::name::{Map, Name, Set, is_name, keyed_hash, name};
use crate::platform::{Fonts, Shaped, Wanted};
use crate::properties::{Id, Prop, Style, initial_groups};
use crate::rules::{Classes, RuleSet};
use crate::scroll::Scrolling;
use crate::segments::Pictures;
use crate::selector::{Pseudo, Sought, filter, key};
use crate::sheet::{
    AtKind, Block, Compiling, Defined, Parameters, Prepared, Sheet, Source, Within,
};
use crate::tree::{
    Attribute, DOCUMENT, Data, Element, Flags, Gone, Likeness, Namespace, NodeId, Replaced, State,
    StyleSource, Tree,
};
use crate::types::{Contain, Families, Overflow};
use crate::values::{Css, Ctx, Deps, P, RootUnits, Str, commas, integer, parse_all};

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
    /// In an `embed` or an `object`.
    pub(crate) is_object: bool,
    pub(crate) more_contrast: bool,
    pub(crate) forces_colors: bool,
    pub(crate) fullscreen: bool,
    pub(crate) overlay_scrollbars: bool,
    pub(crate) is_active: bool,
    pub(crate) quirks: Quirks,
    pub(crate) has_math: bool,
    /// With controls or captions.
    pub(crate) has_media: bool,
    pub(crate) fixes_text_areas: bool,
    /// What the user of macOS has chosen for selected text, light and dark.
    pub(crate) highlight: [u32; 2],
    pub(crate) palette: Option<bun_web::host::Palette>,
    pub(crate) has_touch: bool,
    pub(crate) titlebar_area: Option<[f32; 4]>,
    pub(crate) root_font: RootUnits,
    pub(crate) initial_font: RootUnits,
    /// Changes when values that were computed before are no longer right.
    pub(crate) generation: u32,
    /// Likewise, for those that depend on the viewport.
    pub(crate) viewport_generation: u32,
}

impl Environment {
    pub(crate) fn is_dark(&self, scheme: crate::types::ColorScheme) -> bool {
        use crate::types::ColorScheme;
        let scheme = match () {
            () if self.forces_colors => ColorScheme::LIGHT | ColorScheme::DARK,
            () if scheme.is_empty() => self.color_scheme,
            () => scheme,
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
                all.max(viewport)
            } else {
                all
            }
        }
    }
}

/// No two documents have the same: they share declarations.
pub(crate) fn new_generation() -> u32 {
    thread_local!(static LAST: Cell<u32> = const { Cell::new(0) });
    LAST.set(LAST.get() + 1);
    LAST.get()
}

/// About those of containers.
#[derive(Default)]
pub(crate) struct Queries {
    /// The elements that have got a style since the last layout.
    pub(crate) fresh: Vec<NodeId>,
    /// That many of them are in order, while styles change because of what layout has found.
    pub(crate) laid_out: usize,
    pub(crate) are_settling: bool,
    /// The styles that transitions start from, and the last animation from before.
    pub(crate) before: Map<NodeId, (Rc<Style>, u32)>,
    /// They keep them, or else it might never end.
    pub(crate) with_new_scrollbars: Set<BoxId>,
}

/// For what is outside.
pub(crate) enum Request {
    Image(Str),
    Svg(Str),
    Font(Str),
    Release(u32),
}

/// How many a thread has.
pub(crate) struct Counted;

thread_local!(static COUNT: Cell<u32> = const { Cell::new(0) });

impl Counted {
    fn new() -> Counted {
        COUNT.set(COUNT.get() + 1);
        Counted
    }

    pub(crate) fn count() -> u32 {
        COUNT.get()
    }
}

impl Drop for Counted {
    fn drop(&mut self) {
        COUNT.set(COUNT.get() - 1);
    }
}

pub(crate) struct Document {
    _counted: Counted,
    pub(crate) tree: Tree,
    pub(crate) environment: Environment,
    pub(crate) styles: Stylist,
    pub(crate) fonts: Fonts,
    pub(crate) boxes: Boxes,
    pub(crate) animations: Animations,
    pub(crate) scrolling: Scrolling,
    pub(crate) compositor: crate::compositor::Compositor,
    pub(crate) marks: Marks,
    pub(crate) accessibility: Option<Box<crate::accessibility::Accessibility>>,
    pub(crate) pictures: Pictures,
    pub(crate) base_url: Rc<[u8]>,

    class_lists: ClassLists,
    spare_strings: SpareStrings,
    prepared: Vec<Prepared>,
    /// With the base URL, the media, the owner and the hash.
    shared_rules: Map<u64, Rc<RefCell<RuleSet>>>,
    registered_by_script: crate::custom::Registry,
    pub(crate) selectors: Map<u64, Option<Rc<Sought>>>,
    /// How many elements have each `key::attribute` and `key::value`.
    pub(crate) attribute_keys: Counts,
    /// Of the viewport, while it is in a frame without a box.
    pub(crate) offset_when_displayed: Option<[f32; 2]>,
    pub(crate) media_queries: Map<u64, crate::condition::Condition>,
    pub(crate) resolved: crate::computed::Resolved,
    requested_fonts: Vec<Rc<FontFace>>,
    /// Until a character is written that they are for.
    deferred_fonts: Vec<(Wanted, Rc<FontFace>, Coverage)>,
    font_faces_changed: bool,
    pub(crate) font_faces_version: u32,
    pub(crate) font_requests: Option<Vec<Rc<FontFace>>>,
    pub(crate) shaped: RefCell<Map<u64, Rc<Shaped>>>,
    /// Since the long texts that are not used any more were last dropped.
    pub(crate) newly_shaped_bytes: Cell<usize>,
    /// How long the paragraphs are that `Inline::of_words` has got since boxes are being built.
    pub(crate) words_built: core::cell::Cell<usize>,
    /// `None` until it has loaded.
    pub(crate) images: RefCell<Map<Str, Option<Replaced>>>,
    /// The floats that wait for them.
    shape_images: RefCell<Vec<(Str, NodeId)>>,
    pub(crate) image_shapes: RefCell<crate::float_area::ImageShapes>,
    pub(crate) changed_formulas: Set<NodeId>,
    pub(crate) requests: RefCell<Vec<Request>>,
    /// The elements of a JSON array.
    pub(crate) events: Vec<EngineEvent>,

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
    /// The containing blocks that are only a part of the box.
    pub(crate) containing_parts: Map<BoxId, abi::Rect>,
    pub(crate) anchored: Map<NodeId, crate::anchor::Anchoring>,
    /// With the anchor functions of their keyframes.
    pub(crate) anchored_by_animation: Map<NodeId, Rc<Style>>,
    pub(crate) anchor_index: Option<crate::anchor::Index>,
    pub(crate) anchors: Set<NodeId>,
    pub(crate) implicit_anchors: Map<NodeId, NodeId>,
    /// The `svg` elements that have what others refer to, and how often those have changed.
    /// With what refers to each.
    pub(crate) referenced_svgs: RefCell<Map<NodeId, Set<NodeId>>>,
    pub(crate) references: RefCell<crate::svg::References>,
    pub(crate) svg_generation: u32,
    pub(crate) environment_changes: u32,
    /// By their data.
    pub(crate) paths: RefCell<Map<Box<str>, crate::path::Path>>,
    /// `None` for those that are empty.
    pub(crate) path_bounds: RefCell<Map<NodeId, Option<crate::abi::Rect>>>,
    pub(crate) last_track: RefCell<Option<crate::svg_text::LastTrack>>,
    /// Something outside of an `svg` has been looked for.
    pub(crate) svg_reads: Cell<crate::svg_paint::Reads>,
    pub(crate) svg_changes: u32,
    pub(crate) has_foreign_objects: bool,
    pub(crate) svg_targets: RefCell<Rc<crate::svg::Targets>>,
    pub(crate) svg_ids: RefCell<crate::svg::Ids>,
    pub(crate) svg_budget: Cell<u32>,
    /// There has been a style for which the third dimension matters.
    pub(crate) has_depth: Cell<bool>,
    /// It is an image, or it has what another one refers to.
    pub(crate) is_embedded: bool,
    pub(crate) natural: Replaced,
    /// From `#svgView(transform())`.
    pub(crate) view_transform: crate::abi::Matrix,
    pub(crate) stretches_view: bool,
    pub(crate) externals: Map<Str, Option<Box<Document>>>,
    pub(crate) wanted_externals: RefCell<Set<Str>>,
    /// How far the lines of the largest text decoration are from their text, if they do not follow from the font.
    pub(crate) decoration_reach: f32,
    /// Those that show something from another origin.
    pub(crate) foreign_frames: Set<NodeId>,
    pub(crate) view_transitions: Vec<crate::view_transition::ViewTransition>,
    pub(crate) animated_vectors: RefCell<Set<(u32, NodeId)>>,
    pub(crate) resized_vectors: crate::embedded::Resized,
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
    pub(crate) is_in_design_mode: bool,
    pub(crate) counters_are_stale: bool,
    pub(crate) needs_layout: bool,
    pub(crate) needs_frame: bool,
    pub(crate) layout_version: u32,
    pub(crate) matrices: crate::geometry::Matrices,
    /// Unlike `layout_version`, it stays when something scrolls.
    pub(crate) sizes_version: u32,

    pub(crate) doomed: Vec<BoxId>,
    /// The nodes whose styles are being forgotten have their boxes in a buried one.
    pub(crate) is_burying: bool,
    /// While a node is detached, the generated elements that `forget_subtree` has to free.
    pub(crate) left_behind: Option<Vec<NodeId>>,
    /// Empty, for `forget_subtree`.
    room_for_ids: Vec<NodeId>,
    pub(crate) ordinals: Vec<(NodeId, i32)>,
    /// Lists with items that are not their children.
    pub(crate) deep_lists: Set<NodeId>,
    pub(crate) stale_lists: Vec<NodeId>,
    /// How many of the layouts in progress only compute a size.
    pub(crate) measuring: u32,
    pub(crate) layout_pass: u32,
    /// Boxes that lay out their children more than once can be nested. Without fuel a pass keeps what it has.
    pub(crate) layout_fuel: usize,
    pub(crate) moved_boxes_in_scrollers: Vec<BoxId>,
    /// They are out of flow, and only their `left` or `top` has changed.
    pub(crate) boxes_to_move: Vec<NodeId>,
    pub(crate) edits: crate::forecast::Forecast,
    pub(crate) reads: crate::forecast::Forecast,
    /// For the `note_extents` that follows.
    pub(crate) gathered: Cell<Option<(BoxId, crate::scroll::Contents)>>,
    pub(crate) changed_scrollbars: Vec<BoxId>,
    pub(crate) basis_for_widths: (BoxId, [Option<f32>; 2]),
    pub(crate) resized_scrollers: Vec<NodeId>,
    /// The elements whose transforms have changed.
    pub(crate) moved_boxes: Vec<NodeId>,
}

fn initial_style(fonts: &Fonts) -> Style {
    let mut groups = initial_groups();
    if let Some(it) = &fonts.settings {
        groups.set(&crate::properties::Value::FontSize(crate::types::FontSize(
            it.size.max(it.minimum_size),
            it.size,
            Some(3),
        )));
        it.standard.iter().for_each(|it| {
            groups.set(&crate::properties::Value::FontFamily(
                crate::types::Families([it.as_bytes(), b"\0"].concat().into()),
            ))
        });
    }
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
        measures: Default::default(),
        animates: Default::default(),
    }
}

/// Keys may share a count.
/// What a bare node is appended to.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Above {
    Detached,
    /// It is rendered, and neither a script nor a selector has seen it.
    New,
    Rendered,
}

pub(crate) struct Counts(Box<[u16; 2048]>);

impl Counts {
    fn place(key: Name) -> usize {
        (key.bits() >> 24) as usize % 2048
    }

    pub(crate) fn at_most(&self, key: Name) -> usize {
        match self.0[Counts::place(key)] {
            u16::MAX => usize::MAX,
            count => count.into(),
        }
    }

    #[inline]
    fn tag(element: &Element) -> Name {
        if element.is_generated() {
            Name::NONE
        } else {
            key::tag(element.tag)
        }
    }

    fn add(&mut self, key: Name) {
        let count = &mut self.0[Counts::place(key)];
        *count = count.saturating_add((key != Name::NONE).into());
    }

    #[inline]
    fn add_all(&mut self, element: &Element) {
        self.add(Counts::tag(element));
        for it in element.attributes_besides_class() {
            self.add(key::attribute(it.name));
            self.add(it.key);
        }
    }

    #[inline]
    fn remove_all(&mut self, element: &Element) {
        self.remove(Counts::tag(element));
        for it in element.attributes_besides_class() {
            self.remove(key::attribute(it.name));
            self.remove(it.key);
        }
    }

    fn remove(&mut self, key: Name) {
        let count = &mut self.0[Counts::place(key)];
        debug_assert!(key == Name::NONE || *count != 0);
        *count -= u16::from(key != Name::NONE && !matches!(*count, 0 | u16::MAX));
    }
}

#[inline(always)]
fn is_styled_by_table(tag: Name) -> bool {
    is_name!(tag, "td" | "th" | "colgroup" | "thead" | "tbody" | "tfoot")
}

/// References to the literals that attributes had last, which they tend to get again. Counting them is atomic.
#[derive(Default)]
struct SpareStrings([Option<DomString>; 16]);

impl SpareStrings {
    #[inline(always)]
    fn slot(&mut self, string: &DomString) -> &mut Option<DomString> {
        &mut self.0[(core::ptr::from_ref(string.as_impl()).addr() >> 4) % 16]
    }

    #[inline(always)]
    fn share(&mut self, string: &DomString) -> DomString {
        self.slot(string)
            .take_if(|it| it.is_same(string))
            .unwrap_or_else(|| string.clone())
    }

    #[inline(always)]
    fn give_back(&mut self, text: StoredText) {
        if let StoredText::Ascii(string) = text
            && string.as_impl().is_atom()
        {
            let slot = self.slot(&string);
            *slot = Some(string);
        }
    }
}

struct ClassLists {
    all: Map<Name, Rc<Classes>>,
    /// By the address of the literal that a script has set, and whether case is ignored.
    of_literals: Box<[Option<(DomString, bool, Rc<Classes>)>; 128]>,
}

impl ClassLists {
    #[inline]
    fn find(
        &mut self,
        text: &str,
        source: impl Fn() -> StoredText,
        ignores_case: bool,
    ) -> Rc<Classes> {
        let ignores_case = ignores_case && text.bytes().any(|it| it.is_ascii_uppercase());
        let new = || Rc::new(Classes::new(&source(), ignores_case));
        let known = self
            .all
            .entry(Name::hash(text.as_bytes(), false).salted(ignores_case.into()))
            .or_insert_with(new);
        if *known.source == *text {
            Rc::clone(known)
        } else {
            new()
        }
    }

    /// If it is ASCII.
    #[inline(always)]
    fn of(&mut self, value: &DomString, ignores_case: bool) -> Option<Rc<Classes>> {
        let slot = ((core::ptr::from_ref(value.as_impl()).addr() as u64)
            .wrapping_mul(0x9e37_79b9_7f4a_7c15)
            >> 57) as usize;
        match &self.of_literals[slot] {
            Some((literal, ignored_case, classes))
                if literal.is_same(value) && *ignored_case == ignores_case =>
            {
                Some(Rc::clone(classes))
            }
            _ => self.find_and_remember(value, ignores_case, slot),
        }
    }

    fn find_and_remember(
        &mut self,
        value: &DomString,
        ignores_case: bool,
        slot: usize,
    ) -> Option<Rc<Classes>> {
        let classes = self.find(
            value.ascii()?,
            || StoredText::Ascii(value.clone()),
            ignores_case,
        );
        if value.as_impl().is_atom() {
            self.of_literals[slot] = Some((value.clone(), ignores_case, Rc::clone(&classes)));
        }
        Some(classes)
    }

    fn clear(&mut self) {
        self.of_literals.fill(None);
        self.all.clear();
    }
}

/// For `room_for_ids`
const KEPT_ROOM: usize = 256;

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
            has_media: false,
            fixes_text_areas: false,
            reduced_motion: false,
            reduced_transparency: false,
            cannot_scroll: false,
            is_object: false,
            more_contrast: false,
            forces_colors: false,
            palette: None,
            has_touch: false,
            fullscreen: false,
            overlay_scrollbars: false,
            is_active: true,
            highlight: [0xb3d7_ffff, 0x3f63_8bff],
            titlebar_area: None,
            root_font: initial.root_units(),
            initial_font: initial.root_units(),
            generation: new_generation(),
            viewport_generation: 0,
        };
        let styles = Stylist::new(&environment, initial);
        let mut tree = Tree::new();
        tree[DOCUMENT].layout_box = VIEWPORT;
        Document {
            _counted: Counted::new(),
            boxes: Boxes::new(&styles.initial),
            tree,
            environment,
            styles,
            fonts,
            animations: Default::default(),
            scrolling: Default::default(),
            compositor: Default::default(),
            accessibility: None,
            marks: Default::default(),
            pictures: Pictures::default(),
            base_url: base_url.into(),
            spare_strings: SpareStrings::default(),
            class_lists: ClassLists {
                all: Map::default(),
                of_literals: Box::new([const { None }; 128]),
            },
            prepared: Vec::new(),
            shared_rules: Default::default(),
            registered_by_script: Default::default(),
            selectors: Default::default(),
            offset_when_displayed: None,
            attribute_keys: Counts(Box::new([0; 2048])),
            media_queries: Default::default(),
            resolved: Default::default(),
            requested_fonts: Vec::new(),
            deferred_fonts: Vec::new(),
            font_faces_changed: false,
            font_faces_version: 0,
            font_requests: None,
            shaped: Default::default(),
            newly_shaped_bytes: Cell::new(0),
            words_built: Default::default(),
            images: Default::default(),
            shape_images: Default::default(),
            image_shapes: Default::default(),
            changed_formulas: Default::default(),
            requests: Default::default(),
            events: Vec::new(),
            top_layer: Vec::new(),
            leaving_top_layer: Vec::new(),
            containers: Default::default(),
            viewport_users: Default::default(),
            root_scrollbars: [0.0; 2],
            queries: Default::default(),
            carousels: Default::default(),
            auto_visible: Default::default(),
            locks: Default::default(),
            containing_parts: Default::default(),
            anchored: Default::default(),
            anchored_by_animation: Default::default(),
            anchor_index: None,
            anchors: Default::default(),
            implicit_anchors: Default::default(),
            referenced_svgs: Default::default(),
            references: Default::default(),
            svg_generation: 0,
            environment_changes: 0,
            paths: Default::default(),
            path_bounds: Default::default(),
            last_track: RefCell::default(),
            svg_reads: Cell::default(),
            svg_changes: 0,
            has_foreign_objects: false,
            svg_targets: RefCell::default(),
            svg_ids: Default::default(),
            svg_budget: Cell::new(0),
            has_depth: Cell::new(false),
            is_embedded: false,
            natural: Replaced::default(),
            view_transform: crate::types::IDENTITY,
            externals: Default::default(),
            stretches_view: false,
            wanted_externals: Default::default(),
            decoration_reach: 0.0,
            foreign_frames: Default::default(),
            view_transitions: Vec::new(),
            animated_vectors: Default::default(),
            resized_vectors: Default::default(),
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
            is_in_design_mode: false,
            counters_are_stale: false,
            needs_layout: true,
            needs_frame: false,
            layout_version: 0,
            matrices: Default::default(),
            sizes_version: 0,
            doomed: Vec::new(),
            is_burying: false,
            left_behind: None,
            room_for_ids: Vec::new(),
            ordinals: Vec::new(),
            deep_lists: Set::default(),
            stale_lists: Vec::new(),
            measuring: 0,
            layout_pass: 0,
            layout_fuel: usize::MAX,
            moved_boxes_in_scrollers: Vec::new(),
            boxes_to_move: Vec::new(),
            edits: Default::default(),
            reads: Default::default(),
            gathered: Cell::new(None),
            changed_scrollbars: Vec::new(),
            basis_for_widths: Default::default(),
            resized_scrollers: Vec::new(),
            moved_boxes: Vec::new(),
        }
    }

    pub(crate) fn emit(&mut self, node: NodeId, event: ForNode) {
        self.events.push(EngineEvent::Node(node, event));
    }

    pub(crate) fn has_news(&mut self) -> bool {
        self.report_finished_scrolls();
        self.has_events()
    }

    pub(crate) fn take_events(&mut self) -> Vec<EngineEvent> {
        self.report_finished_scrolls();
        self.emit_scroll_events();
        core::mem::take(&mut self.events)
    }

    pub(crate) fn forget_memos(&mut self) {
        self.styles
            .scopes
            .values()
            .chain(self.shared_rules.values())
            .for_each(|it| it.borrow_mut().forget_memos());
        self.styles.user_agent.get_mut().forget_memos();
    }

    pub(crate) fn feature_changed(&mut self, id: NodeId, feature: Name) {
        if self.tree.is_rendered(id) {
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
        for child in children {
            self.stop_rendering(child);
        }
        if let Some(element) = self.tree.element_mut(host) {
            element.rare_mut().shadow_root = root;
        }
        self.tree[host].set(Flags::REDIRECTS_CHILDREN);
        self.tree.ancestry.forget_all();
        self.mark_parent_rebuild(host);
        self.mark_rebuild(host);
        root
    }

    fn children_changed(&mut self, child: NodeId, is_new: bool) {
        let parent = self.tree[child].parent;
        if !self.tree.is_rendered(parent) {
            return;
        }
        self.text_changed_in(parent);
        if !is_new {
            self.forget_has_results(child);
        }
        self.styles
            .dependencies
            .get_mut()
            .children_changed(&self.tree, child, is_new);
        if self.tree[parent].has(Flags::COUNTED_CHILDREN) {
            for it in self.tree.element_children(parent) {
                self.tree
                    .mark_style(it, Flags::REMATCH_SUBTREE | Flags::RECASCADE);
                let generated = self.tree.element(it).map_or([0; 4], |it| it.generated);
                generated
                    .into_iter()
                    .filter(|it| *it != 0)
                    .for_each(|it| self.tree.mark_style(it, Flags::RECASCADE));
            }
        }
        (self.counters_are_stale, self.marks.are_stale) = (true, true);
        self.svg_children_changed(parent);
    }

    /// Of what leaves its place.
    fn forget_has_results(&mut self, root: NodeId) {
        let results = self.styles.has_results.get_mut();
        if !results.is_empty() {
            self.tree.visit_subtree(root, |id| {
                _ = self.tree[id]
                    .has(Flags::HAS_ANCHOR)
                    .then(|| results.remove(&id))
            });
        }
    }

    pub(crate) fn children_replaced(&mut self, parent: NodeId) {
        self.text_changed_in(parent);
        self.styles
            .dependencies
            .get_mut()
            .children_replaced(&self.tree, parent);
        (self.counters_are_stale, self.marks.are_stale) = (true, true);
        self.svg_changed(parent);
    }

    pub(crate) fn start_rendering(&mut self, id: NodeId) {
        match self.tree[id].data {
            Data::Text(_)
                if self
                    .tree
                    .element(self.tree.flat_parent(id))
                    .is_some_and(|it| it.style.is_none()) => {}
            Data::Text(_) => self.mark_parent_rebuild(id),
            _ => self.tree.mark_style(id, Flags::REMATCH),
        }
    }

    /// Forgets the styles, the boxes and the animations of the node and of what is in it.
    pub(crate) fn stop_rendering(&mut self, id: NodeId) {
        self.note_departure(id);
        self.forget_hidden_offsets(id);
        self.forget_style(id);
    }

    pub(crate) fn forget_style(&mut self, id: NodeId) {
        self.tree.prefetch_after(id);
        self.tree.prefetch_style(id + 4);
        let Some(element) = self.tree.element_mut(id) else {
            self.tree[id].layout_box = 0;
            return;
        };
        (element.rules, element.base_style) = (None, None);
        let mut keeps_offset = false;
        if let Some(it) = element.rare_if_any() {
            keeps_offset = self.scrolling.is_hiding && it.scroll != [0.0; 2];
            (it.container_size, it.scroll) =
                (None, if keeps_offset { it.scroll } else { [0.0; 2] });
        }
        let (style, is_backdrop) = (
            element.style.take(),
            element.pseudo == crate::selector::Pseudo::Backdrop,
        );
        if keeps_offset {
            self.scrolling
                .around_hidden
                .extend(self.tree.flat_ancestors(id));
        }
        let is_in_buried_box = self.is_burying
            && !is_backdrop
            && !self.tree[id].has(Flags::TOP_LAYER)
            && self.carousels.is_empty();
        let is_buried = is_in_buried_box || self.bury_box(id);
        self.tree[id].layout_box = 0;
        if let Some(style) = style {
            let was_burying = core::mem::replace(&mut self.is_burying, is_buried);
            self.forget_styles_below(id);
            self.is_burying = was_burying;
            if self.tree[id].has(Flags::ANIMATED) {
                self.cancel_css_animations(id);
            }
            if !self.anchored.is_empty() {
                self.anchored.remove(&id);
            }
            if self.tree[id].has(Flags::HAS_ANSWERED) {
                self.tree[id].unset(Flags::HAS_ANSWERED);
                self.styles.answers.get_mut().remove(&id);
            }
            if !style.is_inert() {
                self.auto_visible.remove(&id);
                for set in [
                    &mut self.containers,
                    &mut self.locks.remembering,
                    &mut self.anchors,
                ] {
                    set.remove(&id);
                }
            }
        }
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
        if generated != [0; 4] {
            for it in generated.into_iter().filter(|it| *it != 0) {
                match &mut self.left_behind {
                    Some(left_behind) => {
                        left_behind.push(it);
                        self.forget_style(it);
                    }
                    None => self.free_subtree(it),
                }
            }
        }
        if self.carousels.has(id) {
            self.drop_scroll_parts(id);
        }
        if self.tree[id].has(Flags::REDIRECTS_CHILDREN) {
            for child in Vec::from_iter(self.tree.flat_children(id)) {
                self.forget_style(child);
            }
            match (self.take_parts(id), &mut self.left_behind) {
                (Some(parts), Some(left_behind)) => left_behind.push(parts),
                (Some(parts), None) => self.free_subtree(parts),
                _ => {}
            }
            return;
        }
        let mut child = self.tree[id].first_child;
        while child != 0 {
            self.forget_style(child);
            child = self.tree[child].next;
        }
    }

    fn unlink(&mut self, id: NodeId) {
        self.stop_rendering(id);
        self.unlink_unstyled(id);
    }

    /// Whether `stop_rendering` has more to do than to reset flags.
    fn has_been_rendered(&self, id: NodeId) -> bool {
        let node = &self.tree[id];
        node.layout_box != 0
            || node.has(Flags::HAS_MISSED)
            || !self.scrolling.around_hidden.is_empty()
            || node.element().is_some_and(|it| {
                it.style.is_some() || it.rules.is_some() || it.base_style.is_some() || it.has_rare()
            })
    }

    fn unlink_unstyled(&mut self, id: NodeId) {
        if self.tree[id].parent != 0 {
            self.children_changed(id, false);
        }
        self.unassign(id);
        self.tree.unlink_unknown(id);
    }

    pub(crate) fn unassign_all(&mut self, slot: NodeId) {
        for id in self
            .tree
            .element_mut(slot)
            .and_then(Element::rare_if_any)
            .map(|it| core::mem::take(&mut it.assigned))
            .unwrap_or_default()
        {
            self.stop_rendering(id);
            self.tree[id].slot = 0;
        }
    }

    pub(crate) fn rehome(&mut self, id: NodeId, new: impl Fn(NodeId) -> NodeId) {
        let last = &mut self.tree.cold_mut(id).last_child;
        *last = new(*last);
        self.tree.dirty_child(id).set(0);
        self.tree.visit(id).set(0);
        let node = &mut self.tree[id];
        for it in [
            &mut node.parent,
            &mut node.first_child,
            &mut node.previous,
            &mut node.next,
            &mut node.scope,
            &mut node.slot,
        ] {
            *it = new(*it);
        }
        match &mut node.data {
            Data::ShadowRoot { host, .. } => *host = new(*host),
            Data::Element(element) => {
                element.originator = new(element.originator);
                element
                    .rare_if_any()
                    .into_iter()
                    .flat_map(|it| it.assigned.iter_mut().chain([&mut it.shadow_root]))
                    .for_each(|it| *it = new(*it));
                element.is_unprepared = true;
                element.classes = element.classes.take().map(|it| {
                    Rc::new(Classes::new(
                        &it.source,
                        self.environment.quirks == Quirks::All,
                    ))
                });
                if element.namespace == Namespace::MathMl && !self.environment.has_math {
                    self.set_environment(Environment {
                        has_math: true,
                        ..self.environment.clone()
                    });
                }
            }
            _ => {}
        }
    }

    fn unassign(&mut self, id: NodeId) {
        let slot = core::mem::take(&mut self.tree[id].slot);
        if let Some(slot) = self.tree.element_mut(slot) {
            slot.unassign(id);
        }
    }

    pub(crate) fn insert(&mut self, parent: NodeId, child: NodeId, before: NodeId) {
        let (was_rendered, old_parent) = (self.tree.is_rendered(child), self.tree[child].parent);
        if old_parent != 0 {
            self.unlink(child);
            self.tree.ancestry.forget_all();
        }
        self.tree.link(parent, child, before);
        self.svg_ids.get_mut().tree_changed();
        let scope = self.tree[parent].scope;
        if self.tree[child].scope != scope {
            self.tree.set_scope(child, scope);
        }
        if !self.tree.is_rendered(parent) {
            return;
        }
        if was_rendered {
            if let Some(accessibility) = &mut self.accessibility {
                self.tree
                    .visit_subtree(child, |id| accessibility.element_added(id));
            }
            self.update_derived_state(
                child,
                old_parent != parent || self.tree.html_tag(parent) == name!("fieldset"),
            );
        } else {
            let mut ids = SmallVec::<[NodeId; 32]>::new();
            self.tree.visit_subtree(child, |id| ids.push(id));
            for (index, id) in ids.iter().copied().enumerate() {
                self.tree.prefetch_in(&ids[index..]);
                if !self.prepare_quickly(id) {
                    self.prepare(id, true);
                    self.derive_state(id, true);
                }
            }
        }
        self.children_changed(child, true);
        self.start_rendering(child);
    }

    /// After `Tree::move_children`.
    pub(crate) fn children_appended(&mut self, parent: NodeId, first: NodeId) {
        let (scope, is_rendered) = (self.tree[parent].scope, self.tree.is_rendered(parent));
        self.svg_ids.get_mut().tree_changed();
        const INHERITED: State = State::READ_WRITE.union(State::RTL);
        let mut inherit_nothing = self.accessibility.is_none()
            && self
                .tree
                .element(parent)
                .is_some_and(|it| !it.state.intersects(INHERITED));
        let mut at = if scope == 0 { 0 } else { first };
        while at != 0 {
            self.tree.prefetch_after(at);
            let node = &mut self.tree[at];
            node.scope = scope;
            let is_ready = node.element().is_none_or(|it| {
                inherit_nothing
                    && it.is_ready()
                    && !node.has(Flags::AUTO_DIRECTION | Flags::REDIRECTS_CHILDREN)
            });
            if is_rendered && is_ready {
                node.element()
                    .into_iter()
                    .for_each(|it| self.attribute_keys.add_all(it));
            }
            if is_rendered && !is_ready && !self.prepare_quickly(at) {
                self.prepare(at, true);
                self.derive_state(at, true);
                inherit_nothing &= self
                    .tree
                    .element(at)
                    .is_some_and(|it| !it.state.intersects(INHERITED));
            }
            at = self.tree.following(at, parent);
        }
        if !is_rendered || first == 0 {
            return;
        }
        let are_alone = self.tree[first].previous == 0;
        if are_alone {
            self.children_replaced(parent);
        }
        let mut child = first;
        while child != 0 {
            if !are_alone {
                self.children_changed(child, true);
            }
            self.start_rendering(child);
            child = self.tree[child].next;
        }
    }

    /// `insert`, for a node without children and a rendered parent. There is less to it if that has yet to be styled.
    #[inline]
    pub(crate) fn append_new(&mut self, parent: NodeId, child: NodeId) {
        if self.tree[child].parent != 0
            || !self.tree.element(parent).is_some_and(|it| {
                it.rules.is_none() && it.style.is_none() && it.namespace == Namespace::Html
            })
            || self.has_auto_direction
            || self.accessibility.is_some()
            || self.tree[parent].has(
                Flags::EDGE_CHILDREN
                    | Flags::CHILD_INDEX
                    | Flags::NEXT_SIBLING
                    | Flags::LATER_SIBLINGS
                    | Flags::EMPTINESS
                    | Flags::COUNTED_CHILDREN,
            )
            || self.styles.dependencies.get_mut().looks_for_descendants()
        {
            return self.insert(parent, child, 0);
        }
        self.tree.append(parent, child);
        self.svg_ids.get_mut().tree_changed();
        if !self.prepare_quickly(child) {
            self.prepare(child, true);
            self.derive_state(child, true);
        }
        (self.counters_are_stale, self.marks.are_stale) = (true, true);
    }

    /// Frees the descendants, which are bare. Returns how many they were.
    pub(crate) fn drop_children(&mut self, parent: NodeId) -> u32 {
        if self.tree.is_rendered(parent) {
            self.left_behind = Some(Vec::new());
            let mut child = self.tree[parent].first_child;
            while child != 0 {
                let node = &self.tree[child];
                if node.layout_box != 0 && node.next != 0 && node.previous == 0 {
                    self.mark_parent_rebuild(child);
                }
                let node = &self.tree[child];
                if node.layout_box != 0
                    || node
                        .element()
                        .is_some_and(|it| it.style.is_some() || it.rules.is_some())
                {
                    self.stop_rendering(child);
                }
                child = self.tree[child].next;
            }
            self.children_replaced(parent);
            let mut ids = self.tree.descendants(parent).collect();
            self.forget_nodes(&mut ids, true);
            return self.tree.free_these_below(parent, &ids, |id, element| {
                if element.namespace == Namespace::Svg {
                    self.smil.forget(id);
                }
                self.attribute_keys.remove_all(element);
            });
        }
        self.svg_ids.get_mut().tree_changed();
        self.tree.free_below(parent)
    }

    /// `prepare` and `derive_state`, if nothing but its parent has a say in them.
    #[inline]
    fn prepare_quickly(&mut self, id: NodeId) -> bool {
        if self
            .tree
            .element(id)
            .is_some_and(|it| it.is_unprepared && it.lacks_hints())
        {
            self.tree
                .element_mut(id)
                .into_iter()
                .for_each(|it| it.is_unprepared = false);
            self.update_inline_style(id);
        }
        let node = &self.tree[id];
        let Some(element) = node.element() else {
            return true;
        };
        let Some(parent) = self.tree.element(node.parent) else {
            return false;
        };
        if node.has(Flags::AUTO_DIRECTION | Flags::REDIRECTS_CHILDREN)
            || self.accessibility.is_some()
        {
            return false;
        }
        if !element.state.is_empty() {
            let Some(own) = element
                .state_if_dormant()
                .filter(|_| !element.is_unprepared && self.tree.is_bare(id))
            else {
                return false;
            };
            let state = own
                | parent.state
                    & if element.tag == name!("input") {
                        State::RTL
                    } else {
                        State::READ_WRITE | State::RTL
                    };
            self.attribute_keys.add_all(element);
            self.tree
                .element_mut(id)
                .into_iter()
                .for_each(|it| it.state = state);
            return true;
        }
        let Some(own) = element.own_state() else {
            return false;
        };
        if element.may_be_special() && is_styled_by_table(element.tag) {
            let mut above =
                core::iter::successors(Some(node.parent), |it| Some(self.tree[*it].parent)).take(3);
            if self.has_table_that_styles()
                || !above.any(|it| self.tree.html_tag(it) == name!("table"))
            {
                return false;
            }
        }
        self.attribute_keys.add_all(element);
        let state = own | parent.state & (State::READ_WRITE | State::RTL);
        if !state.is_empty() {
            self.tree
                .element_mut(id)
                .into_iter()
                .for_each(|it| it.state = state);
        }
        true
    }

    #[inline(always)]
    fn has_table_that_styles(&self) -> bool {
        [name!("border"), name!("rules"), name!("cellpadding")]
            .into_iter()
            .any(|it| self.attribute_keys.at_most(key::attribute(it)) != 0)
    }

    /// Whether `Above::New` is an option.
    pub(crate) fn overlooks_new_nodes(&mut self) -> bool {
        self.accessibility.is_none() && !self.styles.dependencies.get_mut().looks_for_descendants()
    }

    #[inline(always)]
    fn inherited_from_new(&self, parent: NodeId) -> Option<State> {
        let parent = self
            .tree
            .element(parent)
            .filter(|it| it.namespace == Namespace::Html && !self.has_auto_direction)?;
        Some(parent.state & (State::READ_WRITE | State::RTL))
    }

    /// `Err` is for `append_new`.
    #[inline(always)]
    pub(crate) fn append_bare_text(
        &mut self,
        parent: NodeId,
        above: Above,
        text: StoredText,
    ) -> Result<NodeId, NodeId> {
        match above == Above::Detached
            || above == Above::New && self.inherited_from_new(parent).is_some()
        {
            true => Ok(self.tree.append_bare(parent, Data::Text(text), 0)),
            false => Err(self.tree.create_bare(Data::Text(text), 0)),
        }
    }

    /// Likewise. `own` is `Element::own_state`.
    #[inline(always)]
    pub(crate) fn append_bare_element(
        &mut self,
        parent: NodeId,
        above: Above,
        mut element: Box<Element>,
        keys: u64,
        own: Option<State>,
    ) -> Result<NodeId, NodeId> {
        if above != Above::Detached {
            let inherited = if above == Above::New
                && !(self.has_table_that_styles() && is_styled_by_table(element.tag))
            {
                self.inherited_from_new(parent)
            } else {
                None
            };
            let Some((own, inherited)) = own.zip(inherited) else {
                return Err(self.tree.create_bare(Data::Element(element), keys));
            };
            element.state = own | inherited;
            self.attribute_keys.add_all(&element);
        }
        self.tree.sequence.shape_changed(parent);
        Ok(self.tree.append_bare(parent, Data::Element(element), keys))
    }

    /// After what `Above::New` has got.
    pub(crate) fn new_nodes_appended(&mut self) {
        self.svg_ids.get_mut().tree_changed();
        (self.counters_are_stale, self.marks.are_stale) = (true, true);
    }

    /// For an element that was not rendered. `counts`: it is from now on.
    pub(crate) fn prepare(&mut self, id: NodeId, counts: bool) {
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        if let Some(accessibility) = &mut self.accessibility {
            accessibility.element_added(id);
        }
        if counts {
            self.attribute_keys.add_all(element);
        }
        self.has_foreign_objects |= element.tag == name!("foreignObject");
        let is_unprepared = core::mem::take(&mut element.is_unprepared);
        let has_context = is_styled_by_table(element.tag) || element.tag == name!("svg");
        if counts && crate::smil::is_animation(element) {
            self.smil.changed(id);
        }
        if is_unprepared {
            self.update_inline_style(id);
        }
        if is_unprepared || has_context {
            self.update_hints(id);
        }
    }

    fn update_inline_style(&mut self, id: NodeId) {
        let within = self.within();
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        element.inline_style = match (element.style_source, &element.inline_style) {
            (StyleSource::Attribute, _) => {
                let source = element
                    .attribute(name!("style"))
                    .filter(|_| !element.is_style_refused)
                    .unwrap_or_default();
                self.styles.block(source.as_bytes(), within, &self.base_url)
            }
            (_, block) => block.as_ref().map(|it| {
                self.styles
                    .blocks
                    .share(it.editable().list.clone(), within, &it.base_url)
            }),
        };
    }

    pub(crate) fn inline_style(&mut self, id: NodeId) -> Option<&Rc<Block>> {
        if self
            .tree
            .element(id)
            .is_some_and(|it| it.is_unprepared && it.style_source == StyleSource::Attribute)
        {
            self.update_inline_style(id);
        }
        self.tree.element(id)?.inline_style.as_ref()
    }

    /// `edit` answers whether it has changed anything.
    pub(crate) fn edit_inline_style(
        &mut self,
        id: NodeId,
        edit: impl FnOnce(&mut InlineBlocks, &mut Rc<Block>) -> bool,
    ) -> bool {
        self.inline_style(id);
        let (within, blocks) = (self.within(), &mut self.styles.blocks);
        let Some(element) = self.tree.element_to_style(id) else {
            return false;
        };
        let block = element
            .inline_style
            .get_or_insert_with(|| blocks.parse(b"", within, &self.base_url));
        let has_changed = edit(blocks, block);
        element.inline_style.take_if(|it| it.is_blank());
        has_changed && self.inline_style_edited(id)
    }

    /// Whether it changes anything.
    pub(crate) fn set_inline_property(
        &mut self,
        id: NodeId,
        prop: Prop,
        value: &[u8],
        is_important: bool,
    ) -> bool {
        self.anticipate_edits(id);
        match if is_important {
            None
        } else {
            self.amend_inline_style(id, prop, value)
        } {
            Some(has_changed) => has_changed && self.inline_style_edited(id),
            None => {
                self.edit_inline_style(id, |blocks, it| blocks.set(it, prop, value, is_important))
            }
        }
    }

    fn inline_style_edited(&mut self, id: NodeId) -> bool {
        let Some(element) = self.tree.element_mut(id) else {
            return false;
        };
        if element.style_source == StyleSource::Attribute && !element.has(name!("style")) {
            let edited = element.inline_style.take();
            self.change_attribute(
                id,
                Err((atom!("style").into(), None)),
                Some(StoredText::default()),
                false,
            );
            self.tree
                .element_mut(id)
                .into_iter()
                .for_each(|it| it.inline_style.clone_from(&edited));
        }
        let Some(element) = self.tree.element_to_style(id) else {
            return false;
        };
        (element.style_source, element.is_style_refused) = (StyleSource::Edited, false);
        if self.tree.is_rendered(id) {
            self.tree.mark_style(id, Flags::REANIMATE);
            if self
                .styles
                .dependencies
                .get_mut()
                .may_mention(key::attribute(name!("style")))
            {
                self.tree.visit(id).set(0);
                self.feature_changed(id, key::attribute(name!("style")));
            }
            self.recascade_readers_of_attribute(id, name!("style"));
        }
        true
    }

    pub(crate) fn serialize_inline_style(&mut self, id: NodeId) {
        let Some(element) = self
            .tree
            .element_mut(id)
            .filter(|it| it.style_source == StyleSource::Edited)
        else {
            return;
        };
        if let Some(index) = element
            .attributes
            .iter()
            .position(|it| it.name == name!("style"))
        {
            let value = element.value_of(&element.attributes[index]).into();
            element.attributes.to_mut()[index].value = value;
        }
        element.style_source = StyleSource::Serialized;
    }

    fn recascade_readers_of_attribute(&self, id: NodeId, name: Name) {
        let Some(element) = self
            .tree
            .element(id)
            .filter(|_| self.styles.attributes_read.get() & crate::custom::mark(name) != 0)
        else {
            return;
        };
        for it in element
            .generated
            .into_iter()
            .filter(|it| *it != 0)
            .chain([id])
        {
            if self
                .tree
                .style(it)
                .is_some_and(|style| style.deps.contains(Deps::ATTRIBUTES))
            {
                self.tree.mark_style(it, Flags::RECASCADE);
            }
        }
    }

    /// Whether a script has made it by other means than the attribute.
    pub(crate) fn has_edited_style(&self, id: NodeId) -> bool {
        self.tree
            .element(id)
            .is_some_and(|it| it.style_source != StyleSource::Attribute)
    }

    /// For a copy of what `has_edited_style`.
    pub(crate) fn count_style_as_edited(&mut self, id: NodeId) {
        self.update_inline_style(id);
        self.tree
            .element_mut(id)
            .into_iter()
            .for_each(|it| it.style_source = StyleSource::Serialized);
    }

    pub(crate) fn refuse_inline_style(&mut self, id: NodeId, refuses: bool) {
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        if core::mem::replace(&mut element.is_style_refused, refuses) != refuses {
            self.update_inline_style(id);
            self.tree.mark_style(id, Flags::REMATCH);
        }
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
        self.svg_subtree_leaves(child);
        self.children_changed(child, false);
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
        self.forget_subtree(root, Tree::free);
    }

    /// Takes it out of the tree. It stays for as long as scripts can reach it.
    pub(crate) fn detach(&mut self, root: NodeId) {
        if !self.tree.is_rendered(root) {
            self.unassign(root);
            self.tree.unlink_unknown(root);
            return self.tree.set_scope(root, 0);
        }
        self.tree.prefetch_first_below(root);
        self.restore_animated_attributes(root);
        self.left_behind = Some(Vec::new());
        if self.has_been_rendered(root) {
            self.stop_rendering(root);
        }
        self.unlink_unstyled(root);
        self.forget_subtree(root, Tree::reset);
        self.tree.set_scope(root, 0);
    }

    /// `detach`, for all that it has. It is rendered, and no host.
    pub(crate) fn detach_children(&mut self, parent: NodeId, children: &[NodeId]) {
        self.left_behind = Some(Vec::new());
        if let [first, _, ..] = *children
            && self.tree[first].layout_box != 0
        {
            self.mark_parent_rebuild(first);
        }
        for child in children.iter().copied() {
            self.restore_animated_attributes(child);
            if self.has_been_rendered(child) {
                self.stop_rendering(child);
            }
        }
        self.children_replaced(parent);
        let mut ids = core::mem::take(&mut self.room_for_ids);
        for child in children.iter().copied() {
            self.tree.visit_subtree(child, |id| ids.push(id));
            self.tree.unlink_unknown(child);
        }
        self.forget_nodes(&mut ids, false);
        ids.drain(..).for_each(|id| self.tree.reset(id));
        ids.shrink_to(KEPT_ROOM);
        self.room_for_ids = ids;
        children.iter().for_each(|it| self.tree.set_scope(*it, 0));
    }

    /// All that refers to the nodes, which have no styles, from outside of the tree. `finish` resets their flags.
    fn forget_subtree(&mut self, root: NodeId, finish: impl Fn(&mut Tree, NodeId)) {
        let mut ids = core::mem::take(&mut self.room_for_ids);
        self.tree.visit_subtree(root, |id| ids.push(id));
        self.forget_nodes(&mut ids, false);
        ids.drain(..).for_each(|id| finish(&mut self.tree, id));
        ids.shrink_to(KEPT_ROOM);
        self.room_for_ids = ids;
    }

    /// `are_doomed`: what only their elements tell is left to the caller.
    fn forget_nodes(&mut self, ids: &mut Vec<NodeId>, are_doomed: bool) {
        let kept = ids.len();
        self.left_behind
            .take()
            .into_iter()
            .flatten()
            .for_each(|it| self.tree.visit_subtree(it, |id| ids.push(id)));
        let flags = ids.iter().fold(Flags::empty(), |all, id| {
            self.tree.ancestry.forget(*id);
            self.tree[*id].set(Flags::VISITED);
            all | self.tree[*id].flags.get()
        });
        self.nodes_removed(ids);
        if let Some(accessibility) = &mut self.accessibility {
            accessibility.nodes_freed(&self.tree, ids);
        }
        Tree::count_freed(ids.len());
        let has_more = flags
            .intersects(Flags::HAS_ANCHOR | Flags::ANIMATED | Flags::WATCHED_BY_TIMELINE)
            || !self.view_transitions.is_empty()
            || !self.replacements.is_empty();
        for id in ids.iter().copied().take_while(|_| has_more) {
            let flags = self.tree[id].flags.get();
            if flags.contains(Flags::HAS_ANCHOR) {
                self.styles.has_results.get_mut().remove(&id);
            }
            if flags.intersects(Flags::ANIMATED | Flags::WATCHED_BY_TIMELINE) {
                self.orphan_animations(id);
            }
            if !self.view_transitions.is_empty() {
                self.captured_node_freed(id);
            }
            if !self.replacements.is_empty() && self.replacements.remove(&id).is_some() {
                self.generated_images.remove(&id);
                self.drawn_images.remove(&id);
            }
        }
        for (index, id) in ids
            .iter()
            .copied()
            .enumerate()
            .skip(if are_doomed { kept } else { 0 })
        {
            self.tree.prefetch_in(&ids[index..]);
            match &self.tree[id].data {
                Data::ShadowRoot { .. } => _ = self.styles.scopes.remove(&id),
                Data::Element(element) if element.is_generated() => {
                    self.counter_users.remove(&id);
                    self.generated_images.remove(&id);
                    self.drawn_images.remove(&id);
                    self.shape_images.get_mut().retain(|it| it.1 != id);
                    self.changed_formulas.remove(&id);
                }
                Data::Element(element) if element.namespace == Namespace::Svg => {
                    self.smil.forget(id)
                }
                _ => {}
            }
            let Some(element) = self.tree.element_mut(id) else {
                continue;
            };
            self.attribute_keys.remove_all(element);
            element.generated_by_rules = None;
            element
                .rare_if_any()
                .into_iter()
                .for_each(|it| (it.replaced, it.remembered_size) = (None, [None; 2]));
        }
        let gone = &Gone {
            tree: &self.tree,
            ids,
        };
        gone.leave_list(&mut self.top_layer, |it| *it);
        gone.leave_list(&mut self.leaving_top_layer, |it| *it);
        gone.leave_map(&mut self.implicit_anchors);
        gone.leave_set(&mut self.deep_lists);
        gone.leave_set(self.boxes.styled_first.get_mut());
        gone.leave_set(&mut self.foreign_frames);
        gone.leave_set(&mut self.stale_directions);
        self.scrolling.forget(gone);
        self.carousels.forget(gone);
        self.compositor.forget(gone);
        self.marks.forget(gone);
        ids.drain(kept..).for_each(|id| self.tree.free(id));
    }

    pub(crate) fn set_text(&mut self, id: NodeId, text: StoredText) {
        let Data::Text(data) = &mut self.tree[id].data else {
            return;
        };
        let (was_empty, is_empty) = (data.is_empty(), text.is_empty());
        *data = text;
        self.text_changed(id, was_empty != is_empty);
    }

    pub(crate) fn append_text(&mut self, id: NodeId, more: &DomString) {
        let Data::Text(data) = &mut self.tree[id].data else {
            return;
        };
        let was_empty = data.string().is_empty();
        data.push(more);
        self.text_changed(id, was_empty && !more.is_empty());
    }

    fn text_changed(&mut self, id: NodeId, changes_emptiness: bool) {
        if !self.tree.is_rendered(id) {
            return;
        }
        let parent = self.tree[id].parent;
        if changes_emptiness && self.tree[parent].has(Flags::EMPTINESS) {
            self.feature_changed(parent, key::EMPTY);
        }
        self.marks.are_stale = true;
        self.start_rendering(id);
        self.text_changed_in(parent);
        self.slot_changed(self.tree[id].slot);
        self.svg_changed(parent);
    }

    /// By `Attribute::qualified`, for what no script has set.
    pub(crate) fn set_attribute(&mut self, id: NodeId, qualified: &str, value: Option<&str>) {
        let name = Name::new(qualified.as_bytes());
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let index = element.attributes.iter().position(|it| it.name == name);
        if index.map(|it| &*element.attributes[it].value) == value {
            return;
        }
        let place = index.ok_or_else(|| {
            match bun_core::strings::index_of_char_usize(qualified.as_bytes(), b' ')
                .map(|it| (&qualified[..it], &qualified[it + 1..]))
            {
                Some((_, "source")) => (
                    Atom::new(qualified),
                    Some(Rc::new(Space {
                        ns: Ns::None,
                        prefix: None,
                        uri: "".into(),
                        is_hidden: true,
                    })),
                ),
                Some((local, uri)) => (
                    Atom::new(local),
                    Some(Space::new(Ns::from_uri(Some(&Atom::new(uri))), None)),
                ),
                None => (Atom::new(qualified), None),
            }
        });
        self.change_attribute(
            id,
            place,
            value.map(StoredText::from),
            self.environment.quirks == Quirks::All,
        );
    }

    /// `place` is the index of the attribute, or else the name of the one to add.
    /// For an attribute with a `key::value` of an HTML element. Does nothing unless no style can depend on it.
    pub(crate) fn change_attribute_unnoticed(
        &mut self,
        id: NodeId,
        local: &Atom,
        value: &crate::api::core::DomString,
    ) -> bool {
        let Some(element) = self.tree.element(id) else {
            return false;
        };
        let Some(index) = element
            .attributes
            .iter()
            .position(|it| it.key != Name::NONE && it.local == *local)
        else {
            return false;
        };
        let is_rendered = self.tree.is_rendered(id);
        let (name, old) = (
            element.attributes[index].name,
            element.attributes[index].key,
        );
        let Some(new) = value
            .ascii()
            .and_then(|it| key::short_value(name, it.as_bytes()))
        else {
            return false;
        };
        if key::is_in_selectors(old)
            || key::is_in_selectors(new)
            || !self.smil.effects.bases.is_empty()
            || self.may_notice(id, element, name)
        {
            return false;
        }
        let Some(element) = self.tree.element_mut(id) else {
            return false;
        };
        let attribute = &mut element.attributes.to_mut()[index];
        (attribute.value, attribute.key) = (StoredText::Ascii(value.clone()), new);
        self.tree.add_keys(id, filter(core::iter::once(new)));
        if is_rendered {
            self.attribute_keys.add(new);
            self.attribute_keys.remove(old);
        }
        true
    }

    /// One with a `key::value`, of an HTML element that is not rendered and has none in a namespace.
    pub(crate) fn set_keyed_attribute(
        &mut self,
        id: NodeId,
        local: &Atom,
        name: Name,
        value: &crate::api::core::DomString,
    ) -> bool {
        let Some(text) = value.ascii().filter(|_| self.smil.effects.bases.is_empty()) else {
            return false;
        };
        let (key, keys) = (
            key::short_value(name, text.as_bytes()).unwrap_or(Name::NONE),
            self.tree[id].keys,
        );
        let Some(element) = self.tree.element_mut(id) else {
            return false;
        };
        let (attributes, value) = (
            element.attributes.to_mut_for_more(),
            StoredText::Ascii(value.clone()),
        );
        let keys = match attributes.iter_mut().find(|it| it.name == name) {
            Some(attribute) => {
                (attribute.value, attribute.key) = (value, key);
                crate::selector::filter_of(element)
            }
            None => {
                attributes.push(Attribute {
                    name,
                    local: local.clone(),
                    space: None,
                    value,
                    key,
                });
                keys | filter(
                    [key::attribute(name), key]
                        .into_iter()
                        .filter(|it| *it != Name::NONE),
                )
            }
        };
        self.tree.set_keys(id, keys);
        true
    }

    /// One of an HTML element, in no namespace, without `Meaning::OTHER`. Whether it has changed, or `None` if that is up to `change_attribute`.
    #[inline(always)]
    pub(crate) fn store_attribute(
        &mut self,
        id: NodeId,
        name: Known,
        value: &DomString,
        is_rendered: bool,
        may_change: bool,
        ignores_case: bool,
    ) -> Option<bool> {
        let element = self
            .tree
            .element(id)
            .filter(|_| self.smil.effects.bases.is_empty())?;
        if name == atom!("class") {
            let classes = self.class_lists.of(value, ignores_case)?;
            if element
                .classes
                .as_ref()
                .is_some_and(|it| Rc::ptr_eq(it, &classes))
            {
                return Some(false);
            }
            return (!is_rendered).then(|| self.store_classes(id, classes));
        }
        let Some(index) = element
            .attributes
            .iter()
            .position(|it| it.local == name && it.space.is_none())
        else {
            return (may_change && !is_rendered).then(|| self.add_attribute(id, name, value))?;
        };
        let old = element.attributes[index].value.string();
        if old.is_same(value) {
            return Some(false);
        }
        let text = value.ascii()?;
        let has_changed = old.as_impl().is_atom() && value.as_impl().is_atom() || old != value;
        if has_changed
            && (!may_change
                || is_rendered
                    && (name.meaning().contains(Meaning::READ)
                        || self.may_notice(id, element, element.attributes[index].name)))
        {
            return None;
        }
        let element = self.tree.element_mut(id)?;
        let old = core::mem::replace(
            &mut element.attributes.to_mut()[index].value,
            StoredText::Ascii(self.spare_strings.share(value)),
        );
        self.spare_strings.give_back(old);
        element.is_unprepared |= has_changed && name.meaning().contains(Meaning::HINT);
        if name == atom!("id") && has_changed {
            element.id = if text.is_empty() {
                Name::NONE
            } else {
                Name::new(text.as_bytes())
            };
            let keys = filter(core::iter::once(key::id(element.id)));
            self.tree.add_keys(id, keys);
        }
        Some(has_changed)
    }

    /// As `store_attribute`, for an element that is not rendered.
    fn add_attribute(&mut self, id: NodeId, local: Known, value: &DomString) -> Option<bool> {
        let (text, name, element) = (
            value.ascii()?,
            Atom::of(local).name(),
            self.tree.element_mut(id)?,
        );
        element.attributes.to_mut_for_more().push(Attribute {
            name,
            local: local.into(),
            space: None,
            value: StoredText::Ascii(value.clone()),
            key: Name::NONE,
        });
        element.is_unprepared |= local.meaning().contains(Meaning::HINT);
        let mut keys = filter(core::iter::once(key::attribute(name)));
        if local == atom!("id") && !text.is_empty() {
            element.id = Name::new(text.as_bytes());
            keys |= filter(core::iter::once(key::id(element.id)));
        }
        self.tree.set_keys(id, self.tree[id].keys | keys);
        Some(true)
    }

    /// Of an element that is not rendered.
    #[inline(always)]
    fn store_classes(&mut self, id: NodeId, classes: Rc<Classes>) -> bool {
        const KEY: Name = key::attribute(name!("class"));
        let Some(element) = self.tree.element_mut(id) else {
            return false;
        };
        let attribute = || Attribute {
            name: name!("class"),
            local: atom!("class").into(),
            space: None,
            value: classes.source.clone(),
            key: Name::NONE,
        };
        if element.attributes.len() == usize::from(element.classes.is_some()) {
            element.attributes = crate::tree::Attributes::Shared(Rc::clone(
                classes.attributes.get_or_init(|| Rc::new([attribute()])),
            ));
        } else {
            let all = if element.classes.is_some() {
                element.attributes.to_mut()
            } else {
                element.attributes.to_mut_for_more()
            };
            match all.iter_mut().find(|it| it.name == name!("class")) {
                Some(old) => old.value = classes.source.clone(),
                None => all.push(attribute()),
            }
        }
        let keys = classes.filter | filter(core::iter::once(KEY));
        element.classes = Some(classes);
        self.tree.add_keys(id, keys);
        true
    }

    /// That an attribute which is not `is_read_in_html` has another value.
    #[inline]
    fn may_notice(&self, id: NodeId, element: &Element, name: Name) -> bool {
        let reads = |it: NodeId| {
            self.styles.attributes_read.get() & crate::custom::mark(name) != 0
                && self
                    .tree
                    .style(it)
                    .is_some_and(|it| it.deps.contains(Deps::ATTRIBUTES))
        };
        self.styles
            .dependencies
            .borrow()
            .may_mention(key::attribute(name))
            || self.accessibility.is_some()
            || reads(id)
            || element.generated != [0; 4] && element.generated.into_iter().any(reads)
    }

    /// Does nothing if the element is rendered or has attributes.
    pub(crate) fn set_only_class(
        &mut self,
        id: NodeId,
        value: &crate::api::core::DomString,
        ignores_case: bool,
    ) -> bool {
        if self.tree.is_rendered(id)
            || self
                .tree
                .element(id)
                .is_none_or(|it| !it.attributes.is_empty())
        {
            return false;
        }
        self.class_lists
            .of(value, ignores_case)
            .is_some_and(|it| self.store_classes(id, it))
    }

    pub(crate) fn change_attribute(
        &mut self,
        id: NodeId,
        place: Result<usize, (Atom, Option<Rc<Space>>)>,
        value: Option<StoredText>,
        ignores_case: bool,
    ) {
        let is_rendered = self.tree.is_rendered(id);
        if is_rendered {
            self.anticipate_attributes(id);
        }
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        let (index, is_new) = match place {
            Ok(index) => (index, false),
            Err(_) if value.is_none() => return,
            Err((local, space)) => {
                let mut added = Attribute {
                    name: local.name(),
                    local,
                    space,
                    value: StoredText::default(),
                    key: Name::NONE,
                };
                if added.space.is_some() {
                    added.name = Name::new(added.qualified().as_bytes());
                }
                element.attributes.to_mut_for_more().push(added);
                (element.attributes.len() - 1, true)
            }
        };
        let attribute = &element.attributes[index];
        let (name, old_key, has_space, qualified) = (
            attribute.name,
            attribute.key,
            attribute.space.is_some(),
            attribute.qualified(),
        );
        let new_key = value.as_ref().map_or(Name::NONE, |it| {
            key::value(name, qualified.as_bytes(), it.as_bytes())
        });
        let lower = if !has_space && !qualified.bytes().any(|it| it.is_ascii_uppercase()) {
            name
        } else {
            Name::lowercase(qualified.as_bytes())
        };
        let is_only_for_selectors = element.namespace == Namespace::Html
            && (name == name!("class")
                || (old_key, new_key) != (Name::NONE, Name::NONE)
                || !crate::hints::is_read_in_html(name));
        let can_be_hint = !is_only_for_selectors && crate::hints::can_be_hint(element, name);
        let attribute = &mut element.attributes.to_mut()[index];
        let classes = value
            .as_ref()
            .filter(|_| name == name!("class"))
            .map(|value| self.class_lists.find(value, || value.clone(), ignores_case));
        let (old_id, mut new_id, has_value) = (element.id, element.id, value.is_some());
        if name == name!("id") {
            new_id = value
                .as_ref()
                .filter(|it| !it.is_empty())
                .map_or(Name::NONE, |it| Name::new(it.as_bytes()));
        }
        match value {
            Some(value) => {
                (attribute.value, attribute.key) = (
                    classes
                        .as_ref()
                        .filter(|it| it.source.is_ascii())
                        .map_or(value, |it| it.source.clone()),
                    new_key,
                )
            }
            None => _ = element.attributes.to_mut().remove(index),
        }
        element.id = new_id;
        if name == name!("style") {
            element.style_source = StyleSource::Attribute;
        }
        let old = if name == name!("class") {
            core::mem::replace(&mut element.classes, classes.clone())
        } else {
            None
        };
        let keys = crate::selector::filter_of(element);
        if !is_rendered {
            element.is_unprepared |= name == name!("style") || can_be_hint;
            return self.tree.set_keys(id, keys);
        }
        let own_key = |has: bool| {
            if has && name != name!("class") {
                key::attribute(name)
            } else {
                Name::NONE
            }
        };
        for (old, new) in [(own_key(!is_new), own_key(has_value)), (old_key, new_key)] {
            self.attribute_keys.add(new);
            self.attribute_keys.remove(old);
        }
        self.tree.set_keys(id, keys);
        if let Some(accessibility) = &mut self.accessibility {
            accessibility.attribute_changed(&self.tree, id, name, [old_id, new_id]);
        }
        self.tree.visit(id).set(0);
        if is_new || new_id != old_id || classes.is_some() {
            self.activate_rules(id);
        } else if key::is_in_selectors(new_key) {
            self.activate_key(id, new_key);
        }
        if name == name!("class") {
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
        } else if name == name!("id") {
            [old_id, new_id]
                .into_iter()
                .for_each(|it| self.feature_changed(id, key::id(it)));
        } else if name == name!("style") {
            self.update_inline_style(id);
            self.tree.mark_style(id, Flags::REANIMATE);
        }
        let dependencies = self.styles.dependencies.get_mut();
        [old_key, new_key]
            .into_iter()
            .filter(|it| key::is_in_selectors(*it))
            .for_each(|it| dependencies.feature_changed(&self.tree, id, it));
        dependencies.feature_changed(&self.tree, id, key::attribute(lower));
        if has_space {
            [name, name!("\0")]
                .into_iter()
                .for_each(|it| self.feature_changed(id, key::attribute(it)));
        }
        self.recascade_readers_of_attribute(id, name);
        let Some(element) = self.tree.element(id).filter(|_| !is_only_for_selectors) else {
            return;
        };
        let (tag, is_math) = (element.html_tag(), element.namespace == Namespace::MathMl);
        if can_be_hint
            && name == name!("transform")
            && element.namespace == Namespace::Svg
            && self.move_svg_element(id)
        {
            return self.svg_element_moved(id);
        }
        if can_be_hint {
            self.hint_changed(id, name);
        }
        if is_math {
            self.math_changed(id);
        }
        if crate::hints::can_change_state(name) {
            if name == name!("dir") {
                self.tree.ancestry.forget_all();
            }
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
            for cell in cells {
                self.update_hints(cell);
            }
        }
        if name == name!("id") {
            self.id_changed(id);
        }
        if is_name!(name, "requiredExtensions" | "systemLanguage") {
            self.mark_parent_rebuild(id);
        }
        if self.tree.element(id).is_some_and(crate::smil::is_animation) {
            self.smil.changed(id);
        }
        self.svg_changed(id);
    }

    pub(crate) fn relayout(&mut self, id: NodeId) {
        self.relayout_with(id, false);
    }

    pub(crate) fn relayout_with(&mut self, id: NodeId, keeps_static_position: bool) {
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
                    .chain([own])
                    .for_each(|it| self.boxes[it].cache.clear());
            }
            if self.boxes[own].is_cell() {
                self.boxes.forget_replaced_in_cell(own);
            }
            self.boxes.mark_layout_with(own, keeps_static_position);
            self.needs_layout = self.needs_layout || !self.boxes.is_parked(own);
        }
    }

    pub(crate) fn use_media_styles(&mut self) {
        if !self.environment.has_media {
            self.set_environment(Environment {
                has_media: true,
                ..self.environment.clone()
            });
        }
    }

    pub(crate) fn set_pseudo(&mut self, id: NodeId, name: &[u8], originator: NodeId) {
        if let Some(element) = self.tree.element_mut(id) {
            element.set_pseudo(Pseudo::from_name(name), originator);
            self.tree.mark_style(id, Flags::REMATCH);
        }
    }

    pub(crate) fn assign_slot(&mut self, slot: NodeId, nodes: Vec<NodeId>) {
        let stay: Set<_> = nodes.iter().copied().collect();
        let old: Vec<_> = self
            .tree
            .flat_children(slot)
            .filter(|it| !stay.contains(it))
            .collect();
        for id in old {
            self.stop_rendering(id);
            self.tree[id].slot = 0;
        }
        let new: Vec<_> = nodes
            .iter()
            .copied()
            .filter(|it| self.tree[*it].slot != slot)
            .collect();
        for id in &new {
            self.stop_rendering(*id);
            self.unassign(*id);
            self.tree[*id].slot = slot;
        }
        if let Some(element) = self.tree.element_mut(slot) {
            element.rare_mut().assigned = nodes;
        }
        self.tree[slot].set(Flags::REDIRECTS_CHILDREN);
        self.assigned_changed(slot, new);
    }

    fn assigned_changed(&mut self, slot: NodeId, new: impl IntoIterator<Item = NodeId>) {
        self.tree.ancestry.forget_all();
        self.slot_changed(slot);
        new.into_iter().for_each(|it| self.start_rendering(it));
        self.start_rendering_fallback(slot);
        self.mark_rebuild(slot);
    }

    fn start_rendering_fallback(&mut self, slot: NodeId) {
        if self
            .tree
            .element(slot)
            .is_some_and(|it| it.assigned.is_empty())
        {
            let mut child = self.tree[slot].first_child;
            while child != 0 {
                self.start_rendering(child);
                child = self.tree[child].next;
            }
        }
    }

    /// `id` has no slot. They are in the order of the tree.
    pub(crate) fn add_to_slot(&mut self, slot: NodeId, id: NodeId) {
        if self.tree[id].slot != 0 {
            return;
        }
        if self
            .tree
            .element(slot)
            .is_none_or(|it| it.assigned.is_empty())
        {
            return self.assign_slot(slot, vec![id]);
        }
        let (mut previous, mut next) = (self.tree[id].previous, self.tree[id].next);
        let is_end = |it: NodeId| it == 0 || self.tree[it].slot == slot;
        while !is_end(next) && !is_end(previous) {
            (previous, next) = (self.tree[previous].previous, self.tree[next].next);
        }
        let is_by_next = is_end(next);
        self.tree[id].slot = slot;
        if let Some(element) = self.tree.element_mut(slot) {
            let assigned = &mut element.rare_mut().assigned;
            let index = match is_by_next {
                true => assigned
                    .iter()
                    .take_while(|_| next != 0)
                    .position(|it| *it == next)
                    .unwrap_or(assigned.len()),
                false => assigned
                    .iter()
                    .rposition(|it| *it == previous)
                    .map_or(0, |it| it + 1),
            };
            assigned.insert(index, id);
        }
        self.assigned_changed(slot, [id]);
    }

    /// It may be gone already.
    pub(crate) fn remove_from_slot(&mut self, slot: NodeId, id: NodeId) {
        if self.tree[id].slot == slot {
            self.stop_rendering(id);
            self.unassign(id);
        }
        self.assigned_changed(slot, []);
    }

    pub(crate) fn set_replaced(&mut self, id: NodeId, replaced: Option<Replaced>) {
        let Some(element) = self.tree.element_mut(id) else {
            return;
        };
        let old = core::mem::replace(&mut element.rare_mut().replaced, replaced);
        if element.shadow_root != 0 && (old.is_none() || replaced.is_none()) {
            self.tree.mark_style(id, Flags::RECASCADE);
        }
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

    /// As of the last time that it was styled.
    pub(crate) fn was_displayed(&self, id: NodeId) -> bool {
        self.tree
            .style(id)
            .is_some_and(|it| it.display() != crate::types::Display::None)
    }

    pub(crate) fn set_top_layer(&mut self, mut nodes: Vec<NodeId>) {
        nodes.retain(|it| *it != self.tree.root_element());
        let [old, new] = [&self.top_layer, &nodes].map(|it| it.iter().copied().collect::<Set<_>>());
        self.leaving_top_layer = self
            .top_layer
            .iter()
            .copied()
            .filter(|it| !new.contains(it))
            .collect();
        for id in &nodes {
            if !old.contains(id) {
                if self.was_displayed(*id) {
                    self.mark_parent_rebuild(*id);
                }
                self.detach_box(*id);
                self.tree[*id].set(Flags::TOP_LAYER);
                self.tree.mark_style(*id, Flags::REMATCH | Flags::RECASCADE);
            }
        }
        let mut nodes = nodes.into_iter();
        let kept: Vec<_> = self
            .top_layer
            .iter()
            .filter_map(|it| {
                if new.contains(it) {
                    nodes.next()
                } else {
                    Some(*it)
                }
            })
            .collect();
        self.top_layer = kept.into_iter().chain(nodes).collect();
        self.relevance_changed();
        self.mark_rebuild(DOCUMENT);
    }

    // ───────────────────────────── style sheets ─────────────────────────────

    pub(crate) fn within(&self) -> Within {
        if self.environment.quirks == Quirks::All {
            Within::Quirks
        } else {
            Within::Style
        }
    }

    pub(crate) fn compile_sheet(
        &mut self,
        source: Source,
        base_url: &Rc<[u8]>,
        media: &[u8],
        owner: NodeId,
        edited: Vec<(u32, Rc<Block>)>,
    ) -> Compiling {
        let with = Parameters {
            base_url: Rc::clone(base_url),
            media: media.into(),
            owner,
            within: self.within(),
        };
        if !edited.is_empty() {
            return Compiling::Done(Rc::new(Sheet::with_blocks(source, &with, edited)));
        }
        let hash = keyed_hash((bun_wyhash::hash(&source), base_url, media, with.within));
        let known = self
            .prepared
            .iter()
            .position(|it| **it.source() == *source)
            .map(|it| self.prepared.swap_remove(it));
        if let Some(sheet) = Sheet::shared(hash, owner, &source) {
            Compiling::Done(sheet)
        } else if source.len() >= Prepared::WORTHWHILE && Prepared::cannot_import(&source) {
            Compiling::Scanning(known.unwrap_or_else(|| Prepared::new(source)), with, hash)
        } else {
            Compiling::Done(Sheet::with_blocks(source, &with, edited).share(hash, owner))
        }
    }

    /// `compile_sheet` goes on with a scan, and shares a sheet for as long as it is held.
    pub(crate) fn take_back(&mut self, outdated: Compiling) -> Option<Rc<Sheet>> {
        match outdated {
            Compiling::Done(sheet) => Some(sheet),
            Compiling::Scanning(prepared, ..) => {
                self.prepared.push(prepared);
                None
            }
        }
    }

    pub(crate) fn prepare_sheet(&mut self, source: &[u8]) {
        let is_used = || {
            self.styles
                .scopes
                .values()
                .any(|it| it.borrow().sheets().any(|it| **it.source() == *source))
        };
        if source.len() >= Prepared::WORTHWHILE
            && self.prepared.len() < 8
            && Prepared::cannot_import(source)
            && self.prepared_source(source).is_none()
            && !is_used()
        {
            self.prepared.push(Prepared::new(Source::of_sheet(source)));
        }
    }

    pub(crate) fn prepare_sheet_from_utf8(&mut self, source: &[u8]) {
        if bun_core::strings::is_valid_utf8(source) {
            self.prepare_sheet(source.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(source));
        }
    }

    /// <https://encoding.spec.whatwg.org/#utf-8-decode>
    pub(crate) fn source_from_utf8(&self, bytes: &[u8]) -> Source {
        let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        match self.prepared_source(bytes) {
            Some(known) => known.clone(),
            None if bun_core::strings::is_valid_utf8(bytes) => Source::of_sheet(bytes),
            None => Source::copy_of(
                &bytes
                    .utf8_chunks()
                    .flat_map(|it| {
                        [
                            it.valid(),
                            if it.invalid().is_empty() {
                                ""
                            } else {
                                "\u{fffd}"
                            },
                        ]
                    })
                    .collect::<String>()
                    .into_bytes(),
            ),
        }
    }

    fn prepared_source(&self, source: &[u8]) -> Option<&Source> {
        self.prepared
            .iter()
            .map(Prepared::source)
            .find(|it| ***it == *source)
    }

    pub(crate) fn set_cue_styles(&mut self, scope: NodeId, sources: &[Box<[u8]>]) {
        let base_url = crate::values::SELF_CONTAINED.into();
        let sheets: Vec<_> = sources
            .iter()
            .map(|it| {
                self.compile_sheet(Source::copy_of(it), &base_url, b"", 0, Vec::new())
                    .finish()
            })
            .collect();
        self.set_sheets(scope, &sheets);
        self.tree.mark_style(
            self.tree[self.tree.host_of(scope)].parent,
            Flags::REMATCH_SUBTREE | Flags::RECASCADE,
        );
    }

    pub(crate) fn set_sheets(&mut self, scope: NodeId, sheets: &[Rc<Sheet>]) {
        let old: Vec<_> = (self.styles.scopes.get(&scope))
            .map_or(Vec::new(), |it| it.borrow().sheets().cloned().collect());
        if old.iter().map(Rc::as_ptr).eq(sheets.iter().map(Rc::as_ptr)) {
            return;
        }
        let is_in =
            |list: &[Rc<Sheet>], sheet: &Rc<Sheet>| list.iter().any(|it| Rc::ptr_eq(it, sheet));
        let changed: Vec<_> = (old.iter().filter(|it| !is_in(sheets, it)))
            .chain(sheets.iter().filter(|it| !is_in(&old, it)))
            .collect();
        let dependencies = self.styles.dependencies.get_mut();
        let (mut subjects, mut is_reordered) = (None, false);
        if scope == DOCUMENT {
            let mut rules = self.styles.scopes.entry(scope).or_default().borrow_mut();
            subjects = rules.set_sheets(sheets, &self.environment, dependencies);
            is_reordered = rules.was_reordered;
        } else {
            let pointers: Vec<_> = sheets.iter().map(Rc::as_ptr).collect();
            let hash = keyed_hash(pointers);
            let rules = self.shared_rules.entry(hash).or_insert_with(|| {
                let mut rules = RuleSet::default();
                rules.set_sheets(sheets, &self.environment, dependencies);
                Rc::new(RefCell::new(rules))
            });
            self.styles.scopes.insert(scope, Rc::clone(rules));
        }
        self.definitions_changed(scope, &|kind| {
            changed.iter().any(|it| it.has(kind))
                || is_reordered && sheets.iter().any(|it| it.has(kind))
        });
        let root = if scope == DOCUMENT {
            self.tree.root_element()
        } else {
            self.tree.host_of(scope)
        };
        if root == 0 {
            return;
        }
        self.forget_highlights();
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
    }

    fn definitions_changed(&mut self, scope: NodeId, has: &dyn Fn(AtKind) -> bool) {
        if scope == DOCUMENT && has(AtKind::FontFace) {
            (self.font_faces_changed, self.font_faces_version) =
                (true, self.font_faces_version + 1);
        }
        if scope == DOCUMENT && has(AtKind::Property) {
            self.update_registry();
        }
        let root = if scope == DOCUMENT {
            self.tree.root_element()
        } else {
            self.tree.host_of(scope)
        };
        if root == 0 {
            return;
        }
        if has(AtKind::CounterStyle) {
            self.counters_are_stale = true;
            self.rebuild_everything();
        }
        if has(AtKind::Function) || has(AtKind::FontPaletteValues) || has(AtKind::FontFeatureValues)
        {
            self.recascade_everything();
        }
        if has(AtKind::PositionTry) {
            self.forget_position_options();
        }
        if has(AtKind::Keyframes) {
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

    pub(crate) fn is_registered_by_script(&self, name: Name) -> bool {
        self.registered_by_script.contains_key(&name)
    }

    pub(crate) fn matches_media(&mut self, query: &[u8]) -> bool {
        if self.media_queries.len() > 256 {
            self.media_queries.clear();
        }
        let parsed = self
            .media_queries
            .entry(keyed_hash(query))
            .or_insert_with(|| crate::condition::media_list(query).0);
        parsed.evaluate(&self.environment) == Some(true)
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
        self.environment.generation = new_generation();
        self.styles.forget_values();
        self.tree
            .mark_style(self.tree.root_element(), Flags::RECASCADE_SUBTREE);
    }

    /// Returns whether that is news.
    pub(crate) fn set_displayed(&mut self, is_displayed: bool) -> bool {
        if is_displayed == self.offset_when_displayed.is_none() {
            return false;
        }
        match self.offset_when_displayed.take() {
            Some(offset) => {
                self.scrolling.viewport = offset;
                self.resized_scrollers.push(DOCUMENT);
            }
            None => {
                self.offset_when_displayed = Some(core::mem::take(&mut self.scrolling.viewport))
            }
        }
        let root = self.tree.root_element();
        if root != 0 {
            self.tree
                .mark_style(root, Flags::REMATCH | Flags::RECASCADE);
        }
        self.needs_layout = true;
        true
    }

    pub(crate) fn set_environment(&mut self, new: Environment) {
        let old = core::mem::replace(&mut self.environment, new);
        if old == self.environment {
            return;
        }
        self.needs_layout = true;
        self.environment_changes += 1;
        self.forget_highlights();
        let new = &self.environment;
        match (
            old.zoom,
            old.overlay_scrollbars,
            old.scale,
            old.dark,
            old.highlight,
            old.palette,
            old.forces_colors,
        ) == (
            new.zoom,
            new.overlay_scrollbars,
            new.scale,
            new.dark,
            new.highlight,
            new.palette,
            new.forces_colors,
        ) {
            true => self.pictures.outdate(),
            false => self.pictures.discard(),
        }
        let mut affected = crate::rules::Subjects::default();
        self.styles
            .user_agent
            .get_mut()
            .evaluate_media(new, false, &mut affected);
        for (rules, is_of_document) in self
            .styles
            .scopes
            .get(&DOCUMENT)
            .into_iter()
            .map(|it| (it, true))
            .chain(self.shared_rules.values().map(|it| (it, false)))
        {
            rules
                .borrow_mut()
                .evaluate_media(new, is_of_document, &mut affected);
        }
        if (
            old.quirks,
            old.has_math,
            old.has_media,
            old.forces_colors,
            old.fixes_text_areas,
        ) != (
            new.quirks,
            new.has_math,
            new.has_media,
            new.forces_colors,
            new.fixes_text_areas,
        ) {
            self.styles.set_user_agent_sheets(new);
            affected.is_everything |= (old.quirks, old.forces_colors, old.fixes_text_areas)
                != (new.quirks, new.forces_colors, new.fixes_text_areas);
            self.class_lists.clear();
        }
        let root = self.tree.root_element();
        if affected.is_everything {
            self.tree.mark_style(root, Flags::REMATCH_SUBTREE);
        } else if root != 0 {
            affected.mark(&self.tree, root);
            if let Some(rules) = self.styles.scopes.get(&DOCUMENT) {
                affected.check(&self.tree, &rules.borrow(), &self.styles.has_results);
            }
        }
        self.definitions_changed(DOCUMENT, &|kind| affected.definitions.contains(&kind));
        let new = &self.environment;
        if old.scale != new.scale {
            self.fonts.device_scale = new.scale;
            self.fonts_changed();
        } else if (
            old.dark,
            old.highlight,
            old.palette,
            old.color_scheme,
            old.forces_colors,
            old.quirks,
        ) != (
            new.dark,
            new.highlight,
            new.palette,
            new.color_scheme,
            new.forces_colors,
            new.quirks,
        ) {
            self.recascade_everything();
        } else if (old.viewport, old.titlebar_area) != (new.viewport, new.titlebar_area) {
            self.environment.viewport_generation = new_generation();
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
            for it in asked {
                self.container_changed(it, false);
            }
        }
        let new = &self.environment;
        if (
            old.zoom,
            old.overlay_scrollbars,
            old.quirks,
            old.cannot_scroll,
            old.is_object,
        ) != (
            new.zoom,
            new.overlay_scrollbars,
            new.quirks,
            new.cannot_scroll,
            new.is_object,
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

    pub(crate) fn set_user_sheets(&mut self, sheets: Vec<Rc<Sheet>>) {
        if !sheets
            .iter()
            .map(Rc::as_ptr)
            .eq(self.styles.user_sheets.iter().map(Rc::as_ptr))
        {
            self.styles.user_sheets = sheets;
            self.styles.set_user_agent_sheets(&self.environment);
            self.forget_highlights();
            self.tree
                .mark_style(self.tree.root_element(), Flags::REMATCH_SUBTREE);
            self.definitions_changed(DOCUMENT, &|_| true);
        }
    }

    pub(crate) fn set_font_settings(
        &mut self,
        settings: &Option<std::sync::Arc<bun_web::host::FontSettings>>,
    ) {
        if self.fonts.settings != *settings {
            self.fonts.settings.clone_from(settings);
            self.fonts_changed();
            let units = self.styles.initial.root_units();
            self.set_environment(Environment {
                initial_font: units,
                root_font: units,
                ..self.environment.clone()
            });
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
        if self.fonts.used_by_canvases.insert(used) {
            self.fonts.used.get_mut().insert(used);
            self.fonts.newly_used.get_mut().push(used);
        }
        self.request_fonts();
    }

    pub(crate) fn font_faces(&self) -> Vec<Rc<FontFace>> {
        self.styles
            .scopes
            .get(&DOCUMENT)
            .map_or(Vec::new(), |it| it.borrow().font_faces())
    }

    pub(crate) fn take_font_requests(&mut self) -> Vec<Rc<FontFace>> {
        self.request_fonts();
        let of_externals = self
            .externals
            .values_mut()
            .flatten()
            .filter_map(|it| it.font_requests.take());
        self.font_requests
            .take()
            .into_iter()
            .chain(of_externals)
            .flatten()
            .collect()
    }

    #[inline]
    pub(crate) fn request_fonts(&mut self) {
        if !self.fonts.newly_written.get_mut().is_empty()
            || !self.fonts.newly_used.get_mut().is_empty()
            || self.font_faces_changed
        {
            self.request_new_fonts();
        }
    }

    fn request_new_fonts(&mut self) {
        let (written, fonts) = (
            core::mem::take(self.fonts.newly_written.get_mut()),
            &self.fonts,
        );
        let is_needed = |(wanted, _, coverage): &mut (Wanted, _, Coverage)| {
            written
                .iter()
                .any(|(font, it)| fonts.is_for(*font, *wanted) && coverage.has(*it))
        };
        let mut needed: Vec<_> = self
            .deferred_fonts
            .extract_if(.., is_needed)
            .map(|it| it.1)
            .collect();
        let newly_used = core::mem::take(self.fonts.newly_used.get_mut());
        let changed = core::mem::take(&mut self.font_faces_changed);
        let faces = if changed || !newly_used.is_empty() {
            self.font_faces()
        } else {
            Vec::new()
        };
        if changed {
            self.requested_fonts
                .retain(|face| faces.iter().any(|it| Rc::ptr_eq(it, face)));
            self.font_requests.get_or_insert_default();
            self.deferred_fonts.clear();
            needed.clear();
        }
        let (known, unnoticed) = (self.deferred_fonts.len(), OnceCell::<Set<char>>::new());
        let shaped = (changed || self.fonts.has_written.get()).then_some(self.shaped.get_mut());
        let texts = || {
            shaped.iter().flat_map(|it| {
                it.values()
                    .map(|it| &*it.text)
                    .chain(self.boxes.edited_texts())
            })
        };
        let unnoticed = || unnoticed.get_or_init(|| texts().flat_map(str::chars).collect());
        let used = if changed {
            self.fonts.used.get_mut().iter().copied().collect()
        } else {
            newly_used
        };
        for wanted in used {
            let of_family = || {
                faces
                    .iter()
                    .filter(|it| Name::lowercase(it.family.as_bytes()) == wanted.0)
            };
            let distance = |face: &FontFace| face.distance(wanted.1.map(f32::from_bits));
            let best = of_family().map(|it| distance(it)).min();
            let matching: Vec<_> = of_family()
                .filter(|it| Some(distance(it)) == best)
                .map(|it| (it, it.coverage()))
                .collect();
            // The renderer chooses among the faces that are loaded.
            let may_wait = !self.fonts.used_by_canvases.contains(&wanted)
                && (matching.len() == of_family().count()
                    || matching.iter().any(|it| it.1.has(' ')));
            for (face, coverage) in matching {
                // The metrics are those of the face that has the space.
                match !may_wait
                    || coverage.has(' ')
                    || unnoticed().iter().any(|it| coverage.has(*it))
                {
                    true => needed.push(Rc::clone(face)),
                    false => self
                        .deferred_fonts
                        .push((wanted, Rc::clone(face), coverage)),
                }
            }
        }
        if changed || !needed.is_empty() || self.deferred_fonts.len() != known {
            self.fonts
                .wait_for(self.deferred_fonts.iter().map(|it| &it.2));
        }
        needed.into_iter().for_each(|it| self.request_font(it));
    }

    fn request_font(&mut self, face: Rc<FontFace>) {
        if !self.requested_fonts.iter().any(|it| Rc::ptr_eq(it, &face)) {
            self.requested_fonts.push(Rc::clone(&face));
            self.font_requests.get_or_insert_default().push(face);
        }
    }

    /// Asks for it the first time.
    pub(crate) fn image(&self, url: &Str) -> Option<Replaced> {
        self.svg_has_read(crate::svg_paint::Reads::REFERENCES);
        *self
            .images
            .borrow_mut()
            .entry(Rc::clone(url))
            .or_insert_with(|| {
                self.requests
                    .borrow_mut()
                    .push(Request::Image(Rc::clone(url)));
                None
            })
    }

    pub(crate) fn shape_image(&self, url: &Str, user: NodeId) -> Option<Replaced> {
        let url = &crate::values::with_cors(url);
        let (image, mut waiting) = (self.image(url), self.shape_images.borrow_mut());
        if image.is_none() && !waiting.iter().any(|it| it.1 == user && it.0 == *url) {
            waiting.push((Rc::clone(url), user));
        }
        image.filter(|it| it.image != 0)
    }

    /// The URL says whether to ignore the orientation.
    pub(crate) fn oriented_url(&self, url: &Str, style: &Style) -> Str {
        match style.other_if_set(crate::properties::Id::ImageOrientation) {
            Some(_) if !self.is_cross_origin(url) => format!("unoriented:{url}").into(),
            _ => Rc::clone(url),
        }
    }

    pub(crate) fn oriented_image(&self, url: &Str, style: &Style) -> Option<Replaced> {
        self.image(&self.oriented_url(url, style))
    }

    pub(crate) fn set_image(&mut self, url: &str, image: Replaced) {
        self.images.get_mut().insert(url.into(), Some(image));
        let users: Vec<_> = self
            .generated_images
            .iter()
            .filter(|it| &*it.1.0 == url)
            .map(|it| (*it.0, it.1.1))
            .collect();
        for (id, resolution) in users {
            self.set_replaced(id, Some(image.at_resolution(resolution)));
            if image == Replaced::default() {
                self.generated_image_is_broken(id);
            }
        }
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
        if !self.needs_layout
            && self.moved_boxes.is_empty()
            && self.queries.fresh.is_empty()
            && self.scrolling.repositioned.is_empty()
            && self.is_styled()
        {
            return self.request_fonts();
        }
        self.restyle_and_lay_out();
    }

    fn restyle_and_lay_out(&mut self) {
        for _ in 0..16 {
            self.update_style();
            self.request_fonts();
            self.needs_layout |= self.note_visibility_of_anchors();
            if !self.needs_layout {
                self.update_scrollers_of_moved_boxes();
            }
            if !self.needs_layout {
                break;
            }
            if !self.carousels.is_empty() {
                self.assign_markers();
            }
            self.update_counters();
            let anchors = self.select_scroll_anchors();
            self.scrolling.repositioned.clear();
            self.move_boxes();
            self.number_stale_lists();
            self.rebuild_boxes();
            if !self.stale_lists.is_empty() {
                self.number_stale_lists();
                self.rebuild_boxes();
                self.stale_lists.clear();
            }
            for node in core::mem::take(&mut self.moved_boxes) {
                self.moved_boxes_in_scrollers.extend(self.own_box(node));
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
                (self.queries.laid_out, self.queries.are_settling) =
                    (self.queries.fresh.len(), true);
            }
        }
        (self.queries.laid_out, self.queries.are_settling) = (0, false);
        self.queries.fresh.clear();
        self.queries.before.clear();
        self.queries.with_new_scrollbars.clear();
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
            let is_foreign = self.has_foreign_objects
                && self.tree.element(*id).is_some_and(|it| {
                    (it.namespace, it.tag) == (Namespace::Svg, name!("foreignObject"))
                });
            let own = self.own_box(*id).filter(|_| {
                contain.intersects(Contain::SIZE | Contain::INLINE_SIZE) && !is_foreign
            });
            let size = own.map(|own| {
                let ([_, _, width, height], [top, right, bottom, left], it) =
                    (self.content_box(own), self.gutters(own), &self.boxes[own]);
                let is_stable = |axis: usize| {
                    !it.style.layout.scrollbar_gutter.is_empty()
                        && it.mode.is_vertical() == (axis == 0)
                };
                let if_assumed_away = |axis: usize, size: f32| {
                    if it.overflow[axis] == Overflow::Auto && !is_stable(axis) {
                        size
                    } else {
                        0.0
                    }
                };
                [
                    width + if_assumed_away(1, left + right),
                    height + if_assumed_away(0, top + bottom),
                ]
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
                element.rare_mut().container_size = size;
            }
        }
        if !changed.is_empty() && !self.marks.is_empty() {
            self.forget_highlights();
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
        let backdrop = self
            .tree
            .element(id)
            .map(|it| it.generated[crate::tree::BACKDROP]);
        for child in self
            .rendered_children(id)
            .chain(backdrop)
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
        self.tree.sequence.frame_ended();
        self.edits.frame_ended();
        self.reads.frame_ended();
        self.boxes.sweep(self.animations.now, &self.styles.initial);
        self.styles.collect_garbage(nodes);
        let shaped = self.shaped.get_mut();
        if shaped.len() > nodes + 2048 {
            shaped.retain(|_, it| Rc::strong_count(it) > 1);
        }
        if self.class_lists.all.len() > nodes + 4096 {
            self.class_lists
                .all
                .retain(|_, it| Rc::strong_count(it) > 1);
        }
        if self.shared_rules.len() > 8 {
            self.shared_rules
                .retain(|_, rules| Rc::strong_count(rules) > 1);
        }
        self.prepared.clear();
        crate::values::release_parser_memory();
    }

    fn expect_foreign(&mut self, tag: Name, namespace: Namespace) {
        if namespace == Namespace::MathMl && !self.environment.has_math {
            self.set_environment(Environment {
                has_math: true,
                ..self.environment.clone()
            });
        }
        self.has_foreign_objects |= tag == name!("foreignObject");
    }

    #[inline]
    pub(crate) fn create_element(
        &mut self,
        local: Atom,
        namespace: Namespace,
        space: Option<Rc<Space>>,
    ) -> NodeId {
        let tag = local.name();
        if namespace != Namespace::Html {
            self.expect_foreign(tag, namespace);
        }
        self.tree.create_element(
            tag,
            namespace,
            filter(core::iter::once(key::tag(tag))),
            |element| {
                element.local = local;
                space
                    .into_iter()
                    .for_each(|it| element.rare_mut().space = Some(it));
            },
        )
    }

    fn element_without_attributes(
        &mut self,
        tag: Name,
        local: Atom,
        namespace: Namespace,
    ) -> Box<Element> {
        if namespace != Namespace::Html {
            self.expect_foreign(tag, namespace);
        }
        self.tree.new_element(tag, namespace, |it| it.local = local)
    }

    /// The names of the attributes differ, and are in no namespace.
    #[inline]
    pub(crate) fn element_with(
        &mut self,
        local: Atom,
        namespace: Namespace,
        attributes: impl ExactSizeIterator<Item = (Atom, StoredText)>,
        ignores_case: bool,
    ) -> Box<Element> {
        let tag = local.name();
        let mut element = self.element_without_attributes(tag, local, namespace);
        let mut all = Vec::with_capacity(attributes.len());
        for (local, mut value) in attributes {
            let name = local.name();
            let key = key::value(name, local.as_utf8().as_bytes(), value.as_bytes());
            if name == name!("class") {
                let classes = element.classes.insert(self.class_lists.find(
                    &value,
                    || value.clone(),
                    ignores_case,
                ));
                value = if classes.source.is_ascii() {
                    classes.source.clone()
                } else {
                    value
                };
            } else if name == name!("id") && !value.is_empty() {
                element.id = Name::new(value.as_bytes());
            }
            let is_only_for_selectors = namespace == Namespace::Html
                && (name == name!("class")
                    || key != Name::NONE
                    || name == name!("type") && is_name!(tag, "input" | "button"));
            element.is_unprepared |= name == name!("style")
                || !is_only_for_selectors && crate::hints::can_be_hint(&element, name);
            all.push(Attribute {
                name,
                local,
                space: None,
                value,
                key,
            });
        }
        element.attributes = crate::tree::Attributes::Own(all);
        element
    }

    #[inline(always)]
    pub(crate) fn likeness_of(&mut self, id: NodeId) -> Option<Likeness> {
        let keys = self.tree[id].keys;
        Some(Likeness::of(self.tree.element_mut(id)?, keys))
    }

    #[inline(always)]
    pub(crate) fn create_like(
        &mut self,
        Likeness {
            tag,
            namespace,
            local,
            space,
            is_unprepared,
            id,
            classes,
            attributes,
            keys,
        }: Likeness,
    ) -> NodeId {
        self.tree.create_element(tag, namespace, keys, |element| {
            (
                element.local,
                element.is_unprepared,
                element.id,
                element.classes,
                element.attributes,
            ) = (local, is_unprepared, id, classes, attributes);
            space
                .into_iter()
                .for_each(|it| element.rare_mut().space = Some(it));
        })
    }

    #[inline(always)]
    pub(crate) fn element_like(&mut self, it: &Likeness) -> Box<Element> {
        self.tree.new_element(it.tag, it.namespace, |element| {
            (
                element.local,
                element.is_unprepared,
                element.id,
                element.classes,
                element.attributes,
            ) = (
                it.local.clone(),
                it.is_unprepared,
                it.id,
                it.classes.clone(),
                it.attributes.clone(),
            );
            it.space
                .iter()
                .for_each(|it| element.rare_mut().space = Some(Rc::clone(it)));
        })
    }

    /// For a document with other quirks.
    pub(crate) fn reclassify(&mut self, root: NodeId, is_quirky: bool) {
        let mut affected = Vec::new();
        self.tree.visit_subtree(root, |id| {
            affected.extend(
                self.tree
                    .element(id)
                    .and_then(|it| it.classes.as_ref())
                    .filter(|it| it.has_capitals)
                    .map(|it| (id, it.source.clone())),
            )
        });
        for (id, source) in affected {
            if let Some(index) = self.tree.element(id).and_then(|it| {
                it.attributes
                    .iter()
                    .position(|it| it.name == name!("class"))
            }) {
                self.change_attribute(id, Ok(index), Some(source), is_quirky);
            }
        }
    }

    /// With its attributes.
    pub(crate) fn copy_element(&mut self, from: NodeId) -> NodeId {
        self.tree.prefetch_after(from);
        let copy = self.likeness_of(from).map_or(0, |it| self.create_like(it));
        if self.has_edited_style(from) {
            self.count_style_as_edited(copy);
        }
        copy
    }
}
