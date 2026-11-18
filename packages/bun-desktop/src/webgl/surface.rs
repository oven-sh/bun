//! The drawing buffer.

use std::rc::Rc;

use super::Picture;
use super::context::{Context, Extension, MAX_COLORS, dirty};
use super::decoder::{Answer, Result, bad_enum, check_state, check_value};
use super::formats::{Format, find};
use super::framebuffers::{Attachment, Framebuffer, READ, Renderbuffer};
use super::gl::*;
use super::native::Gl;
use super::objects::{Bytes, Handle};
use super::pixels::{premultiply, zeroed};
use crate::abi_webgl::answer;
use crate::gfx::Pixmap;

pub struct Surface {
    pub framebuffer: Rc<Framebuffer>,
    /// With one sample, if the other has more.
    resolved: Option<Framebuffer>,
    size: [u32; 2],
    format: u32,
    pub is_resolved: bool,
    pub was_presented: bool,
    /// Their memory is used again once nothing shows them.
    pictures: Vec<Pixmap>,
    /// Of as many as there can be.
    bytes: Bytes,
}

impl Surface {
    pub fn new() -> Surface {
        Surface {
            framebuffer: Rc::new(Framebuffer::of(Handle::default())),
            resolved: None,
            size: [0; 2],
            format: NONE,
            is_resolved: false,
            was_presented: false,
            pictures: Vec::new(),
            bytes: Bytes::default(),
        }
    }
}

impl Context {
    fn attach_new(
        &mut self,
        framebuffer: &Framebuffer,
        slots: &[usize],
        format: &'static Format,
        samples: u32,
        size: [u32; 2],
    ) -> Result {
        let renderbuffer = Rc::new(Renderbuffer::of(Handle::default()));
        self.store(&renderbuffer, format, samples, size)?;
        self.gl
            .bind_framebuffer(DRAW_FRAMEBUFFER, framebuffer.name.0);
        slots.iter().for_each(|it| {
            self.set_attachment(
                framebuffer,
                DRAW_FRAMEBUFFER,
                *it,
                Some(Attachment::Renderbuffer(renderbuffer.clone())),
            )
        });
        Ok(())
    }

    fn allocate_surface(&mut self, format: &'static Format, size: [u32; 2]) -> Result {
        const DEPTH: usize = MAX_COLORS;
        const STENCIL: usize = MAX_COLORS + 1;
        let (framebuffer, attributes) = (self.surface.framebuffer.clone(), self.attributes);
        let samples = self
            .sample_counts(format)
            .into_iter()
            .find(|it| *it <= 4 && attributes.antialias)
            .unwrap_or(0);
        self.surface.resolved = None;
        self.surface.bytes.set(
            u64::from(size[0]) * u64::from(size[1]) * if format.sized == RGBA16F { 36 } else { 20 },
        )?;
        self.attach_new(&framebuffer, &[0], format, samples, size)?;
        let slots =
            &[DEPTH, STENCIL][usize::from(!attributes.depth)..1 + usize::from(attributes.stencil)];
        if let (Some(format), false) = (
            find(if attributes.stencil {
                DEPTH24_STENCIL8
            } else {
                DEPTH_COMPONENT24
            }),
            slots.is_empty(),
        ) {
            self.attach_new(
                &framebuffer,
                if self.is_webgl2() || slots.len() < 2 {
                    slots
                } else {
                    &[STENCIL + 1]
                },
                format,
                samples,
                size,
            )?;
        }
        if samples > 0 {
            let resolved = Framebuffer::of(Handle::default());
            self.attach_new(&resolved, &[0], format, 0, size)?;
            self.initialize_framebuffer(&resolved)?;
            self.surface.resolved = Some(resolved);
        }
        Ok(())
    }

    /// `NONE` keeps the format. The answer is the format and the size, which can be smaller.
    pub fn drawing_buffer_storage(
        &mut self,
        format: u32,
        width: u32,
        height: u32,
    ) -> Result<Answer> {
        let (is_first, limit) = (self.surface.format == NONE, self.limits.renderbuffer_size);
        let sized = match format {
            NONE if is_first && self.attributes.alpha => RGBA8,
            NONE if is_first => RGB8,
            NONE => self.surface.format,
            RGBA8 => format,
            SRGB8_ALPHA8 if self.features.is_webgl2_or_has(Extension::Srgb) => format,
            RGBA16F if find(format).is_some_and(|it| self.features.renders(it)) => format,
            _ => return bad_enum("unknown format"),
        };
        check_state(
            format == NONE || self.attributes.alpha,
            "the context has no alpha",
        )?;
        check_value(
            format == NONE || width <= limit && height <= limit,
            "it is larger than MAX_RENDERBUFFER_SIZE",
        )?;
        let (Some(stored), mut size) = (find(sized), [width, height].map(|it| it.clamp(1, limit)))
        else {
            return bad_enum("unknown format");
        };
        while let Err(error) = self.allocate_surface(stored, size) {
            if size == [1, 1] {
                self.link.lose();
                return Err(error);
            }
            size = size.map(|it| (it / 2).max(1));
        }
        self.restore_framebuffer(DRAW_FRAMEBUFFER);
        if is_first {
            self.restore_framebuffer(READ_FRAMEBUFFER);
            let [width, height] = [width.min(size[0]) as i32, height.min(size[1]) as i32];
            self.viewport(0, 0, width, height)?;
            self.gl.scissor(0, 0, width, height);
        }
        (
            self.surface.size,
            self.surface.format,
            self.surface.is_resolved,
            self.surface.was_presented,
        ) = (size, sized, false, false);
        self.surface.pictures.clear();
        Ok(Answer::List(answer::UINTS, vec![sized, size[0], size[1]]))
    }

    pub fn set_color_spaces(&mut self, is_drawing_buffer_wide: bool, is_unpack_wide: bool) {
        self.is_wide = [is_drawing_buffer_wide, is_unpack_wide];
    }

    /// Binds what has the pixels of the drawing buffer, to read them.
    fn resolve(&mut self) {
        let (gl, surface) = (self.gl, &self.surface);
        let (source, resolved, [width, height]) = (
            surface.framebuffer.name.0,
            surface.resolved.as_ref().map(|it| it.name.0),
            surface.size.map(|it| it as i32),
        );
        gl.bind_framebuffer(READ_FRAMEBUFFER, source);
        gl.read_buffer(COLOR_ATTACHMENT0);
        let Some(resolved) = resolved else { return };
        if !std::mem::replace(&mut self.surface.is_resolved, true) {
            gl.bind_framebuffer(DRAW_FRAMEBUFFER, resolved);
            self.unmasked(|gl| {
                gl.blit(
                    [0, 0, width, height],
                    [0, 0, width, height],
                    COLOR_BUFFER_BIT,
                    NEAREST,
                )
            });
            self.restore_framebuffer(DRAW_FRAMEBUFFER);
            self.dirty |= dirty::FRAMEBUFFER;
        }
        gl.bind_framebuffer(READ_FRAMEBUFFER, resolved);
    }

    /// With what the page reads from.
    pub fn reading(&mut self, read: impl FnOnce(&Gl)) {
        let needs_other = self.framebuffers[READ].is_default() && self.surface.resolved.is_some();
        if needs_other {
            self.resolve();
        }
        read(self.gl);
        if needs_other {
            self.restore_framebuffer(READ_FRAMEBUFFER);
        }
    }

    fn picture(&mut self, is_straight: bool) -> Option<Pixmap> {
        let (gl, [width, height]) = (self.gl, self.surface.size);
        self.initialize_framebuffer(&self.surface.framebuffer.clone())
            .ok()?;
        let unused = self
            .surface
            .pictures
            .iter()
            .position(|it| !it.is_shared())
            .map(|it| self.surface.pictures.swap_remove(it));
        let mut picture = unused.or_else(|| Pixmap::new(width, height))?;
        let (pixels, is_float) = (picture.data_mut(), self.surface.format == RGBA16F);
        let mut floats = zeroed(if is_float { pixels.len() * 4 } else { 0 })?;
        self.resolve();
        gl.pixel_storei(PACK_ALIGNMENT, 4);
        gl.pixel_storei(PACK_ROW_LENGTH, 0);
        self.can_read_upside_down
            .inspect(|it| gl.pixel_storei(*it, 1));
        let (kind, to) = if is_float {
            (FLOAT, floats.as_mut_ptr())
        } else {
            (UNSIGNED_BYTE, pixels.as_mut_ptr())
        };
        // SAFETY: both are as large as the drawing buffer.
        unsafe { (gl.read_pixels)(0, 0, width, height, RGBA, kind, to) };
        self.can_read_upside_down
            .inspect(|it| gl.pixel_storei(*it, 0));
        gl.bind_framebuffer(READ_FRAMEBUFFER, self.surface.framebuffer.name.0);
        gl.read_buffer(if self.surface.framebuffer.read_buffer() == NONE {
            NONE
        } else {
            COLOR_ATTACHMENT0
        });
        self.restore_framebuffer(READ_FRAMEBUFFER);
        pixels
            .iter_mut()
            .zip(floats.as_chunks().0)
            .for_each(|(to, it)| *to = (f32::from_ne_bytes(*it) * 255. + 0.5) as u8);
        if self.can_read_upside_down.is_none() {
            let (top, bottom) = pixels.split_at_mut((height / 2 * width * 4) as usize);
            top.chunks_exact_mut(width as usize * 4)
                .zip(bottom.rchunks_exact_mut(width as usize * 4))
                .for_each(|(a, b)| a.swap_with_slice(b));
        }
        if !self.attributes.premultiplied_alpha && self.attributes.alpha && !is_straight {
            pixels
                .as_chunks_mut()
                .0
                .iter_mut()
                .for_each(|it| *it = premultiply(*it));
        }
        picture.allow_sharing();
        self.surface.pictures.truncate(2);
        self.surface.pictures.extend(picture.shared());
        Some(picture)
    }

    fn discard(&mut self) {
        for it in self.surface.framebuffer.all() {
            if let Attachment::Renderbuffer(it) = it {
                it.is_raw.set(true);
            }
        }
        self.surface.is_resolved = false;
        self.dirty |= dirty::FRAMEBUFFER;
    }

    pub fn present(&mut self, canvas: u32) {
        if !std::mem::replace(&mut self.surface.was_presented, true) {
            let pixels = self.picture(false);
            self.link.present(
                canvas,
                Picture {
                    pixels,
                    size: self.surface.size,
                    is_wide: self.is_wide[0],
                },
            );
            self.dirty |= dirty::FRAMEBUFFER;
            if !self.attributes.preserve_drawing_buffer {
                self.discard();
            }
        }
    }

    pub fn read_back(&mut self, discards: bool, is_straight: bool) {
        let pixels = self.picture(is_straight);
        self.link.hand_over(Picture {
            pixels,
            size: self.surface.size,
            is_wide: self.is_wide[0],
        });
        if discards {
            self.discard();
        }
    }
}
