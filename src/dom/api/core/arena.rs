//! The nodes of a page, and of the documents without a window that it has made.

use core::cell::{Cell, RefCell, UnsafeCell};
use core::ffi::c_void;
use std::rc::Rc;

use bun_jsc::JSGlobalObject;

use super::Agent;
use super::changes::Changes;
use super::gc::Barrier;
use super::kinds::Kind;
use super::steps::Has;
use crate::document::Document;
use crate::tree::{DOCUMENT, NodeId};

const MAX_PANICS: u8 = 3;

pub(crate) struct Arena {
    engine: UnsafeCell<Box<Document>>,
    is_borrowed: Cell<bool>,
    /// Since it last painted.
    panics: Cell<u8>,
    /// Their objects were collected, which happens whenever something is allocated.
    dead: RefCell<Vec<NodeId>>,
    /// Those of them that have bare children.
    dead_owners: RefCell<Vec<NodeId>>,
    has_dead: Cell<bool>,
    pub(super) barrier: Barrier,
    /// Every document holds them.
    pub(super) structures: [Cell<*mut c_void>; Kind::ALL.len()],
    pub(super) steps: [Has; Kind::ALL.len()],
    /// No two arenas have the same. What happens in the trees of the user agent does not count.
    pub(super) version: Cell<u64>,
    pub(super) attribute_version: Cell<u64>,
    pub(super) changes: Changes,
    /// Every document holds it.
    pub(super) agent: Cell<*const Agent>,
    pub(super) has_slots: Cell<bool>,
    /// A control can belong to a form that it is not in.
    pub(crate) has_remote_owners: Cell<bool>,
    /// How many bare nodes the collector was not told of.
    pub(super) unreported: Cell<u32>,
    /// A frame is coming, or there is no window.
    pub(crate) is_scheduled: Cell<bool>,
    pub(super) needs_sync: Cell<bool>,
    pub(crate) recent_markup: Cell<Option<Box<crate::api::markup::Recent>>>,
}

impl Arena {
    pub(crate) fn new(global: &JSGlobalObject, font_scope: u32, base_url: &[u8]) -> Rc<Arena> {
        thread_local! {
            static SERIAL: Cell<u64> = const { Cell::new(1) };
        }
        crate::recovery::install();
        let version = SERIAL.replace(SERIAL.get() + 1) << 40;
        Rc::new(Arena {
            engine: UnsafeCell::new(Box::new(Document::new(font_scope, base_url))),
            is_borrowed: Cell::new(false),
            panics: Cell::new(0),
            dead: RefCell::default(),
            dead_owners: RefCell::default(),
            has_dead: Cell::new(false),
            barrier: Barrier::new(global),
            structures: [const { Cell::new(core::ptr::null_mut()) }; Kind::ALL.len()],
            steps: core::array::from_fn(|it| Has::of(Kind::ALL[it])),
            version: Cell::new(version),
            agent: Cell::new(core::ptr::null()),
            attribute_version: Cell::new(0),
            changes: Changes::new(version),
            has_slots: Cell::new(false),
            has_remote_owners: Cell::new(false),
            unreported: Cell::new(0),
            is_scheduled: Cell::new(true),
            needs_sync: Cell::new(false),
            recent_markup: Cell::new(None),
        })
    }

    #[inline(always)]
    pub(crate) fn read<R>(&self, read: impl FnOnce(&Document) -> R) -> R {
        assert!(!self.is_borrowed.get());
        // SAFETY: nothing has it mutably.
        read(unsafe { &**self.engine.get() })
    }

    /// For what changes nodes that are not rendered, and cannot panic.
    #[inline(always)]
    pub(crate) fn write<R>(&self, write: impl FnOnce(&mut Document) -> R) -> R {
        assert!(!self.is_borrowed.replace(true));
        // SAFETY: nothing else has it mutably, and what `read` runs does not come here.
        let result = write(unsafe { &mut **self.engine.get() });
        self.is_borrowed.set(false);
        result
    }

    /// `None` if it panics, or if that has kept happening.
    #[inline]
    pub(crate) fn attempt<R>(&self, run: impl FnOnce(&mut Document) -> R) -> Option<R> {
        // SAFETY: `guard` has borrowed it.
        self.guard(|| run(unsafe { &mut *self.engine_unchecked() }))
    }

    /// `run` may use `engine_unchecked`.
    #[inline]
    pub(crate) fn guard<R>(&self, run: impl FnOnce() -> R) -> Option<R> {
        if self.is_broken() {
            return None;
        }
        assert!(!self.is_borrowed.replace(true));
        let result = crate::recovery::attempt(run);
        self.is_borrowed.set(false);
        if result.is_none() {
            self.recover();
        }
        result
    }

    #[cold]
    fn recover(&self) {
        self.panics.set(self.panics.get() + 1);
        self.write(|engine| {
            if self.is_broken() || crate::recovery::attempt(|| engine.start_over()).is_none() {
                self.panics.set(MAX_PANICS);
                let mut old = core::mem::ManuallyDrop::new(core::mem::replace(
                    engine,
                    *Box::new(Document::new(0, b"")),
                ));
                core::mem::swap(&mut engine.tree, &mut old.tree);
                engine.tree.leak_styles();
                engine.tree.forget_boxes();
            }
        });
    }

    #[inline(always)]
    pub(crate) fn is_broken(&self) -> bool {
        self.panics.get() >= MAX_PANICS
    }

    pub(crate) fn paint(&self, engine: &mut Document, surface: u32) {
        engine.paint_frame(surface);
        if !self.is_broken() {
            self.panics.set(0);
        }
        self.free_dead(engine);
    }

    /// # Safety
    /// As for a `&mut`, for as long as it is used, and no node is asked for anything meanwhile.
    #[inline(always)]
    pub(crate) unsafe fn engine_unchecked(&self) -> *mut Document {
        // SAFETY: the box is only written by its owner.
        unsafe { &raw mut **self.engine.get() }
    }

    pub(super) fn collected(&self, id: NodeId, has_bare_children: bool) {
        if has_bare_children {
            self.dead_owners.borrow_mut().push(id);
        }
        self.dead.borrow_mut().push(id);
        self.has_dead.set(true);
    }

    /// Before a node is made.
    #[inline(always)]
    pub(crate) fn free_dead(&self, engine: &mut Document) {
        if self.has_dead.get() {
            self.has_dead.set(false);
            self.dead_owners
                .take()
                .into_iter()
                .for_each(|it| _ = engine.tree.free_below(it));
            let dead = self.dead.take();
            for (index, id) in dead.iter().copied().enumerate() {
                engine.tree.prefetch_in(&dead[index..]);
                match id {
                    DOCUMENT => engine.tree.set_cell(id, core::ptr::null()),
                    _ => engine.tree.free(id),
                }
            }
        }
    }
}
