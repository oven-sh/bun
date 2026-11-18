//! What puts pixels into textures.

use std::ptr::null;
use std::rc::Rc;

use super::buffers::UNPACK;
use super::context::Context;
use super::decoder::{
    NO_MEMORY, Result, bad_enum, bad_state, bad_value, check_enum, check_state, check_value,
};
use super::formats::{Component, Format, find, native_kind, size_of_kind, view_for};
use super::framebuffers::{Attachment, clip};
use super::gl::*;
use super::pixels::{Layout, convert_row, premultiply, premultiply_row, unpremultiply, zeroed};
use super::textures::{Image, Place, Texture};
use super::{Offered, Wanted};
use crate::abi_webgl::{Unpacking, Upload, source, view};
use crate::gfx::Pixmap;
use crate::icc::Conversion;

const TIGHT: Unpacking = Unpacking {
    alignment: 1,
    row_length: 0,
    image_height: 0,
    skip: [0; 3],
};

fn check_store(name: u32, value: i32) -> Result {
    check_value(
        if matches!(name, PACK_ALIGNMENT | UNPACK_ALIGNMENT) {
            matches!(value, 1 | 2 | 4 | 8)
        } else {
            value >= 0
        },
        "unknown param",
    )
}

/// `Ok(false)` if it is about something else.
pub fn set_unpacking(
    store: &mut Unpacking,
    is_webgl2: bool,
    name: u32,
    value: i32,
) -> Result<bool> {
    let field = match name {
        UNPACK_ALIGNMENT => &mut store.alignment,
        UNPACK_ROW_LENGTH if is_webgl2 => &mut store.row_length,
        UNPACK_IMAGE_HEIGHT if is_webgl2 => &mut store.image_height,
        UNPACK_SKIP_PIXELS if is_webgl2 => &mut store.skip[0],
        UNPACK_SKIP_ROWS if is_webgl2 => &mut store.skip[1],
        UNPACK_SKIP_IMAGES if is_webgl2 => &mut store.skip[2],
        _ => return Ok(false),
    };
    check_store(name, value)?;
    *field = value as u32;
    Ok(true)
}

/// Where an upload goes.
struct Destination {
    texture: Rc<Texture>,
    place: Place,
    format: &'static Format,
    /// `None` if the image is defined anew.
    offset: Option<[u32; 3]>,
    size: [u32; 3],
    is_unsized: bool,
}

/// Four bytes for each pixel, the top row first.
struct Picture<'a> {
    size: [u32; 2],
    pixels: &'a [u8],
    is_premultiplied: bool,
    is_wide: bool,
}

impl Offered {
    /// And whether they are premultiplied, and in Display P3.
    pub fn open(
        self,
        [is_for_wide, converts_colors, premultiplies, is_straight]: Wanted,
    ) -> Option<(Pixmap, [bool; 2])> {
        let (pixels, is_wide, image) = match self {
            Offered::Image(image) => match (is_for_wide && converts_colors && !is_straight)
                .then(|| image.widen())
                .flatten()
            {
                Some(wide) => (wide, true, Some(image)),
                None => (image.first_frame()?, image.is_wide(), Some(image)),
            },
            Offered::Pixels(pixels, is_wide) => (pixels?, is_wide, None),
        };
        let is_opaque = pixels
            .data()
            .as_chunks::<4>()
            .0
            .iter()
            .fold(255, |all, it| all & it[3])
            == 255;
        let is_premultiplied = if is_opaque {
            premultiplies
        } else {
            !is_straight
        };
        match image
            .filter(|_| !converts_colors || is_premultiplied != premultiplies)
            .and_then(|it| it.decode_straight(converts_colors.then_some(is_for_wide)))
        {
            Some(it) => Some((
                Pixmap::from_vec(it.data, it.width, it.height)?,
                [false, is_for_wide],
            )),
            None => Some((pixels, [is_premultiplied, is_wide])),
        }
    }
}

fn reserved(bytes: u64) -> Result<Vec<u8>> {
    let mut all = Vec::new();
    all.try_reserve_exact(bytes as usize)
        .map_or(Err(NO_MEMORY), |()| Ok(all))
}

impl Context {
    pub fn pixel_storei(&mut self, name: u32, value: i32) -> Result {
        let is_webgl2 = self.is_webgl2();
        let field = match name {
            _ if set_unpacking(&mut self.unpacking, is_webgl2, name, value)? => return Ok(()),
            UNPACK_FLIP_Y_WEBGL
            | UNPACK_PREMULTIPLY_ALPHA_WEBGL
            | UNPACK_COLORSPACE_CONVERSION_WEBGL => {
                let flag = match name {
                    UNPACK_FLIP_Y_WEBGL => &mut self.flips,
                    UNPACK_PREMULTIPLY_ALPHA_WEBGL => &mut self.premultiplies,
                    _ => check_value(
                        matches!(value as u32, NONE | BROWSER_DEFAULT_WEBGL),
                        "unknown param",
                    )
                    .map(|()| &mut self.converts_colors)?,
                };
                *flag = value != 0;
                return Ok(());
            }
            PACK_ALIGNMENT => &mut self.packing.alignment,
            PACK_ROW_LENGTH if is_webgl2 => &mut self.packing.row_length,
            PACK_SKIP_PIXELS if is_webgl2 => &mut self.packing.skip[0],
            PACK_SKIP_ROWS if is_webgl2 => &mut self.packing.skip[1],
            _ => return bad_enum("unknown pname"),
        };
        check_store(name, value).map(|()| *field = value as u32)
    }

    pub fn unpack_natively(&mut self, store: Unpacking) {
        let values = |it: Unpacking| {
            [
                it.alignment,
                it.row_length,
                it.image_height,
                it.skip[0],
                it.skip[1],
                it.skip[2],
            ]
        };
        let names = [
            UNPACK_ALIGNMENT,
            UNPACK_ROW_LENGTH,
            UNPACK_IMAGE_HEIGHT,
            UNPACK_SKIP_PIXELS,
            UNPACK_SKIP_ROWS,
            UNPACK_SKIP_IMAGES,
        ];
        for ((name, value), before) in names
            .into_iter()
            .zip(values(store))
            .zip(values(std::mem::replace(&mut self.native_unpacking, store)))
        {
            if value != before {
                self.gl.pixel_storei(name, value);
            }
        }
    }

    /// # Safety
    /// The texture is selected. `pixels` is null, or it has what that takes, in memory or in the buffer that is bound.
    pub unsafe fn write_natively(
        &self,
        place: Place,
        format: &Format,
        offset: Option<[u32; 3]>,
        size: [u32; 3],
        kind: u32,
        pixels: *const u8,
    ) {
        let (gl, Place { target, level }, (internal, base), [width, height, depth]) =
            (self.gl, place, format.native(), size);
        let (kind, bytes) = (native_kind(kind), format.bytes(size) as u32);
        // SAFETY: the caller's contract.
        unsafe {
            match (offset, place.has_layers(), format.block.is_some()) {
                (None, false, false) => (gl.tex_image_2d)(
                    target, level, internal, width, height, 0, base, kind, pixels,
                ),
                (None, true, false) => (gl.tex_image_3d)(
                    target, level, internal, width, height, depth, 0, base, kind, pixels,
                ),
                (Some([x, y, _]), false, false) => {
                    (gl.tex_sub_image_2d)(target, level, x, y, width, height, base, kind, pixels)
                }
                (Some([x, y, z]), true, false) => (gl.tex_sub_image_3d)(
                    target, level, x, y, z, width, height, depth, base, kind, pixels,
                ),
                (None, false, true) => (gl.compressed_tex_image_2d)(
                    target, level, internal, width, height, 0, bytes, pixels,
                ),
                (None, true, true) => (gl.compressed_tex_image_3d)(
                    target, level, internal, width, height, depth, 0, bytes, pixels,
                ),
                (Some([x, y, _]), false, true) => (gl.compressed_tex_sub_image_2d)(
                    target, level, x, y, width, height, internal, bytes, pixels,
                ),
                (Some([x, y, z]), true, true) => (gl.compressed_tex_sub_image_3d)(
                    target, level, x, y, z, width, height, depth, internal, bytes, pixels,
                ),
            }
        }
    }

    /// Whether an image of that format can be there.
    pub fn check_format_for(&self, place: Place, format: &Format, size: [u32; 3]) -> Result {
        let has_small_blocks = format.block.is_some()
            && format.sized < COMPRESSED_R11_EAC
            && format.sized != COMPRESSED_RGB_ETC1_WEBGL;
        let is_bptc = (COMPRESSED_RGBA_BPTC_UNORM_EXT..=COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT)
            .contains(&format.sized);
        let has_volumes = format.is_color() && format.block.is_none() || is_bptc;
        check_state(
            place.target != TEXTURE_3D || has_volumes,
            "the format is not for this target",
        )?;
        check_state(
            format.sized != COMPRESSED_RGB_ETC1_WEBGL || !place.has_layers(),
            "the format is not for this target",
        )?;
        check_state(
            format.is_color()
                || self.is_webgl2()
                || place
                    == Place {
                        target: TEXTURE_2D,
                        level: 0,
                    },
            "depth textures of WebGL 1 are 2D and have one level",
        )?;
        check_state(
            !has_small_blocks
                || size[..2]
                    .iter()
                    .all(|it| (it << place.level).is_multiple_of(4)),
            "the size does not fit the blocks of the format",
        )
    }

    fn part_of(
        &self,
        texture: Rc<Texture>,
        place: Place,
        offset: [u32; 3],
        size: [u32; 3],
    ) -> Result<Destination> {
        self.check_level(place)?;
        check_value(
            offset.iter().chain(&size).all(|it| *it as i32 >= 0),
            "negative offset or size",
        )?;
        let image = texture.image(place);
        let Some(format) = image.format else {
            return bad_state("the level has no image yet");
        };
        check_value(
            (0..3).all(|it| offset[it] + size[it] <= image.size[it]),
            "the rectangle is out of range",
        )?;
        Ok(Destination {
            texture,
            place,
            format,
            offset: Some(offset),
            size,
            is_unsized: image.is_unsized,
        })
    }

    fn whole(
        &self,
        texture: Rc<Texture>,
        place: Place,
        format: &'static Format,
        upload: &Upload,
    ) -> Result<Destination> {
        self.check_size(place, upload.size)?;
        check_value(upload.border == 0, "the border has to be 0")?;
        check_state(
            texture.immutable_levels.get() == 0,
            "texStorage has settled the images of the texture",
        )?;
        self.check_format_for(place, format, upload.size)?;
        Ok(Destination {
            texture,
            place,
            format,
            offset: None,
            size: upload.size,
            is_unsized: format.sized != upload.internal_format,
        })
    }

    fn destination(&self, upload: &Upload) -> Result<Destination> {
        let (texture, place) = (
            self.texture_with(upload.target, upload.dimensions)?,
            Place {
                target: upload.target,
                level: upload.level,
            },
        );
        let Upload {
            internal_format,
            format,
            kind,
            ..
        } = *upload;
        check_enum(self.features.knows(format, kind), "unknown format or type")?;
        if upload.is_partial != 0 {
            let it = self.part_of(texture, place, upload.offset, upload.size)?;
            let made = self.features.combine(
                if it.is_unsized {
                    format
                } else {
                    it.format.sized
                },
                format,
                kind,
            );
            check_state(
                made.is_some_and(|made| made.sized == it.format.sized)
                    && (it.format.is_color() || self.is_webgl2()),
                "the image has another format",
            )?;
            return Ok(it);
        }
        check_value(
            self.features.is_unsized(internal_format)
                || self
                    .features
                    .sized(internal_format)
                    .is_some_and(|it| it.block.is_none()),
            "unknown internalformat",
        )?;
        let Some(made) = self.features.combine(internal_format, format, kind) else {
            return bad_state("internalformat, format and type do not go together");
        };
        self.whole(texture, place, made, upload)
    }

    /// # Safety
    /// As `write_natively`, with `store`.
    unsafe fn write(
        &mut self,
        to: &Destination,
        store: Unpacking,
        kind: u32,
        pixels: *const u8,
        has_pixels: bool,
    ) -> Result {
        let Destination {
            ref texture,
            place,
            format,
            offset,
            size,
            is_unsized,
        } = *to;
        let write = |it: &mut Context| {
            it.unpack_natively(store);
            // SAFETY: the caller's contract.
            unsafe { it.write_natively(place, format, offset, size, kind, pixels) };
        };
        if offset.is_none() {
            return self.define(
                texture,
                &[(
                    place,
                    Image {
                        format: Some(format),
                        size,
                        is_unsized,
                        is_raw: !has_pixels,
                    },
                )],
                write,
            );
        }
        self.overwrite(texture, place, size, write)
    }

    /// `write` replaces a part of that size. The texture is selected.
    fn overwrite(
        &mut self,
        texture: &Texture,
        place: Place,
        size: [u32; 3],
        write: impl FnOnce(&mut Context),
    ) -> Result {
        let image = texture.image(place);
        if size != image.size {
            self.initialize_image(texture, place)?;
        }
        self.select(texture);
        if !image.is_raw {
            write(self);
            return Ok(());
        }
        self.allocate(write).map(|()| texture.set_written(place))
    }

    fn layout(&self, upload: &Upload) -> Result<Layout> {
        let (store, fits) = (&self.unpacking, |skip: u32, size: u32, given: u32| {
            skip == 0 && given == 0 || u64::from(skip) + u64::from(size) <= given.into()
        });
        let is_valid = fits(store.skip[0], upload.size[0], store.row_length)
            && (upload.dimensions == 2 || fits(store.skip[1], upload.size[1], store.image_height));
        check_state(
            is_valid,
            "what is skipped and the size exceed UNPACK_ROW_LENGTH or UNPACK_IMAGE_HEIGHT",
        )
        .map(|()| {
            Layout::new(
                store,
                upload.format,
                upload.kind,
                upload.size,
                upload.dimensions == 3,
            )
        })
    }

    fn check_no_unpack_buffer(&self) -> Result {
        check_state(
            self.buffers[UNPACK].is_none(),
            "not while there is a PIXEL_UNPACK_BUFFER",
        )
    }

    pub fn tex_image(&mut self, upload: Upload, view: u32, bytes: &[u8]) -> Result {
        self.check_no_unpack_buffer()?;
        let to = self.destination(&upload)?;
        if view == view::NULL {
            check_value(to.offset.is_none(), "null instead of pixels")?;
            // SAFETY: there is nothing to read.
            return unsafe { self.write(&to, TIGHT, upload.kind, null(), false) };
        }
        let changes = self.flips || self.premultiplies;
        check_state(
            !changes || upload.dimensions == 2,
            "arrays with layers are neither flipped nor premultiplied",
        )?;
        check_state(
            view == view_for(upload.kind) && (to.format.is_color() || self.is_webgl2()),
            "the array is of another type",
        )?;
        let layout = self.layout(&upload)?;
        check_state(
            layout.end <= bytes.len() as u64,
            "the array has too few pixels",
        )?;
        if !changes || layout.end == 0 {
            // SAFETY: as checked.
            return unsafe { self.write(&to, self.unpacking, upload.kind, bytes.as_ptr(), true) };
        }
        let (height, mut changed) = (
            u64::from(upload.size[1]),
            reserved(layout.row * u64::from(upload.size[1]))?,
        );
        for row in (0..height).map(|it| if self.flips { height - 1 - it } else { it }) {
            changed.extend_from_slice(
                &bytes[(layout.start + row * layout.row_stride) as usize..][..layout.row as usize],
            );
        }
        if self.premultiplies {
            premultiply_row(&mut changed, upload.format, upload.kind);
        }
        // SAFETY: it has all the rows.
        unsafe { self.write(&to, TIGHT, upload.kind, changed.as_ptr(), true) }
    }

    fn write_from_buffer(
        &mut self,
        to: &Destination,
        store: Unpacking,
        kind: u32,
        offset: usize,
        bytes: u64,
    ) -> Result {
        let Some(buffer) = self.buffers[UNPACK]
            .clone()
            .filter(|it| !self.is_contested(it))
        else {
            return bad_state("there is no free PIXEL_UNPACK_BUFFER");
        };
        check_state(
            buffer.contains(offset, bytes),
            "the buffer has too few pixels",
        )?;
        if to.offset.is_some() && to.size != to.texture.image(to.place).size {
            self.initialize_image(&to.texture, to.place)?;
        }
        self.gl.bind_buffer(PIXEL_UNPACK_BUFFER, buffer.name.0);
        // SAFETY: as checked.
        let result = unsafe { self.write(to, store, kind, offset as *const u8, true) };
        self.gl.bind_buffer(PIXEL_UNPACK_BUFFER, 0);
        result
    }

    /// Some drivers want the padding of the last row to be in the buffer.
    fn write_last_row_alone(
        &mut self,
        mut to: Destination,
        kind: u32,
        offset: usize,
        layout: &Layout,
    ) -> Result {
        if to.offset.is_none() {
            // SAFETY: there is nothing to read.
            unsafe { self.write(&to, TIGHT, kind, null(), false)? };
        }
        let ([x, y, z], [width, height, depth], store) =
            (to.offset.unwrap_or_default(), to.size, self.unpacking);
        let store = Unpacking {
            image_height: if store.image_height > 0 {
                store.image_height
            } else {
                height
            },
            skip: [0; 3],
            ..store
        };
        let (last, rows) = (
            layout.end - layout.row,
            u64::from(height - 1) * layout.row_stride,
        );
        for (at, size, start, store) in [
            ([x, y, z], [width, height, depth - 1], layout.start, store),
            (
                [x, y, z + depth - 1],
                [width, height - 1, 1],
                last - rows,
                store,
            ),
            (
                [x, y + height - 1, z + depth - 1],
                [width, 1, 1],
                last,
                TIGHT,
            ),
        ] {
            (to.offset, to.size) = (Some(at), size);
            if !size.contains(&0) {
                self.write_from_buffer(
                    &to,
                    store,
                    kind,
                    offset + start as usize,
                    layout.end - start,
                )?;
            }
        }
        Ok(())
    }

    pub fn tex_image_from_buffer(&mut self, upload: Upload, offset: usize) -> Result {
        check_state(
            self.buffers[UNPACK].is_some() && !self.flips && !self.premultiplies,
            "there is no PIXEL_UNPACK_BUFFER, or it would have to be flipped or premultiplied",
        )?;
        let (to, layout) = (self.destination(&upload)?, self.layout(&upload)?);
        check_state(
            offset.is_multiple_of(size_of_kind(upload.kind).0 as usize),
            "the offset is not aligned",
        )?;
        let (fits, padded) = (
            |it| {
                self.buffers[UNPACK]
                    .as_ref()
                    .is_some_and(|buffer| buffer.contains(offset, it) && !self.is_contested(buffer))
            },
            layout.end.saturating_add(layout.row_stride - layout.row),
        );
        if layout.end > 0 && fits(layout.end) && !fits(padded) {
            return self.write_last_row_alone(to, upload.kind, offset, &layout);
        }
        self.write_from_buffer(&to, self.unpacking, upload.kind, offset, layout.end)
    }

    fn write_picture(&mut self, mut upload: Upload, flags: u32, picture: Picture) -> Result {
        check_value(
            picture.pixels.len() <= i32::MAX as usize
                && picture.pixels.len() as u64 / 4
                    == u64::from(picture.size[0]) * u64::from(picture.size[1]),
            "the image has no pixels, or too many",
        )?;
        if picture.is_wide != self.is_wide[1] && self.converts_colors {
            let (mut pixels, conversion) = (
                reserved(picture.pixels.len() as u64)?,
                Conversion::between(self.is_wide[1]),
            );
            pixels.extend_from_slice(picture.pixels);
            if picture.is_premultiplied {
                conversion.apply(pixels.as_chunks_mut().0)
            } else {
                conversion.apply_to_colors(pixels.as_chunks_mut().0)
            }
            return self.write_picture(
                upload,
                flags,
                Picture {
                    pixels: &pixels,
                    is_wide: self.is_wide[1],
                    ..picture
                },
            );
        }
        let ([width, height], is_bitmap) = (picture.size, flags & source::IS_BITMAP != 0);
        if flags & source::HAS_SIZE == 0 {
            upload.size = [width, height, 1];
        }
        self.check_no_unpack_buffer()?;
        let (
            to,
            Upload {
                format, kind, size, ..
            },
        ) = (self.destination(&upload)?, upload);
        let is_valid = match to.format.component {
            Component::Unorm => to.format.is_color(),
            Component::Float => to.format.is_color() && kind != UNSIGNED_INT_5_9_9_9_REV,
            Component::Uint => kind == UNSIGNED_BYTE,
            _ => false,
        };
        check_value(
            is_valid || !self.is_webgl2(),
            "an image cannot be converted to this internalformat",
        )?;
        check_state(
            is_valid,
            "an image cannot be converted to this format and type",
        )?;
        let (skip, layers) = (
            self.unpacking.skip.map(u64::from),
            if upload.dimensions == 3 {
                self.unpacking.image_height
            } else {
                0
            },
        );
        let slice = u64::from(if layers > 0 { layers } else { size[1] });
        let first = skip[1]
            + if upload.dimensions == 3 {
                skip[2] * slice
            } else {
                0
            };
        let end = first + slice * u64::from(size[2].saturating_sub(1)) + u64::from(size[1]);
        check_state(
            skip[0] + u64::from(size[0]) <= width.into()
                && end <= height.into()
                && u64::from(size[1]) <= slice,
            "the selected part is outside of the image",
        )?;
        let (flips, premultiplies) = if is_bitmap {
            (false, picture.is_premultiplied)
        } else {
            (self.flips, self.premultiplies)
        };
        let stride = width as usize * 4;
        if !flips
            && premultiplies == picture.is_premultiplied
            && kind == UNSIGNED_BYTE
            && to.format.bits[3] > 0
            && !to.format.is_emulated()
            && !size.contains(&0)
        {
            let store = Unpacking {
                alignment: 4,
                row_length: width,
                image_height: slice as u32,
                skip: [0; 3],
            };
            // SAFETY: as checked.
            return unsafe {
                self.write(
                    &to,
                    store,
                    kind,
                    picture.pixels[first as usize * stride + skip[0] as usize * 4..].as_ptr(),
                    true,
                )
            };
        }
        let mut converted = reserved(Layout::new(&TIGHT, format, kind, size, true).end)?;
        for row in (0..size[2].into()).flat_map(|layer: u64| {
            (0..size[1].into()).map(move |row: u64| first + layer * slice + row)
        }) {
            let row = if flips {
                u64::from(height) - 1 - row
            } else {
                row
            } as usize;
            let pixels = picture.pixels[row * stride..].as_chunks().0[skip[0] as usize..]
                [..size[0] as usize]
                .iter()
                .copied();
            match (picture.is_premultiplied, premultiplies) {
                (false, true) => convert_row(pixels.map(premultiply), format, kind, &mut converted),
                (true, false) => {
                    convert_row(pixels.map(unpremultiply), format, kind, &mut converted)
                }
                _ => convert_row(pixels, format, kind, &mut converted),
            }
        }
        // SAFETY: it has all the rows.
        unsafe { self.write(&to, TIGHT, kind, converted.as_ptr(), true) }
    }

    pub fn tex_image_from_data(
        &mut self,
        upload: Upload,
        flags: u32,
        width: u32,
        height: u32,
        pixels: &[u8],
    ) -> Result {
        self.check_no_unpack_buffer()?;
        self.write_picture(
            upload,
            flags,
            Picture {
                size: [width, height],
                pixels,
                is_premultiplied: false,
                is_wide: flags & source::IS_WIDE != 0,
            },
        )
    }

    pub fn tex_image_from_source(&mut self, upload: Upload, flags: u32) -> Result {
        let wanted = [
            self.is_wide[1],
            self.converts_colors,
            self.premultiplies,
            flags & source::IS_STRAIGHT != 0,
        ];
        let Some((pixels, [is_premultiplied, is_wide])) = self.link.take_offer(wanted) else {
            return bad_value("the image cannot be decoded");
        };
        self.write_picture(
            upload,
            flags,
            Picture {
                size: [pixels.width(), pixels.height()],
                pixels: pixels.data(),
                is_premultiplied,
                is_wide,
            },
        )
    }

    /// From the bytes, or else from the buffer.
    pub fn compressed_tex_image(
        &mut self,
        upload: Upload,
        is_from_buffer: bool,
        size: u32,
        offset: usize,
        bytes: &[u8],
    ) -> Result {
        check_state(
            is_from_buffer == self.buffers[UNPACK].is_some(),
            "an offset needs a PIXEL_UNPACK_BUFFER, and an array that there is none",
        )?;
        let (texture, place) = (
            self.texture_with(upload.target, upload.dimensions)?,
            Place {
                target: upload.target,
                level: upload.level,
            },
        );
        let Some((format, block)) = self
            .features
            .sized(upload.internal_format)
            .and_then(|it| Some((it, it.block?)))
        else {
            return bad_enum("unknown format");
        };
        check_value(
            upload.size.iter().all(|it| *it <= 1 << 16),
            "the rectangle is out of range",
        )?;
        check_state(
            upload.is_partial == 0
                || texture
                    .image(place)
                    .format
                    .is_none_or(|it| it.sized == format.sized),
            "the image has another format",
        )?;
        let needed = format.bytes(upload.size);
        check_value(
            needed
                == if is_from_buffer {
                    size.into()
                } else {
                    bytes.len() as u64
                },
            "the size needs another number of bytes",
        )?;
        let to = if upload.is_partial == 0 {
            self.whole(texture, place, format, &upload)?
        } else {
            self.part_of(texture, place, upload.offset, upload.size)?
        };
        if let Some(offset) = to.offset {
            let whole = to.texture.image(place).size;
            let is_aligned = |it: usize| {
                offset[it].is_multiple_of(block[it])
                    && (to.size[it].is_multiple_of(block[it])
                        || offset[it] + to.size[it] == whole[it])
            };
            check_state(
                to.format.sized == format.sized
                    && format.sized != COMPRESSED_RGB_ETC1_WEBGL
                    && is_aligned(0)
                    && is_aligned(1),
                "the part is not made of whole blocks, or the format cannot be updated",
            )?;
        }
        if is_from_buffer {
            return self.write_from_buffer(&to, TIGHT, NONE, offset, needed);
        }
        // SAFETY: as checked.
        unsafe { self.write(&to, TIGHT, NONE, bytes.as_ptr(), true) }
    }

    fn check_copy(to: &Format, is_unsized: bool, from: &Format) -> Result {
        let has_all = (0..4).all(|it| {
            to.bits[it] == 0 || from.bits[it] > 0 && (is_unsized || to.bits[it] == from.bits[it])
        });
        let is_valid = to.is_color()
            && to.block.is_none()
            && to.component == from.component
            && to.is_srgb() == from.is_srgb()
            && has_all;
        check_state(is_valid, "the read buffer cannot be copied to this format")
    }

    fn copy(&mut self, to: &Destination, source: &Attachment, [x, y]: [i32; 2]) -> Result {
        let is_same = matches!(source, Attachment::Texture(_, place, layer) if source.is_of_texture(&to.texture) && *place == to.place && to.offset.is_none_or(|it| it[2] == *layer));
        check_state(!is_same, "a texture is read and drawn on at once")?;
        let ((left, width), (bottom, height)) = (
            clip(x, to.size[0], source.size()[0]),
            clip(y, to.size[1], source.size()[1]),
        );
        if to.offset.is_none() {
            // SAFETY: there is nothing to read.
            unsafe { self.write(to, TIGHT, to.format.kinds[0], null(), false)? };
        }
        if width == 0 || height == 0 {
            return Ok(());
        }
        let ([to_x, to_y, to_z], [x, y]) = (
            to.offset.unwrap_or_default(),
            [x + left as i32, y + bottom as i32],
        );
        let [to_x, to_y] = [to_x + left, to_y + bottom];
        if matches!(to.format.base, ALPHA | LUMINANCE_ALPHA) {
            let (kind, size) = if to.format.component == Component::Float {
                (FLOAT, 4)
            } else {
                (UNSIGNED_BYTE, 1)
            };
            let (mut pixels, mut kept) = (
                zeroed(width as usize * height as usize * 4 * size).ok_or(NO_MEMORY)?,
                reserved(u64::from(width) * u64::from(height) * 2 * size as u64)?,
            );
            // SAFETY: there is room for them.
            unsafe {
                self.read_natively(
                    [x, y],
                    [width, height],
                    RGBA,
                    kind,
                    [1, 0],
                    pixels.as_mut_ptr(),
                )
            };
            let luminance = if to.format.base == ALPHA { 0 } else { size };
            pixels
                .chunks_exact(4 * size)
                .for_each(|it| kept.extend(it[..luminance].iter().chain(&it[3 * size..])));
            let part = Destination {
                texture: to.texture.clone(),
                offset: Some([to_x, to_y, to_z]),
                size: [width, height, 1],
                ..*to
            };
            // SAFETY: it has all the rows.
            return unsafe { self.write(&part, TIGHT, kind, kept.as_ptr(), true) };
        }
        self.overwrite(&to.texture, to.place, [width, height, 1], |it| {
            // SAFETY: they only take numbers.
            it.reading(|gl| unsafe {
                match to.place.has_layers() {
                    true => (gl.copy_tex_sub_image_3d)(
                        to.place.target,
                        to.place.level,
                        to_x,
                        to_y,
                        to_z,
                        x,
                        y,
                        width,
                        height,
                    ),
                    false => (gl.copy_tex_sub_image_2d)(
                        to.place.target,
                        to.place.level,
                        to_x,
                        to_y,
                        x,
                        y,
                        width,
                        height,
                    ),
                }
            });
        })
    }

    pub fn copy_tex_image_2d(
        &mut self,
        [target, level, internal_format, x, y, width, height, border]: [u32; 8],
    ) -> Result {
        let (texture, place, is_unsized) = (
            self.texture_with(target, 2)?,
            Place { target, level },
            self.features.is_unsized(internal_format),
        );
        check_enum(
            is_unsized || self.features.sized(internal_format).is_some(),
            "unknown internalformat",
        )?;
        self.check_size(place, [width, height, 1])?;
        check_value(border == 0, "the border has to be 0")?;
        let (source, from) = self.read_source()?;
        let format = match internal_format {
            _ if !is_unsized => find(internal_format),
            _ if from.component == Component::Float && !self.is_webgl2() => self.features.combine(
                internal_format,
                internal_format,
                if from.bits[0] == 16 {
                    HALF_FLOAT_OES
                } else {
                    FLOAT
                },
            ),
            _ if from.bits[0] > 8 => None,
            RGBA if self.is_webgl2() && from.base == RGBA => Some(from),
            RGB if self.is_webgl2() && from.bits[0] < 8 => find(RGB565),
            _ => self
                .features
                .combine(internal_format, internal_format, UNSIGNED_BYTE),
        };
        let Some(format) = format else {
            return bad_state("the read buffer cannot be copied to this format");
        };
        Context::check_copy(format, is_unsized, from)?;
        let upload = Upload {
            target,
            level,
            internal_format,
            offset: [0; 3],
            size: [width, height, 1],
            border,
            format: NONE,
            kind: NONE,
            dimensions: 2,
            is_partial: 0,
        };
        self.copy(
            &self.whole(texture, place, format, &upload)?,
            &source,
            [x as i32, y as i32],
        )
    }

    fn copy_part(
        &mut self,
        place: Place,
        dimensions: u32,
        offset: [u32; 3],
        from: [i32; 2],
        size: [u32; 3],
    ) -> Result {
        let to = self.part_of(
            self.texture_with(place.target, dimensions)?,
            place,
            offset,
            size,
        )?;
        let (source, format) = self.read_source()?;
        Context::check_copy(to.format, true, format)?;
        check_state(
            !to.format.is_emulated()
                || to.format.component == Component::Float
                || format.bits[0] <= 8,
            "the read buffer cannot be copied to this format",
        )?;
        self.copy(&to, &source, from)
    }

    pub fn copy_tex_sub_image_2d(
        &mut self,
        [target, level, to_x, to_y, x, y, width, height]: [u32; 8],
    ) -> Result {
        self.copy_part(
            Place { target, level },
            2,
            [to_x, to_y, 0],
            [x as i32, y as i32],
            [width, height, 1],
        )
    }

    pub fn copy_tex_sub_image_3d(
        &mut self,
        [target, level, to_x, to_y, to_z, x, y, width, height]: [u32; 9],
    ) -> Result {
        self.copy_part(
            Place { target, level },
            3,
            [to_x, to_y, to_z],
            [x as i32, y as i32],
            [width, height, 1],
        )
    }
}
