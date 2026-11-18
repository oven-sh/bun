//! Textures and samplers.

use std::cell::{Cell, RefCell};
use std::ptr::null;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

use super::context::{Context, Extension, check_comparison, dirty};
use super::decoder::{
    Answer, NO_MEMORY, Result, bad_enum, bad_state, check_enum, check_state, check_value,
};
use super::formats::{Component, Features, Format, bytes_per_pixel, find};
use super::gl::*;
use super::native::{Kind, Name};
use super::objects::{Bytes, Handle, is};
use super::pixels::zeroed;
use crate::abi_webgl::Unpacking;

pub const TARGETS: [u32; 4] = [TEXTURE_2D, TEXTURE_CUBE_MAP, TEXTURE_3D, TEXTURE_2D_ARRAY];
pub const LEVELS: usize = 15;

#[derive(Clone, Copy, Default)]
pub struct Image {
    pub format: Option<&'static Format>,
    pub size: [u32; 3],
    /// The page has left the details of the format open.
    pub is_unsized: bool,
    /// It has whatever was in that memory.
    pub is_raw: bool,
}

#[derive(Clone, Copy)]
pub struct Sampling {
    min_filter: u32,
    mag_filter: u32,
    wrap: [u32; 3],
    lod: [f32; 2],
    compare_mode: u32,
    compare_function: u32,
    anisotropy: f32,
}

impl Default for Sampling {
    fn default() -> Sampling {
        Sampling {
            min_filter: NEAREST_MIPMAP_LINEAR,
            mag_filter: LINEAR,
            wrap: [REPEAT; 3],
            lod: [-1000., 1000.],
            compare_mode: NONE,
            compare_function: LEQUAL,
            anisotropy: 1.,
        }
    }
}

/// What `texParameterf()` or `texParameteri()` was given, as both.
#[derive(Clone, Copy)]
struct Value(f32, i32);

impl Sampling {
    /// Returns whether it is an integer.
    fn set(&mut self, name: u32, Value(float, integer): Value, context: &Context) -> Result<bool> {
        let (value, is_webgl2) = (integer as u32, context.is_webgl2());
        let is_wrap = matches!(value, REPEAT | CLAMP_TO_EDGE | MIRRORED_REPEAT)
            || value == MIRROR_CLAMP_TO_EDGE_EXT && context.has(Extension::MirrorClamp);
        let (field, is_valid) = match name {
            TEXTURE_MIN_FILTER => (
                &mut self.min_filter,
                matches!(
                    value,
                    NEAREST | LINEAR | NEAREST_MIPMAP_NEAREST..=LINEAR_MIPMAP_LINEAR
                ),
            ),
            TEXTURE_MAG_FILTER => (&mut self.mag_filter, matches!(value, NEAREST | LINEAR)),
            TEXTURE_WRAP_S => (&mut self.wrap[0], is_wrap),
            TEXTURE_WRAP_T => (&mut self.wrap[1], is_wrap),
            TEXTURE_WRAP_R if is_webgl2 => (&mut self.wrap[2], is_wrap),
            TEXTURE_COMPARE_MODE if is_webgl2 => (
                &mut self.compare_mode,
                matches!(value, NONE | COMPARE_REF_TO_TEXTURE),
            ),
            TEXTURE_COMPARE_FUNC if is_webgl2 => {
                (&mut self.compare_function, check_comparison(value).is_ok())
            }
            TEXTURE_MIN_LOD | TEXTURE_MAX_LOD if is_webgl2 => {
                self.lod[(name - TEXTURE_MIN_LOD) as usize] = float;
                return Ok(false);
            }
            TEXTURE_MAX_ANISOTROPY_EXT if context.has(Extension::Anisotropic) => {
                check_value(float >= 1., "unknown param")?;
                self.anisotropy = float;
                return Ok(false);
            }
            _ => return bad_enum("unknown pname"),
        };
        check_enum(is_valid, "unknown param")?;
        *field = value;
        Ok(true)
    }

    fn get(&self, name: u32, features: Features) -> Result<Answer> {
        Ok(match name {
            TEXTURE_MIN_FILTER => Answer::Uint(self.min_filter),
            TEXTURE_MAG_FILTER => Answer::Uint(self.mag_filter),
            TEXTURE_WRAP_S => Answer::Uint(self.wrap[0]),
            TEXTURE_WRAP_T => Answer::Uint(self.wrap[1]),
            TEXTURE_MAX_ANISOTROPY_EXT if features.has(Extension::Anisotropic) => {
                Answer::Float(self.anisotropy)
            }
            TEXTURE_WRAP_R if features.is_webgl2 => Answer::Uint(self.wrap[2]),
            TEXTURE_COMPARE_MODE if features.is_webgl2 => Answer::Uint(self.compare_mode),
            TEXTURE_COMPARE_FUNC if features.is_webgl2 => Answer::Uint(self.compare_function),
            TEXTURE_MIN_LOD | TEXTURE_MAX_LOD if features.is_webgl2 => {
                Answer::Float(self.lod[(name - TEXTURE_MIN_LOD) as usize])
            }
            _ => return bad_enum("unknown pname"),
        })
    }

    fn uses_mipmaps(&self) -> bool {
        !matches!(self.min_filter, NEAREST | LINEAR)
    }
}

pub struct Sampler {
    pub handle: Handle,
    name: Name,
    pub sampling: Cell<Sampling>,
}

impl Sampler {
    pub fn new(handle: Handle, _: u32, _: &Context) -> Sampler {
        handle.was_bound.set(true);
        Sampler {
            handle,
            name: Name::new(Kind::Sampler),
            sampling: Cell::default(),
        }
    }
}

pub struct Texture {
    pub handle: Handle,
    pub name: Name,
    /// Unlike the name, no other gets it.
    serial: u64,
    /// In `TARGETS`, once it was bound.
    pub slot: Cell<usize>,
    /// The levels of each face.
    images: RefCell<Vec<Image>>,
    pub sampling: Cell<Sampling>,
    /// The first and the last that are used.
    levels: Cell<[u32; 2]>,
    pub immutable_levels: Cell<u32>,
    reads_stencil: Cell<bool>,
    native_levels: Cell<[u32; 2]>,
    swizzle: Cell<[u32; 4]>,
    may_be_raw: Cell<bool>,
    bytes: Bytes,
}

#[derive(Default)]
pub struct Unit {
    pub textures: [Option<Rc<Texture>>; 4],
    pub sampler: Option<Rc<Sampler>>,
    native: [u64; 4],
}

/// An image of a texture.
#[derive(Clone, Copy, PartialEq)]
pub struct Place {
    /// A face, if it is a cube.
    pub target: u32,
    pub level: u32,
}

impl Place {
    fn index(self) -> usize {
        let face = self.target.wrapping_sub(TEXTURE_CUBE_MAP_POSITIVE_X);
        (if face < 6 { face as usize * LEVELS } else { 0 }) + self.level as usize
    }

    pub fn has_layers(self) -> bool {
        matches!(self.target, TEXTURE_3D | TEXTURE_2D_ARRAY)
    }
}

fn at_level(size: [u32; 3], level: u32, target: u32) -> [u32; 3] {
    let half = |it: u32| (it >> level).max(1);
    [
        half(size[0]),
        half(size[1]),
        if target == TEXTURE_3D {
            half(size[2])
        } else {
            size[2]
        },
    ]
}

fn last_level(size: [u32; 3], target: u32) -> u32 {
    size[0]
        .max(size[1])
        .max(if target == TEXTURE_3D { size[2] } else { 1 })
        .ilog2()
}

impl Texture {
    pub fn new(handle: Handle, _: u32, _: &Context) -> Texture {
        static SERIAL: AtomicU64 = AtomicU64::new(1);
        let (slot, images, sampling, immutable_levels, reads_stencil, may_be_raw, bytes) =
            Default::default();
        let (name, serial, levels, swizzle) = (
            Name::new(Kind::Texture),
            SERIAL.fetch_add(1, Ordering::Relaxed),
            [0, 1000].into(),
            [RED, RED + 1, RED + 2, ALPHA].into(),
        );
        Texture {
            handle,
            name,
            serial,
            slot,
            images,
            sampling,
            native_levels: [0, 1000].into(),
            levels,
            immutable_levels,
            reads_stencil,
            swizzle,
            may_be_raw,
            bytes,
        }
    }

    pub fn target(&self) -> u32 {
        TARGETS[self.slot.get()]
    }

    pub fn image(&self, place: Place) -> Image {
        self.images
            .borrow()
            .get(place.index())
            .copied()
            .unwrap_or_default()
    }

    pub fn set_written(&self, place: Place) {
        self.images.borrow_mut()[place.index()].is_raw = false;
    }

    pub fn faces(&self) -> std::ops::Range<u32> {
        if self.target() == TEXTURE_CUBE_MAP {
            TEXTURE_CUBE_MAP_POSITIVE_X..TEXTURE_CUBE_MAP_NEGATIVE_Z + 1
        } else {
            self.target()..self.target() + 1
        }
    }

    /// The first and the last level that can be read.
    pub fn level_range(&self) -> [u32; 2] {
        let [base, last] = self.levels.get();
        let Some(limit) = self.immutable_levels.get().checked_sub(1) else {
            return [base, last];
        };
        [base.min(limit), last.clamp(base.min(limit), limit)]
    }

    pub fn base(&self) -> Image {
        let level = self.level_range()[0];
        if (level as usize) < LEVELS {
            self.image(Place {
                target: self.faces().start,
                level,
            })
        } else {
            Image::default()
        }
    }

    fn matches(&self, level: u32, format: &Format, size: [u32; 3]) -> bool {
        self.faces()
            .map(|target| self.image(Place { target, level }))
            .all(|it| it.size == size && it.format.is_some_and(|it| std::ptr::eq(it, format)))
    }

    pub fn is_cube_complete(&self) -> bool {
        let base = self.base();
        base.format.is_some_and(|it| {
            !base.size.contains(&0) && self.matches(self.level_range()[0], it, base.size)
        })
    }

    /// The last level, if it has all.
    pub fn last_mipmap(&self) -> Option<u32> {
        let (base, [first, last]) = (self.base(), self.level_range());
        let (format, last) = (
            base.format.filter(|_| self.is_cube_complete())?,
            last.min(first + last_level(base.size, self.target())),
        );
        (first <= last
            && (first + 1..=last)
                .all(|it| self.matches(it, format, at_level(base.size, it - first, self.target()))))
        .then_some(last)
    }

    /// The levels that a shader reads, if it is complete.
    pub fn sampled_levels(&self, sampling: &Sampling, features: Features) -> Option<[u32; 2]> {
        let (base, [first, limit]) = (self.base(), self.level_range());
        let format = base
            .format
            .filter(|_| self.is_cube_complete() && first <= limit)?;
        let is_smooth = sampling.mag_filter != NEAREST
            || !matches!(sampling.min_filter, NEAREST | NEAREST_MIPMAP_NEAREST);
        let filters = features.meet(format.filters)
            || format.has_depth()
                && sampling.compare_mode != NONE
                && !(format.has_stencil() && self.reads_stencil.get());
        let is_restricted = !features.is_webgl2 && !base.size.iter().all(|it| it.is_power_of_two());
        if is_smooth && !filters
            || is_restricted
                && (sampling.uses_mipmaps() || sampling.wrap[..2] != [CLAMP_TO_EDGE; 2])
        {
            return None;
        }
        Some([
            first,
            if sampling.uses_mipmaps() {
                self.last_mipmap()?
            } else {
                first
            },
        ])
    }

    /// The type of the samplers of a shader that can read it.
    pub fn is_for(&self, component: Component, is_shadow: bool, sampling: &Sampling) -> bool {
        self.base().format.is_none_or(|it| match it.component {
            _ if it.has_stencil() && self.reads_stencil.get() => component == Component::Uint,
            _ if it.has_depth() => {
                component == Component::Float && is_shadow == (sampling.compare_mode != NONE)
            }
            Component::Int | Component::Uint => component == it.component,
            _ => component == Component::Float && !is_shadow,
        })
    }
}

impl Context {
    pub fn active_texture(&mut self, texture: u32) -> Result {
        let unit = texture.wrapping_sub(TEXTURE0);
        check_enum(
            unit < self.limits.shaders.combined_texture_units,
            "there is no such texture unit",
        )?;
        self.active_unit = unit as usize;
        Ok(())
    }

    fn texture_slot(&self, target: u32) -> Result<usize> {
        TARGETS[..if self.is_webgl2() { 4 } else { 2 }]
            .iter()
            .position(|it| *it == target)
            .map_or(bad_enum("unknown target"), Ok)
    }

    pub fn bind_texture(&mut self, target: u32, texture: Option<Rc<Texture>>) -> Result {
        let slot = self.texture_slot(target)?;
        if let Some(texture) = &texture {
            if !texture.handle.was_bound.replace(true) {
                texture.slot.set(slot);
                texture
                    .images
                    .replace(vec![Image::default(); texture.faces().len() * LEVELS]);
                self.select(texture);
            }
            check_state(
                texture.slot.get() == slot,
                "the texture was bound to another target",
            )?;
        }
        self.units[self.active_unit].textures[slot] = texture;
        self.dirty |= dirty::TEXTURES;
        Ok(())
    }

    pub fn forget_texture(&mut self, texture: &Rc<Texture>) {
        self.units.iter_mut().for_each(|it| {
            drop(it.textures[texture.slot.get()].take_if(|it| Rc::ptr_eq(it, texture)))
        });
        self.detach(|it| it.is_of_texture(texture));
    }

    pub fn bind_natively(&mut self, unit: usize, slot: usize, texture: Option<&Texture>) {
        let serial = texture.map_or(0, |it| it.serial);
        if std::mem::replace(&mut self.units[unit].native[slot], serial) != serial {
            self.activate(unit);
            self.gl
                .bind_texture(TARGETS[slot], texture.map_or(0, |it| it.name.0));
        }
    }

    fn activate(&mut self, unit: usize) {
        if std::mem::replace(&mut self.native_unit, unit) != unit {
            self.gl.active_texture(TEXTURE0 + unit as u32);
        }
    }

    /// Makes it what the functions of the driver work on.
    pub fn select(&mut self, texture: &Texture) {
        let unit = self.units.len() - 1;
        self.bind_natively(unit, texture.slot.get(), Some(texture));
        self.activate(unit);
    }

    fn bound_texture(&self, target: u32) -> Result<Rc<Texture>> {
        self.units[self.active_unit].textures[self.texture_slot(target)?]
            .clone()
            .map_or(bad_state("this target has no texture"), Ok)
    }

    /// For a function with so many dimensions, which names a face of a cube.
    pub fn texture_with(&self, target: u32, dimensions: u32) -> Result<Rc<Texture>> {
        match (target, dimensions) {
            (TEXTURE_2D, 2) | (TEXTURE_3D | TEXTURE_2D_ARRAY, 3) => self.bound_texture(target),
            (TEXTURE_CUBE_MAP_POSITIVE_X..=TEXTURE_CUBE_MAP_NEGATIVE_Z, 2) => {
                self.bound_texture(TEXTURE_CUBE_MAP)
            }
            _ => bad_enum("unknown target"),
        }
    }

    fn largest(&self, target: u32) -> u32 {
        match target {
            TEXTURE_2D | TEXTURE_2D_ARRAY => self.limits.texture_size,
            TEXTURE_3D => self.limits.volume_size,
            _ => self.limits.cube_size,
        }
    }

    pub fn check_level(&self, place: Place) -> Result {
        check_value(
            place.level <= self.largest(place.target).ilog2(),
            "there is no such level",
        )
    }

    pub fn check_size(&self, place: Place, [width, height, depth]: [u32; 3]) -> Result {
        self.check_level(place)?;
        let side = self.largest(place.target) >> place.level;
        let (deepest, is_square) = match place.target {
            TEXTURE_2D => (1, true),
            TEXTURE_3D => (side, true),
            TEXTURE_2D_ARRAY => (self.limits.layers, true),
            _ => (1, width == height),
        };
        check_value(
            width <= side && height <= side && depth <= deepest && is_square,
            "the image is too large, or a face of a cube is no square",
        )?;
        check_value(
            self.is_webgl2()
                || place.level == 0
                || width & width.wrapping_sub(1) == 0 && height & height.wrapping_sub(1) == 0,
            "mipmaps need sides that are powers of two",
        )
    }

    /// `allocate` tells the driver. The texture is selected.
    pub fn define(
        &mut self,
        texture: &Texture,
        images: &[(Place, Image)],
        allocate: impl FnOnce(&mut Context),
    ) -> Result {
        let bytes = |it: &Image| it.format.map_or(0, |format| format.bytes(it.size));
        let before = texture.bytes.get();
        texture
            .bytes
            .set(images.iter().fold(before, |sum, (place, image)| {
                sum + bytes(image) - bytes(&texture.image(*place))
            }))?;
        self.select(texture);
        if let Err(error) = self.allocate(allocate) {
            _ = texture.bytes.set(before);
            // Other errors change nothing. After this one, nobody knows which images there are.
            if let (OUT_OF_MEMORY, Some(format)) = (error.0, find(RGBA8)) {
                for &(place, _) in images
                    .iter()
                    .filter(|it| it.1.format.or(texture.image(it.0).format).is_some())
                {
                    // SAFETY: there is nothing to read.
                    _ = self
                        .allocate(|it| unsafe {
                            it.write_natively(place, format, None, [0; 3], UNSIGNED_BYTE, null())
                        })
                        .inspect_err(|_| self.link.lose());
                    _ = texture.bytes.set(
                        texture.bytes.get()
                            - bytes(&std::mem::take(
                                &mut texture.images.borrow_mut()[place.index()],
                            )),
                    );
                }
                self.images_changed();
            }
            self.update_levels(texture);
            return Err(error);
        }
        for (place, image) in images {
            texture.images.borrow_mut()[place.index()] = *image;
            texture.may_be_raw.update(|it| it || image.is_raw);
        }
        self.update_swizzle(texture);
        self.update_levels(texture);
        self.images_changed();
        Ok(())
    }

    fn update_swizzle(&mut self, texture: &Texture) {
        const TEXTURE_SWIZZLE_R: u32 = 0x8E42;
        if let Some(swizzle) = texture.base().format.map(|it| it.swizzle(self.is_webgl2()))
            && texture.swizzle.replace(swizzle) != swizzle
        {
            self.select(texture);
            (TEXTURE_SWIZZLE_R..)
                .zip(swizzle)
                .for_each(|(name, it)| self.gl.tex_parameteri(texture.target(), name, it));
        }
    }

    fn set_levels(&mut self, texture: &Texture, levels: [u32; 2]) {
        if texture.native_levels.replace(levels) != levels {
            self.select(texture);
            [TEXTURE_BASE_LEVEL, TEXTURE_MAX_LEVEL]
                .into_iter()
                .zip(levels)
                .for_each(|(name, it)| {
                    self.gl
                        .tex_parameteri(texture.target(), name, it.min(LEVELS as u32 - 1))
                });
        }
    }

    /// Drivers have memory for levels that are missing or do not fit, which `texelFetch` would get at.
    fn update_levels(&mut self, texture: &Texture) {
        if self.is_webgl2() {
            let first = texture.level_range()[0];
            self.set_levels(texture, [first, texture.last_mipmap().unwrap_or(first)]);
        }
    }

    pub fn initialize_texture(&mut self, texture: &Texture) -> Result {
        if texture.may_be_raw.get() {
            for (target, level) in texture
                .faces()
                .flat_map(|face| (0..LEVELS as u32).map(move |level| (face, level)))
            {
                self.initialize_image(texture, Place { target, level })?;
            }
            texture.may_be_raw.set(false);
        }
        Ok(())
    }

    pub fn initialize_image(&mut self, texture: &Texture, place: Place) -> Result {
        let image = texture.image(place);
        let Some(format) = image.format.filter(|_| image.is_raw) else {
            return Ok(());
        };
        let is_cleared = format.block.is_none()
            && (0..image.size[2]).all(|layer| {
                self.clear_image(format, |gl, attachment| match place.has_layers() {
                    true => gl.framebuffer_texture_layer(
                        DRAW_FRAMEBUFFER,
                        attachment,
                        texture.name.0,
                        place.level as i32,
                        layer as i32,
                    ),
                    false => gl.framebuffer_texture_2d(
                        DRAW_FRAMEBUFFER,
                        attachment,
                        place.target,
                        texture.name.0,
                        place.level as i32,
                    ),
                })
            });
        if !is_cleared {
            self.upload_zeros(texture, place, format, image.size)?;
        }
        texture.set_written(place);
        Ok(())
    }

    fn upload_zeros(
        &mut self,
        texture: &Texture,
        place: Place,
        format: &'static Format,
        [width, height, depth]: [u32; 3],
    ) -> Result {
        const AT_ONCE: u64 = 1 << 22;
        let step = format.block.map_or(1, |it| it[1]);
        let row = format.block.map_or_else(
            || u64::from(width) * u64::from(bytes_per_pixel(format.base, format.kinds[0])),
            |_| format.bytes([width, step, 1]),
        );
        let steps = (AT_ONCE / row.max(1)).clamp(1, height.div_ceil(step).max(1).into());
        let zeros = zeroed((row * steps) as usize).ok_or(NO_MEMORY)?;
        self.select(texture);
        self.unpack_natively(Unpacking {
            alignment: 1,
            ..Unpacking::default()
        });
        for (z, y) in (0..depth).flat_map(|z| {
            (0..height)
                .step_by((steps as u32 * step) as usize)
                .map(move |y| (z, y))
        }) {
            let size = [width, (height - y).min(steps as u32 * step), 1];
            // SAFETY: there are as many bytes as the largest part has.
            self.allocate(|it| unsafe {
                it.write_natively(
                    place,
                    format,
                    Some([0, y, z]),
                    size,
                    format.kinds.first().copied().unwrap_or(0),
                    zeros.as_ptr(),
                )
            })?;
        }
        Ok(())
    }

    fn tex_storage(
        &mut self,
        target: u32,
        levels: u32,
        internal_format: u32,
        size: [u32; 3],
        dimensions: u32,
    ) -> Result {
        check_enum(
            matches!(target, TEXTURE_3D | TEXTURE_2D_ARRAY) == (dimensions == 3),
            "unknown target",
        )?;
        let texture = self.bound_texture(target)?;
        let Some(format) = self.features.sized(internal_format) else {
            return bad_enum("unknown internalformat");
        };
        check_value(
            levels as i32 > 0 && size.iter().all(|it| *it as i32 > 0),
            "levels and sizes have to be positive",
        )?;
        check_state(
            levels <= last_level(size, target) + 1,
            "the size allows fewer levels",
        )?;
        self.check_size(Place { target, level: 0 }, size)?;
        check_state(
            texture.immutable_levels.get() == 0,
            "texStorage has settled the images of the texture",
        )?;
        self.check_format_for(Place { target, level: 0 }, format, size)?;
        let image = |level| {
            if level < levels {
                Image {
                    format: Some(format),
                    size: at_level(size, level, target),
                    is_unsized: false,
                    is_raw: true,
                }
            } else {
                Image::default()
            }
        };
        let images: Vec<_> = texture
            .faces()
            .flat_map(|target| {
                (0..LEVELS as u32).map(move |level| (Place { target, level }, image(level)))
            })
            .collect();
        self.define(&texture, &images, |it| match dimensions {
            2 => it
                .gl
                .tex_storage_2d(target, levels, format.native().0, size[0], size[1]),
            _ => it
                .gl
                .tex_storage_3d(target, levels, format.native().0, size[0], size[1], size[2]),
        })?;
        texture.immutable_levels.set(levels);
        self.update_levels(&texture);
        Ok(())
    }

    pub fn tex_storage_2d(
        &mut self,
        target: u32,
        levels: u32,
        format: u32,
        width: u32,
        height: u32,
    ) -> Result {
        self.tex_storage(target, levels, format, [width, height, 1], 2)
    }

    pub fn tex_storage_3d(
        &mut self,
        target: u32,
        levels: u32,
        format: u32,
        width: u32,
        height: u32,
        depth: u32,
    ) -> Result {
        self.tex_storage(target, levels, format, [width, height, depth], 3)
    }

    pub fn generate_mipmap(&mut self, target: u32) -> Result {
        let texture = self.bound_texture(target)?;
        let (base, [first, last]) = (texture.base(), texture.level_range());
        let Some(format) = base.format.filter(|_| texture.is_cube_complete()) else {
            return bad_state("the base level is not defined, or the cube map is incomplete");
        };
        let is_valid = match self.is_webgl2() {
            true => {
                base.is_unsized
                    || self.features.renders(format) && self.features.meet(format.filters)
            }
            false => {
                base.size.iter().all(|it| it.is_power_of_two())
                    && !format.is_srgb()
                    && self.features.meet(format.filters)
            }
        };
        check_state(
            is_valid && format.is_color() && format.block.is_none(),
            "not with this format or size",
        )?;
        texture.faces().try_for_each(|target| {
            self.initialize_image(
                &texture,
                Place {
                    target,
                    level: first,
                },
            )
        })?;
        let (last, image) = (last.min(first + last_level(base.size, target)), |level| {
            Image {
                size: at_level(base.size, level - first, target),
                is_raw: false,
                ..base
            }
        });
        let images: Vec<_> = texture
            .faces()
            .flat_map(|target| {
                (first + 1..=last).map(move |level| (Place { target, level }, image(level)))
            })
            .collect();
        self.set_levels(&texture, texture.level_range());
        self.define(&texture, &images, |it| it.gl.generate_mipmap(target))
    }

    fn tex_parameter(&mut self, target: u32, name: u32, value: Value) -> Result {
        let texture = self.bound_texture(target)?;
        let is_integer = match name {
            TEXTURE_BASE_LEVEL | TEXTURE_MAX_LEVEL if self.is_webgl2() => {
                check_value(value.1 >= 0, "negative level")?;
                let mut levels = texture.levels.get();
                levels[(name - TEXTURE_BASE_LEVEL) as usize] = value.1 as u32;
                texture.levels.set(levels);
                self.update_swizzle(&texture);
                self.update_levels(&texture);
                self.images_changed();
                return Ok(());
            }
            DEPTH_STENCIL_TEXTURE_MODE_WEBGL if self.has(Extension::StencilTexturing) => {
                check_enum(
                    matches!(value.1 as u32, DEPTH_COMPONENT | STENCIL_INDEX_WEBGL),
                    "unknown param",
                )?;
                texture
                    .reads_stencil
                    .set(value.1 as u32 == STENCIL_INDEX_WEBGL);
                true
            }
            _ => {
                let mut sampling = texture.sampling.get();
                let is_integer = sampling.set(name, value, self)?;
                texture.sampling.set(sampling);
                is_integer
            }
        };
        self.select(&texture);
        if is_integer {
            self.gl.tex_parameteri(target, name, value.1 as u32)
        } else {
            self.gl.tex_parameterf(target, name, value.0)
        }
        self.dirty |= dirty::TEXTURES;
        Ok(())
    }

    pub fn tex_parameterf(&mut self, target: u32, name: u32, value: f32) -> Result {
        self.tex_parameter(target, name, Value(value, value.round() as i32))
    }

    pub fn tex_parameteri(&mut self, target: u32, name: u32, value: i32) -> Result {
        self.tex_parameter(target, name, Value(value as f32, value))
    }

    pub fn get_tex_parameter(&mut self, target: u32, name: u32) -> Result<Answer> {
        let texture = self.bound_texture(target)?;
        Ok(match name {
            TEXTURE_BASE_LEVEL | TEXTURE_MAX_LEVEL if self.is_webgl2() => {
                Answer::Uint(texture.levels.get()[(name - TEXTURE_BASE_LEVEL) as usize])
            }
            TEXTURE_IMMUTABLE_FORMAT if self.is_webgl2() => {
                Answer::Boolean(texture.immutable_levels.get() > 0)
            }
            TEXTURE_IMMUTABLE_LEVELS if self.is_webgl2() => {
                Answer::Uint(texture.immutable_levels.get())
            }
            DEPTH_STENCIL_TEXTURE_MODE_WEBGL if self.has(Extension::StencilTexturing) => {
                Answer::Uint(if texture.reads_stencil.get() {
                    STENCIL_INDEX_WEBGL
                } else {
                    DEPTH_COMPONENT
                })
            }
            _ => texture.sampling.get().get(name, self.features)?,
        })
    }

    pub fn bind_sampler(&mut self, unit: u32, sampler: Option<Rc<Sampler>>) -> Result {
        check_value(
            unit < self.limits.shaders.combined_texture_units,
            "there is no such texture unit",
        )?;
        self.gl
            .bind_sampler(unit, sampler.as_ref().map_or(0, |it| it.name.0));
        self.units[unit as usize].sampler = sampler;
        self.dirty |= dirty::TEXTURES;
        Ok(())
    }

    pub fn forget_sampler(&mut self, sampler: &Rc<Sampler>) {
        for unit in 0..self.limits.shaders.combined_texture_units {
            if is(&self.units[unit as usize].sampler, sampler) {
                _ = self.bind_sampler(unit, None);
            }
        }
    }

    fn sampler_parameter(&mut self, sampler: &Sampler, name: u32, value: Value) -> Result {
        let mut sampling = sampler.sampling.get();
        if sampling.set(name, value, self)? {
            self.gl
                .sampler_parameteri(sampler.name.0, name, value.1 as u32)
        } else {
            self.gl.sampler_parameterf(sampler.name.0, name, value.0)
        }
        sampler.sampling.set(sampling);
        self.dirty |= dirty::TEXTURES;
        Ok(())
    }

    pub fn sampler_parameterf(&mut self, sampler: Rc<Sampler>, name: u32, value: f32) -> Result {
        self.sampler_parameter(&sampler, name, Value(value, value.round() as i32))
    }

    pub fn sampler_parameteri(&mut self, sampler: Rc<Sampler>, name: u32, value: i32) -> Result {
        self.sampler_parameter(&sampler, name, Value(value as f32, value))
    }

    pub fn get_sampler_parameter(&mut self, sampler: Rc<Sampler>, name: u32) -> Result<Answer> {
        sampler.sampling.get().get(name, self.features)
    }
}
