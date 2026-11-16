//! SVG files that are shown as images, or that have what a document refers to.

use core::cell::{Cell, RefCell};
use core::mem::ManuallyDrop;
use std::rc::Rc;

use bun_ast::E::JsonValue;
use bun_core::strings;
use bun_parsers::xml;

use crate::abi::{Item, Rect, RoundedRect, Tile};
use crate::document::{Document, Environment};
use crate::geometry::translation;
use crate::name::{Map, Name, name};
use crate::paint::{Painter, Picture, Space, square};
use crate::svg::{Node, percent_decoded, scaling, view_box};
use crate::tree::{DOCUMENT, Data, Namespace, NodeId, Replaced, State};
use crate::types::*;
use crate::values::{Ctx, Lp, Size, Str, text};

/// In the id of an image that the library does not know.
const VECTOR: u32 = 1 << 31;
use crate::recovery::attempt;

const MAX_NESTING: u32 = 8;

#[derive(Clone, Copy, PartialEq)]
struct Key {
    size: [f32; 2],
    scale: f32,
    is_dark: bool,
}

struct Vector {
    source: Box<[u8]>,
    url: Box<[u8]>,
    font_scope: u32,
    images: Map<Str, Option<Replaced>>,
    /// Until it has what it needs, or for as long as it is animated.
    document: Option<Box<Document>>,
    is_animated: bool,
    start: Option<f64>,
    pictures: Vec<(Key, Rc<Picture>)>,
}

thread_local! {
    static VECTORS: ManuallyDrop<RefCell<Map<u32, Rc<RefCell<Vector>>>>> = ManuallyDrop::default();
    static LAST_ID: Cell<u32> = const { Cell::new(VECTOR) };
    static NESTING: Cell<u32> = const { Cell::new(0) };
}

pub(crate) fn is_vector(image: u32) -> bool {
    image & VECTOR != 0
}

/// One that has panicked stays borrowed, and so shows nothing from then on.
fn with_vector<R>(id: u32, visit: impl FnOnce(&mut Vector) -> R) -> Option<R> {
    let vector = VECTORS.with(|it| it.borrow().get(&id).cloned())?;
    attempt(move || Some(visit(&mut *vector.try_borrow_mut().ok()?))).flatten()
}

struct Builder<'a> {
    document: Box<Document>,
    prefixes: Vec<(&'a [u8], &'a [u8])>,
    sheets: Vec<u32>,
}

impl<'a> Builder<'a> {
    fn add(&mut self, node: &'a JsonValue, parent: NodeId, depth: u32) -> Option<()> {
        let id = match node {
            JsonValue::String(data) => self.document.tree.create(Data::Text(data.slice().to_vec())),
            JsonValue::Object(node) => match node.properties() {
                [name, attributes, children] if depth < 512 => {
                    return self.add_element(
                        [&name.value, &attributes.value, &children.value],
                        parent,
                        depth,
                    );
                }
                _ => return Some(()),
            },
            _ => return None,
        };
        self.document.insert(parent, id, 0);
        Some(())
    }

    fn add_element(&mut self, parts: [&'a JsonValue; 3], parent: NodeId, depth: u32) -> Option<()> {
        let [
            JsonValue::String(name),
            JsonValue::Object(attributes),
            JsonValue::Array(children),
        ] = parts
        else {
            return None;
        };
        let attributes = attributes
            .properties()
            .iter()
            .filter_map(|it| match &it.value {
                JsonValue::String(value) => Some((it.key.slice(), value.slice())),
                _ => None,
            });
        let known = self.prefixes.len();
        let declared = |name: &'a [u8]| {
            if name == b"xmlns" {
                Some(&b""[..])
            } else {
                name.strip_prefix(b"xmlns:")
            }
        };
        self.prefixes.extend(
            attributes
                .clone()
                .filter_map(|(name, value)| Some((declared(name)?, value))),
        );
        let (prefix, local) =
            strings::split_once_char(name.slice(), b':').unwrap_or((b"", name.slice()));
        let namespace = match self
            .prefixes
            .iter()
            .rfind(|it| it.0 == prefix)
            .map(|it| it.1)
        {
            Some(b"http://www.w3.org/2000/svg") => Namespace::Svg,
            Some(b"http://www.w3.org/1999/xhtml") => Namespace::Html,
            Some(b"http://www.w3.org/1998/Math/MathML") => Namespace::MathMl,
            None if !prefix.is_empty() => return None,
            _ => Namespace::Other,
        };
        let id = self.document.create_element(text(local), namespace);
        for (name, value) in attributes {
            let prefixed = strings::split_once_char(name, b':').and_then(|(prefix, local)| {
                Some((local, self.prefixes.iter().rfind(|it| it.0 == prefix)?.1))
            });
            let name = prefixed.map_or_else(
                || text(name).to_owned(),
                |(local, url)| format!("{} {}", text(local), text(url)),
            );
            self.document.set_attribute(id, &name, Some(text(value)));
        }
        self.document.update_hints(id);
        self.document.insert(parent, id, 0);
        children
            .items()
            .iter()
            .try_for_each(|it| self.add(it, id, depth + 1))?;
        self.prefixes.truncate(known);
        let document = &mut self.document;
        let attribute = |name| document.tree.element(id)?.attribute(name);
        if local == b"style"
            && matches!(namespace, Namespace::Svg | Namespace::Html)
            && matches!(attribute(name!("type")), None | Some("" | "text/css"))
        {
            let source: Vec<u8> = document
                .tree
                .children(id)
                .filter_map(|it| document.tree[it].text())
                .flatten()
                .copied()
                .collect();
            let (base, media) = (
                Rc::clone(&document.base_url),
                attribute(name!("media")).unwrap_or_default().to_owned(),
            );
            self.sheets
                .push(document.create_sheet(&source, &base, media.as_bytes(), 0));
        } else if let (b"img", Namespace::Html, Some(source)) =
            (local, namespace, attribute(name!("src")))
        {
            let url = document.resolve_url(source);
            let image = document.image(&url).unwrap_or_default();
            document.generated_images.insert(id, (url, 1.0));
            document.set_replaced(id, Some(image));
        }
        Some(())
    }
}

fn parse(
    source: &[u8],
    url: &[u8],
    font_scope: u32,
    images: &Map<Str, Option<Replaced>>,
) -> Option<(Box<Document>, Vec<u32>)> {
    let arena = bun_alloc::Arena::default();
    let mut allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _scope = allocator.enter();
    let (mut log, file) = (
        bun_ast::Log::init(),
        bun_ast::Source::init_path_string(b"image.svg", source),
    );
    let options = xml::Options {
        compact: false,
        encoding: xml::InputEncoding::Bytes,
    };
    let bun_ast::expr::Data::EObjectJSON(root) =
        xml::XML::parse(&file, &mut log, &arena, options).ok()?.data
    else {
        return None;
    };
    let (root, mut document) = (
        JsonValue::Object(root),
        Box::new(Document::new(font_scope, url)),
    );
    (document.is_embedded, *document.images.get_mut()) = (true, images.clone());
    let mut builder = Builder {
        document,
        prefixes: vec![
            (b"xml", b"http://www.w3.org/XML/1998/namespace"),
            (b"xmlns", b"http://www.w3.org/2000/xmlns/"),
        ],
        sheets: Vec::new(),
    };
    let root = &root;
    attempt(move || {
        builder.add(root, DOCUMENT, 0)?;
        builder.document.set_sheets(DOCUMENT, &builder.sheets);
        Some((builder.document, builder.sheets))
    })?
}

impl Vector {
    fn open(&self) -> Option<Box<Document>> {
        let (mut document, mut sheets) =
            parse(&self.source, &self.url, self.font_scope, &self.images)?;
        let root = document.tree.root_element();
        document
            .tree
            .element(root)
            .filter(|it| it.tag == name!("svg") && it.namespace == Namespace::Svg)?;
        document.show_fragment();
        document.start_smil();
        document.update_style();
        document.natural = document.natural_size_of_root();
        const FILL: &[u8] = b":root{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;\
            max-width:none!important;max-height:none!important;overflow:hidden!important}";
        sheets.push(document.create_sheet(FILL, b"", b"", 0));
        document.set_sheets(DOCUMENT, &sheets);
        Some(document)
    }

    fn picture(&mut self, key: Key, environment: &Environment) -> Option<Rc<Picture>> {
        if let Some(known) = self.pictures.iter().find(|it| it.0 == key) {
            return Some(Rc::clone(&known.1));
        }
        let mut document = self.document.take().or_else(|| self.open())?;
        let Environment {
            generation,
            viewport_generation,
            root_font,
            ..
        } = document.environment;
        let (viewport, scale, dark) = (key.size, key.scale, key.is_dark);
        document.set_environment(Environment {
            viewport,
            scale,
            dark,
            zoom: 1.0,
            root_font,
            generation,
            viewport_generation,
            ..environment.clone()
        });
        document.update_style();
        document.start_pending_animations();
        document.update_picture();
        let picture = Rc::new(document.pictures.lend()?);
        self.is_animated = document.next_wake(false).is_finite();
        self.document = self.is_animated.then_some(document);
        self.pictures.truncate(3);
        self.pictures.insert(0, (key, Rc::clone(&picture)));
        Some(picture)
    }
}

/// 0 if it is no SVG image.
pub(crate) fn create_vector(source: &[u8], url: &[u8], font_scope: u32) -> (u32, Replaced) {
    let (source, url) = (source.into(), url.into());
    let mut vector = Vector {
        source,
        url,
        font_scope,
        images: Map::default(),
        document: None,
        is_animated: false,
        start: None,
        pictures: Vec::new(),
    };
    let Some(document) = attempt(|| vector.open()).flatten() else {
        return (0, Replaced::default());
    };
    let (id, natural) = (LAST_ID.get() + 1, document.natural);
    LAST_ID.set(id);
    vector.document = Some(document);
    VECTORS.with(|it| it.borrow_mut().insert(id, Rc::new(RefCell::new(vector))));
    (id, natural)
}

pub(crate) fn release_vector(id: u32) {
    VECTORS.with(|it| it.borrow_mut().remove(&id));
}

/// Like `Document::requests`.
pub(crate) fn vector_requests(id: u32) -> Vec<Str> {
    let requests = with_vector(id, |vector| {
        let document = vector.document.as_mut()?;
        document.update_picture();
        Some(document.requests.take())
    });
    requests.flatten().unwrap_or_default()
}

pub(crate) fn set_vector_image(id: u32, url: &str, image: Replaced) {
    with_vector(id, |vector| {
        vector.images.insert(url.into(), Some(image));
        vector
            .document
            .iter_mut()
            .for_each(|it| it.set_image(url, image));
        vector.pictures.clear();
    });
}

pub(crate) fn vector_fonts_changed(id: u32) {
    with_vector(id, |vector| {
        vector.document.iter_mut().for_each(|it| it.fonts_changed());
        vector.pictures.clear();
    });
}

impl Document {
    pub(crate) fn resolve_url(&self, url: &str) -> Str {
        Ctx {
            base_url: &self.base_url,
            ..Ctx::dummy()
        }
        .url(url.trim_ascii().as_bytes())
    }

    /// An image of the library, or 0.
    pub(crate) fn record_vector(&self, id: u32, size: [f32; 2]) -> u32 {
        let (key, environment) = (
            Key {
                size: size.map(|it| it.round().max(1.0)),
                scale: 1.0,
                is_dark: false,
            },
            &self.environment,
        );
        let picture = with_vector(id, |it| it.picture(key, environment)).flatten();
        crate::layout::set_scale_of_units(environment.scale);
        let (Some(picture), Some(renderer)) = (picture, crate::platform::renderer()) else {
            return 0;
        };
        // SAFETY: the picture outlives the call.
        unsafe { (renderer.record_image)(&picture.list(1.0), key.size[0], key.size[1]) }
    }

    pub(crate) fn image_alpha(&self, image: u32, size: [usize; 2]) -> Vec<u8> {
        if !is_vector(image) {
            return crate::platform::image_alpha(image, size);
        }
        let recorded = self.record_vector(image, size.map(|it| it as f32));
        self.requests
            .borrow_mut()
            .extend(["release".into(), recorded.to_string().into()]);
        crate::platform::image_alpha(recorded, size)
    }

    fn natural_size_of_root(&self) -> Replaced {
        let Some(root) = self.svg_node(self.tree.root_element()) else {
            return Replaced::default();
        };
        let size = [&root.style.layout.width, &root.style.layout.height].map(|it| match it {
            Size::Length(Lp::Px(length)) => Some(*length),
            _ => None,
        });
        let ratio = match size {
            [Some(width), Some(height)] => (width > 0.0 && height > 0.0).then(|| width / height),
            _ => crate::svg::ratio(root.element),
        };
        Replaced {
            image: 0,
            size,
            ratio,
        }
    }

    /// What an image without a `viewBox` is stretched from.
    pub(crate) fn synthesized_view(&self, node: &Node, rect: Rect) -> Option<Rect> {
        let [width, height] = self.natural.size;
        (self.is_embedded
            && node.uses.is_none()
            && self.tree.is_root(node.id)
            && view_box(node.element).is_none())
        .then(|| {
            Rect::new([
                0.0,
                0.0,
                width.unwrap_or(rect.width),
                height.unwrap_or(rect.height),
            ])
        })
        .filter(|it| !it.is_empty())
    }

    /// https://svgwg.org/svg2-draft/linking.html#SVGFragmentIdentifiers
    pub(crate) fn show_fragment(&mut self) {
        let Some((_, fragment)) = strings::split_once_char(&self.base_url, b'#') else {
            return;
        };
        let (fragment, root) = (percent_decoded(fragment), self.tree.root_element());
        let mut view: Vec<(&str, String)> = Vec::new();
        for part in strings::split(&fragment, b"&") {
            if let Some(list) = part
                .strip_prefix(b"svgView(")
                .and_then(|it| it.strip_suffix(b")"))
            {
                let items = strings::split(list, b";")
                    .map(|it| strings::split_once_char(it.trim_ascii().strip_suffix(b")")?, b'('));
                for (name, value) in items.collect::<Option<Vec<_>>>().unwrap_or_default() {
                    match name {
                        b"transform" => {
                            self.view_transform =
                                crate::svg::parse_transform(text(value)).unwrap_or(IDENTITY)
                        }
                        b"viewBox" | b"preserveAspectRatio" => view.push((
                            if name == b"viewBox" {
                                "viewBox"
                            } else {
                                "preserveAspectRatio"
                            },
                            text(value).to_owned(),
                        )),
                        _ => {}
                    }
                }
            } else if let Some(target) = self.svg_element_by_id(root, Name::new(part)) {
                self.change_state(target, State::TARGET);
                let Some(element) = self
                    .tree
                    .element(target)
                    .filter(|it| it.tag == name!("view"))
                else {
                    continue;
                };
                view.extend(
                    view_box(element)
                        .and(element.attribute(name!("viewBox")))
                        .map(|it| ("viewBox", it.to_owned())),
                );
                view.extend(
                    element
                        .attribute(name!("preserveAspectRatio"))
                        .map(|it| ("preserveAspectRatio", it.to_owned())),
                );
            }
        }
        view.iter()
            .for_each(|(name, value)| self.set_attribute(root, name, Some(value)));
    }

    /// Asks for the file the first time.
    pub(crate) fn external_reference(&self, url: &str) -> Option<Node<'_>> {
        let url = self.resolve_url(url);
        let (file, fragment) = strings::split_once_char(url.as_bytes(), b'#')
            .map_or((url.as_bytes(), None), |it| (it.0, Some(it.1)));
        self.svg_references.set(true);
        let Some(external) = self.externals.get(text(file)) else {
            if (!self.is_embedded || url.starts_with("data:"))
                && self.wanted_externals.borrow_mut().insert(text(file).into())
            {
                self.requests
                    .borrow_mut()
                    .extend(["svg".into(), text(file).into()]);
            }
            return None;
        };
        let (external, root) = external.as_ref().map(|it| (it, it.tree.root_element()))?;
        external.svg_node(match fragment {
            Some(fragment) => {
                external.svg_element_by_id(root, Name::new(&percent_decoded(fragment)))?
            }
            None => root,
        })
    }

    pub(crate) fn set_external(&mut self, url: &str, source: &[u8]) {
        let mut external =
            parse(source, url.as_bytes(), self.fonts.scope, &Map::default()).map(|it| it.0);
        if let Some(external) = &mut external {
            let Environment {
                generation,
                viewport_generation,
                root_font,
                ..
            } = external.environment;
            external.set_environment(Environment {
                root_font,
                generation,
                viewport_generation,
                ..self.environment.clone()
            });
            external.update_layout();
            external.requests.take();
        }
        self.externals.insert(url.into(), external);
        self.referenced_svg_changed();
    }

    pub(crate) fn take_requests(&mut self) -> Vec<Str> {
        let mut requests = self.requests.take();
        self.externals
            .values()
            .flatten()
            .for_each(|it| requests.append(&mut it.requests.borrow_mut()));
        requests
    }

    pub(crate) fn has_requests(&self) -> bool {
        core::iter::once(self)
            .chain(self.externals.values().flatten().map(|it| &**it))
            .any(|it| !it.requests.borrow().is_empty())
    }

    pub(crate) fn advance_vectors(&mut self, now: f64) {
        for (id, node) in self.animated_vectors.take() {
            with_vector(id, |vector| {
                let elapsed = now - *vector.start.get_or_insert(now);
                vector
                    .document
                    .iter_mut()
                    .for_each(|it| it.set_time(elapsed));
                vector.pictures.clear();
            });
            match node {
                0 => self.pictures.discard(),
                node => self.repaint(node),
            }
        }
    }
}

impl Painter<'_> {
    /// With its corner in the origin of the space.
    fn vector_image(
        &mut self,
        image: u32,
        size: [f32; 2],
        style: &crate::properties::Style,
        space: &Space,
    ) {
        let (document, mut inside) = (self.document, *space);
        let rounded = size.map(|it| (it / style.zoom).round().max(1.0));
        if NESTING.get() >= MAX_NESTING
            || !self.vector(
                scaling(size[0] / rounded[0], size[1] / rounded[1]),
                &mut inside,
            )
        {
            return;
        }
        let matrix = self.out.links[inside.link as usize].matrix;
        let key = Key {
            size: rounded,
            scale: (document.screen_scale(&matrix) * 16.0).round().max(1.0) / 16.0,
            is_dark: style.dark,
        };
        NESTING.set(NESTING.get() + 1);
        let painted = with_vector(image, |it| {
            Some((it.picture(key, &document.environment)?, it.is_animated))
        })
        .flatten();
        NESTING.set(NESTING.get() - 1);
        crate::layout::set_scale_of_units(document.environment.scale);
        let Some((picture, is_animated)) = painted.filter(|_| !self.is_hidden) else {
            return;
        };
        if is_animated {
            self.depends_on_outside();
            self.is_volatile = true;
            document
                .animated_vectors
                .borrow_mut()
                .insert((image, self.painted_node));
        }
        self.enter(inside.link);
        self.out.append(&picture);
    }

    /// `paint` fills the tile, whose corner is in the origin of the space.
    pub(crate) fn tiled(
        &mut self,
        clip: RoundedRect,
        tile: Tile,
        space: &Space,
        paint: impl FnOnce(&mut Self, &Space),
    ) {
        let (
            mut inside,
            Rect {
                x,
                y,
                width,
                height,
            },
        ) = (*space, tile.rect);
        let cell = Rect::new([0.0, 0.0, width, height]);
        self.clip(clip, &mut inside);
        self.vector(translation([x, y]), &mut inside);
        if tile.step != [0.0; 2] {
            self.link(
                Item::PushPattern {
                    bounds: clip.rect.moved([-x, -y]),
                    tile: Tile { rect: cell, ..tile },
                    matrix: IDENTITY,
                },
                &mut inside,
            );
            inside.visible = cell;
        } else if clip.rect.intersection(&tile.rect) != clip.rect {
            self.clip(square(cell), &mut inside);
        }
        paint(self, &inside);
    }

    pub(crate) fn draw_image(
        &mut self,
        clip: RoundedRect,
        tile: Tile,
        image: u32,
        style: &crate::properties::Style,
        space: &Space,
    ) {
        if is_vector(image) {
            return self.tiled(clip, tile, space, |painter, space| {
                painter.vector_image(image, [tile.rect.width, tile.rect.height], style, space)
            });
        }
        self.emit(
            Item::Image {
                clip,
                tile,
                image,
                pixelated: style.is_pixelated(),
            },
            space,
        );
    }
}
