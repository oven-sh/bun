use std::ffi::{CString, c_char, c_void};
use std::rc::Rc;

use super::{SHADER, Scene, Step};
use crate::error::{Context as _, Result, ensure};
use crate::paint::layers::core_animation::Surface;
use crate::paint::raster::{IntRect, Pixel, swap_red_and_blue};
use crate::platform::macos::{Object, failure};

#[repr(C)]
struct Description {
    words: *const [u32; 4],
    units: [*const u32; 3],
    bytes: [usize; 4],
    opaque: [Step; 2],
    steps: *const Step,
    count: usize,
    textures: *const *const c_void,
    backdrop: [f32; 4],
    needs_samples: bool,
    stays_opaque: bool,
    loads: bool,
}

#[derive(Clone, Copy)]
#[repr(u32)]
enum Kind {
    Colors,
    Depths,
    Depth,
    Image,
}

unsafe extern "C" {
    fn bd_vector_start(shader: *const c_char) -> *mut c_char;
    safe fn bd_vector_rest();
    safe fn bd_vector_stop();
    safe fn bd_vector_texture(
        surface: Option<&c_void>,
        width: i32,
        height: i32,
        kind: Kind,
    ) -> Option<Object>;
    fn bd_vector_write(
        texture: &c_void,
        area: &IntRect,
        pixels: *const Pixel,
        stride: usize,
    ) -> *mut c_char;
    safe fn bd_vector_finish() -> *mut c_char;
    safe fn bd_vector_schedule();
    safe fn bd_vector_widen(surface: &c_void);
    fn bd_vector_draw(
        scene: &Description,
        colors: &c_void,
        depths: &c_void,
        before: &c_void,
        after: &c_void,
    ) -> *mut c_char;
}

const PREAMBLE: &str = "#include <metal_stdlib>
using namespace metal;
#define FUNCTION static inline
#define BUFFERS , const device uint4* words, const device uint* units, uint last_texel
#define ARGUMENTS , words, units, last_texel
#define TEXTURES , texture2d<float> backdrop, texture2d<float> image
#define WITH_TEXTURES , backdrop, image
#define ANGLE atan2
#define FLOATS as_type<float4>
#define WORD(it) words[it]
#define POINT(it) ((const device float2*)words)[it]
#define UNIT(it) units[it]
#define TEXEL(it) ((const device uint*)words)[min(it, last_texel)]
#define READ(from, x, y) from.read(min(uint2(x, y), uint2(from.get_width() - 1u, from.get_height() - 1u)))
#define SAMPLE(from, at) from.sample(between_pixels, at)
#define DX dfdx
#define DY dfdy
constexpr sampler between_pixels(coord::pixel, filter::linear, address::clamp_to_edge);
";

const MAIN: &str = "struct Varyings {
    float4 position [[position]];
    uint4 ink [[flat]];
    float4 part [[flat]];
    float2 reach [[flat]];
    float2 from_center [[center_no_perspective]];
};

struct Plain {
    float4 position [[position]];
    uint color [[flat]];
};

struct Pass {
    float2 size;
    uint last_texel;
    uint stays_opaque;
};

#define INPUTS const device uint4* words [[buffer(0)]], const device uint* units [[buffer(1)]], constant Pass& pass [[buffer(2)]]
#define IMAGES texture2d<float> backdrop [[texture(0)]], texture2d<float> image [[texture(1)]]
#define POSITION float4(it.at / pass.size * float2(2.0, -2.0) + float2(-1.0, 1.0), it.depth, 1.0)
#define CORNER(it) Corner { it.position.xy, 0.0, it.ink.x, it.ink.y, it.ink.z, it.ink.w, it.from_center, it.reach, it.part }

vertex Varyings place_corner(uint index [[vertex_id]], INPUTS, uint first [[instance_id]]) {
    Corner it = place(first * 4u + index, words, units, 0u);
    return { POSITION, uint4(it.color, it.flags, it.address, it.stride), it.part, it.reach, it.from_center };
}

vertex Plain place_plain_corner(uint index [[vertex_id]], INPUTS, uint first [[instance_id]]) {
    Corner it = place(first * 4u + index, words, units, 0u);
    return { POSITION, it.color };
}

fragment half4 paint_plain_pixel(Plain it [[stage_in]]) {
    return unpack_unorm4x8_to_half(it.color);
}

fragment float4 shade_pixel(Varyings it [[stage_in]], INPUTS) {
    return float4(shade(it.ink.x, it.position.xy, words, units, pass.last_texel).xyz, 1.0);
}

struct Result {
    float4 added [[color(0), index(0)]];
    float4 taken [[color(0), index(1)]];
};

fragment Result paint_pixel(Varyings it [[stage_in]], INPUTS, IMAGES) {
    Change change = paint(it.position.xy, CORNER(it), pass.stays_opaque != 0u, words, units, pass.last_texel, backdrop, image);
    return { change.added, change.taken };
}

fragment float4 mix_pixel(Varyings it [[stage_in]], float4 below [[color(0)]], INPUTS, IMAGES, constant uint& mode [[buffer(3)]]) {
    return paint_on(below, mode, floor(it.position.xy) + 0.5, CORNER(it), pass.stays_opaque != 0u, words, units, pass.last_texel, backdrop, image);
}";

pub fn start(_takes_software: bool) -> Result<()> {
    let shader = CString::new([PREAMBLE, SHADER, MAIN].concat())?;
    // SAFETY: a string.
    unsafe { failure(bd_vector_start(shader.as_ptr())) }
}

pub struct Started;

pub fn hand_over() -> Option<Started> {
    Some(Started)
}

pub fn take_over(_: Started) {}

pub fn rest() {
    bd_vector_rest();
}

pub fn stop() {
    bd_vector_stop();
}

fn finish() -> Result<()> {
    // SAFETY: an answer.
    unsafe { failure(bd_vector_finish()) }
}

/// Of a target.
pub const MAX_AREA: i64 = 1 << 24;

pub const CUTS_BETWEEN_PIXELS: bool = true;

pub fn reads_backdrop() -> bool {
    true
}

pub struct Texture {
    object: Object,
    pub(super) size: [i32; 2],
}

impl Texture {
    pub const MAX_SIDE: i32 = 16384;

    pub fn new(width: i32, height: i32) -> Result<Texture> {
        ensure!(width.max(height) <= Self::MAX_SIDE, "it is too large");
        Ok(Texture {
            object: bd_vector_texture(None, width, height, Kind::Image)
                .context("there is no memory")?,
            size: [width, height],
        })
    }

    /// After what was drawn so far. `pixels` begin at the corner of `area`.
    pub fn write(&self, area: IntRect, pixels: &[Pixel], stride: usize) -> Result<()> {
        assert!(
            IntRect::new(0, 0, self.size[0], self.size[1]).contains(area)
                && !area.is_empty()
                && pixels.len() >= (area.height() - 1) * stride + area.width()
        );
        // SAFETY: as asserted.
        unsafe {
            failure(bd_vector_write(
                &self.object,
                &area,
                pixels.as_ptr(),
                stride,
            ))
        }
    }
}

pub type Picture = Rc<Surface>;

struct Page {
    texture: Rc<Texture>,
    surface: Picture,
    was_shown: bool,
}

impl Page {
    fn new(size @ [width, height]: [i32; 2], is_wide: bool) -> Option<Page> {
        let surface = Rc::new(Surface::new(width, height)?);
        if is_wide {
            bd_vector_widen(surface.object());
        }
        let object = bd_vector_texture(Some(surface.object()), width, height, Kind::Image)?;
        Some(Page {
            texture: Rc::new(Texture { object, size }),
            surface,
            was_shown: false,
        })
    }

    fn is_free(&self) -> bool {
        Rc::strong_count(&self.surface) == 1 && !(self.was_shown && self.surface.is_in_use())
    }
}

pub struct Target {
    size: [i32; 2],
    is_wide: bool,
    /// These only exist on the chip.
    colors: Object,
    depths: Object,
    depth: Object,
    /// The last one has what was drawn last.
    pages: Vec<Page>,
    frame: Option<Picture>,
}

impl Target {
    pub fn new(width: i32, height: i32, is_wide: bool) -> Result<Target> {
        ensure!(width.max(height) <= Texture::MAX_SIDE, "it is too large");
        let (size, new) = ([width, height], |kind| {
            bd_vector_texture(None, width, height, kind)
        });
        let all = || {
            Some(Target {
                size,
                is_wide,
                colors: new(Kind::Colors)?,
                depths: new(Kind::Depths)?,
                depth: new(Kind::Depth)?,
                pages: vec![Page::new(size, is_wide)?],
                frame: None,
            })
        };
        all().context("there is no memory")
    }

    fn page(&self) -> &Page {
        &self.pages[self.pages.len() - 1]
    }

    fn turn_page(&mut self) -> Result<()> {
        const MAX_PAGES: usize = 5;
        let older = &self.pages[..self.pages.len() - 1];
        let mut next = match older.iter().position(Page::is_free) {
            Some(index) => self.pages.remove(index),
            None => Page::new(self.size, self.is_wide).context("there is no memory")?,
        };
        if self.pages.len() >= MAX_PAGES {
            self.pages.remove(0);
        }
        next.was_shown = false;
        self.pages.push(next);
        Ok(())
    }

    /// With what was drawn, until more is.
    pub fn texture(&self) -> Rc<Texture> {
        self.page().texture.clone()
    }

    /// For the window server, which waits until it is drawn.
    pub fn picture(&self) -> Option<Picture> {
        bd_vector_schedule();
        self.frame.clone()
    }

    pub fn end_frame(&mut self, is_complete: bool) {
        self.frame = self.pages.last_mut().filter(|_| is_complete).map(|page| {
            page.was_shown = true;
            page.surface.clone()
        });
    }

    pub fn write(&mut self, pixels: &[Pixel]) -> Result<()> {
        finish()?;
        self.frame = None;
        if !self.page().is_free() {
            self.turn_page()?;
        }
        let (width, page) = (
            self.size[0] as usize,
            self.pages
                .last_mut()
                .and_then(|it| Rc::get_mut(&mut it.surface)),
        );
        page.context("there is no surface")?.rows_mut(|y, row| {
            row.iter_mut()
                .zip(&pixels[y * width..])
                .for_each(|(to, from)| *to = swap_red_and_blue(*from))
        });
        Ok(())
    }

    /// `pixels` are all of them, and those in `area` are written.
    pub fn read(&mut self, area: IntRect, pixels: &mut [Pixel]) -> Result<()> {
        finish()?;
        let (width, columns) = (
            self.size[0] as usize,
            area.left as usize..area.right as usize,
        );
        self.page()
            .surface
            .rows(area.top as usize..area.bottom as usize, |y, row| {
                pixels[y * width..][columns.clone()]
                    .iter_mut()
                    .zip(&row[columns.clone()])
                    .for_each(|(to, from)| *to = swap_red_and_blue(*from));
            });
        Ok(())
    }

    pub fn draw(&mut self, scene: &mut Scene) -> Result<()> {
        let before = self.texture();
        let turns = self.page().was_shown || scene.uses(&before);
        if turns {
            self.turn_page()?;
        }
        let (loads, textures) = (
            scene.backdrop.is_none() && !turns && !scene.needs_samples,
            scene
                .textures
                .iter()
                .map(|it| &raw const *it.object)
                .collect::<Vec<_>>(),
        );
        let steps = scene.steps(scene.backdrop.is_none() && !loads);
        let (steps, count) = (steps.as_ptr(), steps.len());
        let description = Description {
            words: scene.words.as_ptr(),
            units: [
                scene.units.as_ptr(),
                scene.opaque[0].as_ptr(),
                scene.opaque[1].as_ptr(),
            ],
            bytes: [
                size_of_val(&scene.words[..]),
                size_of_val(&scene.units[..]),
                size_of_val(&scene.opaque[0][..]),
                size_of_val(&scene.opaque[1][..]),
            ],
            opaque: scene.opaque_steps(),
            steps,
            count,
            textures: textures.as_ptr(),
            backdrop: scene
                .backdrop
                .unwrap_or([0, 0, 0, 255 * u8::from(scene.stays_opaque)])
                .map(|it| f32::from(it) / 255.),
            needs_samples: scene.needs_samples,
            stays_opaque: scene.stays_opaque,
            loads,
        };
        let depth = if scene.needs_samples {
            &self.depths
        } else {
            &self.depth
        };
        // SAFETY: the units only refer to words and the steps to textures that there are, and the clips are within the target.
        unsafe {
            failure(bd_vector_draw(
                &description,
                &self.colors,
                depth,
                &before.object,
                &self.page().texture.object,
            ))
        }
    }
}
