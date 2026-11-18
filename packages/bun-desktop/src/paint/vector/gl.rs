//! With the system's OpenGL ES 3, and without a window.

use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr::{null, null_mut};
use std::rc::Rc;

use super::{Mode, SHADER, Scene};
use crate::egl;
use crate::error::{Context as _, Result, bail, ensure};
use crate::paint::raster::{IntRect, Pixel};

macro_rules! functions {
    ($($name:ident = $symbol:literal($($argument:ty),*) $(-> $result:ty)?;)*) => {
        struct Functions {
            $($name: unsafe extern "C" fn($($argument),*) $(-> $result)?,)*
        }

        impl Functions {
            fn load() -> Option<Functions> {
                // SAFETY: the signatures are those of the specifications.
                unsafe {
                    Some(Functions {
                        $($name: std::mem::transmute::<*mut c_void, Option<unsafe extern "C" fn($($argument),*) $(-> $result)?>>(
                            egl::find($symbol),
                        )?,)*
                    })
                }
            }
        }
    };
}

functions! {
    get_string = c"glGetString"(u32) -> *const c_char;
    get_error = c"glGetError"() -> u32;
    get_graphics_reset_status = c"glGetGraphicsResetStatusEXT"() -> u32;
    get_integerv = c"glGetIntegerv"(u32, *mut i32);
    create_shader = c"glCreateShader"(u32) -> u32;
    shader_source = c"glShaderSource"(u32, i32, *const *const c_char, *const i32);
    compile_shader = c"glCompileShader"(u32);
    get_shader_info_log = c"glGetShaderInfoLog"(u32, i32, *mut i32, *mut c_char);
    create_program = c"glCreateProgram"() -> u32;
    attach_shader = c"glAttachShader"(u32, u32);
    link_program = c"glLinkProgram"(u32);
    get_programiv = c"glGetProgramiv"(u32, u32, *mut i32);
    use_program = c"glUseProgram"(u32);
    get_uniform_location = c"glGetUniformLocation"(u32, *const c_char) -> i32;
    uniform_1i = c"glUniform1i"(i32, i32);
    uniform_2f = c"glUniform2f"(i32, f32, f32);
    gen_buffers = c"glGenBuffers"(i32, *mut u32);
    bind_buffer = c"glBindBuffer"(u32, u32);
    buffer_data = c"glBufferData"(u32, isize, *const c_void, u32);
    gen_textures = c"glGenTextures"(i32, *mut u32);
    delete_textures = c"glDeleteTextures"(i32, *const u32);
    active_texture = c"glActiveTexture"(u32);
    bind_texture = c"glBindTexture"(u32, u32);
    tex_parameteri = c"glTexParameteri"(u32, u32, i32);
    pixel_storei = c"glPixelStorei"(u32, i32);
    tex_image_2d = c"glTexImage2D"(u32, i32, i32, i32, i32, i32, u32, u32, *const c_void);
    tex_sub_image_2d = c"glTexSubImage2D"(u32, i32, i32, i32, i32, i32, u32, u32, *const c_void);
    gen_renderbuffers = c"glGenRenderbuffers"(i32, *mut u32);
    delete_renderbuffers = c"glDeleteRenderbuffers"(i32, *const u32);
    bind_renderbuffer = c"glBindRenderbuffer"(u32, u32);
    renderbuffer_storage_multisample = c"glRenderbufferStorageMultisample"(u32, i32, u32, i32, i32);
    gen_framebuffers = c"glGenFramebuffers"(i32, *mut u32);
    delete_framebuffers = c"glDeleteFramebuffers"(i32, *const u32);
    bind_framebuffer = c"glBindFramebuffer"(u32, u32);
    framebuffer_renderbuffer = c"glFramebufferRenderbuffer"(u32, u32, u32, u32);
    framebuffer_texture_2d = c"glFramebufferTexture2D"(u32, u32, u32, u32, i32);
    blit_framebuffer = c"glBlitFramebuffer"(i32, i32, i32, i32, i32, i32, i32, i32, u32, u32);
    viewport = c"glViewport"(i32, i32, i32, i32);
    scissor = c"glScissor"(i32, i32, i32, i32);
    enable = c"glEnable"(u32);
    disable = c"glDisable"(u32);
    clear_color = c"glClearColor"(f32, f32, f32, f32);
    clear_depthf = c"glClearDepthf"(f32);
    clear = c"glClear"(u32);
    color_mask = c"glColorMask"(u8, u8, u8, u8);
    blend_func = c"glBlendFunc"(u32, u32);
    depth_func = c"glDepthFunc"(u32);
    stencil_func = c"glStencilFunc"(u32, i32, u32);
    stencil_op = c"glStencilOp"(u32, u32, u32);
    stencil_op_separate = c"glStencilOpSeparate"(u32, u32, u32, u32);
    draw_elements = c"glDrawElements"(u32, i32, u32, *const c_void);
    read_pixels = c"glReadPixels"(i32, i32, i32, i32, u32, u32, *mut c_void);
}

const TEXTURE_2D: u32 = 0x0DE1;
const TEXTURE_0: u32 = 0x84C0;
const FRAMEBUFFER: u32 = 0x8D40;
const RENDERBUFFER: u32 = 0x8D41;
const COLOR_ATTACHMENT: u32 = 0x8CE0;
const RGBA: u32 = 0x1908;
const RGBA8: u32 = 0x8058;
const UNSIGNED_BYTE: u32 = 0x1401;
const UNSIGNED_INT: u32 = 0x1405;
const NEAREST: u32 = 0x2600;
const LINEAR: u32 = 0x2601;
const ROW_LENGTH: u32 = 0x0CF2;
const BLEND: u32 = 0x0BE2;
const DEPTH_TEST: u32 = 0x0B71;
const STENCIL_TEST: u32 = 0x0B90;
const SCISSOR_TEST: u32 = 0x0C11;
const KEEP: u32 = 0x1E00;

/// Of the textures with the words and the units.
const WIDTH: usize = 2048;
const FORMATS: [(i32, u32); 2] = [(0x8D70, 0x8D99), (0x8236, 0x8D94)];
const UNITS_PER_DRAW: u32 = 1 << 14;

const PREAMBLE: &str = "precision highp float;
precision highp int;
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define uint4 uvec4
#define FUNCTION
#define BUFFERS
#define ARGUMENTS
#define TEXTURES
#define WITH_TEXTURES
#define ANGLE atan
#define FLOATS uintBitsToFloat
#define WORD(it) texelFetch(words, ivec2((it) & 2047u, (it) >> 11), 0)
#define UNIT(it) texelFetch(units, ivec2((it) & 2047u, (it) >> 11), 0).x
#define READ(from, x, y) texelFetch(from, clamp(ivec2(x, y), ivec2(0), textureSize(from, 0) - 1), 0)
#define SAMPLE(from, at) textureLod(from, (at) / vec2(textureSize(from, 0)), 0.0)
uniform highp usampler2D words, units;
uniform highp sampler2D backdrop, image;
uniform vec2 size;
uniform highp int first_unit, last_texel, stays_opaque, mode;
uint TEXEL(uint it) {
    it = min(it, uint(last_texel));
    return WORD(it >> 2)[it & 3u];
}
vec2 POINT(uint it) {
    vec4 two = FLOATS(WORD(it >> 1));
    return (it & 1u) == 0u ? two.xy : two.zw;
}
";

const VERTEX: [&str; 2] = [
    "#define DX(it) (it)
#define DY(it) (it)
",
    "flat out uvec4 ink;
flat out vec4 part;
flat out vec2 reach;
out vec2 from_center;
void main() {
    Corner it = place(uint(gl_VertexID + first_unit * 4));
    gl_Position = vec4(it.at / size * 2.0 - 1.0, it.depth * 2.0 - 1.0, 1.0);
    ink = uvec4(it.color, it.flags, it.address, it.stride);
    part = it.part;
    reach = it.reach;
    from_center = it.from_center;
}",
];

macro_rules! fragment {
    ($extension:literal, $main:literal) => {
        [
            concat!(
                "#extension ",
                $extension,
                " : require\n#define DX dFdx\n#define DY dFdy\n"
            ),
            concat!(
                "flat in uvec4 ink;
flat in vec4 part;
flat in vec2 reach;
in vec2 from_center;
#define PIXEL (floor(gl_FragCoord.xy) + 0.5)
#define CORNER Corner(PIXEL, 0.0, ink.x, ink.y, ink.z, ink.w, from_center, reach, part)
",
                $main
            ),
        ]
    };
}

const BLENDS: [&str; 2] = fragment!(
    "GL_EXT_blend_func_extended",
    "layout(location = 0, index = 0) out vec4 added;
layout(location = 0, index = 1) out vec4 taken;
void main() {
    Change change = paint(PIXEL, CORNER, stays_opaque != 0);
    added = change.added;
    taken = change.taken;
}"
);

const MIXES: [&str; 2] = fragment!(
    "GL_EXT_shader_framebuffer_fetch",
    "layout(location = 0) inout vec4 result;
void main() {
    result = paint_on(result, uint(mode), PIXEL, CORNER, stays_opaque != 0);
}"
);

#[derive(Clone, Copy, Default)]
struct Program {
    name: u32,
    size: i32,
    first_unit: i32,
    last_texel: i32,
    stays_opaque: i32,
    mode: i32,
}

impl Program {
    fn new(gl: &Functions, fragment: [&str; 2]) -> Result<Program> {
        // SAFETY: the context is current.
        unsafe {
            let name = (gl.create_program)();
            let shaders = [(0x8B31, VERTEX), (0x8B30, fragment)].map(|(kind, [first, main])| {
                let source =
                    CString::new(["#version 300 es\n", first, PREAMBLE, SHADER, main].concat())
                        .unwrap_or_default();
                let shader = (gl.create_shader)(kind);
                (gl.shader_source)(shader, 1, &source.as_ptr(), null());
                (gl.compile_shader)(shader);
                (gl.attach_shader)(name, shader);
                shader
            });
            (gl.link_program)(name);
            let mut is_linked = 0;
            (gl.get_programiv)(name, 0x8B82, &mut is_linked);
            if is_linked == 0 {
                let mut logs = [[0; 1024]; 2];
                shaders.iter().zip(&mut logs).for_each(|(shader, log)| {
                    (gl.get_shader_info_log)(*shader, 1024, null_mut(), log.as_mut_ptr())
                });
                bail!(
                    "{:?}",
                    logs.each_ref().map(|it| CStr::from_ptr(it.as_ptr()))
                );
            }
            (gl.use_program)(name);
            let location = |it: &CStr| (gl.get_uniform_location)(name, it.as_ptr());
            for (slot, it) in (0..).zip([c"words", c"units", c"backdrop", c"image"]) {
                (gl.uniform_1i)(location(it), slot);
            }
            let [size, first_unit, last_texel, stays_opaque, mode] = [
                c"size",
                c"first_unit",
                c"last_texel",
                c"stays_opaque",
                c"mode",
            ]
            .map(location);
            Ok(Program {
                name,
                size,
                first_unit,
                last_texel,
                stays_opaque,
                mode,
            })
        }
    }
}

struct Device {
    gl: Functions,
    context: egl::Context,
    blends: Program,
    mixes: Option<Program>,
    /// How many rows the textures with the words and the units have.
    rows: [usize; 2],
    max_side: i32,
    units: Vec<u32>,
}

thread_local! {
    static DEVICE: RefCell<Option<Device>> = const { RefCell::new(None) };
}

impl Device {
    fn new(takes_software: bool) -> Result<Device> {
        let context = egl::Context::new(takes_software)
            .context("there is no OpenGL ES 3 that survives errors")?;
        let gl = Functions::load().context("a function is missing")?;
        let mut device = Device {
            gl,
            context,
            blends: Program::default(),
            mixes: None,
            rows: [0; 2],
            max_side: 0,
            units: Vec::new(),
        };
        // SAFETY: the arguments are what the specifications ask for.
        unsafe {
            let gl = &device.gl;
            let string = |name| {
                Some((gl.get_string)(name))
                    .filter(|it| !it.is_null())
                    .map(|it| CStr::from_ptr(it).to_string_lossy())
                    .context("it does not say what it is")
            };
            let name = string(0x1F01)?;
            ensure!(
                takes_software
                    || !["llvmpipe", "softpipe", "SwiftShader"]
                        .iter()
                        .any(|it| name.contains(it)),
                "{name} is no GPU"
            );
            let has_extension = string(0x1F03)?
                .split(' ')
                .any(|it| it == "GL_EXT_shader_framebuffer_fetch");
            (device.blends, device.mixes) = (
                Program::new(gl, BLENDS)?,
                has_extension.then(|| Program::new(gl, MIXES)).transpose()?,
            );
            let gl = &device.gl;
            (0..2).for_each(|slot| _ = device.texture(slot, NEAREST));
            let (mut indices, corners) = (
                0,
                (0..UNITS_PER_DRAW as u16)
                    .flat_map(|it| [0, 1, 2, 2, 1, 3].map(|corner| it * 4 + corner))
                    .collect::<Vec<_>>(),
            );
            (gl.gen_buffers)(1, &mut indices);
            (gl.bind_buffer)(0x8893, indices);
            (gl.buffer_data)(
                0x8893,
                size_of_val(&corners[..]) as isize,
                corners.as_ptr().cast(),
                0x88E4,
            );
            (gl.blend_func)(1, 0x88FA);
            (gl.depth_func)(0x0204);
            (gl.clear_depthf)(0.);
            (gl.disable)(0x0BD0);
            (device.gl.get_integerv)(0x84E8, &mut device.max_side);
            device.check()?;
            Ok(device)
        }
    }

    fn check(&self) -> Result<()> {
        // SAFETY: the context is current.
        let (error, reset) =
            unsafe { ((self.gl.get_error)(), (self.gl.get_graphics_reset_status)()) };
        ensure!(error | reset == 0, "error {error:#x}, reset {reset:#x}");
        Ok(())
    }

    fn texture(&self, slot: u32, filter: u32) -> u32 {
        let mut texture = 0;
        // SAFETY: likewise.
        unsafe {
            (self.gl.gen_textures)(1, &mut texture);
            (self.gl.active_texture)(TEXTURE_0 + slot);
            (self.gl.bind_texture)(TEXTURE_2D, texture);
            [0x2800, 0x2801]
                .into_iter()
                .for_each(|it| (self.gl.tex_parameteri)(TEXTURE_2D, it, filter as i32));
        }
        texture
    }

    fn release_memory(&mut self) {
        for (slot, (internal, format)) in (0..).zip(FORMATS) {
            // SAFETY: the context is current.
            unsafe {
                (self.gl.active_texture)(TEXTURE_0 + slot);
                (self.gl.tex_image_2d)(
                    TEXTURE_2D,
                    0,
                    internal,
                    0,
                    0,
                    0,
                    format,
                    UNSIGNED_INT,
                    null(),
                );
            }
        }
        (self.rows, self.units) = ([0; 2], Vec::new());
    }

    fn upload<T>(&mut self, slot: usize, items: &[T]) {
        let ((internal, format), gl) = (FORMATS[slot], &self.gl);
        let (whole, rest) = items.as_chunks::<WIDTH>();
        // SAFETY: an item is a texel of that format.
        unsafe {
            (gl.active_texture)(TEXTURE_0 + slot as u32);
            if self.rows[slot] <= whole.len() {
                self.rows[slot] = (whole.len() + 1).next_power_of_two();
                (gl.tex_image_2d)(
                    TEXTURE_2D,
                    0,
                    internal,
                    WIDTH as i32,
                    self.rows[slot] as i32,
                    0,
                    format,
                    UNSIGNED_INT,
                    null(),
                );
            }
            (gl.tex_sub_image_2d)(
                TEXTURE_2D,
                0,
                0,
                0,
                WIDTH as i32,
                whole.len() as i32,
                format,
                UNSIGNED_INT,
                whole.as_ptr().cast(),
            );
            (gl.tex_sub_image_2d)(
                TEXTURE_2D,
                0,
                0,
                whole.len() as i32,
                rest.len() as i32,
                1,
                format,
                UNSIGNED_INT,
                rest.as_ptr().cast(),
            );
        }
    }
}

pub fn start(takes_software: bool) -> Result<()> {
    DEVICE.set(Some(Device::new(takes_software)?));
    Ok(())
}

pub struct Started(Device);

// SAFETY: the context is not current on any thread.
unsafe impl Send for Started {}

/// To another thread.
pub fn hand_over() -> Option<Started> {
    let device = DEVICE.take()?;
    device.context.set_current(false);
    Some(Started(device))
}

pub fn take_over(Started(device): Started) {
    device.context.set_current(true);
    DEVICE.set(Some(device));
}

pub fn rest() {
    DEVICE.with_borrow_mut(|it| it.iter_mut().for_each(Device::release_memory));
}

pub fn stop() {
    DEVICE.take();
}

fn with_device<R>(f: impl FnOnce(&mut Device) -> Result<R>) -> Result<R> {
    DEVICE.with_borrow_mut(|it| f(it.as_mut().context("the GPU is not ready")?))
}

/// Of a target.
pub const MAX_AREA: i64 = 1 << 23;

/// Of a shape.
pub const MAX_UNITS: usize = 1 << 21;

/// Mesa's software renderer lets samples of the pixels next to the scissor box through.
pub const CUTS_BETWEEN_PIXELS: bool = false;

pub fn reads_backdrop() -> bool {
    DEVICE.with_borrow(|it| it.as_ref().is_some_and(|it| it.mixes.is_some()))
}

pub struct Texture {
    name: u32,
    pub(super) size: [i32; 2],
}

impl Drop for Texture {
    fn drop(&mut self) {
        // SAFETY: the name is from this context.
        _ = DEVICE.try_with(|it| {
            it.borrow()
                .iter()
                .for_each(|it| unsafe { (it.gl.delete_textures)(1, &self.name) })
        });
    }
}

impl Texture {
    pub const MAX_SIDE: i32 = 16384;

    pub fn new(width: i32, height: i32) -> Result<Texture> {
        let mut texture = Texture {
            name: 0,
            size: [width, height],
        };
        // SAFETY: the context is current.
        with_device(|device| unsafe {
            ensure!(
                width.max(height) <= device.max_side.min(Self::MAX_SIDE),
                "it is too large"
            );
            texture.name = device.texture(3, LINEAR);
            (device.gl.tex_image_2d)(
                TEXTURE_2D,
                0,
                RGBA8 as i32,
                width,
                height,
                0,
                RGBA,
                UNSIGNED_BYTE,
                null(),
            );
            device.check()
        })?;
        Ok(texture)
    }

    /// After what was drawn so far. `pixels` begin at the corner of `area`.
    pub fn write(&self, area: IntRect, pixels: &[Pixel], stride: usize) -> Result<()> {
        assert!(
            IntRect::new(0, 0, self.size[0], self.size[1]).contains(area)
                && !area.is_empty()
                && pixels.len() >= (area.height() - 1) * stride + area.width()
        );
        // SAFETY: as asserted.
        with_device(|device| unsafe {
            let gl = &device.gl;
            (gl.active_texture)(TEXTURE_0 + 3);
            (gl.bind_texture)(TEXTURE_2D, self.name);
            (gl.pixel_storei)(ROW_LENGTH, stride as i32);
            (gl.tex_sub_image_2d)(
                TEXTURE_2D,
                0,
                area.left,
                area.top,
                area.width() as i32,
                area.height() as i32,
                RGBA,
                UNSIGNED_BYTE,
                pixels.as_ptr().cast(),
            );
            (gl.pixel_storei)(ROW_LENGTH, 0);
            device.check()
        })
    }
}

pub struct Target {
    texture: Rc<Texture>,
    /// For the colors, and for the depth and the stencil.
    samples: [u32; 2],
    /// With the samples, and with the texture.
    frames: [u32; 2],
}

impl Drop for Target {
    fn drop(&mut self) {
        // SAFETY: the names are from this context.
        _ = DEVICE.try_with(|it| unsafe {
            if let Some(Device { gl, .. }) = &*it.borrow() {
                (gl.delete_framebuffers)(2, self.frames.as_ptr());
                (gl.delete_renderbuffers)(2, self.samples.as_ptr());
            }
        });
    }
}

impl Target {
    pub fn new(width: i32, height: i32, _is_wide: bool) -> Result<Target> {
        let mut target = Target {
            texture: Rc::new(Texture::new(width, height)?),
            samples: [0; 2],
            frames: [0; 2],
        };
        // SAFETY: the context is current.
        with_device(|device| unsafe {
            let gl = &device.gl;
            (gl.gen_renderbuffers)(2, target.samples.as_mut_ptr());
            (gl.gen_framebuffers)(2, target.frames.as_mut_ptr());
            (gl.bind_framebuffer)(FRAMEBUFFER, target.frames[0]);
            for (buffer, format, attachment) in [
                (target.samples[0], RGBA8, COLOR_ATTACHMENT),
                (target.samples[1], 0x8CAD, 0x821A),
            ] {
                (gl.bind_renderbuffer)(RENDERBUFFER, buffer);
                (gl.renderbuffer_storage_multisample)(RENDERBUFFER, 4, format, width, height);
                (gl.framebuffer_renderbuffer)(FRAMEBUFFER, attachment, RENDERBUFFER, buffer);
            }
            (gl.bind_framebuffer)(FRAMEBUFFER, target.frames[1]);
            (gl.framebuffer_texture_2d)(
                FRAMEBUFFER,
                COLOR_ATTACHMENT,
                TEXTURE_2D,
                target.texture.name,
                0,
            );
            device.check()
        })?;
        Ok(target)
    }

    /// With what was drawn, until more is.
    pub fn texture(&self) -> Rc<Texture> {
        self.texture.clone()
    }

    pub fn end_frame(&mut self, _is_complete: bool) {}

    pub fn write(&mut self, pixels: &[Pixel]) -> Result<()> {
        let [width, height] = self.texture.size;
        self.texture
            .write(IntRect::new(0, 0, width, height), pixels, width as usize)
    }

    /// `pixels` are all of them, and those in `area` are written.
    pub fn read(&mut self, area: IntRect, pixels: &mut [Pixel]) -> Result<()> {
        let [width, height] = self.texture.size;
        assert!(
            pixels.len() == width as usize * height as usize
                && IntRect::new(0, 0, width, height).contains(area)
                && !area.is_empty()
        );
        let start = &mut pixels[area.top as usize * width as usize + area.left as usize..];
        // SAFETY: as asserted.
        with_device(|device| unsafe {
            (device.gl.bind_framebuffer)(FRAMEBUFFER, self.frames[1]);
            (device.gl.pixel_storei)(0x0D02, width);
            (device.gl.read_pixels)(
                area.left,
                area.top,
                area.width() as i32,
                area.height() as i32,
                RGBA,
                UNSIGNED_BYTE,
                start.as_mut_ptr().cast(),
            );
            device.check()
        })
    }

    pub fn draw(&mut self, scene: &mut Scene) -> Result<()> {
        let [width, height] = self.texture.size;
        scene.steps(scene.backdrop.is_none());
        // SAFETY: the context is current, and no draw has more units than there are indices for.
        with_device(|device| unsafe {
            device.upload(0, &scene.words);
            let mut units = std::mem::take(&mut device.units);
            units.clear();
            // What is in front comes first, so that what it hides is not painted.
            units.extend(
                scene
                    .units
                    .iter()
                    .chain(scene.opaque.iter().flat_map(|it| it.iter().rev())),
            );
            device.upload(1, &units);
            device.units = units;
            let gl = &device.gl;
            let switch = |what: u32, is_on: bool| {
                if is_on {
                    (gl.enable)(what)
                } else {
                    (gl.disable)(what)
                }
            };
            let [red, green, blue, alpha] = scene
                .backdrop
                .unwrap_or([0, 0, 0, 255 * u8::from(scene.stays_opaque)])
                .map(|it| f32::from(it) / 255.);
            for slot in [2, 3] {
                (gl.active_texture)(TEXTURE_0 + slot);
                (gl.bind_texture)(TEXTURE_2D, self.texture.name);
            }
            for program in device.mixes.iter().chain([&device.blends]) {
                (gl.use_program)(program.name);
                (gl.uniform_2f)(program.size, width as f32, height as f32);
                (gl.uniform_1i)(program.stays_opaque, scene.stays_opaque.into());
                (gl.uniform_1i)(program.last_texel, scene.words.len() as i32 * 4 - 1);
            }
            (gl.bind_framebuffer)(FRAMEBUFFER, self.frames[0]);
            (gl.viewport)(0, 0, width, height);
            (gl.clear_color)(red, green, blue, alpha);
            (gl.clear)(0x4500);
            (gl.enable)(SCISSOR_TEST);
            let (mut state, mut program, mut texture) = (None, device.blends, 0);
            for step in scene
                .opaque_steps()
                .iter()
                .chain(&scene.steps)
                .filter(|it| it.first < it.end)
            {
                if state.replace((step.mode, step.mixing)) != Some((step.mode, step.mixing)) {
                    let (counts, blocks) = (
                        step.mode == Mode::Count,
                        matches!(step.mode, Mode::BlockNonZero | Mode::BlockOdd),
                    );
                    let shows = !counts && !blocks;
                    program = device
                        .mixes
                        .filter(|_| step.mixing != 0)
                        .unwrap_or(device.blends);
                    (gl.use_program)(program.name);
                    (gl.uniform_1i)(program.mode, step.mixing as i32);
                    switch(BLEND, step.mixing == 0);
                    switch(DEPTH_TEST, !counts);
                    switch(
                        STENCIL_TEST,
                        !matches!(step.mode, Mode::Blend | Mode::Opaque | Mode::Tint),
                    );
                    (gl.color_mask)(shows.into(), shows.into(), shows.into(), shows.into());
                    if !counts {
                        (gl.stencil_func)(
                            if blocks { 0x0202 } else { 0x0205 },
                            0,
                            if matches!(step.mode, Mode::CoverOdd | Mode::BlockOdd) {
                                1
                            } else {
                                255
                            },
                        );
                        (gl.stencil_op)(0, 0, 0);
                    } else {
                        (gl.stencil_func)(0x0207, 0, 255);
                        (gl.stencil_op_separate)(0x0404, KEEP, KEEP, 0x8507);
                        (gl.stencil_op_separate)(0x0405, KEEP, KEEP, 0x8508);
                    }
                }
                if step.texture != 0
                    && std::mem::replace(&mut texture, step.texture) != step.texture
                {
                    (gl.bind_texture)(TEXTURE_2D, scene.textures[texture as usize - 1].name);
                }
                (gl.scissor)(
                    step.clip.left,
                    step.clip.top,
                    step.clip.width() as i32,
                    step.clip.height() as i32,
                );
                for first in (step.first..step.end).step_by(UNITS_PER_DRAW as usize) {
                    (gl.uniform_1i)(program.first_unit, first as i32);
                    (gl.draw_elements)(
                        4,
                        (step.end - first).min(UNITS_PER_DRAW) as i32 * 6,
                        0x1403,
                        null(),
                    );
                }
            }
            (gl.disable)(SCISSOR_TEST);
            (gl.color_mask)(1, 1, 1, 1);
            (gl.bind_framebuffer)(0x8CA9, self.frames[1]);
            (gl.blit_framebuffer)(0, 0, width, height, 0, 0, width, height, 0x4000, NEAREST);
            device.check()
        })
    }
}
