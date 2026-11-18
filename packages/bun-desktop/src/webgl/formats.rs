//! The formats of images.

use super::context::Extension::{self, *};
use super::gl::*;
use crate::abi_webgl::{scalar, view};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Component {
    Unorm,
    Snorm,
    Float,
    Int,
    Uint,
}

/// What it takes, in WebGL 1 and in WebGL 2.
#[derive(Clone, Copy)]
pub struct Need(pub [Option<u64>; 2]);

const fn any(extension: Extension) -> Option<u64> {
    Some(extension.bit())
}

const FREE: Option<u64> = Some(0);
const ALWAYS: Need = Need([FREE; 2]);
const NEVER: Need = Need([None; 2]);
const WEBGL2: Need = Need([None, FREE]);

pub struct Format {
    pub sized: u32,
    /// What `texImage2D()` calls it.
    pub base: u32,
    /// The first one matches what is stored.
    pub kinds: &'static [u32],
    /// Red, green, blue, alpha, depth and stencil.
    pub bits: [u8; 6],
    pub component: Component,
    pub renders: Need,
    pub filters: Need,
    /// It can be asked for by its sized name.
    pub exists: Need,
    /// Width, height and bytes, if it is compressed.
    pub block: Option<[u32; 3]>,
}

const HALF: &[u32] = &[HALF_FLOAT, FLOAT];
const HALF_RENDERS: Need = Need([
    any(ColorBufferHalfFloat),
    Some(ColorBufferHalfFloat.bit() | ColorBufferFloat2.bit()),
]);
const HALF_FILTERS: Need = Need([any(HalfFloatLinear), FREE]);
const FLOAT_RENDERS: Need = Need([any(ColorBufferFloat), any(ColorBufferFloat2)]);
const FLOAT_FILTERS: Need = Need([any(FloatLinear); 2]);
const SNORM_RENDERS: Need = Need([None, any(RenderSnorm)]);
const NORM16: Need = Need([None, any(Norm16)]);
const DEPTH_FILTERS: Need = Need([FREE, None]);

const ALPHA8: u32 = 0x803C;
const LUMINANCE8: u32 = 0x8040;
const LUMINANCE8_ALPHA8: u32 = 0x8045;
const ALPHA32F: u32 = 0x8816;
const LUMINANCE32F: u32 = 0x8818;
const LUMINANCE_ALPHA32F: u32 = 0x8819;
const ALPHA16F: u32 = 0x881C;
const LUMINANCE16F: u32 = 0x881E;
const LUMINANCE_ALPHA16F: u32 = 0x881F;

macro_rules! formats {
    (
        plain { $($sized:ident $base:ident $kinds:expr, $bits:expr, $component:ident $renders:ident $filters:ident $exists:ident)* }
        compressed { $($extension:ident $component_of_block:ident [$($name:ident $width:literal $height:literal $bytes:literal)*])* }
    ) => {
        pub static FORMATS: &[Format] = &[
            $(Format {
                sized: $sized, base: $base, kinds: $kinds, bits: $bits, component: Component::$component, renders: $renders, filters: $filters, exists: $exists,
                block: None,
            },)*
            $($(Format {
                sized: $name, base: $name, kinds: &[], bits: [8, 8, 8, 8, 0, 0], component: Component::$component_of_block, renders: NEVER, filters: ALWAYS,
                exists: Need([any($extension); 2]), block: Some([$width, $height, $bytes]),
            },)*)*
        ];
    };
}

formats! {
    plain {
        RGBA8 RGBA &[UNSIGNED_BYTE], [8, 8, 8, 8, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        RGB8 RGB &[UNSIGNED_BYTE], [8, 8, 8, 0, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        RG8 RG &[UNSIGNED_BYTE], [8, 8, 0, 0, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        R8 RED &[UNSIGNED_BYTE], [8, 0, 0, 0, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        RGBA4 RGBA &[UNSIGNED_SHORT_4_4_4_4, UNSIGNED_BYTE], [4, 4, 4, 4, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        RGB5_A1 RGBA &[UNSIGNED_SHORT_5_5_5_1, UNSIGNED_BYTE, UNSIGNED_INT_2_10_10_10_REV], [5, 5, 5, 1, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        RGB565 RGB &[UNSIGNED_SHORT_5_6_5, UNSIGNED_BYTE], [5, 6, 5, 0, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        RGB10_A2 RGBA &[UNSIGNED_INT_2_10_10_10_REV], [10, 10, 10, 2, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        SRGB8_ALPHA8 RGBA &[UNSIGNED_BYTE], [8, 8, 8, 8, 0, 0], Unorm ALWAYS ALWAYS WEBGL2
        SRGB8 RGB &[UNSIGNED_BYTE], [8, 8, 8, 0, 0, 0], Unorm NEVER ALWAYS WEBGL2
        RGBA8_SNORM RGBA &[BYTE], [8, 8, 8, 8, 0, 0], Snorm SNORM_RENDERS ALWAYS WEBGL2
        RGB8_SNORM RGB &[BYTE], [8, 8, 8, 0, 0, 0], Snorm NEVER ALWAYS WEBGL2
        RG8_SNORM RG &[BYTE], [8, 8, 0, 0, 0, 0], Snorm SNORM_RENDERS ALWAYS WEBGL2
        R8_SNORM RED &[BYTE], [8, 0, 0, 0, 0, 0], Snorm SNORM_RENDERS ALWAYS WEBGL2
        RGBA16F RGBA HALF, [16, 16, 16, 16, 0, 0], Float HALF_RENDERS HALF_FILTERS WEBGL2
        RGB16F RGB HALF, [16, 16, 16, 0, 0, 0], Float NEVER HALF_FILTERS WEBGL2
        RG16F RG HALF, [16, 16, 0, 0, 0, 0], Float HALF_RENDERS HALF_FILTERS WEBGL2
        R16F RED HALF, [16, 0, 0, 0, 0, 0], Float HALF_RENDERS HALF_FILTERS WEBGL2
        RGBA32F RGBA &[FLOAT], [32, 32, 32, 32, 0, 0], Float FLOAT_RENDERS FLOAT_FILTERS WEBGL2
        RGB32F RGB &[FLOAT], [32, 32, 32, 0, 0, 0], Float NEVER FLOAT_FILTERS WEBGL2
        RG32F RG &[FLOAT], [32, 32, 0, 0, 0, 0], Float FLOAT_RENDERS FLOAT_FILTERS WEBGL2
        R32F RED &[FLOAT], [32, 0, 0, 0, 0, 0], Float FLOAT_RENDERS FLOAT_FILTERS WEBGL2
        R11F_G11F_B10F RGB &[UNSIGNED_INT_10F_11F_11F_REV, HALF_FLOAT, FLOAT], [11, 11, 10, 0, 0, 0], Float FLOAT_RENDERS ALWAYS WEBGL2
        RGB9_E5 RGB &[UNSIGNED_INT_5_9_9_9_REV, HALF_FLOAT, FLOAT], [9, 9, 9, 0, 0, 0], Float NEVER ALWAYS WEBGL2
        RGBA8UI RGBA_INTEGER &[UNSIGNED_BYTE], [8, 8, 8, 8, 0, 0], Uint ALWAYS NEVER WEBGL2
        RGBA8I RGBA_INTEGER &[BYTE], [8, 8, 8, 8, 0, 0], Int ALWAYS NEVER WEBGL2
        RGBA16UI RGBA_INTEGER &[UNSIGNED_SHORT], [16, 16, 16, 16, 0, 0], Uint ALWAYS NEVER WEBGL2
        RGBA16I RGBA_INTEGER &[SHORT], [16, 16, 16, 16, 0, 0], Int ALWAYS NEVER WEBGL2
        RGBA32UI RGBA_INTEGER &[UNSIGNED_INT], [32, 32, 32, 32, 0, 0], Uint ALWAYS NEVER WEBGL2
        RGBA32I RGBA_INTEGER &[INT], [32, 32, 32, 32, 0, 0], Int ALWAYS NEVER WEBGL2
        RGB10_A2UI RGBA_INTEGER &[UNSIGNED_INT_2_10_10_10_REV], [10, 10, 10, 2, 0, 0], Uint ALWAYS NEVER WEBGL2
        RGB8UI RGB_INTEGER &[UNSIGNED_BYTE], [8, 8, 8, 0, 0, 0], Uint NEVER NEVER WEBGL2
        RGB8I RGB_INTEGER &[BYTE], [8, 8, 8, 0, 0, 0], Int NEVER NEVER WEBGL2
        RGB16UI RGB_INTEGER &[UNSIGNED_SHORT], [16, 16, 16, 0, 0, 0], Uint NEVER NEVER WEBGL2
        RGB16I RGB_INTEGER &[SHORT], [16, 16, 16, 0, 0, 0], Int NEVER NEVER WEBGL2
        RGB32UI RGB_INTEGER &[UNSIGNED_INT], [32, 32, 32, 0, 0, 0], Uint NEVER NEVER WEBGL2
        RGB32I RGB_INTEGER &[INT], [32, 32, 32, 0, 0, 0], Int NEVER NEVER WEBGL2
        RG8UI RG_INTEGER &[UNSIGNED_BYTE], [8, 8, 0, 0, 0, 0], Uint ALWAYS NEVER WEBGL2
        RG8I RG_INTEGER &[BYTE], [8, 8, 0, 0, 0, 0], Int ALWAYS NEVER WEBGL2
        RG16UI RG_INTEGER &[UNSIGNED_SHORT], [16, 16, 0, 0, 0, 0], Uint ALWAYS NEVER WEBGL2
        RG16I RG_INTEGER &[SHORT], [16, 16, 0, 0, 0, 0], Int ALWAYS NEVER WEBGL2
        RG32UI RG_INTEGER &[UNSIGNED_INT], [32, 32, 0, 0, 0, 0], Uint ALWAYS NEVER WEBGL2
        RG32I RG_INTEGER &[INT], [32, 32, 0, 0, 0, 0], Int ALWAYS NEVER WEBGL2
        R8UI RED_INTEGER &[UNSIGNED_BYTE], [8, 0, 0, 0, 0, 0], Uint ALWAYS NEVER WEBGL2
        R8I RED_INTEGER &[BYTE], [8, 0, 0, 0, 0, 0], Int ALWAYS NEVER WEBGL2
        R16UI RED_INTEGER &[UNSIGNED_SHORT], [16, 0, 0, 0, 0, 0], Uint ALWAYS NEVER WEBGL2
        R16I RED_INTEGER &[SHORT], [16, 0, 0, 0, 0, 0], Int ALWAYS NEVER WEBGL2
        R32UI RED_INTEGER &[UNSIGNED_INT], [32, 0, 0, 0, 0, 0], Uint ALWAYS NEVER WEBGL2
        R32I RED_INTEGER &[INT], [32, 0, 0, 0, 0, 0], Int ALWAYS NEVER WEBGL2
        RGBA16_EXT RGBA &[UNSIGNED_SHORT], [16, 16, 16, 16, 0, 0], Unorm ALWAYS ALWAYS NORM16
        RGB16_EXT RGB &[UNSIGNED_SHORT], [16, 16, 16, 0, 0, 0], Unorm NEVER ALWAYS NORM16
        RG16_EXT RG &[UNSIGNED_SHORT], [16, 16, 0, 0, 0, 0], Unorm ALWAYS ALWAYS NORM16
        R16_EXT RED &[UNSIGNED_SHORT], [16, 0, 0, 0, 0, 0], Unorm ALWAYS ALWAYS NORM16
        RGBA16_SNORM_EXT RGBA &[SHORT], [16, 16, 16, 16, 0, 0], Snorm SNORM_RENDERS ALWAYS NORM16
        RGB16_SNORM_EXT RGB &[SHORT], [16, 16, 16, 0, 0, 0], Snorm NEVER ALWAYS NORM16
        RG16_SNORM_EXT RG &[SHORT], [16, 16, 0, 0, 0, 0], Snorm SNORM_RENDERS ALWAYS NORM16
        R16_SNORM_EXT RED &[SHORT], [16, 0, 0, 0, 0, 0], Snorm SNORM_RENDERS ALWAYS NORM16
        DEPTH_COMPONENT16 DEPTH_COMPONENT &[UNSIGNED_SHORT, UNSIGNED_INT], [0, 0, 0, 0, 16, 0], Unorm ALWAYS DEPTH_FILTERS WEBGL2
        DEPTH_COMPONENT24 DEPTH_COMPONENT &[UNSIGNED_INT], [0, 0, 0, 0, 24, 0], Unorm ALWAYS DEPTH_FILTERS WEBGL2
        DEPTH_COMPONENT32F DEPTH_COMPONENT &[FLOAT], [0, 0, 0, 0, 32, 0], Float ALWAYS NEVER WEBGL2
        DEPTH24_STENCIL8 DEPTH_STENCIL &[UNSIGNED_INT_24_8], [0, 0, 0, 0, 24, 8], Unorm ALWAYS DEPTH_FILTERS WEBGL2
        DEPTH32F_STENCIL8 DEPTH_STENCIL &[FLOAT_32_UNSIGNED_INT_24_8_REV], [0, 0, 0, 0, 32, 8], Float ALWAYS NEVER WEBGL2
        STENCIL_INDEX8 NONE &[], [0, 0, 0, 0, 0, 8], Uint ALWAYS NEVER NEVER
        ALPHA8 ALPHA &[UNSIGNED_BYTE], [0, 0, 0, 8, 0, 0], Unorm NEVER ALWAYS NEVER
        LUMINANCE8 LUMINANCE &[UNSIGNED_BYTE], [8, 0, 0, 0, 0, 0], Unorm NEVER ALWAYS NEVER
        LUMINANCE8_ALPHA8 LUMINANCE_ALPHA &[UNSIGNED_BYTE], [8, 0, 0, 8, 0, 0], Unorm NEVER ALWAYS NEVER
        ALPHA16F ALPHA &[HALF_FLOAT], [0, 0, 0, 16, 0, 0], Float NEVER HALF_FILTERS NEVER
        LUMINANCE16F LUMINANCE &[HALF_FLOAT], [16, 0, 0, 0, 0, 0], Float NEVER HALF_FILTERS NEVER
        LUMINANCE_ALPHA16F LUMINANCE_ALPHA &[HALF_FLOAT], [16, 0, 0, 16, 0, 0], Float NEVER HALF_FILTERS NEVER
        ALPHA32F ALPHA &[FLOAT], [0, 0, 0, 32, 0, 0], Float NEVER FLOAT_FILTERS NEVER
        LUMINANCE32F LUMINANCE &[FLOAT], [32, 0, 0, 0, 0, 0], Float NEVER FLOAT_FILTERS NEVER
        LUMINANCE_ALPHA32F LUMINANCE_ALPHA &[FLOAT], [32, 0, 0, 32, 0, 0], Float NEVER FLOAT_FILTERS NEVER
    }
    compressed {
        S3tc Unorm [COMPRESSED_RGB_S3TC_DXT1_EXT 4 4 8 COMPRESSED_RGBA_S3TC_DXT1_EXT 4 4 8 COMPRESSED_RGBA_S3TC_DXT3_EXT 4 4 16 COMPRESSED_RGBA_S3TC_DXT5_EXT 4 4 16]
        S3tcSrgb Unorm [
            COMPRESSED_SRGB_S3TC_DXT1_EXT 4 4 8 COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT 4 4 8 COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT 4 4 16
            COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT 4 4 16
        ]
        Rgtc Unorm [COMPRESSED_RED_RGTC1_EXT 4 4 8 COMPRESSED_RED_GREEN_RGTC2_EXT 4 4 16]
        Rgtc Snorm [COMPRESSED_SIGNED_RED_RGTC1_EXT 4 4 8 COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT 4 4 16]
        Bptc Unorm [COMPRESSED_RGBA_BPTC_UNORM_EXT 4 4 16 COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT 4 4 16]
        Bptc Float [COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT 4 4 16 COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT 4 4 16]
        Etc1 Unorm [COMPRESSED_RGB_ETC1_WEBGL 4 4 8]
        Etc Unorm [
            COMPRESSED_R11_EAC 4 4 8 COMPRESSED_RG11_EAC 4 4 16 COMPRESSED_RGB8_ETC2 4 4 8 COMPRESSED_SRGB8_ETC2 4 4 8
            COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 4 4 8 COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2 4 4 8 COMPRESSED_RGBA8_ETC2_EAC 4 4 16
            COMPRESSED_SRGB8_ALPHA8_ETC2_EAC 4 4 16
        ]
        Etc Snorm [COMPRESSED_SIGNED_R11_EAC 4 4 8 COMPRESSED_SIGNED_RG11_EAC 4 4 16]
        Astc Unorm [
            COMPRESSED_RGBA_ASTC_4X4_KHR 4 4 16 COMPRESSED_RGBA_ASTC_5X4_KHR 5 4 16 COMPRESSED_RGBA_ASTC_5X5_KHR 5 5 16 COMPRESSED_RGBA_ASTC_6X5_KHR 6 5 16
            COMPRESSED_RGBA_ASTC_6X6_KHR 6 6 16 COMPRESSED_RGBA_ASTC_8X5_KHR 8 5 16 COMPRESSED_RGBA_ASTC_8X6_KHR 8 6 16 COMPRESSED_RGBA_ASTC_8X8_KHR 8 8 16
            COMPRESSED_RGBA_ASTC_10X5_KHR 10 5 16 COMPRESSED_RGBA_ASTC_10X6_KHR 10 6 16 COMPRESSED_RGBA_ASTC_10X8_KHR 10 8 16
            COMPRESSED_RGBA_ASTC_10X10_KHR 10 10 16 COMPRESSED_RGBA_ASTC_12X10_KHR 12 10 16 COMPRESSED_RGBA_ASTC_12X12_KHR 12 12 16
            COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR 4 4 16 COMPRESSED_SRGB8_ALPHA8_ASTC_5X4_KHR 5 4 16 COMPRESSED_SRGB8_ALPHA8_ASTC_5X5_KHR 5 5 16
            COMPRESSED_SRGB8_ALPHA8_ASTC_6X5_KHR 6 5 16 COMPRESSED_SRGB8_ALPHA8_ASTC_6X6_KHR 6 6 16 COMPRESSED_SRGB8_ALPHA8_ASTC_8X5_KHR 8 5 16
            COMPRESSED_SRGB8_ALPHA8_ASTC_8X6_KHR 8 6 16 COMPRESSED_SRGB8_ALPHA8_ASTC_8X8_KHR 8 8 16 COMPRESSED_SRGB8_ALPHA8_ASTC_10X5_KHR 10 5 16
            COMPRESSED_SRGB8_ALPHA8_ASTC_10X6_KHR 10 6 16 COMPRESSED_SRGB8_ALPHA8_ASTC_10X8_KHR 10 8 16 COMPRESSED_SRGB8_ALPHA8_ASTC_10X10_KHR 10 10 16
            COMPRESSED_SRGB8_ALPHA8_ASTC_12X10_KHR 12 10 16 COMPRESSED_SRGB8_ALPHA8_ASTC_12X12_KHR 12 12 16
        ]
    }
}

/// Format, type, what they make together, and what that takes.
static UNSIZED: &[(u32, u32, u32, Need)] = {
    const FLOATS: Need = Need([any(TextureFloat), None]);
    const HALVES: Need = Need([any(TextureHalfFloat), None]);
    const DEPTHS: Need = Need([any(DepthTexture), None]);
    const SRGB: Need = Need([any(Srgb), None]);
    &[
        (RGBA, UNSIGNED_BYTE, RGBA8, ALWAYS),
        (RGBA, UNSIGNED_SHORT_4_4_4_4, RGBA4, ALWAYS),
        (RGBA, UNSIGNED_SHORT_5_5_5_1, RGB5_A1, ALWAYS),
        (RGB, UNSIGNED_BYTE, RGB8, ALWAYS),
        (RGB, UNSIGNED_SHORT_5_6_5, RGB565, ALWAYS),
        (LUMINANCE_ALPHA, UNSIGNED_BYTE, LUMINANCE8_ALPHA8, ALWAYS),
        (LUMINANCE, UNSIGNED_BYTE, LUMINANCE8, ALWAYS),
        (ALPHA, UNSIGNED_BYTE, ALPHA8, ALWAYS),
        (RGBA, FLOAT, RGBA32F, FLOATS),
        (RGB, FLOAT, RGB32F, FLOATS),
        (LUMINANCE_ALPHA, FLOAT, LUMINANCE_ALPHA32F, FLOATS),
        (LUMINANCE, FLOAT, LUMINANCE32F, FLOATS),
        (ALPHA, FLOAT, ALPHA32F, FLOATS),
        (RGBA, HALF_FLOAT_OES, RGBA16F, HALVES),
        (RGB, HALF_FLOAT_OES, RGB16F, HALVES),
        (LUMINANCE_ALPHA, HALF_FLOAT_OES, LUMINANCE_ALPHA16F, HALVES),
        (LUMINANCE, HALF_FLOAT_OES, LUMINANCE16F, HALVES),
        (ALPHA, HALF_FLOAT_OES, ALPHA16F, HALVES),
        (DEPTH_COMPONENT, UNSIGNED_SHORT, DEPTH_COMPONENT16, DEPTHS),
        (DEPTH_COMPONENT, UNSIGNED_INT, DEPTH_COMPONENT24, DEPTHS),
        (DEPTH_STENCIL, UNSIGNED_INT_24_8, DEPTH24_STENCIL8, DEPTHS),
        (SRGB_EXT, UNSIGNED_BYTE, SRGB8, SRGB),
        (SRGB_ALPHA_EXT, UNSIGNED_BYTE, SRGB8_ALPHA8, SRGB),
    ]
};

/// The version of WebGL, and the extensions that the page has enabled.
#[derive(Clone, Copy)]
pub struct Features {
    pub is_webgl2: bool,
    pub enabled: u64,
}

impl Features {
    pub fn meet(self, need: Need) -> bool {
        need.0[usize::from(self.is_webgl2)].is_some_and(|it| it == 0 || it & self.enabled != 0)
    }

    pub fn has(self, extension: Extension) -> bool {
        self.enabled & extension.bit() != 0
    }

    pub fn is_webgl2_or_has(self, extension: Extension) -> bool {
        self.is_webgl2 || self.has(extension)
    }

    pub fn sized(self, internal: u32) -> Option<&'static Format> {
        find(internal).filter(|it| self.meet(it.exists))
    }

    fn all_unsized(self) -> impl Iterator<Item = &'static (u32, u32, u32, Need)> {
        UNSIZED.iter().filter(move |it| self.meet(it.3))
    }

    pub fn is_unsized(self, internal: u32) -> bool {
        self.all_unsized().any(|it| it.0 == internal)
    }

    /// Whether these are names of a format and a type at all.
    pub fn knows(self, format: u32, kind: u32) -> bool {
        let sized = || {
            FORMATS
                .iter()
                .filter(|it| it.block.is_none() && self.meet(it.exists))
        };
        (self.is_unsized(format) || sized().any(|it| it.base == format))
            && (self.all_unsized().any(|it| it.1 == kind)
                || sized().any(|it| it.kinds.contains(&kind)))
    }

    /// What `texImage2D()` makes of these.
    pub fn combine(self, internal: u32, format: u32, kind: u32) -> Option<&'static Format> {
        let unsized_one = self
            .all_unsized()
            .find(|it| (it.0, it.0, it.1) == (internal, format, kind))
            .and_then(|it| find(it.2));
        unsized_one.or_else(|| {
            self.sized(internal)
                .filter(|it| it.base == format && it.kinds.contains(&kind))
        })
    }

    pub fn for_renderbuffer(self, internal: u32) -> Option<&'static Format> {
        let is_known = match internal {
            DEPTH_STENCIL => return find(DEPTH24_STENCIL8),
            RGBA4 | RGB5_A1 | RGB565 | DEPTH_COMPONENT16 | STENCIL_INDEX8 => true,
            _ if self.is_webgl2 => self.sized(internal).is_some(),
            SRGB8_ALPHA8 => self.has(Srgb),
            _ => matches!(internal, RGBA16F | RGB16F | RGBA32F),
        };
        find(internal).filter(|it| is_known && self.renders(it))
    }

    pub fn renders(self, format: &Format) -> bool {
        match format.sized {
            RGB16F => self.has(ColorBufferHalfFloat) && !self.is_webgl2,
            RGB9_E5 => self.has(SharedExponent),
            _ => self.meet(format.renders),
        }
    }
}

pub fn find(sized: u32) -> Option<&'static Format> {
    FORMATS.iter().find(|it| it.sized == sized)
}

impl Format {
    pub fn is_integer(&self) -> bool {
        matches!(self.component, Component::Int | Component::Uint)
    }

    /// What a shader writes.
    pub fn scalar(&self) -> u32 {
        match self.component {
            Component::Int => scalar::INT,
            Component::Uint => scalar::UINT,
            _ => scalar::FLOAT,
        }
    }

    pub fn has_depth(&self) -> bool {
        self.bits[4] > 0
    }

    pub fn has_stencil(&self) -> bool {
        self.bits[5] > 0
    }

    pub fn is_color(&self) -> bool {
        !self.has_depth() && !self.has_stencil()
    }

    pub fn is_srgb(&self) -> bool {
        matches!(self.sized, SRGB8 | SRGB8_ALPHA8)
    }

    /// The driver gets red, or red and green.
    pub fn is_emulated(&self) -> bool {
        matches!(self.base, ALPHA | LUMINANCE | LUMINANCE_ALPHA)
    }

    /// The internal format and the format.
    pub fn native(&self) -> (u32, u32) {
        let by_size = |formats: [u32; 3]| formats[usize::from(self.bits[0].max(self.bits[3]) / 16)];
        match self.base {
            ALPHA | LUMINANCE => (by_size([R8, R16F, R32F]), RED),
            LUMINANCE_ALPHA => (by_size([RG8, RG16F, RG32F]), RG),
            COMPRESSED_RGB_ETC1_WEBGL => (COMPRESSED_RGB8_ETC2, COMPRESSED_RGB8_ETC2),
            base => (self.sized, base),
        }
    }

    /// Where a shader gets red, green, blue and alpha.
    pub fn swizzle(&self, is_webgl2: bool) -> [u32; 4] {
        const GREEN: u32 = RED + 1;
        match self.base {
            ALPHA => [ZERO, ZERO, ZERO, RED],
            LUMINANCE => [RED, RED, RED, ONE],
            LUMINANCE_ALPHA => [RED, RED, RED, GREEN],
            DEPTH_COMPONENT | DEPTH_STENCIL if !is_webgl2 => [RED, RED, RED, ONE],
            _ => [RED, GREEN, GREEN + 1, ALPHA],
        }
    }

    pub fn component_type(&self) -> u32 {
        [
            UNSIGNED_NORMALIZED,
            SIGNED_NORMALIZED,
            FLOAT,
            INT,
            UNSIGNED_INT,
        ][self.component as usize]
    }

    /// About.
    pub fn bytes(&self, [width, height, depth]: [u32; 3]) -> u64 {
        let [across, down, bytes] = self.block.unwrap_or_else(|| {
            [
                1,
                1,
                self.bits
                    .iter()
                    .map(|it| u32::from(*it))
                    .sum::<u32>()
                    .div_ceil(8)
                    .next_power_of_two(),
            ]
        });
        u64::from(width.div_ceil(across))
            * u64::from(height.div_ceil(down))
            * u64::from(depth)
            * u64::from(bytes)
    }
}

pub fn components(format: u32) -> u32 {
    match format {
        RGBA | RGBA_INTEGER | SRGB_ALPHA_EXT => 4,
        RGB | RGB_INTEGER | SRGB_EXT => 3,
        RG | RG_INTEGER | LUMINANCE_ALPHA => 2,
        RED | RED_INTEGER | LUMINANCE | ALPHA | DEPTH_COMPONENT | DEPTH_STENCIL => 1,
        _ => 0,
    }
}

/// The size of a value, and whether that is a whole pixel.
pub fn size_of_kind(kind: u32) -> (u32, bool) {
    match kind {
        BYTE | UNSIGNED_BYTE => (1, false),
        SHORT | UNSIGNED_SHORT | HALF_FLOAT | HALF_FLOAT_OES => (2, false),
        INT | UNSIGNED_INT | FLOAT => (4, false),
        UNSIGNED_SHORT_4_4_4_4 | UNSIGNED_SHORT_5_5_5_1 | UNSIGNED_SHORT_5_6_5 => (2, true),
        UNSIGNED_INT_2_10_10_10_REV
        | UNSIGNED_INT_10F_11F_11F_REV
        | UNSIGNED_INT_5_9_9_9_REV
        | UNSIGNED_INT_24_8 => (4, true),
        FLOAT_32_UNSIGNED_INT_24_8_REV => (8, true),
        _ => (0, false),
    }
}

/// 0 if they are not known.
pub fn bytes_per_pixel(format: u32, kind: u32) -> u32 {
    let (size, is_packed) = size_of_kind(kind);
    if is_packed {
        size
    } else {
        size * components(format)
    }
}

/// The kind of array that holds such values.
pub fn view_for(kind: u32) -> u32 {
    match (kind, size_of_kind(kind).0) {
        (BYTE, _) => view::INT8,
        (SHORT, _) => view::INT16,
        (INT, _) => view::INT32,
        (FLOAT, _) => view::FLOAT32,
        (_, 1) => view::UINT8,
        (_, 2) => view::UINT16,
        (_, 4) => view::UINT32,
        _ => view::NULL,
    }
}

pub fn native_kind(kind: u32) -> u32 {
    if kind == HALF_FLOAT_OES {
        HALF_FLOAT
    } else {
        kind
    }
}
