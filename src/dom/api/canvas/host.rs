//! What a context asks of its canvas and of the document.

use bun_jsc::JSValue;
use bun_jsc::bindgen::{IntoError as _, JsHeap, JsInterface as _, JsScope, Result};
use bun_jsc::virtual_machine::VirtualMachine;

use super::Failure;
use super::bitmap::Source;
use super::context::Context;
use super::element::size_of_element;
use super::offscreen::OffscreenCanvas;
use super::recorder::Recorder;
use super::text::{Font, Inherited};
use crate::api::core::{Doc, Element, Node, atom};
use crate::api::{images, on_behalf};
pub(super) use crate::generated_bindgen::canvas::CanvasRenderingContext2DSettings as Settings;
use crate::generated_bindgen::canvas::{
    CanvasColorType, CanvasImageSource, ImageBitmapRenderingContext, PredefinedColorSpace,
    js_Canvas2D as js, js_CanvasRenderingContext2D, js_ImageBitmapRenderingContext as js_renderer,
    js_OffscreenCanvasRenderingContext2D,
};
use crate::properties::Id;
use crate::selector::Pseudo;
use crate::types::FontStyle;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

/// https://html.spec.whatwg.org/#concept-canvas-context-mode
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum Mode {
    #[default]
    None,
    TwoD,
    BitmapRenderer,
    Placeholder,
}

impl Mode {
    pub(super) fn of(id: &[u8]) -> Mode {
        match id {
            b"2d" => Mode::TwoD,
            b"bitmaprenderer" => Mode::BitmapRenderer,
            _ => Mode::None,
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Kind {
    Element,
    Offscreen { has_placeholder: bool },
}

pub(super) const DEFAULT_SETTINGS: Settings = Settings {
    alpha: true,
    color_space: PredefinedColorSpace::Srgb,
    color_type: CanvasColorType::Unorm8,
    desynchronized: false,
    will_read_frequently: false,
};

impl Mode {
    pub(super) fn takes(self, settings: &Settings) -> &Settings {
        if self == Mode::TwoD {
            settings
        } else {
            &DEFAULT_SETTINGS
        }
    }
}

impl Context {
    pub(super) fn create<'a>(
        heap: &JsHeap<'a>,
        canvas: JSValue,
        size: [u32; 2],
        kind: Kind,
        settings: &Settings,
    ) -> &'a Context {
        let context = Context::new(size, Settings { ..*settings });
        let context: &Context = match kind {
            Kind::Element => js_CanvasRenderingContext2D::create(heap, context),
            Kind::Offscreen { has_placeholder } => {
                context.has_placeholder.set(has_placeholder);
                js_OffscreenCanvasRenderingContext2D::create(heap, context)
            }
        };
        js::set_canvas(context, canvas);
        context
    }

    /// What `getContext()` answers.
    pub(super) fn exposed<'a>(&'a self, heap: &JsHeap<'a>, mode: Mode) -> JSValue {
        match mode {
            Mode::None | Mode::Placeholder => JSValue::NULL,
            Mode::TwoD => self.to_js(),
            Mode::BitmapRenderer => (js::renderer(self).unwrap_or_else(|| {
                let renderer = js_renderer::create(heap, ImageBitmapRenderingContext::default());
                js_renderer::set_context(renderer, Some(self));
                js_renderer::set_canvas(renderer, js::canvas(self).unwrap_or(JSValue::UNDEFINED));
                js::set_renderer(self, Some(renderer));
                renderer
            }))
            .to_js(),
        }
    }

    fn element<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Element> {
        Node::from_js(heap, js::canvas(self)?)?.as_element()
    }

    fn offscreen<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a OffscreenCanvas> {
        OffscreenCanvas::from_js(heap, js::canvas(self)?)
    }
}

/// What has the fonts.
fn document_for<'a>(cx: Cx<'_, 'a>, element: Option<&'a Element>) -> Result<'a, Option<&'a Doc>> {
    element
        .map(|it| it.doc())
        .filter(|it| it.has_page())
        .map_or_else(|| on_behalf::shown_document(cx), |it| Ok(Some(it)))
}

#[optimize(size)]
pub(super) fn inherited_from<'a>(
    cx: Cx<'_, 'a>,
    element: Option<&'a Element>,
) -> Result<'a, Inherited> {
    let document = document_for(cx, element)?;
    let from = element.or_else(|| document?.document_element());
    let language = core::iter::successors(from.map(|it| &**it), |it| it.parent_or_host())
        .find_map(|it| it.as_element()?.with_attr(atom!("lang"), |it| it.into()));
    let plain = Inherited {
        font_size: 10.0,
        root_font_size: 16.0,
        line_height: 12.0,
        medium_sizes: document.map_or([16.0, 13.0], |it| {
            it.arena().read(|it| it.fonts.medium_sizes())
        }),
        has_quirks: document.is_some_and(|it| it.quirks()),
        is_right_to_left: from
            .and_then(|it| it.with_attr(atom!("dir"), |it| it.eq_ignore_ascii_case("rtl")))
            == Some(true),
        color: 0xff,
        language: language.unwrap_or_default(),
        font_scope: document.map_or_else(
            || on_behalf::font_scope(&cx.heap),
            |it| it.arena().read(|it| it.fonts.scope),
        ),
        is_smoothed: true,
    };
    let styled = element.filter(|it| it.is_connected()).and_then(|it| {
        it.synced_engine(cx, |engine, id| {
            engine.update_style_of(id);
            let (_, style) = engine.style_of_pseudo(id, Pseudo::None)?;
            Some(Inherited {
                font_size: style.font.size.1 / style.zoom,
                line_height: style.line_height() / style.zoom,
                root_font_size: engine.environment.root_font.size,
                is_right_to_left: style.is_rtl(),
                color: style.color(),
                is_smoothed: matches!(
                    style.other_if_set(Id::WebkitFontSmoothing),
                    None | Some("auto" | "subpixel-antialiased")
                ),
                ..plain.clone()
            })
        })
    });
    Ok(styled.unwrap_or(plain))
}

#[optimize(size)]
pub(super) fn inherited<'a>(cx: Cx<'_, 'a>, context: &Context) -> Result<'a, Inherited> {
    let element = context.element(&cx.heap);
    let own = inherited_from(cx, element)?;
    Ok(
        match context
            .offscreen(&cx.heap)
            .and_then(|it| it.inherited.as_deref())
        {
            Some(placeholder) => Inherited {
                is_right_to_left: placeholder.is_right_to_left,
                language: std::rc::Rc::clone(&placeholder.language),
                ..own
            },
            None => own,
        },
    )
}

#[optimize(size)]
pub(super) fn use_font<'a>(cx: Cx<'_, 'a>, context: &Context, font: &Font) -> Result<'a, ()> {
    let mut names = font
        .families
        .names()
        .filter(|it| it[0] != crate::abi::GENERIC_FAMILY)
        .peekable();
    if names.peek().is_some() {
        let element = context.element(&cx.heap);
        let Some(document) = document_for(cx, element)? else {
            return Ok(());
        };
        document.synced_engine(cx, |engine, _| {
            names.for_each(|it| {
                engine.use_font(
                    it,
                    font.weight.round() as u16,
                    font.style != FontStyle::Normal,
                )
            })
        });
        on_behalf::take_requests(cx, document);
    }
    Ok(())
}

pub(super) fn is_focused<'a>(cx: Cx<'_, 'a>, context: &Context, element: &'a Element) -> bool {
    crate::api::ui::focus::focused(element.doc()) == Some(element)
        && context
            .element(&cx.heap)
            .is_some_and(|it| it.contains(element))
}

pub(super) fn canvas_size(heap: &JsHeap<'_>, context: &Context) -> [u32; 2] {
    context
        .element(heap)
        .map(size_of_element)
        .or_else(|| Some(context.offscreen(heap)?.bitmap_size()))
        .unwrap_or_default()
}

fn ignores_orientation<'a>(cx: Cx<'_, 'a>, canvas: Option<&'a Element>) -> bool {
    canvas.filter(|it| it.is_connected()).is_some_and(|it| {
        it.synced_engine(cx, |engine, id| {
            engine.update_style_of(id);
            engine
                .style_of_pseudo(id, Pseudo::None)
                .is_some_and(|it| it.1.other_if_set(Id::ImageOrientation).is_some())
        })
    })
}

/// https://html.spec.whatwg.org/#check-the-usability-of-the-image-argument
pub(super) fn check_usability<'a>(
    cx: Cx<'_, 'a>,
    context: Option<&Context>,
    image: CanvasImageSource<'a>,
) -> Result<'a, Option<Source>> {
    let with_pixels = |it: Source| {
        if it.is_empty() {
            Err(Failure::invalid_state(
                "The image argument has a width or height of 0.",
            ))
        } else {
            Ok(Some(it))
        }
    };
    let source = match image {
        CanvasImageSource::Bitmap(it) => it.source().map(Some),
        CanvasImageSource::Canvas(it) => with_pixels(it.source(cx)),
        CanvasImageSource::Offscreen(it) => it.source(&cx.heap).and_then(with_pixels),
        CanvasImageSource::Image(it) => it.source(cx),
        CanvasImageSource::SvgImage(it) => images::source_of_svg_image(it),
        CanvasImageSource::Video(it) => Ok(it.source(&cx.heap)),
    };
    let mut source = source
        .map_err(|it| it.into_error(&cx.heap))?
        .filter(|it| !it.is_empty());
    if let Some(turned) = source.as_mut().filter(|it| it.ignored_orientation > 1) {
        let canvas = context.and_then(|it| it.element(&cx.heap));
        if !ignores_orientation(cx, canvas) {
            turned.ignored_orientation = 1;
        }
    }
    Ok(source)
}

pub(super) fn present(context: &Context) {
    context.will_present.set(false);
    let global = VirtualMachine::get().global();
    // SAFETY: the recorder presents between tasks, and holds the context.
    let result = unsafe {
        JsScope::with(global.as_mut_ptr(), |cx| {
            context
                .offscreen(&cx.heap)
                .map_or(Ok(()), |it| it.update_placeholder(cx))
                .map_err(|it| it.into_js_error(global))
        })
    };
    if let Err(error) = result {
        let _ = bun_jsc::task::report_error_or_terminate(global, error);
    }
}

pub(crate) fn present_canvases(_: Cx<'_, '_>) {
    Recorder::current().present();
}
