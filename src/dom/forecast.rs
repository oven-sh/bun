//! Scripts tend to go through elements in the order in which they did the last time, or in which those were made.

use core::cell::{Cell, RefCell};
use core::hint::{Locality, prefetch_read};
use std::rc::Rc;

use crate::document::Document;
use crate::properties::Style;
use crate::tree::{Element, NodeId};

#[derive(Default)]
pub(crate) struct Forecast {
    last: Cell<NodeId>,
    rounds: RefCell<Rounds>,
}

#[derive(Default)]
struct Rounds {
    before: Vec<NodeId>,
    now: Vec<NodeId>,
    /// In `before`.
    next: usize,
}

type Ahead = [NodeId; 8];

impl Rounds {
    const MAX_LEN: usize = 1 << 14;

    fn after(&mut self, id: NodeId) -> Option<Ahead> {
        if self.now.len() == Rounds::MAX_LEN || self.now.len() >= 16 && self.now[0] == id {
            self.restart();
        }
        self.now.push(id);
        if let Some(skipped) = self.before[self.next..]
            .iter()
            .take(4)
            .position(|it| *it == id)
        {
            self.next += skipped + 1;
            return self.before[self.next..].first_chunk().copied();
        }
        let [a, b, c] = *self.now.last_chunk()?;
        let step = Some(c.wrapping_sub(b)).filter(|it| *it == b.wrapping_sub(a))?;
        Some(core::array::from_fn(|it| {
            id.wrapping_add(step.wrapping_mul(it as u32 + 1))
        }))
    }

    fn restart(&mut self) {
        core::mem::swap(&mut self.before, &mut self.now);
        self.now.clear();
        self.next = 0;
    }
}

impl Forecast {
    /// Those that are likely to follow, unless it is still the same one.
    #[inline(always)]
    fn after(&self, id: NodeId) -> Option<Ahead> {
        (self.last.replace(id) != id).then(|| self.rounds.borrow_mut().after(id))?
    }

    pub(crate) fn frame_ended(&mut self) {
        let rounds = self.rounds.get_mut();
        match rounds.now.len() {
            0 => {}
            1..16 => *rounds = Rounds::default(),
            _ => rounds.restart(),
        }
    }
}

#[inline(always)]
pub(crate) fn prefetch<T: ?Sized>(it: &T) {
    prefetch_read(core::ptr::from_ref(it).cast::<u8>(), Locality::L1);
}

/// The counts, and what follows them.
#[inline(always)]
pub(crate) fn prefetch_shared<T: ?Sized>(it: &Rc<T>, lines: usize) {
    (0..lines).for_each(|line| {
        prefetch_read(
            Rc::as_ptr(it)
                .cast::<u8>()
                .wrapping_sub(16)
                .wrapping_add(line * 64),
            Locality::L1,
        )
    });
}

#[inline(always)]
pub(crate) fn prefetch_style(it: &Rc<Style>) {
    prefetch_shared(it, size_of::<Style>() / 64 + 1);
}

impl Document {
    #[inline]
    pub(crate) fn anticipate_edits(&self, id: NodeId) {
        let Some([first, second, third, fourth, fifth, sixth, seventh, _]) = self.edits.after(id)
        else {
            return;
        };
        let block = |id: NodeId| self.tree.element(id)?.inline_style.as_ref();
        self.tree.prefetch_links(seventh);
        self.tree.prefetch_data(sixth);
        if let Some(it) = self.tree.element(fifth) {
            it.rules.iter().for_each(|it| prefetch_shared(it, 1));
            it.inline_style.iter().for_each(|it| prefetch_shared(it, 2));
        }
        self.tree
            .element(fourth)
            .and_then(|it| it.rules.as_ref())
            .into_iter()
            .for_each(|it| it.prefetch_last());
        for (step, id) in [fourth, third, second, first].into_iter().enumerate() {
            block(id).into_iter().for_each(|it| it.prefetch(step));
        }
    }

    #[inline]
    pub(crate) fn anticipate_attributes(&self, id: NodeId) {
        let Some([_, second, _, fourth, _, sixth, _, eighth]) = self.edits.after(id) else {
            return;
        };
        self.tree.prefetch_node(eighth);
        self.tree.prefetch_data(sixth);
        if let Some(it) = self.tree.element(fourth) {
            it.classes.iter().for_each(|it| prefetch_shared(it, 2));
            prefetch(&*it.attributes);
        }
        self.tree
            .element(second)
            .and_then(|it| it.classes.as_ref())
            .into_iter()
            .for_each(|it| it.prefetch());
    }

    #[inline]
    pub(crate) fn anticipate_reads(&self, id: NodeId) {
        let Some([_, second, _, fourth, _, sixth, _, eighth]) = self.reads.after(id) else {
            return;
        };
        let hidden = self.tree.found().hidden.borrow();
        let style = |id: NodeId| self.tree.style(id).or_else(|| Some(&hidden.get(id)?.style));
        self.tree.prefetch_links(eighth);
        self.tree.prefetch_data(sixth);
        style(fourth)
            .into_iter()
            .for_each(|it| prefetch_shared(it, 3));
        if let Some(it) = style(second) {
            prefetch_shared(&it.layout, size_of_val(&*it.layout) / 64 + 1);
            prefetch_shared(&it.ink, 2);
            prefetch(&it.text.writing_mode);
        }
    }

    /// For a traversal that is at the first one.
    #[inline]
    pub(crate) fn anticipate_matches(&self, ids: &[NodeId]) {
        let [_, first, second, third, fourth, _, sixth, _, eighth, ..] = *ids else {
            return;
        };
        let decided = |id: NodeId| Some(self.tree.element(id)?.classes.as_ref()?.decided.borrow());
        self.tree.prefetch_node(eighth);
        self.tree.prefetch_data(sixth);
        prefetch(&self.boxes[self.tree[sixth].layout_box]);
        if let Some(it) = self.tree.element(fourth) {
            it.classes.iter().for_each(|it| prefetch_shared(it, 3));
            it.style.iter().for_each(|it| prefetch_shared(it, 3));
            it.rules.iter().for_each(|it| prefetch_shared(it, 1));
        }
        decided(third)
            .iter()
            .flat_map(|it| it.iter())
            .for_each(|it| {
                (0..3).for_each(|line| {
                    prefetch_read(
                        it.list
                            .as_ptr()
                            .cast::<u8>()
                            .wrapping_add(line * 64)
                            .wrapping_sub(16),
                        Locality::L1,
                    )
                })
            });
        decided(second)
            .iter()
            .flat_map(|it| it.iter())
            .filter_map(|it| it.list.upgrade())
            .for_each(|it| it.prefetch_styles());
        decided(first)
            .iter()
            .flat_map(|it| it.iter())
            .filter_map(|it| it.list.upgrade()?.last_style())
            .for_each(|it| (prefetch(&it.layout.display), prefetch_shared(&it.ink, 1)).0);
    }

    /// Likewise, if that has another inline style.
    #[inline]
    pub(crate) fn anticipate_amendments(&self, ids: &[NodeId]) {
        let [_, _, second, _, fourth, _, sixth, _, eighth, ..] = *ids else {
            return;
        };
        self.tree.prefetch_links(eighth);
        self.tree.prefetch_data(sixth);
        let own = &self.boxes[self.tree[sixth].layout_box];
        prefetch(own);
        prefetch(&own.layout);
        prefetch(&own.container);
        prefetch(&own.painted);
        if let Some(it) = self.tree.element(fourth) {
            it.style.iter().for_each(|it| prefetch_shared(it, 3));
            it.rules.iter().for_each(|it| prefetch_shared(it, 1));
        }
        if let Some(Element {
            style: Some(style),
            rules: Some(rules),
            ..
        }) = self.tree.element(second)
        {
            prefetch(&style.layout.display);
            self.styles
                .plain
                .last_of(rules)
                .into_iter()
                .for_each(|it| style.prefetch_group_of(it));
        }
    }
}
