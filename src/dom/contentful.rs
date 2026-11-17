//! What paint timing counts as content.

use crate::abi::{Matrix, Rect};
use crate::boxes::{BoxId, Kind, VIEWPORT};
use crate::document::Document;
use crate::lines::FragmentKind;
use crate::paint::alpha;
use crate::properties::{Id, Style};
use crate::selector::Pseudo;
use crate::tree::{DOCUMENT, NodeId};
use crate::types::*;

#[derive(Clone, Copy)]
pub(crate) enum Content {
    Text,
    Replaced,
    Background,
    Vector,
    TransparentText,
}

pub(crate) struct Contentful {
    pub(crate) node: NodeId,
    pub(crate) content: Content,
    pub(crate) image: u32,
    pub(crate) visible: Rect,
    /// Of the whole.
    pub(crate) area: f32,
}

fn is_transparent(style: &Style) -> bool {
    alpha(style.ink.text_fill_color.resolve(style.color())) == 0
        && style.ink.text_shadow.0.0.is_empty()
        && style.other_if_set(Id::WebkitTextStrokeWidth).is_none()
}

impl Document {
    /// The element that a box was made for.
    fn originator(&self, mut id: BoxId) -> NodeId {
        while self.boxes[id].node == 0 && id != 0 {
            id = self.boxes[id].parent;
        }
        let mut node = self.boxes[id].node;
        while node != 0
            && self
                .tree
                .element(node)
                .is_some_and(|it| it.pseudo != Pseudo::None)
        {
            node = self.tree.flat_parent(node);
        }
        node
    }

    /// What is in the viewport. Only for `only`, unless that is the document.
    pub(crate) fn contentful(&self, only: NodeId) -> Vec<Contentful> {
        let mut found = Vec::new();
        let up = |it: &BoxId| Some(self.boxes[*it].parent).filter(|it| *it != 0);
        let path: Vec<_> = core::iter::successors(self.own_box(only), up).collect();
        if path.is_empty() && only != DOCUMENT {
            return found;
        }
        let hoisted: Vec<_> = path
            .iter()
            .filter(|it| self.boxes[**it].style.is_out_of_flow())
            .collect();
        let shadow_root = self.tree.element(only).map_or(0, |it| it.shadow_root);
        let counts = |id| {
            only == DOCUMENT || {
                let node = self.originator(id);
                node == only || shadow_root != 0 && self.tree[node].scope == shadow_root
            }
        };
        let mut pending: Vec<(BoxId, Matrix, Rect)> =
            vec![(VIEWPORT, IDENTITY, self.observed_root(DOCUMENT).rect)];
        while let Some((id, matrix, clip)) = pending.pop() {
            let it = &self.boxes[id];
            let mut add = |content: Content, image: u32, rect: Rect| {
                let whole = rect.transformed(&matrix);
                let visible = whole.intersection(&clip);
                if !visible.is_empty() {
                    found.push(Contentful {
                        node: self.originator(id),
                        content,
                        image,
                        visible,
                        area: whole.width * whole.height,
                    });
                }
            };
            let is_wanted = counts(id);
            if is_wanted && it.style.is_visible() && it.node != 0 {
                for loaded in it
                    .style
                    .background
                    .image
                    .iter()
                    .filter_map(|image| self.ready(image.0.as_ref()?, &it.style))
                {
                    if loaded.id != 0 {
                        add(Content::Background, loaded.id, self.border_box(id));
                    }
                }
                if it.kind == Kind::Svg {
                    add(
                        Content::Vector,
                        0,
                        self.svg_ink(it.node).unwrap_or_default(),
                    );
                } else if let Some(replaced) = self
                    .tree
                    .element(it.node)
                    .and_then(|it| it.replaced)
                    .filter(|it| it.image != 0)
                {
                    add(
                        Content::Replaced,
                        replaced.image,
                        Rect::new(self.content_box(id)),
                    );
                }
            }
            if it.is_skipped {
                continue;
            }
            if let Some(inline) = it.inline.as_deref().filter(|_| is_wanted) {
                let mut found = [None::<Rect>; 2];
                for fragment in inline
                    .lines
                    .fragments
                    .iter()
                    .filter(|it| matches!(it.kind, FragmentKind::Text { .. }))
                {
                    let item = &inline.items[fragment.item as usize];
                    let style = self.current_style(item);
                    let is_blank = inline
                        .text
                        .get(item.start as usize..item.end as usize)
                        .is_none_or(|it| it.trim_ascii().is_empty());
                    if style.is_visible() && style.effects.opacity.0 > 0.0 && !is_blank {
                        let all = &mut found[usize::from(is_transparent(style))];
                        *all = Some(all.map_or(fragment.rect(), |it| it.union(&fragment.rect())));
                    }
                }
                for (content, all) in [Content::Text, Content::TransparentText]
                    .into_iter()
                    .zip(found)
                {
                    all.into_iter()
                        .for_each(|it| add(content, 0, self.from_lines(id, it)));
                }
            }
            let clip = self
                .overflow_clip(id)
                .filter(|_| id != VIEWPORT)
                .map_or(clip, |it| it.transformed(&matrix).intersection(&clip));
            let in_flow = match is_wanted {
                true => &it.children[..],
                false => path
                    .iter()
                    .position(|it| *it == id)
                    .map_or(&[][..], |it| &path[it.saturating_sub(1)..it]),
            };
            let in_flow = in_flow.iter().filter(|child| {
                (!is_wanted || counts(**child)) && !self.boxes[**child].style.is_out_of_flow()
            });
            for &child in in_flow
                .chain(it.hoisted.iter().filter(|child| {
                    if is_wanted {
                        counts(**child)
                    } else {
                        hoisted.contains(child)
                    }
                }))
                .rev()
            {
                let matrix = if self.boxes[child].container == id {
                    multiply(&matrix, &self.to_container(child))
                } else {
                    self.to_viewport(child)
                };
                if self.boxes[child].style.effects.opacity.0 > 0.0
                    && !self
                        .ink(child)
                        .transformed(&matrix)
                        .intersection(&clip)
                        .is_empty()
                {
                    pending.push((child, matrix, clip));
                }
            }
        }
        found
    }
}
