//! The domain Overlay. What it draws are elements that only the engine has.

use core::fmt::Write as _;

use bun_web::input::{Action, Input};

use super::*;
use crate::abi::Rect;
use crate::api::ui::{Ui, layout, top_layer};
use crate::document::Document;
use crate::types::apply;

type Quad = [[f32; 2]; 4];

pub(super) struct BoxModel {
    /// Content, padding, border and margin, in the viewport.
    pub(super) quads: [Quad; 4],
    pub(super) size: [f32; 2],
    /// The edges of the tracks of a grid, or of the items of a flex container.
    parts: Vec<Quad>,
}

impl Document {
    fn box_model(&self, node: NodeId) -> Option<BoxModel> {
        let rects = self.local_rects(node);
        let (holder, matrix) = rects.first().map(|it| (it.0, self.to_viewport(it.0)))?;
        let border = rects
            .iter()
            .filter(|it| it.0 == holder)
            .map(|it| it.1)
            .reduce(|a, b| a.union(&b))?;
        let own = self.own_box(node).map(|it| &self.boxes[it]);
        let basis = self.boxes[holder].layout.size.width;
        let [margins, borders, paddings] = match (
            own,
            self.tree.element(node).and_then(|_| self.tree.style(node)),
        ) {
            (Some(it), _) => {
                [it.layout.margin, it.layout.border, it.layout.padding].map(|it| it.to_array())
            }
            (None, Some(style)) => {
                let [_, right, _, left] = crate::layout::margin(style, basis).to_array();
                [
                    [0.0, right, 0.0, left],
                    style.fixed().border.to_array(),
                    crate::layout::resolve_padding(style, basis).to_array(),
                ]
            }
            _ => [[0.0; 4]; 3],
        };
        let quad = |it: Rect| {
            [
                [it.x, it.y],
                [it.right(), it.y],
                [it.right(), it.bottom()],
                [it.x, it.bottom()],
            ]
            .map(|it| apply(&matrix, it))
        };
        let padding = border.shrunk(borders);
        let parts = match own.map(|it| (it.kind, it)) {
            Some((crate::boxes::Kind::Grid, it)) => it.strips_of_grid(),
            Some((crate::boxes::Kind::Flex, it)) => {
                let items = it
                    .children
                    .iter()
                    .map(|it| &self.boxes[*it])
                    .filter(|it| it.container == holder && !it.style.is_out_of_flow());
                items
                    .map(|it| {
                        Rect::new([
                            it.layout.location.x,
                            it.layout.location.y,
                            it.layout.size.width,
                            it.layout.size.height,
                        ])
                    })
                    .collect()
            }
            _ => Vec::new(),
        };
        let quads = [
            padding.shrunk(paddings),
            padding,
            border,
            border.shrunk(margins.map(|it| -it)),
        ]
        .map(quad);
        Some(BoxModel {
            quads,
            size: [border.width, border.height],
            parts: parts.into_iter().take(1000).map(quad).collect(),
        })
    }
}

pub(super) fn box_model<'a>(cx: Cx<'_, 'a>, target: Target<'a>) -> Option<BoxModel> {
    layout::laid_out(cx, target.node, |engine, id| {
        Some(target.in_engine(&engine.tree, id))
            .filter(|it| *it != 0)
            .and_then(|it| engine.box_model(it))
    })
}

#[derive(Clone, Default)]
enum Highlight {
    #[default]
    None,
    Nodes(Vec<u32>, Value),
    Quad(Quad, Value),
}

#[derive(Default)]
pub(super) struct Overlay {
    highlight: RefCell<Highlight>,
    /// Grids and flex containers.
    lasting: RefCell<[Vec<(u32, Value)>; 2]>,
    /// How to highlight what is under the mouse.
    picking: RefCell<Option<Value>>,
    message: RefCell<String>,
    /// The style and the text of each element.
    drawn: RefCell<Vec<[String; 2]>>,
}

impl Overlay {
    pub(super) fn forget(&self) {
        drop((
            self.highlight.take(),
            self.lasting.take(),
            self.drawn.take(),
        ));
    }

    pub(super) fn hide<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) {
        self.forget();
        drop((self.picking.take(), self.message.take()));
        if let Some(ui) = Ui::of(doc) {
            ui.layers.picker.take();
            top_layer::show_overlay(cx, ui, &[]);
        }
    }
}

fn color(it: &Value) -> Option<String> {
    let alpha = it["a"].as_number().unwrap_or(1.0);
    (it.is_truthy() && alpha > 0.0).then(|| {
        format!(
            "rgb({} {} {}/{alpha})",
            it["r"].int(),
            it["g"].int(),
            it["b"].int()
        )
    })
}

fn path(quads: &[&Quad]) -> String {
    let mut path = String::new();
    for [a, b, c, d] in quads {
        let _ = write!(
            path,
            "M{} {}L{} {}L{} {}L{} {}Z",
            a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]
        );
    }
    path
}

/// What is between the two.
fn fill(color: &str, quads: &[&Quad]) -> [String; 2] {
    [
        format!(
            "inset:0;background:{color};clip-path:path(evenodd,'{}')",
            path(quads)
        ),
        String::new(),
    ]
}

fn outline(color: &str, style: &str, [a, b, _, d]: &Quad) -> [String; 2] {
    let [width, height] = [b, d].map(|it| (it[0] - a[0]).hypot(it[1] - a[1]));
    let unit = |to: &[f32; 2], length: f32, otherwise| {
        if length > 0.0 {
            [(to[0] - a[0]) / length, (to[1] - a[1]) / length]
        } else {
            otherwise
        }
    };
    let ([p, q], [r, s]) = (unit(b, width, [1.0, 0.0]), unit(d, height, [0.0, 1.0]));
    [
        format!(
            "left:0;top:0;width:{width}px;height:{height}px;border:1px {style} {color};transform-origin:0 0;transform:matrix({p},{q},{r},{s},{},{})",
            a[0], a[1]
        ),
        String::new(),
    ]
}

fn label(text: String, outer: &Quad, [width, height]: [f32; 2]) -> [String; 2] {
    const HEIGHT: f32 = 26.0;
    let extent = |axis: usize| {
        outer.iter().fold([f32::MAX, f32::MIN], |it, point| {
            [it[0].min(point[axis]), it[1].max(point[axis])]
        })
    };
    let ([left, _], [top, bottom]) = (extent(0), extent(1));
    let top = if top >= HEIGHT + 4.0 {
        top - HEIGHT - 4.0
    } else {
        bottom + 4.0
    }
    .clamp(4.0, (height - HEIGHT - 4.0).max(4.0));
    let left = left.clamp(4.0, (width - text.len() as f32 * 7.0 - 24.0).max(4.0));
    [
        format!(
            "left:{left}px;top:{top}px;padding:4px 8px;background:#fff;color:#222;border-radius:3px;box-shadow:0 1px 4px #0006"
        ),
        text,
    ]
}

fn parts(model: &BoxModel, config: &Value, drawn: &mut Vec<[String; 2]>) {
    let line = [
        &config["rowLineColor"],
        &config["cellBorderColor"],
        &config["itemSeparator"]["color"],
        &config["containerBorder"]["color"],
    ]
    .into_iter()
    .find_map(color);
    let border =
        color(&config["gridBorderColor"]).or_else(|| color(&config["containerBorder"]["color"]));
    drawn.extend(
        line.iter()
            .flat_map(|it| model.parts.iter().map(|part| outline(it, "dashed", part))),
    );
    drawn.extend(
        border
            .filter(|_| !model.parts.is_empty())
            .map(|it| outline(&it, "dashed", &model.quads[0])),
    );
}

/// Whether the input is for choosing an element. A frame has an inspector of its own.
#[cold]
pub(crate) fn pick<'a>(cx: Cx<'_, 'a>, ui: &'a Ui, input: &Input, is_for_frame: bool) -> bool {
    let Some(inspector) = ui
        .layers
        .picker
        .borrow()
        .as_ref()
        .and_then(std::rc::Weak::upgrade)
    else {
        return false;
    };
    if matches!(input, Input::Key(it) if it.is_down && it.key == "Escape") {
        inspector.emit("Overlay.inspectModeCanceled", Value::empty());
        return true;
    }
    let Input::Mouse(mouse) = input else {
        return false;
    };
    let point = (mouse.action != Action::Leave && !is_for_frame)
        .then(|| mouse.place.window.map(|it| it / layout::zoom(ui.doc())));
    inspector.pick_at(cx, ui.doc(), point, mouse.action == Action::Up);
    true
}

impl Inspector {
    fn draw_node<'a>(
        &self,
        cx: Cx<'_, 'a>,
        target: Target<'a>,
        config: &Value,
        is_first: bool,
        drawn: &mut Vec<[String; 2]>,
    ) {
        let Some(model) = box_model(cx, target) else {
            return;
        };
        let [content, padding, border, margin] = &model.quads;
        for (name, quads) in [
            ("contentColor", &[content][..]),
            ("paddingColor", &[padding, content]),
            ("borderColor", &[border, padding]),
            ("marginColor", &[margin, border]),
        ] {
            drawn.extend(color(&config[name]).map(|it| fill(&it, quads)));
        }
        let kind = if target
            .element()
            .is_ok_and(|it| layout::computed(cx, it, "display").ends_with(b"grid"))
        {
            "gridHighlightConfig"
        } else {
            "flexContainerHighlightConfig"
        };
        parts(&model, &config[kind], drawn);
        if is_first && config["showInfo"].is_truthy() {
            let [width, height] = model.size.map(|it| (it * 100.0).round() / 100.0);
            let mut name = label_of(&cx.heap, target.node) + &target.pseudo().unwrap_or_default();
            name.truncate(name.floor_char_boundary(80));
            drawn.push(label(
                format!("{name}   {width} × {height}"),
                margin,
                layout::viewport_size(target.node.doc()),
            ));
        }
    }

    pub(super) fn update_overlay<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
        let (overlay, mut drawn) = (&self.overlay, Vec::new());
        for (id, config) in overlay.lasting.borrow().clone().into_iter().flatten() {
            Target::with_id(&cx.heap, id)
                .and_then(|it| box_model(cx, it))
                .inspect(|it| parts(it, &config, &mut drawn));
        }
        match overlay.highlight.borrow().clone() {
            Highlight::None => {}
            Highlight::Nodes(ids, config) => {
                for (index, id) in ids.into_iter().enumerate() {
                    Target::with_id(&cx.heap, id)
                        .inspect(|it| self.draw_node(cx, *it, &config, index == 0, &mut drawn));
                }
            }
            Highlight::Quad(quad, params) => {
                drawn.extend(color(&params["color"]).map(|it| fill(&it, &[&quad])));
                drawn.extend(color(&params["outlineColor"]).map(|it| outline(&it, "solid", &quad)));
            }
        }
        if !overlay.message.borrow().is_empty() {
            drawn.push(["inset:0;background:#0002".into(), String::new()]);
            drawn.push(["left:50%;top:10px;translate:-50%;padding:4px 10px;background:#ffffc2;color:#222;border:1px solid #cacaca;border-radius:4px".into(), overlay.message.borrow().clone()]);
        }
        if *overlay.drawn.borrow() != drawn {
            Ui::of(doc).inspect(|it| top_layer::show_overlay(cx, it, &drawn));
            overlay.drawn.replace(drawn);
        }
        let is_picking = overlay.picking.borrow().is_some();
        Ui::of(doc).inspect(|it| {
            drop(
                it.layers
                    .picker
                    .replace(is_picking.then(|| std::rc::Weak::clone(&self.this))),
            )
        });
        is_picking || !overlay.drawn.borrow().is_empty()
    }

    pub(super) fn pick_at<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        point: Option<[f64; 2]>,
        is_final: bool,
    ) {
        let found = point
            .and_then(|it| layout::hit_test(cx, doc, it))
            .map(Node::out_of_control)
            .and_then(|it| it.inclusive_ancestors().find(|it| it.is_element()));
        let config = self.overlay.picking.borrow().clone();
        let before = self.overlay.highlight.replace(
            found
                .zip(config)
                .filter(|_| !is_final)
                .map_or(Highlight::None, |(node, config)| {
                    Highlight::Nodes(vec![id_of(node)], config)
                }),
        );
        self.update_overlay(cx, doc);
        match found {
            Some(node) if is_final => self.emit(
                "Overlay.inspectNodeRequested",
                record! { "backendNodeId": id_of(node) },
            ),
            Some(node) if !matches!(&before, Highlight::Nodes(ids, _) if *ids == [id_of(node)]) => {
                self.compare_nodes(cx, doc);
                self.emit(
                    "Overlay.nodeHighlightRequested",
                    record! { "nodeId": self.push(cx, node.into()) },
                );
            }
            _ => {}
        }
    }

    fn highlight_node<'a>(&self, cx: Cx<'_, 'a>, params: &Value) -> Result<Highlight, String> {
        let target = self.target(&cx.heap, params)?;
        let mut ids = vec![target.id()];
        if let Some((selector, scope)) = params["selector"].as_text().zip(target.node.scope()) {
            let found =
                scope.query_selector_all(cx, DomString::from_utf8(selector).to_js(&cx.heap));
            ids.extend(
                or_message(cx, found)
                    .into_iter()
                    .flat_map(List::nodes)
                    .filter(|it| *it != target.node)
                    .take(200)
                    .map(id_of),
            );
        }
        Ok(Highlight::Nodes(ids, params["highlightConfig"].clone()))
    }

    pub(super) fn about_overlay<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        name: &str,
        params: &Value,
    ) -> Option<Outcome> {
        let overlay = &self.overlay;
        let lasting = |all: &str, config: &str| {
            params[all]
                .items()
                .iter()
                .map(|it| (it["nodeId"].number() as u32, it[config].clone()))
                .collect()
        };
        match name {
            "highlightNode" => match self.highlight_node(cx, params) {
                Ok(highlight) => drop(overlay.highlight.replace(highlight)),
                Err(message) => return Some(Err(message)),
            },
            "highlightRect" | "highlightQuad" => {
                let quad = if name == "highlightQuad" {
                    params["quad"].clone()
                } else {
                    nodes::quad(["x", "y", "width", "height"].map(|it| params[it].number()))
                };
                overlay.highlight.replace(Highlight::Quad(
                    [0, 2, 4, 6].map(|it| [quad[it].number() as f32, quad[it + 1].number() as f32]),
                    params.clone(),
                ));
            }
            "hideHighlight" => drop(overlay.highlight.take()),
            "setInspectMode" => {
                overlay.picking.replace(
                    params["mode"]
                        .text()
                        .starts_with("searchFor")
                        .then(|| params["highlightConfig"].clone()),
                );
                overlay.highlight.take();
            }
            "setPausedInDebuggerMessage" => {
                drop(overlay.message.replace(params["message"].text().into()))
            }
            "setShowGridOverlays" => {
                overlay.lasting.borrow_mut()[0] =
                    lasting("gridNodeHighlightConfigs", "gridHighlightConfig")
            }
            "setShowFlexOverlays" => {
                overlay.lasting.borrow_mut()[1] =
                    lasting("flexNodeHighlightConfigs", "flexContainerHighlightConfig")
            }
            "disable" => overlay.hide(cx, doc),
            _ => return None,
        }
        self.update_overlay(cx, doc);
        Some(empty())
    }
}
