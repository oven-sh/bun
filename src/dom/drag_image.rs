//! What follows the pointer during a drag.

use crate::abi::{BlendMode, Item, Matrix, Rect, Span, Tile};
use crate::boxes::VIEWPORT;
use crate::document::Document;
use crate::geometry::translation;
use crate::paint::{Painter, Picture, Space, square};
use crate::tree::NodeId;
use crate::types::{IDENTITY, multiply};

/// An image of the library, and where that is in the viewport.
pub(crate) type DragImage = (u32, Rect);

impl Document {
    fn record_for_drag(
        &self,
        mut picture: Picture,
        to_viewport: &Matrix,
        area: Rect,
        opacity: f32,
    ) -> Option<DragImage> {
        let scale = self.environment.scale;
        let ([left, top], [right, bottom]) = (
            [area.x, area.y].map(|it| (it * scale).floor() / scale),
            [area.right(), area.bottom()].map(|it| (it * scale).ceil() / scale),
        );
        let area = (!area.is_empty()).then(|| Rect::from_edges(left, top, right, bottom))?;
        let layer = Item::PushLayer {
            bounds: area.moved([-left, -top]),
            opacity,
            blend: BlendMode::Normal,
            filters: Span::default(),
        };
        picture.items.splice(
            ..0,
            [
                layer,
                Item::PushTransform(multiply(&translation([-left, -top]), to_viewport)),
            ],
        );
        picture.items.extend([Item::Pop; 2]);
        // SAFETY: the picture outlives the call.
        Some((
            unsafe {
                (crate::platform::renderer()?.record_image)(
                    &picture.list(1.0),
                    area.width,
                    area.height,
                )
            },
            area,
        ))
    }

    pub(crate) fn record_selection(&mut self, opacity: f32) -> Option<DragImage> {
        self.update_picture();
        let mut painter = Painter::new(self, None, Picture::default(), Default::default());
        (painter.is_copy, painter.is_hidden, painter.selected) =
            (true, true, Some(Rect::default()));
        painter.out.canvas_source = self.canvas_source();
        painter.page();
        painter.enter(0);
        let area = painter.selected?.intersection(&self.border_box(VIEWPORT));
        self.record_for_drag(painter.out, &IDENTITY, area, opacity)
    }

    pub(crate) fn record_element(&mut self, node: NodeId, opacity: f32) -> Option<DragImage> {
        self.update_picture();
        let (picture, to_viewport, area) = self.picture_of(node)?;
        self.record_for_drag(picture, &to_viewport, area, opacity)
    }

    /// In the corner of the viewport.
    pub(crate) fn record_loose_image(
        &self,
        image: u32,
        [width, height]: [f32; 2],
    ) -> Option<DragImage> {
        let (rect, mut picture) = (Rect::new([0.0, 0.0, width, height]), Picture::default());
        picture.items.push(Item::Image {
            clip: square(rect),
            tile: Tile {
                rect,
                step: [0.0; 2],
            },
            image,
            pixelated: false,
        });
        self.record_for_drag(picture, &IDENTITY, rect, 1.0)
    }
}

impl Painter<'_> {
    pub(crate) fn skips_what_is_not_selected(&self) -> bool {
        self.selected.is_some() && self.is_hidden
    }

    pub(crate) fn paint_selected(
        &mut self,
        node: NodeId,
        rect: Rect,
        space: &Space,
        paint: impl FnOnce(&mut Self),
    ) {
        let (tree, links) = (&self.document.tree, &self.out.links);
        let mut around = core::iter::once(node).chain(tree.flat_ancestors(node));
        let chain = core::iter::successors(Some(&links[space.link as usize]), |it| {
            (it.depth > 0).then(|| &links[it.parent as usize])
        });
        let shown = chain.fold(
            rect.transformed(&links[space.link as usize].matrix),
            |shown, link| match link.item {
                Item::PushClip(clip) => shown.intersection(&clip.rect.transformed(&link.matrix)),
                _ => shown,
            },
        );
        if !shown.is_empty()
            && !around.any(|it| tree.style(it).is_some_and(|it| it.effects.opacity.0 == 0.0))
        {
            self.selected = self.selected.map(|it| {
                if it.is_empty() {
                    shown
                } else {
                    it.union(&shown)
                }
            });
            self.is_hidden = false;
            paint(self);
            self.is_hidden = true;
        }
    }
}
