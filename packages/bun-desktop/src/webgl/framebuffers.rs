//! Framebuffers and renderbuffers.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use super::buffers::PACK;
use super::context::{Context, Extension, MAX_COLORS, Packing, dirty};
use super::decoder::{
    Answer, Error, NO_MEMORY, Result, bad_enum, bad_state, bytes_of_mut, check_enum, check_state,
    check_value, size_from,
};
use super::formats::{Component, Format, components, native_kind, size_of_kind, view_for};
use super::gl::*;
use super::native::{Functions, Gl, Kind, Name};
use super::objects::{Bytes, Handle, is};
use super::pixels::Layout;
use super::textures::{Place, Texture};
use crate::abi_webgl::{Unpacking, answer, scalar};

pub const DRAW: usize = 0;
pub const READ: usize = 1;
const DEPTH_SLOT: usize = MAX_COLORS;
const STENCIL_SLOT: usize = MAX_COLORS + 1;
/// Only in WebGL 1.
const BOTH_SLOT: usize = MAX_COLORS + 2;
const INCOMPLETE: Error = Error(
    INVALID_FRAMEBUFFER_OPERATION,
    "the framebuffer is not complete",
);

pub struct Renderbuffer {
    pub handle: Handle,
    name: Name,
    format: Cell<Option<&'static Format>>,
    /// As the page has said it.
    internal_format: Cell<u32>,
    size: Cell<[u32; 2]>,
    samples: Cell<u32>,
    pub is_raw: Cell<bool>,
    bytes: Bytes,
}

impl Renderbuffer {
    pub fn of(handle: Handle) -> Renderbuffer {
        let (format, size, samples, is_raw, bytes) = Default::default();
        Renderbuffer {
            handle,
            name: Name::new(Kind::Renderbuffer),
            format,
            internal_format: RGBA4.into(),
            size,
            samples,
            is_raw,
            bytes,
        }
    }

    pub fn new(handle: Handle, _: u32, _: &Context) -> Renderbuffer {
        Renderbuffer::of(handle)
    }
}

#[derive(Clone)]
pub enum Attachment {
    Texture(Rc<Texture>, Place, u32),
    Renderbuffer(Rc<Renderbuffer>),
}

impl PartialEq for Attachment {
    fn eq(&self, other: &Attachment) -> bool {
        match (self, other) {
            (
                Attachment::Texture(a, place, layer),
                Attachment::Texture(b, other_place, other_layer),
            ) => Rc::ptr_eq(a, b) && (place, layer) == (other_place, other_layer),
            (Attachment::Renderbuffer(a), Attachment::Renderbuffer(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }
}

impl Attachment {
    pub fn format(&self) -> Option<&'static Format> {
        match self {
            Attachment::Texture(texture, place, _) => texture.image(*place).format,
            Attachment::Renderbuffer(it) => it.format.get(),
        }
    }

    pub fn size(&self) -> [u32; 2] {
        match self {
            Attachment::Texture(texture, place, _) => {
                [0, 1].map(|it| texture.image(*place).size[it])
            }
            Attachment::Renderbuffer(it) => it.size.get(),
        }
    }

    fn id(&self) -> u32 {
        match self {
            Attachment::Texture(it, ..) => it.handle.id,
            Attachment::Renderbuffer(it) => it.handle.id,
        }
    }

    pub fn samples(&self) -> u32 {
        if let Attachment::Renderbuffer(it) = self {
            it.samples.get()
        } else {
            0
        }
    }

    pub fn is_of_texture(&self, texture: &Rc<Texture>) -> bool {
        matches!(self, Attachment::Texture(it, ..) if Rc::ptr_eq(it, texture))
    }

    fn can_be_reached(&self, is_webgl2: bool) -> bool {
        let Attachment::Texture(texture, place, layer) = self else {
            return true;
        };
        let base = texture.level_range()[0];
        let has_level = || {
            texture.immutable_levels.get() > 0
                || place.level == base
                || place.level > base && texture.last_mipmap().is_some_and(|it| place.level <= it)
        };
        *layer < texture.image(*place).size[2]
            && (texture.target() != TEXTURE_CUBE_MAP || texture.is_cube_complete())
            && (!is_webgl2 || has_level())
    }

    fn attach_natively(this: Option<&Attachment>, gl: &Gl, target: u32, point: u32) {
        match this.filter(|it| !matches!(it, Attachment::Texture(it, place, _) if (1..=place.level).contains(&it.immutable_levels.get()))) {
            Some(Attachment::Texture(it, place, layer)) if place.has_layers() => gl.framebuffer_texture_layer(target, point, it.name.0, place.level as i32, *layer as i32),
            Some(Attachment::Texture(it, place, _)) => gl.framebuffer_texture_2d(target, point, place.target, it.name.0, place.level as i32),
            Some(Attachment::Renderbuffer(it)) => gl.framebuffer_renderbuffer(target, point, RENDERBUFFER, it.name.0),
            None => gl.framebuffer_renderbuffer(target, point, RENDERBUFFER, 0),
        }
    }
}

pub struct Framebuffer {
    pub handle: Handle,
    pub name: Name,
    attachments: RefCell<[Option<Attachment>; MAX_COLORS + 3]>,
    /// A bit for each.
    pub draw_buffers: Cell<u8>,
    read_buffer: Cell<Option<usize>>,
    /// And the generation of the images that it is about.
    status: Cell<(u64, u32)>,
}

impl Framebuffer {
    pub fn of(handle: Handle) -> Framebuffer {
        Framebuffer {
            handle,
            name: Name::new(Kind::Framebuffer),
            attachments: RefCell::default(),
            draw_buffers: 1.into(),
            read_buffer: Some(0).into(),
            status: Cell::default(),
        }
    }

    pub fn new(handle: Handle, _: u32, _: &Context) -> Framebuffer {
        Framebuffer::of(handle)
    }

    pub fn is_default(&self) -> bool {
        self.handle.id == 0
    }

    pub fn color(&self, index: usize) -> Option<Attachment> {
        self.attachments.borrow()[index].clone()
    }

    pub fn depth(&self) -> Option<Attachment> {
        self.color(BOTH_SLOT).or_else(|| self.color(DEPTH_SLOT))
    }

    pub fn stencil(&self) -> Option<Attachment> {
        self.color(BOTH_SLOT).or_else(|| self.color(STENCIL_SLOT))
    }

    pub fn all(&self) -> Vec<Attachment> {
        self.attachments
            .borrow()
            .iter()
            .flatten()
            .cloned()
            .collect()
    }

    /// What is drawn to, and at which location.
    pub fn drawn(&self) -> impl Iterator<Item = (usize, Attachment)> {
        (0..MAX_COLORS)
            .filter(|it| self.draw_buffers.get() >> it & 1 != 0)
            .filter_map(|it| Some((it, self.color(it)?)))
    }

    pub fn samples(&self) -> u32 {
        self.attachments
            .borrow()
            .iter()
            .flatten()
            .next()
            .map_or(0, Attachment::samples)
    }

    pub fn draw_buffer(&self, index: u32) -> u32 {
        if self.draw_buffers.get() >> index & 1 == 0 {
            NONE
        } else if self.is_default() {
            BACK
        } else {
            COLOR_ATTACHMENT0 + index
        }
    }

    pub fn read_buffer(&self) -> u32 {
        self.read_buffer.get().map_or(NONE, |it| {
            if self.is_default() {
                BACK
            } else {
                COLOR_ATTACHMENT0 + it as u32
            }
        })
    }
}

/// The part of a line that is inside of `0..limit`: how much is skipped, and how much is left.
pub fn clip(start: i32, length: u32, limit: u32) -> (u32, u32) {
    let (first, end) = (
        i64::from(start).max(0),
        (i64::from(start) + i64::from(length)).min(limit.into()),
    );
    if first < end {
        ((first - i64::from(start)) as u32, (end - first) as u32)
    } else {
        (0, 0)
    }
}

/// Both ends of the part of `from` that is inside of `0..limit`, and of where it goes. Not all drivers can do without.
fn clip_blit(from: [i32; 2], to: [i32; 2], limit: u32) -> Option<[i32; 4]> {
    const FAR: f64 = 32768.;
    let (from, to, limit) = (from.map(f64::from), to.map(f64::from), f64::from(limit));
    let share = |[start, end]: [f64; 2], it: f64| (it - start) / (end - start);
    let at = |[start, end]: [f64; 2], share: f64| start + (end - start) * share;
    let [a, b, c, d] = [
        share(from, 0.),
        share(from, limit),
        share(to, -FAR),
        share(to, FAR),
    ];
    let (first, last) = (
        a.min(b).max(c.min(d)).max(0.),
        a.max(b).min(c.max(d)).min(1.),
    );
    (from[0] != from[1] && to[0] != to[1] && first < last).then_some(())?;
    let [first, last] = if from[0] < from[1] {
        [at(from, first).floor(), at(from, last).ceil()]
    } else {
        [at(from, first).ceil(), at(from, last).floor()]
    }
    .map(|it| it.clamp(0., limit));
    let [start, end] = [first, last].map(|it| at(to, share(from, it)).round());
    let [start, end] = match (last - first).abs() {
        ..1.5 => [start, end].map(|it| it.clamp(-FAR, FAR)),
        ..2.5 => [start, end]
            .map(|it| it.clamp((start + end) / 2. - 2. * FAR, (start + end) / 2. + 2. * FAR)),
        _ => [start, end],
    };
    Some([first, last, start, end].map(|it| it as i32))
}

/// The format and the type that can always be read.
fn usual_read(stored: &Format) -> [u32; 2] {
    match (stored.component, stored.bits[0]) {
        (Component::Unorm, 16) => [RGBA, UNSIGNED_SHORT],
        (Component::Unorm, _) => [RGBA, UNSIGNED_BYTE],
        (Component::Snorm, _) => [RGBA, stored.kinds[0]],
        (Component::Float, _) => [RGBA, FLOAT],
        (Component::Int, _) => [RGBA_INTEGER, INT],
        (Component::Uint, _) => [RGBA_INTEGER, UNSIGNED_INT],
    }
}

impl Context {
    fn framebuffer_sides(&self, target: u32) -> Result<std::ops::Range<usize>> {
        match target {
            FRAMEBUFFER => Ok(DRAW..READ + 1),
            DRAW_FRAMEBUFFER if self.is_webgl2() => Ok(DRAW..DRAW + 1),
            READ_FRAMEBUFFER if self.is_webgl2() => Ok(READ..READ + 1),
            _ => bad_enum("unknown target"),
        }
    }

    pub fn bind_framebuffer(
        &mut self,
        target: u32,
        framebuffer: Option<Rc<Framebuffer>>,
    ) -> Result {
        let (sides, framebuffer) = (
            self.framebuffer_sides(target)?,
            framebuffer.unwrap_or_else(|| self.surface.framebuffer.clone()),
        );
        framebuffer.handle.was_bound.set(true);
        self.gl.bind_framebuffer(target, framebuffer.name.0);
        self.framebuffers[sides].fill(framebuffer);
        self.dirty |= dirty::IMAGES;
        Ok(())
    }

    pub fn forget_framebuffer(&mut self, framebuffer: &Rc<Framebuffer>) {
        for (side, target) in [(DRAW, DRAW_FRAMEBUFFER), (READ, READ_FRAMEBUFFER)] {
            if Rc::ptr_eq(&self.framebuffers[side], framebuffer) {
                self.framebuffers[side] = self.surface.framebuffer.clone();
                self.restore_framebuffer(target);
            }
        }
        self.dirty |= dirty::IMAGES;
    }

    pub fn restore_framebuffer(&self, target: u32) {
        self.gl.bind_framebuffer(
            target,
            self.framebuffers[usize::from(target == READ_FRAMEBUFFER)]
                .name
                .0,
        );
    }

    fn color_attachments(&self) -> u32 {
        if self.features.is_webgl2_or_has(Extension::DrawBuffers) {
            self.limits.shaders.draw_buffers
        } else {
            1
        }
    }

    fn attachment_slots(&self, attachment: u32) -> Result<std::ops::Range<usize>> {
        let first = match attachment {
            DEPTH_STENCIL_ATTACHMENT if self.is_webgl2() => return Ok(DEPTH_SLOT..STENCIL_SLOT + 1),
            DEPTH_STENCIL_ATTACHMENT => BOTH_SLOT,
            DEPTH_ATTACHMENT => DEPTH_SLOT,
            STENCIL_ATTACHMENT => STENCIL_SLOT,
            _ if attachment.wrapping_sub(COLOR_ATTACHMENT0) < self.color_attachments() => {
                (attachment - COLOR_ATTACHMENT0) as usize
            }
            _ => return bad_enum("unknown attachment"),
        };
        Ok(first..first + 1)
    }

    /// The framebuffer is bound to `target`.
    pub fn set_attachment(
        &mut self,
        framebuffer: &Framebuffer,
        target: u32,
        slot: usize,
        attachment: Option<Attachment>,
    ) {
        framebuffer.attachments.borrow_mut()[slot] = attachment;
        if slot < MAX_COLORS {
            Attachment::attach_natively(
                framebuffer.color(slot).as_ref(),
                self.gl,
                target,
                COLOR_ATTACHMENT0 + slot as u32,
            );
        } else {
            Attachment::attach_natively(
                framebuffer.depth().as_ref(),
                self.gl,
                target,
                DEPTH_ATTACHMENT,
            );
            Attachment::attach_natively(
                framebuffer.stencil().as_ref(),
                self.gl,
                target,
                STENCIL_ATTACHMENT,
            );
        }
        framebuffer.status.take();
        self.dirty |= dirty::IMAGES;
    }

    fn attach(
        &mut self,
        target: u32,
        point: u32,
        attachment: impl FnOnce(&Context) -> Result<Option<Attachment>>,
    ) -> Result {
        let (side, slots) = (
            self.framebuffer_sides(target)?.start,
            self.attachment_slots(point)?,
        );
        let (attachment, framebuffer) = (attachment(self)?, self.framebuffers[side].clone());
        check_state(
            !framebuffer.is_default(),
            "not with the default framebuffer",
        )?;
        slots.for_each(|slot| self.set_attachment(&framebuffer, target, slot, attachment.clone()));
        Ok(())
    }

    /// From those that are bound.
    pub fn detach(&mut self, is_it: impl Fn(&Attachment) -> bool) {
        for (framebuffer, target) in self
            .framebuffers
            .clone()
            .into_iter()
            .zip([DRAW_FRAMEBUFFER, READ_FRAMEBUFFER])
        {
            for slot in
                (0..=BOTH_SLOT).filter(|it| framebuffer.color(*it).is_some_and(|it| is_it(&it)))
            {
                self.set_attachment(&framebuffer, target, slot, None);
            }
        }
        self.dirty |= dirty::IMAGES;
    }

    pub fn framebuffer_renderbuffer(
        &mut self,
        target: u32,
        attachment: u32,
        kind: u32,
        renderbuffer: Option<Rc<Renderbuffer>>,
    ) -> Result {
        self.attach(target, attachment, |_| {
            check_enum(kind == RENDERBUFFER, "unknown target")?;
            check_state(
                renderbuffer
                    .as_ref()
                    .is_none_or(|it| it.handle.was_bound.get()),
                "bindRenderbuffer was not called for it",
            )?;
            Ok(renderbuffer.map(Attachment::Renderbuffer))
        })
    }

    pub fn framebuffer_texture_2d(
        &mut self,
        target: u32,
        attachment: u32,
        face: u32,
        texture: Option<Rc<Texture>>,
        level: u32,
    ) -> Result {
        self.attach(target, attachment, |it| {
            let (place, Some(texture)) = (
                Place {
                    target: face,
                    level,
                },
                texture,
            ) else {
                return Ok(None);
            };
            check_enum(
                matches!(
                    face,
                    TEXTURE_2D | TEXTURE_CUBE_MAP_POSITIVE_X..=TEXTURE_CUBE_MAP_NEGATIVE_Z
                ),
                "unknown textarget",
            )?;
            check_value(
                level == 0 || it.features.is_webgl2_or_has(Extension::RenderMipmap),
                "only level 0 can be attached",
            )?;
            it.check_level(place)?;
            check_state(
                texture.handle.was_bound.get() && texture.faces().contains(&face),
                "the texture is of another kind than textarget",
            )?;
            Ok(Some(Attachment::Texture(texture, place, 0)))
        })
    }

    pub fn framebuffer_texture_layer(
        &mut self,
        target: u32,
        attachment: u32,
        texture: Option<Rc<Texture>>,
        level: u32,
        layer: u32,
    ) -> Result {
        self.attach(target, attachment, |it| {
            let Some(texture) = texture else {
                return Ok(None);
            };
            let place = Place {
                target: texture.target(),
                level,
            };
            check_state(place.has_layers(), "the texture has no layers")?;
            check_value(
                layer
                    < if place.target == TEXTURE_3D {
                        it.limits.volume_size
                    } else {
                        it.limits.layers
                    },
                "there is no such layer",
            )?;
            it.check_level(place)?;
            Ok(Some(Attachment::Texture(texture, place, layer)))
        })
    }

    fn find_status(&self, framebuffer: &Framebuffer, target: u32) -> u32 {
        let attachments = framebuffer.attachments.borrow();
        let Some(first) = attachments.iter().flatten().next() else {
            return FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
        };
        for (slot, it) in attachments
            .iter()
            .enumerate()
            .filter_map(|(slot, it)| Some((slot, it.as_ref()?)))
        {
            let fits = it.format().is_some_and(|format| match slot {
                DEPTH_SLOT => format.has_depth() && (self.is_webgl2() || !format.has_stencil()),
                STENCIL_SLOT => {
                    format.has_stencil()
                        && (self.is_webgl2() || !format.has_depth() || framebuffer.is_default())
                }
                BOTH_SLOT => format.has_depth() && format.has_stencil(),
                _ => {
                    format.is_color() && (self.features.renders(format) || framebuffer.is_default())
                }
            });
            if !fits || it.size().contains(&0) || !it.can_be_reached(self.is_webgl2()) {
                return FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
            } else if it.size() != first.size() {
                return FRAMEBUFFER_INCOMPLETE_DIMENSIONS;
            } else if it.samples() != first.samples() {
                return FRAMEBUFFER_INCOMPLETE_MULTISAMPLE;
            } else if slot < MAX_COLORS
                && attachments[..slot]
                    .iter()
                    .flatten()
                    .any(|other| other == it)
            {
                return FRAMEBUFFER_UNSUPPORTED;
            }
        }
        let mut others = attachments[DEPTH_SLOT..].iter().flatten();
        let is_consistent = others
            .next()
            .zip(others.next())
            .is_none_or(|(a, b)| self.is_webgl2() && a == b);
        if is_consistent && self.gl.check_framebuffer_status(target) == FRAMEBUFFER_COMPLETE {
            FRAMEBUFFER_COMPLETE
        } else {
            FRAMEBUFFER_UNSUPPORTED
        }
    }

    fn status(&self, side: usize) -> u32 {
        let framebuffer = &self.framebuffers[side];
        if framebuffer.status.get().0 != self.generation {
            framebuffer.status.set((
                self.generation,
                self.find_status(framebuffer, [DRAW_FRAMEBUFFER, READ_FRAMEBUFFER][side]),
            ));
        }
        framebuffer.status.get().1
    }

    pub fn is_complete(&self, side: usize) -> bool {
        self.status(side) == FRAMEBUFFER_COMPLETE
    }

    pub fn check_framebuffer_status(&mut self, target: u32) -> Answer {
        let sides = self
            .framebuffer_sides(target)
            .inspect_err(|it| self.record("checkFramebufferStatus", *it));
        Answer::Uint(sides.map_or(0, |it| self.status(it.start)))
    }

    /// False if the driver cannot draw to it.
    pub fn clear_image(&mut self, format: &Format, attach: impl Fn(&Gl, u32)) -> bool {
        let gl = self.gl;
        let point = [
            COLOR_ATTACHMENT0,
            DEPTH_ATTACHMENT,
            STENCIL_ATTACHMENT,
            DEPTH_STENCIL_ATTACHMENT,
        ][usize::from(format.has_depth()) + 2 * usize::from(format.has_stencil())];
        gl.bind_framebuffer(DRAW_FRAMEBUFFER, self.scratch_framebuffer.0);
        attach(gl, point);
        let clear = |it: &mut Context| {
            it.unmasked(|gl| match (point, format.component) {
                (DEPTH_STENCIL_ATTACHMENT, _) => gl.clear_bufferfi(DEPTH_STENCIL, 0, 1., 0),
                (DEPTH_ATTACHMENT, _) => gl.clear_bufferfv(DEPTH, 0, &[1f32.to_bits(); 4]),
                (STENCIL_ATTACHMENT, _) => gl.clear_bufferiv(STENCIL, 0, &[0; 4]),
                (_, Component::Int) => gl.clear_bufferiv(COLOR, 0, &[0; 4]),
                (_, Component::Uint) => gl.clear_bufferuiv(COLOR, 0, &[0; 4]),
                _ => gl.clear_bufferfv(COLOR, 0, &[0; 4]),
            });
        };
        let is_cleared = gl.check_framebuffer_status(DRAW_FRAMEBUFFER) == FRAMEBUFFER_COMPLETE
            && self.allocate(clear).is_ok();
        gl.framebuffer_renderbuffer(DRAW_FRAMEBUFFER, point, RENDERBUFFER, 0);
        self.restore_framebuffer(DRAW_FRAMEBUFFER);
        is_cleared
    }

    /// Before it is drawn to or read from.
    pub fn prepare_framebuffer(&mut self, side: usize) -> Result {
        if !self.is_complete(side) {
            return Err(INCOMPLETE);
        }
        self.initialize_framebuffer(&self.framebuffers[side].clone())
    }

    pub fn initialize_framebuffer(&mut self, framebuffer: &Framebuffer) -> Result {
        framebuffer
            .all()
            .iter()
            .try_for_each(|attachment| match attachment {
                Attachment::Texture(texture, place, _) => self.initialize_image(texture, *place),
                Attachment::Renderbuffer(it) => {
                    let clear = |format| {
                        self.clear_image(format, |gl, point| {
                            gl.framebuffer_renderbuffer(
                                DRAW_FRAMEBUFFER,
                                point,
                                RENDERBUFFER,
                                it.name.0,
                            )
                        })
                    };
                    it.is_raw
                        .set(it.is_raw.get() && !it.format.get().is_some_and(clear));
                    if it.is_raw.get() {
                        Err(INCOMPLETE)
                    } else {
                        Ok(())
                    }
                }
            })
    }

    pub fn bind_renderbuffer(
        &mut self,
        target: u32,
        renderbuffer: Option<Rc<Renderbuffer>>,
    ) -> Result {
        check_enum(target == RENDERBUFFER, "unknown target")?;
        if let Some(it) = &renderbuffer
            && !it.handle.was_bound.replace(true)
        {
            self.gl.bind_renderbuffer(target, it.name.0);
        }
        self.renderbuffer = renderbuffer;
        Ok(())
    }

    pub fn forget_renderbuffer(&mut self, renderbuffer: &Rc<Renderbuffer>) {
        if is(&self.renderbuffer, renderbuffer) {
            self.renderbuffer = None;
        }
        self.detach(
            |it| matches!(it, Attachment::Renderbuffer(it) if Rc::ptr_eq(it, renderbuffer)),
        );
    }

    fn bound_renderbuffer(&self, target: u32) -> Result<Rc<Renderbuffer>> {
        check_enum(target == RENDERBUFFER, "unknown target")?;
        self.renderbuffer
            .clone()
            .map_or(bad_state("there is no current renderbuffer"), Ok)
    }

    pub fn store(
        &mut self,
        renderbuffer: &Renderbuffer,
        format: &'static Format,
        samples: u32,
        [width, height]: [u32; 2],
    ) -> Result {
        renderbuffer
            .bytes
            .set(format.bytes([width, height, samples.max(1)]))?;
        self.gl.bind_renderbuffer(RENDERBUFFER, renderbuffer.name.0);
        let result = self.allocate(|it| {
            it.gl.renderbuffer_storage_multisample(
                RENDERBUFFER,
                samples,
                format.sized,
                width,
                height,
            )
        });
        renderbuffer.format.set(Some(format));
        renderbuffer.size.set(if result.is_ok() {
            [width, height]
        } else {
            [0; 2]
        });
        renderbuffer.samples.set(samples);
        renderbuffer.is_raw.set(true);
        self.images_changed();
        result.inspect_err(|_| _ = renderbuffer.bytes.set(0))
    }

    /// The most first.
    pub fn sample_counts(&self, format: &Format) -> Vec<u32> {
        if format.is_integer() && format.is_color() {
            Vec::new()
        } else {
            self.gl.sample_counts(format.sized)
        }
    }

    pub fn renderbuffer_storage(
        &mut self,
        target: u32,
        format: u32,
        width: u32,
        height: u32,
    ) -> Result {
        self.renderbuffer_storage_multisample(target, 0, format, width, height)
    }

    pub fn renderbuffer_storage_multisample(
        &mut self,
        target: u32,
        samples: u32,
        internal_format: u32,
        width: u32,
        height: u32,
    ) -> Result {
        let renderbuffer = self.bound_renderbuffer(target)?;
        check_value(
            samples as i32 >= 0
                && width <= self.limits.renderbuffer_size
                && height <= self.limits.renderbuffer_size,
            "negative samples, or too large",
        )?;
        let Some(format) = self.features.for_renderbuffer(internal_format) else {
            return bad_enum("unknown internalformat");
        };
        let available = if samples == 0 {
            Some(0)
        } else {
            self.sample_counts(format)
                .into_iter()
                .rfind(|it| *it >= samples && internal_format != DEPTH_STENCIL)
        };
        let Some(samples) = available else {
            return bad_state("the format cannot have so many samples");
        };
        renderbuffer.internal_format.set(internal_format);
        self.store(&renderbuffer, format, samples, [width, height])
    }

    pub fn get_renderbuffer_parameter(&mut self, target: u32, name: u32) -> Result<Answer> {
        let it = self.bound_renderbuffer(target)?;
        Ok(Answer::Uint(match name {
            RENDERBUFFER_WIDTH => it.size.get()[0],
            RENDERBUFFER_HEIGHT => it.size.get()[1],
            RENDERBUFFER_INTERNAL_FORMAT => it.internal_format.get(),
            RENDERBUFFER_RED_SIZE..=RENDERBUFFER_STENCIL_SIZE => it
                .format
                .get()
                .filter(|_| !it.size.get().contains(&0))
                .map_or(0, |it| {
                    it.bits[(name - RENDERBUFFER_RED_SIZE) as usize].into()
                }),
            RENDERBUFFER_SAMPLES if self.is_webgl2() => it.samples.get(),
            _ => return bad_enum("unknown pname"),
        }))
    }

    pub fn get_internalformat_parameter(
        &mut self,
        target: u32,
        format: u32,
        name: u32,
    ) -> Result<Answer> {
        let format = [(RGB, RGB8), (RGBA, RGBA8)]
            .iter()
            .find(|it| it.0 == format)
            .map_or(format, |it| it.1);
        let format = self
            .features
            .for_renderbuffer(format)
            .filter(|it| it.sized == format);
        check_enum(
            target == RENDERBUFFER && (format.is_some() && name == SAMPLES),
            "unknown target, internalformat or pname",
        )?;
        Ok(Answer::List(
            answer::INT_ARRAY,
            format.map_or_else(Vec::new, |it| self.sample_counts(it)),
        ))
    }

    pub fn get_framebuffer_attachment_parameter(
        &mut self,
        target: u32,
        point: u32,
        name: u32,
    ) -> Result<Answer> {
        let (framebuffer, is_webgl2) = (
            self.framebuffers[self.framebuffer_sides(target)?.start].clone(),
            self.is_webgl2(),
        );
        let attachment = match point {
            _ if !framebuffer.is_default() => {
                let slots = self.attachment_slots(point)?;
                let [first, last] =
                    [slots.start, slots.end - 1].map(|it| framebuffer.color(it).map(|it| it.id()));
                check_state(first == last, "depth and stencil are in two images")?;
                framebuffer.color(slots.start)
            }
            _ if !is_webgl2 => {
                return self
                    .attachment_slots(point)
                    .and(bad_state("not with the default framebuffer"));
            }
            BACK => framebuffer.color(0),
            DEPTH => framebuffer.depth(),
            STENCIL => framebuffer.stencil(),
            _ => return bad_enum("unknown attachment"),
        };
        let has_component_type = is_webgl2
            || self.has(Extension::ColorBufferFloat)
            || self.has(Extension::ColorBufferHalfFloat);
        let format = attachment.as_ref().and_then(Attachment::format);
        Ok(match (name, &attachment) {
            (FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, None) => Answer::Uint(NONE),
            (FRAMEBUFFER_ATTACHMENT_OBJECT_NAME, None) if is_webgl2 => Answer::Null,
            (_, None) if is_webgl2 => return bad_state("the attachment is empty"),
            (_, None) => return bad_enum("unknown pname"),
            (FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, _) if framebuffer.is_default() => {
                Answer::Uint(FRAMEBUFFER_DEFAULT)
            }
            (FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, Some(Attachment::Texture(..))) => {
                Answer::Uint(TEXTURE)
            }
            (FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, _) => Answer::Uint(RENDERBUFFER),
            (FRAMEBUFFER_ATTACHMENT_OBJECT_NAME, Some(it)) if !framebuffer.is_default() => {
                Answer::Object(it.id())
            }
            (FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL, Some(Attachment::Texture(_, place, _))) => {
                Answer::Uint(place.level)
            }
            (
                FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE,
                Some(Attachment::Texture(it, place, _)),
            ) => Answer::Uint(if it.target() == TEXTURE_CUBE_MAP {
                place.target
            } else {
                0
            }),
            (FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER, Some(Attachment::Texture(_, _, layer)))
                if is_webgl2 =>
            {
                Answer::Uint(*layer)
            }
            (FRAMEBUFFER_ATTACHMENT_RED_SIZE..=FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE, _)
                if is_webgl2 =>
            {
                let part = (name - FRAMEBUFFER_ATTACHMENT_RED_SIZE) as usize;
                Answer::Uint(format.map_or(0, |it| it.bits[part].into()))
            }
            (FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING, _)
                if self.features.is_webgl2_or_has(Extension::Srgb) =>
            {
                Answer::Uint(if format.is_some_and(Format::is_srgb) {
                    SRGB
                } else {
                    LINEAR
                })
            }
            (FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE, _) if has_component_type => {
                check_state(
                    point != DEPTH_STENCIL_ATTACHMENT,
                    "depth and stencil have no common type",
                )?;
                Answer::Uint(format.map_or(NONE, |it| {
                    if matches!(point, STENCIL | STENCIL_ATTACHMENT) {
                        UNSIGNED_INT
                    } else {
                        it.component_type()
                    }
                }))
            }
            _ => return bad_enum("unknown pname"),
        })
    }

    pub fn draw_buffers(&mut self, buffers: &[u32]) -> Result {
        let (framebuffer, limit) = (self.framebuffers[DRAW].clone(), self.color_attachments());
        check_value(
            buffers.len() <= limit as usize,
            "the list is longer than MAX_DRAW_BUFFERS",
        )?;
        check_enum(
            buffers
                .iter()
                .all(|it| matches!(*it, NONE | BACK | COLOR_ATTACHMENT0..=COLOR_ATTACHMENT15)),
            "unknown buffer",
        )?;
        let is_valid = |(index, it): (u32, &u32)| {
            *it == NONE
                || *it
                    == if framebuffer.is_default() {
                        BACK
                    } else {
                        COLOR_ATTACHMENT0 + index
                    }
        };
        check_state(
            (0..).zip(buffers).all(is_valid) && (buffers.len() == 1 || !framebuffer.is_default()),
            "a buffer is at the wrong place, or is not for this framebuffer",
        )?;
        framebuffer.draw_buffers.set(
            (0..)
                .zip(buffers)
                .fold(0, |all, (index, it)| all | u8::from(*it != NONE) << index),
        );
        self.gl.set_draw_buffers(
            &buffers
                .iter()
                .map(|it| if *it == BACK { COLOR_ATTACHMENT0 } else { *it })
                .collect::<Vec<_>>(),
        );
        self.dirty |= dirty::OUTPUTS;
        Ok(())
    }

    pub fn read_buffer(&mut self, source: u32) -> Result {
        let (framebuffer, index) = (
            &self.framebuffers[READ],
            source.wrapping_sub(COLOR_ATTACHMENT0),
        );
        check_enum(
            matches!(source, NONE | BACK) || index < 32,
            "invalid read buffer",
        )?;
        check_state(
            source == NONE
                || if framebuffer.is_default() {
                    source == BACK
                } else {
                    index < self.color_attachments()
                },
            "invalid read buffer",
        )?;
        framebuffer.read_buffer.set(if source == NONE {
            None
        } else if source == BACK {
            Some(0)
        } else {
            Some(index as usize)
        });
        self.gl.read_buffer(if source == BACK {
            COLOR_ATTACHMENT0
        } else {
            source
        });
        Ok(())
    }

    pub fn invalidate_framebuffer(
        &mut self,
        target: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        attachments: &[u32],
    ) -> Result {
        let side = self.framebuffer_sides(target)?.start;
        let framebuffer = self.framebuffers[side].clone();
        check_value(width >= 0 && height >= 0, "negative size")?;
        attachments.iter().try_for_each(|it| match *it {
            it if framebuffer.is_default() => {
                check_enum(matches!(it, COLOR | DEPTH | STENCIL), "unknown attachment")
            }
            COLOR_ATTACHMENT0..=COLOR_ATTACHMENT15 => {
                check_state(self.attachment_slots(*it).is_ok(), "unknown attachment")
            }
            it => self.attachment_slots(it).map(drop),
        })?;
        if x > 0 || y > 0 || framebuffer.is_default() || !self.is_complete(side) {
            return Ok(());
        }
        let slots: Vec<_> = attachments
            .iter()
            .flat_map(|it| self.attachment_slots(*it))
            .flatten()
            .collect();
        let (mut points, mut count) = ([NONE; 10], 0);
        for slot in (0..BOTH_SLOT).filter(|it| slots.contains(it)) {
            let Some(Attachment::Renderbuffer(it)) = framebuffer.color(slot) else {
                continue;
            };
            let is_half = it
                .format
                .get()
                .is_some_and(|it| it.has_depth() && it.has_stencil())
                && !(slots.contains(&DEPTH_SLOT) && slots.contains(&STENCIL_SLOT));
            if !is_half
                && [(x, width), (y, height)].iter().zip(it.size.get()).all(
                    |((start, length), size)| i64::from(*start) + i64::from(*length) >= size.into(),
                )
            {
                it.is_raw.set(true);
                points[count] = if slot < MAX_COLORS {
                    COLOR_ATTACHMENT0 + slot as u32
                } else {
                    [DEPTH_ATTACHMENT, STENCIL_ATTACHMENT][slot - MAX_COLORS]
                };
                count += 1;
            }
        }
        self.gl.invalidate_framebuffer(
            [DRAW_FRAMEBUFFER, READ_FRAMEBUFFER][side],
            count as u32,
            &points,
        );
        self.dirty |= dirty::FRAMEBUFFER;
        Ok(())
    }

    pub fn clear(&mut self, mask: u32) -> Result {
        check_value(
            mask & !(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT) == 0,
            "unknown mask",
        )?;
        self.prepare_target()?;
        check_state(
            mask & COLOR_BUFFER_BIT == 0 || !self.plan.has_integer_target,
            "integer formats need clearBufferiv or clearBufferuiv",
        )
        .map(|()| self.gl.clear(mask))
    }

    pub fn clear_buffer(&mut self, buffer: u32, index: u32, kind: u32, values: &[u32]) -> Result {
        let is_color = buffer == COLOR;
        check_enum(
            is_color
                || (buffer, kind) == (DEPTH, scalar::FLOAT)
                || (buffer, kind) == (STENCIL, scalar::INT),
            "unknown buffer",
        )?;
        check_value(
            index
                < if is_color {
                    self.limits.shaders.draw_buffers
                } else {
                    1
                }
                && values.len() >= if is_color { 4 } else { 1 },
            "there is no such draw buffer, or there are too few values",
        )?;
        self.prepare_target()?;
        let format = self.framebuffers[DRAW]
            .drawn()
            .find(|it| is_color && it.0 == index as usize)
            .and_then(|it| it.1.format());
        check_state(
            format.is_none_or(|it| it.scalar() == kind),
            "the values have another type than the draw buffer",
        )?;
        let values = std::array::from_fn(|it| values.get(it).copied().unwrap_or(0));
        [
            Functions::clear_bufferfv,
            Functions::clear_bufferiv,
            Functions::clear_bufferuiv,
        ][kind.min(2) as usize](self.gl, buffer, index as i32, &values);
        Ok(())
    }

    pub fn clear_bufferfi(&mut self, buffer: u32, index: i32, depth: f32, stencil: i32) -> Result {
        check_enum(buffer == DEPTH_STENCIL, "unknown buffer")?;
        check_value(index == 0, "drawbuffer has to be 0")?;
        self.prepare_target()
            .map(|()| self.gl.clear_bufferfi(buffer, index, depth, stencil))
    }

    pub fn blit_framebuffer(&mut self, [edges @ .., mask, filter]: [u32; 10]) -> Result {
        let [x0, y0, x1, y1, to_x0, to_y0, to_x1, to_y1] = edges.map(|it| it as i32);
        let (from, to) = ([x0, y0, x1, y1], [to_x0, to_y0, to_x1, to_y1]);
        check_enum(matches!(filter, NEAREST | LINEAR), "unknown filter")?;
        check_value(
            mask & !(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT) == 0,
            "unknown mask",
        )?;
        check_value(
            [from, to]
                .iter()
                .all(|it| it[0].abs_diff(it[2]).max(it[1].abs_diff(it[3])) <= i32::MAX as u32),
            "the rectangle is out of range",
        )?;
        check_state(
            filter == NEAREST || mask & !COLOR_BUFFER_BIT == 0,
            "depth and stencil need NEAREST",
        )?;
        self.prepare_framebuffer(READ)?;
        self.prepare_target()?;
        let [target, source] = self.framebuffers.clone();
        let resolves = source.samples() > 0;
        check_state(
            target.samples() == 0 && (!resolves || from == to),
            "samples can only be resolved in place, to an image without",
        )?;
        let color = source.read_buffer.get().and_then(|it| source.color(it));
        let colors = target
            .drawn()
            .map(|it| (COLOR_BUFFER_BIT, color.clone(), it.1));
        let others = [
            (DEPTH_BUFFER_BIT, source.depth(), target.depth()),
            (STENCIL_BUFFER_BIT, source.stencil(), target.stencil()),
        ];
        for (bit, from, to) in colors
            .chain(
                others
                    .into_iter()
                    .filter_map(|it| Some((it.0, it.1, it.2?))),
            )
            .filter(|it| mask & it.0 != 0)
        {
            check_state(
                from.as_ref() != Some(&to),
                "source and destination are one image",
            )?;
            let Some((from, to)) = from.and_then(|it| it.format()).zip(to.format()) else {
                return bad_state("the source lacks a buffer");
            };
            let is_valid = if resolves || bit != COLOR_BUFFER_BIT {
                from.sized == to.sized
            } else {
                from.scalar() == to.scalar()
            };
            check_state(
                is_valid && (filter == NEAREST || !from.is_integer()),
                "source and destination have incompatible formats",
            )?;
        }
        let size = source.all().first().map_or([0; 2], Attachment::size);
        if let (Some([x0, x1, to_x0, to_x1]), Some([y0, y1, to_y0, to_y1])) = (
            clip_blit([x0, x1], [to_x0, to_x1], size[0]),
            clip_blit([y0, y1], [to_y0, to_y1], size[1]),
        ) {
            self.gl
                .blit([x0, y0, x1, y1], [to_x0, to_y0, to_x1, to_y1], mask, filter);
        }
        Ok(())
    }

    /// What `readPixels()` and `copyTexImage2D()` read.
    pub fn read_source(&mut self) -> Result<(Attachment, &'static Format)> {
        self.prepare_framebuffer(READ)?;
        let framebuffer = &self.framebuffers[READ];
        let source = framebuffer
            .read_buffer
            .get()
            .and_then(|it| framebuffer.color(it))
            .filter(|it| it.samples() == 0 || framebuffer.is_default());
        source
            .and_then(|it| Some((it.clone(), it.format()?)))
            .map_or(bad_state("the read buffer is empty, or has samples"), Ok)
    }

    /// The format and the type that can be read besides the usual ones.
    pub fn preferred_read(&self, format: &Format) -> [u32; 2] {
        let asks = !self.framebuffers[READ].is_default();
        let [base, kind] = if asks {
            [
                IMPLEMENTATION_COLOR_READ_FORMAT,
                IMPLEMENTATION_COLOR_READ_TYPE,
            ]
            .map(|it| self.gl.integer(it))
        } else {
            [RGBA, format.kinds[0]]
        };
        match kind {
            _ if components(base) == 0 || size_of_kind(kind).0 == 0 => usual_read(format),
            HALF_FLOAT | HALF_FLOAT_OES => [
                base,
                if self.is_webgl2() {
                    HALF_FLOAT
                } else {
                    HALF_FLOAT_OES
                },
            ],
            _ => [base, kind],
        }
    }

    fn check_read(&mut self, size: [u32; 2], format: u32, kind: u32) -> Result<([u32; 2], Layout)> {
        let is_webgl2 = self.is_webgl2();
        let is_format = matches!(format, ALPHA | RGB | RGBA)
            || is_webgl2
                && components(format) > 0
                && !matches!(
                    format,
                    DEPTH_COMPONENT
                        | DEPTH_STENCIL
                        | SRGB_EXT
                        | SRGB_ALPHA_EXT
                        | LUMINANCE
                        | LUMINANCE_ALPHA
                );
        let is_kind = match kind {
            UNSIGNED_BYTE
            | UNSIGNED_SHORT_5_6_5
            | UNSIGNED_SHORT_4_4_4_4
            | UNSIGNED_SHORT_5_5_5_1 => true,
            FLOAT => {
                is_webgl2
                    || [
                        Extension::TextureFloat,
                        Extension::TextureHalfFloat,
                        Extension::ColorBufferHalfFloat,
                    ]
                    .into_iter()
                    .any(|it| self.has(it))
            }
            HALF_FLOAT_OES => self.has(Extension::TextureHalfFloat),
            UNSIGNED_INT_24_8 | FLOAT_32_UNSIGNED_INT_24_8_REV => false,
            _ => is_webgl2 && size_of_kind(kind).0 > 0,
        };
        check_enum(is_format && is_kind, "unknown format or type")?;
        check_value(size.iter().all(|it| *it as i32 >= 0), "negative size")?;
        let (source, stored) = self.read_source()?;
        let is_narrower =
            stored.component == Component::Unorm && [format, kind] == [RGBA, UNSIGNED_BYTE];
        check_state(
            is_narrower
                || usual_read(stored) == [format, kind]
                || self.preferred_read(stored) == [format, kind],
            "the read buffer cannot be read like that",
        )?;
        let Packing {
            alignment,
            row_length,
            skip,
        } = self.packing;
        check_state(
            skip[0] == 0 && row_length == 0
                || u64::from(skip[0]) + u64::from(size[0]) <= row_length.into(),
            "the skipped pixels and the width exceed PACK_ROW_LENGTH",
        )?;
        let store = Unpacking {
            alignment,
            row_length,
            image_height: 0,
            skip: [skip[0], skip[1], 0],
        };
        Ok((
            source.size(),
            Layout::new(&store, format, kind, [size[0], size[1], 1], false),
        ))
    }

    /// # Safety
    /// There is room for the rows, in memory or in the buffer that is bound.
    pub unsafe fn read_natively(
        &mut self,
        [x, y]: [i32; 2],
        [width, height]: [u32; 2],
        format: u32,
        kind: u32,
        [alignment, row_length]: [u32; 2],
        to: *mut u8,
    ) {
        self.gl.pixel_storei(PACK_ALIGNMENT, alignment);
        self.gl.pixel_storei(PACK_ROW_LENGTH, row_length);
        // SAFETY: the caller's contract.
        self.reading(|gl| unsafe {
            (gl.read_pixels)(x, y, width, height, format, native_kind(kind), to)
        });
    }

    /// The answer is where the first row goes, how far the rows are apart, how long they are, and the rows.
    pub fn read_pixels(
        &mut self,
        [x, y, width, height, format, kind, view, available]: [u32; 8],
    ) -> Result {
        let [x, y] = [x, y].map(|it| it as i32);
        check_state(
            self.buffers[PACK].is_none(),
            "not while there is a PIXEL_PACK_BUFFER",
        )?;
        let (size, layout) = self.check_read([width, height], format, kind)?;
        check_state(view == view_for(kind), "the array is of another type")?;
        check_state(
            layout.end <= available.into(),
            "the pixels do not fit into the array",
        )?;
        let ((left, columns), (top, rows)) = (clip(x, width, size[0]), clip(y, height, size[1]));
        let Some(pixel) = layout
            .row
            .checked_div(width.into())
            .filter(|_| columns > 0 && rows > 0)
        else {
            return Ok(());
        };
        let (row, start) = (
            pixel * u64::from(columns),
            layout.start + u64::from(top) * layout.row_stride + u64::from(left) * pixel,
        );
        let words = 3 + (row as usize * rows as usize).div_ceil(4);
        let mut answer = std::mem::take(&mut self.answer);
        answer.try_reserve(words).or(Err(NO_MEMORY))?;
        answer.extend([start as u32, layout.row_stride as u32, row as u32]);
        answer.resize(words, 0);
        // SAFETY: there is room for rows without gaps.
        unsafe {
            self.read_natively(
                [x + left as i32, y + top as i32],
                [columns, rows],
                format,
                kind,
                [1, 0],
                bytes_of_mut(&mut answer[3..]).as_mut_ptr(),
            )
        };
        self.answer = answer;
        Ok(())
    }

    pub fn read_pixels_to_buffer(
        &mut self,
        [x, y, width, height, format, kind, offset]: [u32; 7],
    ) -> Result {
        let ([x, y], offset) = ([x, y].map(|it| it as i32), size_from(offset)?);
        let Some(buffer) = self.buffers[PACK]
            .clone()
            .filter(|it| !self.is_contested(it))
        else {
            return bad_state("there is no free PIXEL_PACK_BUFFER");
        };
        let (size, layout) = self.check_read([width, height], format, kind)?;
        check_state(
            buffer.contains(offset, layout.end)
                && offset.is_multiple_of(size_of_kind(kind).0 as usize),
            "the pixels do not fit into the buffer, or the offset is not aligned",
        )?;
        let ((left, columns), (top, rows)) = (clip(x, width, size[0]), clip(y, height, size[1]));
        let Some(pixel) = layout
            .row
            .checked_div(width.into())
            .filter(|_| columns > 0 && rows > 0)
        else {
            return Ok(());
        };
        let start = offset as u64
            + layout.start
            + u64::from(top) * layout.row_stride
            + u64::from(left) * pixel;
        let store = [
            self.packing.alignment,
            if self.packing.row_length > 0 {
                self.packing.row_length
            } else {
                width
            },
        ];
        self.gl.bind_buffer(PIXEL_PACK_BUFFER, buffer.name.0);
        // SAFETY: it is a part of what the buffer has room for.
        unsafe {
            self.read_natively(
                [x + left as i32, y + top as i32],
                [columns, rows],
                format,
                kind,
                store,
                start as *mut u8,
            )
        };
        self.gl.bind_buffer(PIXEL_PACK_BUFFER, 0);
        Ok(())
    }
}
