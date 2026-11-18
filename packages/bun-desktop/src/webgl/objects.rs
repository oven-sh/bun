//! What the page has made, by the ids that it has chosen.

use std::any::Any;
use std::cell::Cell;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};

use super::buffers::{Buffer, VertexArray};
use super::context::Context;
use super::decoder::{Answer, NO_MEMORY, Result, bad_state, bad_value, check_state};
use super::framebuffers::{Framebuffer, Renderbuffer};
use super::programs::{Program, Shader};
use super::queries::{Fence, Query, TransformFeedback};
use super::textures::{Sampler, Texture};
use crate::abi_webgl::{answer, object};

#[derive(Default)]
pub struct Handle {
    /// 0 if the page does not know it.
    pub id: u32,
    pub is_deleted: Cell<bool>,
    pub was_bound: Cell<bool>,
}

pub trait Object: Any {
    /// It can still be used while something refers to it.
    const OUTLIVES_DELETION: bool = false;
    fn handle(&self) -> &Handle;
}

pub fn id_of<T: Object>(object: Option<&Rc<T>>) -> u32 {
    object.map_or(0, |it| it.handle().id)
}

pub fn is<T>(bound: &Option<Rc<T>>, object: &Rc<T>) -> bool {
    bound.as_ref().is_some_and(|it| Rc::ptr_eq(it, object))
}

struct Entry {
    /// Until it is deleted.
    kept: Option<Rc<dyn Any>>,
    found: Weak<dyn Any>,
}

#[derive(Default)]
pub struct Objects(Vec<Option<Entry>>);

impl Objects {
    fn entry(&self, id: u32) -> Option<&Entry> {
        self.0.get(id.wrapping_sub(1) as usize)?.as_ref()
    }

    pub fn get<T: Object>(&self, id: u32) -> Result<Rc<T>> {
        let Some(entry) = self.entry(id) else {
            return bad_state("the object is from another context");
        };
        match entry
            .found
            .upgrade()
            .filter(|_| T::OUTLIVES_DELETION || entry.kept.is_some())
        {
            Some(found) => found.downcast().or(bad_state("object is of another type")),
            None if T::OUTLIVES_DELETION => bad_value("the object is deleted"),
            None => bad_state("the object is deleted"),
        }
    }

    fn insert(&mut self, id: u32, object: Rc<dyn Any>) -> Result {
        if id as usize == self.0.len() + 1 {
            self.0.push(None);
        }
        let Some(slot @ None) = self.0.get_mut(id.wrapping_sub(1) as usize) else {
            return bad_state("unknown id");
        };
        *slot = Some(Entry {
            found: Rc::downgrade(&object),
            kept: Some(object),
        });
        Ok(())
    }

    fn take<T: Object>(&mut self, id: u32) -> Result<Option<Rc<T>>> {
        check_state(
            self.entry(id).is_some(),
            "the object is from another context",
        )?;
        let Some(object) = self
            .get::<T>(id)
            .ok()
            .filter(|it| !it.handle().is_deleted.replace(true))
        else {
            return Ok(None);
        };
        self.0[id as usize - 1]
            .iter_mut()
            .for_each(|it| it.kept = None);
        Ok(Some(object))
    }
}

macro_rules! objects {
    ($($kind:ident $type:ident $forget:ident $outlives:literal)*) => {
        $(impl Object for $type {
            const OUTLIVES_DELETION: bool = $outlives;

            fn handle(&self) -> &Handle {
                &self.handle
            }
        })*

        impl Context {
            pub fn create(&mut self, kind: u32, id: u32, argument: u32) -> Result {
                let handle = Handle { id, ..Handle::default() };
                let object: Rc<dyn Any> = match kind {
                    $(object::$kind => Rc::new($type::new(handle, argument, self)),)*
                    _ => return bad_state("unknown kind"),
                };
                self.objects.insert(id, object)
            }

            pub fn delete(&mut self, kind: u32, id: u32) -> Result {
                if kind == object::TRANSFORM_FEEDBACK {
                    check_state(!self.objects.get::<TransformFeedback>(id).is_ok_and(|it| it.is_active()), "it has not ended")?;
                }
                match kind {
                    $(object::$kind => self.objects.take::<$type>(id)?.iter().for_each(|it| self.$forget(it)),)*
                    _ => {}
                }
                Ok(())
            }

            pub fn is(&mut self, kind: u32, id: u32) -> Answer {
                Answer::Boolean(match kind {
                    $(object::$kind => self.objects.get::<$type>(id).is_ok_and(|it| it.handle.was_bound.get()),)*
                    _ => false,
                })
            }
        }
    };
}

objects! {
    BUFFER Buffer forget_buffer false
    FRAMEBUFFER Framebuffer forget_framebuffer false
    PROGRAM Program forget_nothing true
    QUERY Query forget_query false
    RENDERBUFFER Renderbuffer forget_renderbuffer false
    SAMPLER Sampler forget_sampler false
    SHADER Shader forget_nothing true
    SYNC Fence forget_nothing false
    TEXTURE Texture forget_texture false
    TRANSFORM_FEEDBACK TransformFeedback forget_transform_feedback false
    VERTEX_ARRAY VertexArray forget_vertex_array false
}

impl Context {
    fn forget_nothing<T>(&mut self, _: &Rc<T>) {}

    /// The page cannot get at it any more.
    pub fn release(&mut self, id: u32) {
        self.objects
            .0
            .get_mut(id.wrapping_sub(1) as usize)
            .map(Option::take);
    }

    /// Those that the page could get back by asking what is bound or attached.
    pub fn list_referenced(&mut self) -> Answer {
        let is_referenced = |it: &Entry| it.found.strong_count() > usize::from(it.kept.is_some());
        Answer::List(
            answer::OBJECTS,
            (1..)
                .zip(&self.objects.0)
                .filter(|it| it.1.as_ref().is_some_and(is_referenced))
                .map(|it| it.0)
                .collect(),
        )
    }
}

static ALLOCATED: AtomicU64 = AtomicU64::new(0);

thread_local! {
    pub static ALLOCATED_HERE: Cell<u64> = const { Cell::new(0) };
}

#[cfg(unix)]
fn physical_memory() -> u64 {
    // SAFETY: it only takes a number.
    unsafe { libc::sysconf(libc::_SC_PHYS_PAGES) as u64 * libc::sysconf(libc::_SC_PAGESIZE) as u64 }
}

#[cfg(windows)]
fn physical_memory() -> u64 {
    let mut kilobytes = 0;
    crate::win32::GetPhysicallyInstalledSystemMemory(&mut kilobytes);
    kilobytes << 10
}

/// The memory of an object.
#[derive(Default)]
pub struct Bytes(Cell<u64>);

impl Bytes {
    pub fn get(&self) -> u64 {
        self.0.get()
    }

    /// All contexts together do not get more than half of what the computer has.
    pub fn set(&self, bytes: u64) -> Result {
        let limit = physical_memory() / 2;
        let before = self.0.get();
        if bytes > before
            && ALLOCATED
                .load(Ordering::Relaxed)
                .saturating_add(bytes - before)
                > limit
        {
            return Err(NO_MEMORY);
        }
        self.0.set(bytes);
        ALLOCATED.fetch_add(bytes.wrapping_sub(before), Ordering::Relaxed);
        ALLOCATED_HERE.set(
            ALLOCATED_HERE
                .get()
                .wrapping_add(bytes.wrapping_sub(before)),
        );
        Ok(())
    }
}

impl Drop for Bytes {
    fn drop(&mut self) {
        _ = self.set(0);
    }
}
