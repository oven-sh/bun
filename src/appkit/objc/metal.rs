//! Metal and MetalKit bindings, in the style of [`super::appkit`]: one line
//! per method, the Rust signature a transcription of the header named on the
//! right (`MacOSX.sdk/.../Metal.framework/Headers`, `MetalKit.framework/Headers/MTKView.h`).
//!
//! Most Metal objects are typed in the headers as `id<MTLSomething>`: a
//! protocol, not a class (the concrete classes are private and differ per
//! GPU driver). They are declared here with [`objc_protocol!`], which gives a
//! wrapper everything [`objc_class!`] does (retain/release, `Deref` to the
//! parent protocol's wrapper, message sends) except [`super::ClassType`], so
//! there is no `alloc`, subclassing or `downcast` to a protocol type: every
//! instance arrives already made from a `MTLDevice`, command buffer or
//! `MTKView` method whose binding names the right wrapper.
//!
//! The descriptor types (`MTLTextureDescriptor`, `MTLRenderPipelineDescriptor`,
//! …) and `MTKView` are real classes and resolve by name once
//! [`super::metal`] has loaded the frameworks; touching them before that
//! panics with "class not found".
//!
//! Enum-typed getters return the raw `NSUInteger` (`usize`): a driver may hand
//! back a value this file does not list, and an out-of-range enum is UB. The
//! JavaScript-facing enums offer `from_raw` for the way back.

use core::ffi::c_void;
use core::ops::{BitOr, BitOrAssign};
use core::ptr::NonNull;

use super::appkit::{NSColorSpace, NSView};
use super::foundation::{NSArray, NSError, NSObject, NSString};
use super::{Arg, Object, Out, Ptr, Ret, objc_class, objc_methods, objc_protocol, rt};
use crate::error::{Error, Result};
use crate::geometry::{ClearColor, Range, Rect, Region, ScissorRect, Size, Size3, Viewport};

// ─────────────────────────────── enums ─────────────────────────────────────

/// A fieldless `#[repr($raw)]` enum with header values on the left and the
/// JavaScript name on the right; implements [`crate::Named`] from the same
/// list and `from_raw` for values read back from Metal. `pub` because the
/// safe GPU layer re-exports them.
macro_rules! metal_enum {
    (
        $(#[$m:meta])*
        enum $Name:ident: $raw:ident {
            $( $(#[$vm:meta])* $Variant:ident = $val:literal => $js:literal ),* $(,)?
        }
    ) => {
        $(#[$m])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        #[repr($raw)]
        #[allow(unreachable_pub)]
        pub enum $Name {
            $( $(#[$vm])* $Variant = $val ),*
        }

        impl $crate::Named for $Name {
            const ALL: &'static [(&'static str, Self)] = &[ $( ($js, $Name::$Variant) ),* ];

            fn name(self) -> &'static str {
                match self {
                    $( $Name::$Variant => $js ),*
                }
            }
        }

        #[allow(unreachable_pub)]
        impl $Name {
            /// The variant with this header value, if it is one this crate names.
            pub fn from_raw(raw: $raw) -> Option<$Name> {
                <$Name as $crate::Named>::ALL.iter().map(|&(_, v)| v).find(|&v| v as $raw == raw)
            }
        }
    };
}

metal_enum! {
    /// `MTLPixelFormat` (MTLPixelFormat.h); the subset a 2D renderer needs.
    enum PixelFormat: usize {
        Invalid = 0 => "invalid",
        R8Unorm = 10 => "r8unorm",
        R16Float = 25 => "r16float",
        RG8Unorm = 30 => "rg8unorm",
        R32Uint = 53 => "r32uint",
        R32Float = 55 => "r32float",
        RG16Float = 65 => "rg16float",
        RGBA8Unorm = 70 => "rgba8unorm",
        RGBA8UnormSrgb = 71 => "rgba8unorm-srgb",
        BGRA8Unorm = 80 => "bgra8unorm",
        BGRA8UnormSrgb = 81 => "bgra8unorm-srgb",
        RGB10A2Unorm = 90 => "rgb10a2unorm",
        RG32Float = 105 => "rg32float",
        RGBA16Float = 115 => "rgba16float",
        RGBA32Float = 125 => "rgba32float",
        Depth32Float = 252 => "depth32float",
        Depth32FloatStencil8 = 260 => "depth32float-stencil8",
    }
}

impl PixelFormat {
    /// Bytes per texel for the color/depth formats above (`0` for `Invalid`).
    pub(crate) const fn bytes_per_texel(self) -> usize {
        match self {
            PixelFormat::Invalid => 0,
            PixelFormat::R8Unorm => 1,
            PixelFormat::R16Float | PixelFormat::RG8Unorm => 2,
            PixelFormat::R32Uint
            | PixelFormat::R32Float
            | PixelFormat::RG16Float
            | PixelFormat::RGBA8Unorm
            | PixelFormat::RGBA8UnormSrgb
            | PixelFormat::BGRA8Unorm
            | PixelFormat::BGRA8UnormSrgb
            | PixelFormat::RGB10A2Unorm
            | PixelFormat::Depth32Float => 4,
            PixelFormat::RG32Float | PixelFormat::RGBA16Float => 8,
            // Depth32Float_Stencil8 is 5 bytes of payload stored as 8.
            PixelFormat::Depth32FloatStencil8 => 8,
            PixelFormat::RGBA32Float => 16,
        }
    }

    pub(crate) const fn is_depth(self) -> bool {
        matches!(
            self,
            PixelFormat::Depth32Float | PixelFormat::Depth32FloatStencil8
        )
    }

    pub(crate) const fn has_stencil(self) -> bool {
        matches!(self, PixelFormat::Depth32FloatStencil8)
    }

    /// Colour-renderable and filterable on every Mac GPU family, which is
    /// what `generateMipmapsForTexture:` and linear sampling need. Integer
    /// and depth formats are neither.
    pub(crate) const fn is_filterable_color(self) -> bool {
        // The normalized and float colour formats that every Mac GPU family
        // filters (Metal feature set tables); anything added to the enum later
        // is not filterable until listed here.
        matches!(
            self,
            PixelFormat::R8Unorm
                | PixelFormat::R16Float
                | PixelFormat::RG8Unorm
                | PixelFormat::R32Float
                | PixelFormat::RG16Float
                | PixelFormat::RGBA8Unorm
                | PixelFormat::RGBA8UnormSrgb
                | PixelFormat::BGRA8Unorm
                | PixelFormat::BGRA8UnormSrgb
                | PixelFormat::RGB10A2Unorm
                | PixelFormat::RG32Float
                | PixelFormat::RGBA16Float
                | PixelFormat::RGBA32Float
        )
    }
}

metal_enum! {
    /// `MTLPrimitiveType` (MTLRenderCommandEncoder.h).
    enum PrimitiveType: usize {
        Point = 0 => "point",
        Line = 1 => "line",
        LineStrip = 2 => "lineStrip",
        Triangle = 3 => "triangle",
        TriangleStrip = 4 => "triangleStrip",
    }
}

metal_enum! {
    /// `MTLLoadAction` (MTLRenderPass.h).
    enum LoadAction: usize {
        DontCare = 0 => "dontCare",
        Load = 1 => "load",
        Clear = 2 => "clear",
    }
}

metal_enum! {
    /// `MTLStoreAction` (MTLRenderPass.h).
    enum StoreAction: usize {
        DontCare = 0 => "dontCare",
        Store = 1 => "store",
        MultisampleResolve = 2 => "multisampleResolve",
        StoreAndMultisampleResolve = 3 => "storeAndMultisampleResolve",
    }
}

metal_enum! {
    /// `MTLIndexType` (MTLArgument.h).
    enum IndexType: usize {
        UInt16 = 0 => "uint16",
        UInt32 = 1 => "uint32",
    }
}

impl IndexType {
    pub(crate) const fn bytes(self) -> usize {
        match self {
            IndexType::UInt16 => 2,
            IndexType::UInt32 => 4,
        }
    }
}

metal_enum! {
    /// `MTLStorageMode` (MTLResource.h).
    enum StorageMode: usize {
        Shared = 0 => "shared",
        Managed = 1 => "managed",
        Private = 2 => "private",
        Memoryless = 3 => "memoryless",
    }
}

metal_enum! {
    /// `MTLCullMode` (MTLRenderCommandEncoder.h).
    enum CullMode: usize {
        None = 0 => "none",
        Front = 1 => "front",
        Back = 2 => "back",
    }
}

metal_enum! {
    /// `MTLWinding` (MTLRenderCommandEncoder.h).
    enum Winding: usize {
        Clockwise = 0 => "cw",
        CounterClockwise = 1 => "ccw",
    }
}

metal_enum! {
    /// `MTLCompareFunction` (MTLDepthStencil.h).
    enum CompareFunction: usize {
        Never = 0 => "never",
        Less = 1 => "less",
        Equal = 2 => "equal",
        LessEqual = 3 => "lessEqual",
        Greater = 4 => "greater",
        NotEqual = 5 => "notEqual",
        GreaterEqual = 6 => "greaterEqual",
        Always = 7 => "always",
    }
}

metal_enum! {
    /// `MTLBlendFactor` (MTLRenderPipeline.h); the dual-source (`Source1*`) ones left out.
    enum BlendFactor: usize {
        Zero = 0 => "zero",
        One = 1 => "one",
        SourceColor = 2 => "sourceColor",
        OneMinusSourceColor = 3 => "oneMinusSourceColor",
        SourceAlpha = 4 => "sourceAlpha",
        OneMinusSourceAlpha = 5 => "oneMinusSourceAlpha",
        DestinationColor = 6 => "destinationColor",
        OneMinusDestinationColor = 7 => "oneMinusDestinationColor",
        DestinationAlpha = 8 => "destinationAlpha",
        OneMinusDestinationAlpha = 9 => "oneMinusDestinationAlpha",
        SourceAlphaSaturated = 10 => "sourceAlphaSaturated",
        BlendColor = 11 => "blendColor",
        OneMinusBlendColor = 12 => "oneMinusBlendColor",
        BlendAlpha = 13 => "blendAlpha",
        OneMinusBlendAlpha = 14 => "oneMinusBlendAlpha",
    }
}

metal_enum! {
    /// `MTLBlendOperation` (MTLRenderPipeline.h).
    enum BlendOperation: usize {
        Add = 0 => "add",
        Subtract = 1 => "subtract",
        ReverseSubtract = 2 => "reverseSubtract",
        Min = 3 => "min",
        Max = 4 => "max",
    }
}

metal_enum! {
    /// `MTLSamplerMinMagFilter` (MTLSampler.h).
    enum SamplerMinMagFilter: usize {
        Nearest = 0 => "nearest",
        Linear = 1 => "linear",
    }
}

metal_enum! {
    /// `MTLSamplerMipFilter` (MTLSampler.h).
    enum SamplerMipFilter: usize {
        NotMipmapped = 0 => "none",
        Nearest = 1 => "nearest",
        Linear = 2 => "linear",
    }
}

metal_enum! {
    /// `MTLSamplerAddressMode` (MTLSampler.h).
    enum SamplerAddressMode: usize {
        ClampToEdge = 0 => "clampToEdge",
        MirrorClampToEdge = 1 => "mirrorClampToEdge",
        Repeat = 2 => "repeat",
        MirrorRepeat = 3 => "mirrorRepeat",
        ClampToZero = 4 => "clampToZero",
        ClampToBorderColor = 5 => "clampToBorderColor",
    }
}

metal_enum! {
    /// `MTLVertexFormat` (MTLVertexDescriptor.h); names follow the MSL types.
    enum VertexFormat: usize {
        UChar4 = 3 => "uchar4",
        Char4 = 6 => "char4",
        UChar4Normalized = 9 => "uchar4norm",
        Char4Normalized = 12 => "char4norm",
        UShort2 = 13 => "ushort2",
        UShort4 = 15 => "ushort4",
        Short2 = 16 => "short2",
        Short4 = 18 => "short4",
        UShort2Normalized = 19 => "ushort2norm",
        UShort4Normalized = 21 => "ushort4norm",
        Short2Normalized = 22 => "short2norm",
        Short4Normalized = 24 => "short4norm",
        Half2 = 25 => "half2",
        Half4 = 27 => "half4",
        Float = 28 => "float",
        Float2 = 29 => "float2",
        Float3 = 30 => "float3",
        Float4 = 31 => "float4",
        Int = 32 => "int",
        Int2 = 33 => "int2",
        Int3 = 34 => "int3",
        Int4 = 35 => "int4",
        UInt = 36 => "uint",
        UInt2 = 37 => "uint2",
        UInt3 = 38 => "uint3",
        UInt4 = 39 => "uint4",
        Int1010102Normalized = 40 => "int1010102norm",
        UInt1010102Normalized = 41 => "uint1010102norm",
        UChar4NormalizedBgra = 42 => "uchar4normBgra",
        UChar = 45 => "uchar",
        Char = 46 => "char",
        UCharNormalized = 47 => "ucharnorm",
        CharNormalized = 48 => "charnorm",
        UShort = 49 => "ushort",
        Short = 50 => "short",
        UShortNormalized = 51 => "ushortnorm",
        ShortNormalized = 52 => "shortnorm",
        Half = 53 => "half",
    }
}

impl VertexFormat {
    /// Size in bytes of one attribute of this format.
    pub(crate) const fn bytes(self) -> usize {
        use VertexFormat::*;
        match self {
            UChar | Char | UCharNormalized | CharNormalized => 1,
            UShort | Short | UShortNormalized | ShortNormalized | Half => 2,
            UChar4
            | Char4
            | UChar4Normalized
            | Char4Normalized
            | UChar4NormalizedBgra
            | UShort2
            | Short2
            | UShort2Normalized
            | Short2Normalized
            | Half2
            | Float
            | Int
            | UInt
            | Int1010102Normalized
            | UInt1010102Normalized => 4,
            UShort4 | Short4 | UShort4Normalized | Short4Normalized | Half4 | Float2 | Int2
            | UInt2 => 8,
            Float3 | Int3 | UInt3 => 12,
            Float4 | Int4 | UInt4 => 16,
        }
    }
}

metal_enum! {
    /// `MTLVertexStepFunction` (MTLVertexDescriptor.h).
    enum VertexStepFunction: usize {
        Constant = 0 => "constant",
        PerVertex = 1 => "vertex",
        PerInstance = 2 => "instance",
    }
}

metal_enum! {
    /// `MTLFunctionType` (MTLLibrary.h); the visible/intersection/mesh/object kinds left out.
    enum FunctionType: usize {
        Vertex = 1 => "vertex",
        Fragment = 2 => "fragment",
        Kernel = 3 => "kernel",
    }
}

// /// `MTLTriangleFillMode` (MTLRenderCommandEncoder.h).
// #[derive(Clone, Copy, Debug, PartialEq, Eq)]
// #[repr(usize)]
// pub(crate) enum TriangleFillMode {
// Fill = 0,
// Lines = 1,
// }
// /// `MTLTextureType` (MTLTexture.h); 2D only in this crate.
// #[derive(Clone, Copy, Debug, PartialEq, Eq)]
// #[repr(usize)]
// pub(crate) enum TextureType {
// D2 = 2,
// D2Multisample = 4,
// }
/// `MTLCommandBufferStatus` (MTLCommandBuffer.h), as returned by
/// [`MTLCommandBuffer::status`]; the states below `COMPLETED` (not enqueued,
/// enqueued, committed, scheduled) are progress.
pub(crate) mod command_buffer_status {
    pub(crate) const COMPLETED: usize = 4;
    pub(crate) const ERROR: usize = 5;
}

/// An `NS_OPTIONS(NSUInteger, …)` newtype: associated consts, `|`, `bits`,
/// `contains`. Marshalled by `options_abi!` in [`super`].
macro_rules! metal_options {
    (
        $(#[$m:meta])*
        struct $Name:ident { $( $(#[$cm:meta])* const $C:ident = $val:expr; )* }
    ) => {
        $(#[$m])*
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
        #[repr(transparent)]
        #[allow(unreachable_pub)]
        pub struct $Name(usize);

        #[allow(unreachable_pub)]
        impl $Name {
            $( $(#[$cm])* pub const $C: $Name = $Name($val); )*

            #[inline]
            pub const fn bits(self) -> usize {
                self.0
            }
            #[inline]
            pub const fn from_bits(bits: usize) -> $Name {
                $Name(bits)
            }
            #[inline]
            pub const fn contains(self, other: $Name) -> bool {
                self.0 & other.0 == other.0
            }
            #[inline]
            pub const fn is_empty(self) -> bool {
                self.0 == 0
            }
        }

        impl BitOr for $Name {
            type Output = $Name;
            #[inline]
            fn bitor(self, rhs: $Name) -> $Name {
                $Name(self.0 | rhs.0)
            }
        }
        impl BitOrAssign for $Name {
            #[inline]
            fn bitor_assign(&mut self, rhs: $Name) {
                self.0 |= rhs.0;
            }
        }
    };
}

metal_options! {
    /// `MTLResourceOptions` (MTLResource.h). The storage mode lives in bits 4..8
    /// (`MTLResourceStorageModeShift`); CPU cache mode default is 0.
    struct ResourceOptions {
        const CPU_CACHE_MODE_DEFAULT = 0;
        const CPU_CACHE_MODE_WRITE_COMBINED = 1;
        const STORAGE_MODE_SHARED = 0 << 4;
        const STORAGE_MODE_MANAGED = 1 << 4;
        const STORAGE_MODE_PRIVATE = 2 << 4;
        const HAZARD_TRACKING_MODE_UNTRACKED = 1 << 8;
    }
}

impl From<StorageMode> for ResourceOptions {
    /// `MTLStorageMode << MTLResourceStorageModeShift`.
    fn from(mode: StorageMode) -> ResourceOptions {
        ResourceOptions((mode as usize) << 4)
    }
}

metal_options! {
    /// `MTLTextureUsage` (MTLTexture.h).
    struct TextureUsage {
        const UNKNOWN = 0;
        const SHADER_READ = 0x01;
        const SHADER_WRITE = 0x02;
        const RENDER_TARGET = 0x04;
        const PIXEL_FORMAT_VIEW = 0x10;
    }
}

metal_options! {
    /// `MTLColorWriteMask` (MTLRenderPipeline.h).
    struct ColorWriteMask {
        const NONE = 0;
        const RED = 0x1 << 3;
        const GREEN = 0x1 << 2;
        const BLUE = 0x1 << 1;
        const ALPHA = 0x1;
        const ALL = 0xf;
    }
}

// ─────────────────────────────── device ─────────────────────────────────────

objc_protocol!(pub struct MTLDevice: NSObject = "MTLDevice");
objc_methods! { impl MTLDevice {
    pub fn name(&self) -> NSString = "name";
    // pub fn registry_id(&self) -> u64 = "registryID";
    pub fn new_command_queue(&self) -> Retained<Option<MTLCommandQueue>> = "newCommandQueue";
    pub fn new_buffer_with_length(&self, length: usize, options: ResourceOptions) -> Retained<Option<MTLBuffer>>
        = "newBufferWithLength:options:";
    /// Copies `length` bytes from `bytes`; see [`MTLDevice::new_buffer_with_bytes`]. `length` 0 is a Metal error.
    fn new_buffer_with_bytes_raw(&self, bytes: Ptr, length: usize, options: ResourceOptions) -> Retained<Option<MTLBuffer>>
        = "newBufferWithBytes:length:options:";
    pub fn new_texture_with_descriptor(&self, descriptor: &MTLTextureDescriptor) -> Retained<Option<MTLTexture>>
        = "newTextureWithDescriptor:";
    /// Synchronous compile. nil with `error` set on failure; `error` may carry warnings on success.
    fn new_library_with_source_raw(&self, source: &NSString, options: Option<&MTLCompileOptions>, error: &Out<NSError>)
        -> Retained<Option<MTLLibrary>> = "newLibraryWithSource:options:error:";
    fn new_render_pipeline_state_raw(&self, descriptor: &MTLRenderPipelineDescriptor, error: &Out<NSError>)
        -> Retained<Option<MTLRenderPipelineState>> = "newRenderPipelineStateWithDescriptor:error:";
    fn new_compute_pipeline_state_raw(&self, function: &MTLFunction, error: &Out<NSError>)
        -> Retained<Option<MTLComputePipelineState>> = "newComputePipelineStateWithFunction:error:";
    pub fn new_depth_stencil_state(&self, descriptor: &MTLDepthStencilDescriptor) -> Retained<Option<MTLDepthStencilState>>
        = "newDepthStencilStateWithDescriptor:";
    pub fn new_sampler_state(&self, descriptor: &MTLSamplerDescriptor) -> Retained<Option<MTLSamplerState>>
        = "newSamplerStateWithDescriptor:";
    /// `MTLGPUFamily` is an `NSInteger`; see [`gpu_family`]. macOS 10.15+.
    pub fn supports_family(&self, family: isize) -> bool = "supportsFamily:";
    pub fn has_unified_memory(&self) -> bool = "hasUnifiedMemory";
    // pub fn recommended_max_working_set_size(&self) -> u64 = "recommendedMaxWorkingSetSize";
    pub fn max_buffer_length(&self) -> usize = "maxBufferLength";
    pub fn max_threads_per_threadgroup(&self) -> Size3 = "maxThreadsPerThreadgroup";
    pub fn is_low_power(&self) -> bool = "isLowPower";
    // pub fn is_headless(&self) -> bool = "isHeadless";
}}

/// `MTLGPUFamily` values (MTLDevice.h) for [`MTLDevice::supports_family`].
pub(crate) mod gpu_family {
    /// Every Apple-designed GPU; the family that takes shared-storage textures.
    pub(crate) const APPLE1: isize = 1001;
}

impl MTLDevice {
    /// A shared/managed buffer initialised with a copy of `bytes` (which must not be empty).
    pub(crate) fn new_buffer_with_bytes(
        &self,
        bytes: &[u8],
        options: ResourceOptions,
    ) -> Option<MTLBuffer> {
        self.new_buffer_with_bytes_raw(Ptr(bytes.as_ptr().cast()), bytes.len(), options)
    }

    /// Compiles MSL source. `Err` carries the compiler's `NSError` (its
    /// `localizedDescription` is the diagnostic log), or `None` if Metal gave none.
    pub(crate) fn new_library_with_source(
        &self,
        source: &NSString,
        options: Option<&MTLCompileOptions>,
    ) -> core::result::Result<MTLLibrary, Option<NSError>> {
        let error = Out::new();
        self.new_library_with_source_raw(source, options, &error)
            .ok_or_else(|| error.take())
    }

    pub(crate) fn new_render_pipeline_state(
        &self,
        descriptor: &MTLRenderPipelineDescriptor,
    ) -> core::result::Result<MTLRenderPipelineState, Option<NSError>> {
        let error = Out::new();
        self.new_render_pipeline_state_raw(descriptor, &error)
            .ok_or_else(|| error.take())
    }

    pub(crate) fn new_compute_pipeline_state(
        &self,
        function: &MTLFunction,
    ) -> core::result::Result<MTLComputePipelineState, Option<NSError>> {
        let error = Out::new();
        self.new_compute_pipeline_state_raw(function, &error)
            .ok_or_else(|| error.take())
    }
}

// ───────────────────────────── resources ────────────────────────────────────

fn check_range(what: &'static str, len: usize, offset: usize, size: usize) -> Result<()> {
    match offset.checked_add(size) {
        Some(end) if end <= len => Ok(()),
        _ => Err(Error::OutOfBounds {
            what,
            len,
            offset,
            size,
        }),
    }
}

objc_protocol!(pub struct MTLResource: NSObject = "MTLResource");
objc_methods! { impl MTLResource {
    pub fn label(&self) -> Option<NSString> = "label";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    /// Raw `MTLStorageMode`; see [`StorageMode::from_raw`].
    pub fn storage_mode(&self) -> usize = "storageMode";
    pub fn resource_options(&self) -> ResourceOptions = "resourceOptions";
    pub fn allocated_size(&self) -> usize = "allocatedSize";
}}

objc_protocol!(pub struct MTLBuffer: MTLResource = "MTLBuffer");
objc_methods! { impl MTLBuffer {
    pub fn length(&self) -> usize = "length";
    /// NULL for private storage; otherwise `length` bytes valid while the buffer is alive.
    fn contents(&self) -> Ptr = "contents";
    /// Managed storage only: tells Metal the CPU wrote this range.
    pub fn did_modify_range(&self, range: Range) = "didModifyRange:";
}}

impl MTLBuffer {
    /// Copies `bytes` into the buffer's CPU-visible storage at `offset`. For a
    /// managed buffer the caller follows up with [`did_modify_range`](Self::did_modify_range).
    pub(crate) fn copy_to_contents(&self, offset: usize, bytes: &[u8]) -> Result<()> {
        let base = self.contents().0;
        if base.is_null() {
            return Err(Error::OutOfBounds {
                what: "buffer without CPU access",
                len: 0,
                offset,
                size: bytes.len(),
            });
        }
        check_range("buffer write", self.length(), offset, bytes.len())?;
        // SAFETY: `-contents` points at `-length` bytes that stay valid and
        // CPU-writable while `self` is alive (shared/managed storage; private
        // storage returned NULL above); the range was checked against that
        // length and `bytes` cannot overlap a Metal allocation.
        unsafe {
            core::ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                base.cast::<u8>().cast_mut().add(offset),
                bytes.len(),
            );
        }
        Ok(())
    }

    /// Copies `len` bytes out of the buffer's CPU-visible storage at `offset`.
    /// For a managed buffer the GPU's writes are only visible after a blit
    /// `synchronizeResource:` has completed.
    pub(crate) fn copy_from_contents(&self, offset: usize, len: usize) -> Result<Vec<u8>> {
        let base = self.contents().0;
        if base.is_null() {
            return Err(Error::OutOfBounds {
                what: "buffer without CPU access",
                len: 0,
                offset,
                size: len,
            });
        }
        check_range("buffer read", self.length(), offset, len)?;
        let mut out = Vec::<u8>::with_capacity(len);
        // SAFETY: as in `copy_to_contents`; `out` has room for `len` bytes and
        // they are all written before `set_len`.
        unsafe {
            core::ptr::copy_nonoverlapping(base.cast::<u8>().add(offset), out.as_mut_ptr(), len);
            out.set_len(len);
        }
        Ok(out)
    }
}

objc_protocol!(pub struct MTLTexture: MTLResource = "MTLTexture");
objc_methods! { impl MTLTexture {
    /// Raw `MTLTextureType`.
    pub fn texture_type(&self) -> usize = "textureType";
    /// Raw `MTLPixelFormat`; see [`PixelFormat::from_raw`].
    pub fn pixel_format(&self) -> usize = "pixelFormat";
    pub fn width(&self) -> usize = "width";
    pub fn height(&self) -> usize = "height";
    pub fn depth(&self) -> usize = "depth";
    pub fn mipmap_level_count(&self) -> usize = "mipmapLevelCount";
    pub fn sample_count(&self) -> usize = "sampleCount";
    pub fn array_length(&self) -> usize = "arrayLength";
    pub fn usage(&self) -> TextureUsage = "usage";
    pub fn is_framebuffer_only(&self) -> bool = "isFramebufferOnly";
    fn replace_region_raw(&self, region: Region, level: usize, bytes: Ptr, bytes_per_row: usize)
        = "replaceRegion:mipmapLevel:withBytes:bytesPerRow:";
    fn get_bytes_raw(&self, bytes: Ptr, bytes_per_row: usize, region: Region, level: usize)
        = "getBytes:bytesPerRow:fromRegion:mipmapLevel:";
}}

impl MTLTexture {
    /// Bytes Metal reads or writes for `region` at `bytes_per_row`: whole
    /// rows for all but the last, which needs its texels whatever
    /// `bytes_per_row` says. A format this file does not name counts as the
    /// widest there is (16 bytes), so the check only ever errs towards asking
    /// for more.
    fn region_byte_len(&self, region: Region, bytes_per_row: usize) -> usize {
        let texel =
            PixelFormat::from_raw(self.pixel_format()).map_or(16, PixelFormat::bytes_per_texel);
        (|| {
            let rows = region.size.h.checked_mul(region.size.d.max(1))?;
            if rows == 0 {
                return Some(0);
            }
            let last_row = region.size.w.checked_mul(texel)?;
            (rows - 1).checked_mul(bytes_per_row)?.checked_add(last_row)
        })()
        .unwrap_or(usize::MAX)
    }

    /// Uploads `bytes` into `region` of mipmap `level` (shared/managed storage
    /// only), after checking the slice covers what Metal will read.
    pub(crate) fn replace_region(
        &self,
        region: Region,
        level: usize,
        bytes: &[u8],
        bytes_per_row: usize,
    ) -> Result<()> {
        let need = self.region_byte_len(region, bytes_per_row);
        if bytes.len() < need {
            return Err(Error::OutOfBounds {
                what: "texture upload",
                len: bytes.len(),
                offset: 0,
                size: need,
            });
        }
        self.replace_region_raw(region, level, Ptr(bytes.as_ptr().cast()), bytes_per_row);
        Ok(())
    }

    /// Reads `region` of mipmap `level` into `bytes` (shared/managed storage
    /// only; a managed texture needs a completed blit synchronize first).
    pub(crate) fn get_bytes(
        &self,
        bytes: &mut [u8],
        bytes_per_row: usize,
        region: Region,
        level: usize,
    ) -> Result<()> {
        let need = self.region_byte_len(region, bytes_per_row);
        if bytes.len() < need {
            return Err(Error::OutOfBounds {
                what: "texture readback",
                len: bytes.len(),
                offset: 0,
                size: need,
            });
        }
        self.get_bytes_raw(
            Ptr(bytes.as_mut_ptr().cast::<c_void>().cast_const()),
            bytes_per_row,
            region,
            level,
        );
        Ok(())
    }
}

objc_class!(pub struct MTLTextureDescriptor: NSObject = "MTLTextureDescriptor");
objc_methods! { impl MTLTextureDescriptor {
    // pub fn new() -> Retained<MTLTextureDescriptor> = "new";
    pub fn texture_2d(format: PixelFormat, width: usize, height: usize, mipmapped: bool) -> MTLTextureDescriptor
        = "texture2DDescriptorWithPixelFormat:width:height:mipmapped:";
    // pub fn set_texture_type(&self, kind: TextureType) = "setTextureType:";
    // pub fn set_pixel_format(&self, format: PixelFormat) = "setPixelFormat:";
    // pub fn set_width(&self, width: usize) = "setWidth:";
    // pub fn set_height(&self, height: usize) = "setHeight:";
    // pub fn set_depth(&self, depth: usize) = "setDepth:";
    // pub fn set_mipmap_level_count(&self, count: usize) = "setMipmapLevelCount:";
    // pub fn set_sample_count(&self, count: usize) = "setSampleCount:";
    // pub fn set_array_length(&self, length: usize) = "setArrayLength:";
    // pub fn set_resource_options(&self, options: ResourceOptions) = "setResourceOptions:";
    pub fn set_storage_mode(&self, mode: StorageMode) = "setStorageMode:";
    pub fn set_usage(&self, usage: TextureUsage) = "setUsage:";
}}

// ───────────────────────────── shaders ──────────────────────────────────────

objc_protocol!(pub struct MTLLibrary: NSObject = "MTLLibrary");
objc_methods! { impl MTLLibrary {
    // pub fn label(&self) -> Option<NSString> = "label";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    pub fn new_function_with_name(&self, name: &NSString) -> Retained<Option<MTLFunction>> = "newFunctionWithName:";
    /// `NSArray<NSString *>`.
    pub fn function_names(&self) -> NSArray = "functionNames";
}}

impl MTLLibrary {
    pub(crate) fn function_name_list(&self) -> Vec<String> {
        self.function_names()
            .iter()
            .filter_map(|o| o.downcast::<NSString>().ok())
            .map(|s| s.to_string_lossy())
            .collect()
    }
}

objc_protocol!(pub struct MTLFunction: NSObject = "MTLFunction");
objc_methods! { impl MTLFunction {
    // pub fn name(&self) -> NSString = "name";
    // pub fn label(&self) -> Option<NSString> = "label";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    /// Raw `MTLFunctionType`; see [`FunctionType::from_raw`].
    pub fn function_type(&self) -> usize = "functionType";
}}

objc_class!(pub struct MTLCompileOptions: NSObject = "MTLCompileOptions");
objc_methods! { impl MTLCompileOptions {
    // pub fn new() -> Retained<MTLCompileOptions> = "new";
    // /// Deprecated in macOS 15 for `mathMode` but present everywhere.
    // pub fn set_fast_math_enabled(&self, flag: bool) = "setFastMathEnabled:";
    // pub fn set_preserve_invariance(&self, flag: bool) = "setPreserveInvariance:";
}}

// ───────────────────────────── pipelines ────────────────────────────────────

objc_class!(pub struct MTLRenderPipelineDescriptor: NSObject = "MTLRenderPipelineDescriptor");
objc_methods! { impl MTLRenderPipelineDescriptor {
    pub fn new() -> Retained<MTLRenderPipelineDescriptor> = "new";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    pub fn set_vertex_function(&self, function: Option<&MTLFunction>) = "setVertexFunction:";
    pub fn set_fragment_function(&self, function: Option<&MTLFunction>) = "setFragmentFunction:";
    /// Copied by the descriptor.
    pub fn set_vertex_descriptor(&self, descriptor: Option<&MTLVertexDescriptor>) = "setVertexDescriptor:";
    pub fn color_attachments(&self) -> MTLRenderPipelineColorAttachmentDescriptorArray = "colorAttachments";
    pub fn set_depth_attachment_pixel_format(&self, format: PixelFormat) = "setDepthAttachmentPixelFormat:";
    pub fn set_stencil_attachment_pixel_format(&self, format: PixelFormat) = "setStencilAttachmentPixelFormat:";
    pub fn set_raster_sample_count(&self, count: usize) = "setRasterSampleCount:";
    // pub fn set_alpha_to_coverage_enabled(&self, flag: bool) = "setAlphaToCoverageEnabled:";
    // pub fn reset(&self) = "reset";
}}

objc_class!(pub struct MTLRenderPipelineColorAttachmentDescriptorArray: NSObject = "MTLRenderPipelineColorAttachmentDescriptorArray");
objc_methods! { impl MTLRenderPipelineColorAttachmentDescriptorArray {
    /// Lazily creates the descriptor; `index` must be below the device's color attachment limit (8).
    pub fn object_at(&self, index: usize) -> MTLRenderPipelineColorAttachmentDescriptor = "objectAtIndexedSubscript:";
}}

objc_class!(pub struct MTLRenderPipelineColorAttachmentDescriptor: NSObject = "MTLRenderPipelineColorAttachmentDescriptor");
objc_methods! { impl MTLRenderPipelineColorAttachmentDescriptor {
    pub fn set_pixel_format(&self, format: PixelFormat) = "setPixelFormat:";
    pub fn set_blending_enabled(&self, flag: bool) = "setBlendingEnabled:";
    pub fn set_source_rgb_blend_factor(&self, factor: BlendFactor) = "setSourceRGBBlendFactor:";
    pub fn set_destination_rgb_blend_factor(&self, factor: BlendFactor) = "setDestinationRGBBlendFactor:";
    pub fn set_rgb_blend_operation(&self, operation: BlendOperation) = "setRgbBlendOperation:";
    pub fn set_source_alpha_blend_factor(&self, factor: BlendFactor) = "setSourceAlphaBlendFactor:";
    pub fn set_destination_alpha_blend_factor(&self, factor: BlendFactor) = "setDestinationAlphaBlendFactor:";
    pub fn set_alpha_blend_operation(&self, operation: BlendOperation) = "setAlphaBlendOperation:";
    pub fn set_write_mask(&self, mask: ColorWriteMask) = "setWriteMask:";
}}

objc_protocol!(pub struct MTLRenderPipelineState: NSObject = "MTLRenderPipelineState");
objc_methods! { impl MTLRenderPipelineState {
    // pub fn label(&self) -> Option<NSString> = "label";
}}

objc_class!(pub struct MTLVertexDescriptor: NSObject = "MTLVertexDescriptor");
objc_methods! { impl MTLVertexDescriptor {
    // pub fn vertex_descriptor() -> MTLVertexDescriptor = "vertexDescriptor";
    pub fn new() -> Retained<MTLVertexDescriptor> = "new";
    pub fn layouts(&self) -> MTLVertexBufferLayoutDescriptorArray = "layouts";
    pub fn attributes(&self) -> MTLVertexAttributeDescriptorArray = "attributes";
    // pub fn reset(&self) = "reset";
}}

objc_class!(pub struct MTLVertexBufferLayoutDescriptorArray: NSObject = "MTLVertexBufferLayoutDescriptorArray");
objc_methods! { impl MTLVertexBufferLayoutDescriptorArray {
    /// `index` is the vertex buffer argument index (< 31).
    pub fn object_at(&self, index: usize) -> MTLVertexBufferLayoutDescriptor = "objectAtIndexedSubscript:";
}}

objc_class!(pub struct MTLVertexBufferLayoutDescriptor: NSObject = "MTLVertexBufferLayoutDescriptor");
objc_methods! { impl MTLVertexBufferLayoutDescriptor {
    pub fn set_stride(&self, stride: usize) = "setStride:";
    pub fn set_step_function(&self, function: VertexStepFunction) = "setStepFunction:";
    pub fn set_step_rate(&self, rate: usize) = "setStepRate:";
}}

objc_class!(pub struct MTLVertexAttributeDescriptorArray: NSObject = "MTLVertexAttributeDescriptorArray");
objc_methods! { impl MTLVertexAttributeDescriptorArray {
    /// `index` is the `[[attribute(n)]]` (< 31).
    pub fn object_at(&self, index: usize) -> MTLVertexAttributeDescriptor = "objectAtIndexedSubscript:";
}}

objc_class!(pub struct MTLVertexAttributeDescriptor: NSObject = "MTLVertexAttributeDescriptor");
objc_methods! { impl MTLVertexAttributeDescriptor {
    pub fn set_format(&self, format: VertexFormat) = "setFormat:";
    pub fn set_offset(&self, offset: usize) = "setOffset:";
    pub fn set_buffer_index(&self, index: usize) = "setBufferIndex:";
}}

objc_protocol!(pub struct MTLComputePipelineState: NSObject = "MTLComputePipelineState");
objc_methods! { impl MTLComputePipelineState {
    // pub fn label(&self) -> Option<NSString> = "label";
    pub fn max_total_threads_per_threadgroup(&self) -> usize = "maxTotalThreadsPerThreadgroup";
    pub fn thread_execution_width(&self) -> usize = "threadExecutionWidth";
    // pub fn static_threadgroup_memory_length(&self) -> usize = "staticThreadgroupMemoryLength";
}}

objc_class!(pub struct MTLDepthStencilDescriptor: NSObject = "MTLDepthStencilDescriptor");
objc_methods! { impl MTLDepthStencilDescriptor {
    pub fn new() -> Retained<MTLDepthStencilDescriptor> = "new";
    pub fn set_depth_compare_function(&self, function: CompareFunction) = "setDepthCompareFunction:";
    pub fn set_depth_write_enabled(&self, flag: bool) = "setDepthWriteEnabled:";
    // pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
}}

objc_protocol!(pub struct MTLDepthStencilState: NSObject = "MTLDepthStencilState");
objc_methods! { impl MTLDepthStencilState {
    // pub fn label(&self) -> Option<NSString> = "label";
}}

objc_class!(pub struct MTLSamplerDescriptor: NSObject = "MTLSamplerDescriptor");
objc_methods! { impl MTLSamplerDescriptor {
    pub fn new() -> Retained<MTLSamplerDescriptor> = "new";
    pub fn set_min_filter(&self, filter: SamplerMinMagFilter) = "setMinFilter:";
    pub fn set_mag_filter(&self, filter: SamplerMinMagFilter) = "setMagFilter:";
    pub fn set_mip_filter(&self, filter: SamplerMipFilter) = "setMipFilter:";
    /// 1 to 16.
    pub fn set_max_anisotropy(&self, samples: usize) = "setMaxAnisotropy:";
    pub fn set_s_address_mode(&self, mode: SamplerAddressMode) = "setSAddressMode:";
    pub fn set_t_address_mode(&self, mode: SamplerAddressMode) = "setTAddressMode:";
    // pub fn set_r_address_mode(&self, mode: SamplerAddressMode) = "setRAddressMode:";
    // pub fn set_normalized_coordinates(&self, flag: bool) = "setNormalizedCoordinates:";
    // pub fn set_lod_min_clamp(&self, lod: f32) = "setLodMinClamp:";
    // pub fn set_lod_max_clamp(&self, lod: f32) = "setLodMaxClamp:";
    pub fn set_compare_function(&self, function: CompareFunction) = "setCompareFunction:";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
}}

objc_protocol!(pub struct MTLSamplerState: NSObject = "MTLSamplerState");
objc_methods! { impl MTLSamplerState {
    // pub fn label(&self) -> Option<NSString> = "label";
}}

// ───────────────────────────── render passes ────────────────────────────────

objc_class!(pub struct MTLRenderPassDescriptor: NSObject = "MTLRenderPassDescriptor");
objc_methods! { impl MTLRenderPassDescriptor {
    /// A fresh autoreleased descriptor with default attachments.
    pub fn render_pass_descriptor() -> MTLRenderPassDescriptor = "renderPassDescriptor";
    pub fn color_attachments(&self) -> MTLRenderPassColorAttachmentDescriptorArray = "colorAttachments";
    /// `null_resettable`: never nil on read.
    pub fn depth_attachment(&self) -> MTLRenderPassDepthAttachmentDescriptor = "depthAttachment";
    pub fn set_depth_attachment(&self, attachment: Option<&MTLRenderPassDepthAttachmentDescriptor>) = "setDepthAttachment:";
    pub fn stencil_attachment(&self) -> MTLRenderPassStencilAttachmentDescriptor = "stencilAttachment";
    pub fn set_stencil_attachment(&self, attachment: Option<&MTLRenderPassStencilAttachmentDescriptor>) = "setStencilAttachment:";
    pub fn set_render_target_width(&self, width: usize) = "setRenderTargetWidth:";
    pub fn set_render_target_height(&self, height: usize) = "setRenderTargetHeight:";
}}

objc_class!(pub struct MTLRenderPassColorAttachmentDescriptorArray: NSObject = "MTLRenderPassColorAttachmentDescriptorArray");
objc_methods! { impl MTLRenderPassColorAttachmentDescriptorArray {
    /// Lazily creates the descriptor; `index` < 8.
    pub fn object_at(&self, index: usize) -> MTLRenderPassColorAttachmentDescriptor = "objectAtIndexedSubscript:";
}}

objc_class!(pub struct MTLRenderPassAttachmentDescriptor: NSObject = "MTLRenderPassAttachmentDescriptor");
objc_methods! { impl MTLRenderPassAttachmentDescriptor {
    pub fn texture(&self) -> Option<MTLTexture> = "texture";
    pub fn set_texture(&self, texture: Option<&MTLTexture>) = "setTexture:";
    pub fn set_level(&self, level: usize) = "setLevel:";
    pub fn set_slice(&self, slice: usize) = "setSlice:";
    pub fn resolve_texture(&self) -> Option<MTLTexture> = "resolveTexture";
    pub fn set_resolve_texture(&self, texture: Option<&MTLTexture>) = "setResolveTexture:";
    /// Raw `MTLLoadAction`.
    pub fn load_action(&self) -> usize = "loadAction";
    pub fn set_load_action(&self, action: LoadAction) = "setLoadAction:";
    /// Raw `MTLStoreAction`.
    pub fn store_action(&self) -> usize = "storeAction";
    pub fn set_store_action(&self, action: StoreAction) = "setStoreAction:";
}}

objc_class!(pub struct MTLRenderPassColorAttachmentDescriptor: MTLRenderPassAttachmentDescriptor = "MTLRenderPassColorAttachmentDescriptor");
objc_methods! { impl MTLRenderPassColorAttachmentDescriptor {
    pub fn clear_color(&self) -> ClearColor = "clearColor";
    pub fn set_clear_color(&self, color: ClearColor) = "setClearColor:";
}}

objc_class!(pub struct MTLRenderPassDepthAttachmentDescriptor: MTLRenderPassAttachmentDescriptor = "MTLRenderPassDepthAttachmentDescriptor");
objc_methods! { impl MTLRenderPassDepthAttachmentDescriptor {
    pub fn clear_depth(&self) -> f64 = "clearDepth";
    pub fn set_clear_depth(&self, depth: f64) = "setClearDepth:";
}}

objc_class!(pub struct MTLRenderPassStencilAttachmentDescriptor: MTLRenderPassAttachmentDescriptor = "MTLRenderPassStencilAttachmentDescriptor");
objc_methods! { impl MTLRenderPassStencilAttachmentDescriptor {
    pub fn set_clear_stencil(&self, value: u32) = "setClearStencil:";
}}

// ───────────────────────────── command submission ───────────────────────────

objc_protocol!(pub struct MTLCommandQueue: NSObject = "MTLCommandQueue");
objc_methods! { impl MTLCommandQueue {
    // pub fn label(&self) -> Option<NSString> = "label";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    /// +0 (autoreleased) despite making a new object. Blocks the calling
    /// thread while `maxCommandBufferCount` (64) buffers from this queue are
    /// uncommitted or still executing; nil only if the queue is unusable.
    pub fn command_buffer(&self) -> Option<MTLCommandBuffer> = "commandBuffer";
}}

objc_protocol!(pub struct MTLCommandBuffer: NSObject = "MTLCommandBuffer");
objc_methods! { impl MTLCommandBuffer {
    // pub fn label(&self) -> Option<NSString> = "label";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    pub fn render_command_encoder(&self, descriptor: &MTLRenderPassDescriptor) -> Option<MTLRenderCommandEncoder>
        = "renderCommandEncoderWithDescriptor:";
    pub fn compute_command_encoder(&self) -> Option<MTLComputeCommandEncoder> = "computeCommandEncoder";
    pub fn blit_command_encoder(&self) -> Option<MTLBlitCommandEncoder> = "blitCommandEncoder";
    /// `id<MTLDrawable>`; a `CAMetalDrawable` is one.
    pub fn present_drawable(&self, drawable: &CAMetalDrawable) = "presentDrawable:";
    // pub fn enqueue(&self) = "enqueue";
    pub fn commit(&self) = "commit";
    // pub fn wait_until_scheduled(&self) = "waitUntilScheduled";
    pub fn wait_until_completed(&self) = "waitUntilCompleted";
    /// Raw `MTLCommandBufferStatus`; see [`command_buffer_status`].
    pub fn status(&self) -> usize = "status";
    pub fn error(&self) -> Option<NSError> = "error";
    // pub fn push_debug_group(&self, name: &NSString) = "pushDebugGroup:";
    // pub fn pop_debug_group(&self) = "popDebugGroup";
    // pub fn gpu_start_time(&self) -> f64 = "GPUStartTime";
    // pub fn gpu_end_time(&self) -> f64 = "GPUEndTime";
}}

objc_protocol!(pub struct MTLCommandEncoder: NSObject = "MTLCommandEncoder");
objc_methods! { impl MTLCommandEncoder {
    // pub fn label(&self) -> Option<NSString> = "label";
    pub fn set_label(&self, label: Option<&NSString>) = "setLabel:";
    /// Required exactly once before the encoder is released or another is made on the same command buffer.
    pub fn end_encoding(&self) = "endEncoding";
    // pub fn insert_debug_signpost(&self, name: &NSString) = "insertDebugSignpost:";
    pub fn push_debug_group(&self, name: &NSString) = "pushDebugGroup:";
    pub fn pop_debug_group(&self) = "popDebugGroup";
}}

objc_protocol!(pub struct MTLRenderCommandEncoder: MTLCommandEncoder = "MTLRenderCommandEncoder");
objc_methods! { impl MTLRenderCommandEncoder {
    pub fn set_render_pipeline_state(&self, state: &MTLRenderPipelineState) = "setRenderPipelineState:";
    pub fn set_vertex_buffer(&self, buffer: Option<&MTLBuffer>, offset: usize, index: usize) = "setVertexBuffer:offset:atIndex:";
    // pub fn set_vertex_buffer_offset(&self, offset: usize, index: usize) = "setVertexBufferOffset:atIndex:";
    /// Copies `length` (≤ 4096) bytes; see [`MTLRenderCommandEncoder::set_vertex_bytes`].
    fn set_vertex_bytes_raw(&self, bytes: Ptr, length: usize, index: usize) = "setVertexBytes:length:atIndex:";
    pub fn set_vertex_texture(&self, texture: Option<&MTLTexture>, index: usize) = "setVertexTexture:atIndex:";
    pub fn set_vertex_sampler_state(&self, sampler: Option<&MTLSamplerState>, index: usize) = "setVertexSamplerState:atIndex:";
    pub fn set_fragment_buffer(&self, buffer: Option<&MTLBuffer>, offset: usize, index: usize) = "setFragmentBuffer:offset:atIndex:";
    // pub fn set_fragment_buffer_offset(&self, offset: usize, index: usize) = "setFragmentBufferOffset:atIndex:";
    fn set_fragment_bytes_raw(&self, bytes: Ptr, length: usize, index: usize) = "setFragmentBytes:length:atIndex:";
    pub fn set_fragment_texture(&self, texture: Option<&MTLTexture>, index: usize) = "setFragmentTexture:atIndex:";
    pub fn set_fragment_sampler_state(&self, sampler: Option<&MTLSamplerState>, index: usize) = "setFragmentSamplerState:atIndex:";
    pub fn set_depth_stencil_state(&self, state: Option<&MTLDepthStencilState>) = "setDepthStencilState:";
    pub fn set_cull_mode(&self, mode: CullMode) = "setCullMode:";
    pub fn set_front_facing_winding(&self, winding: Winding) = "setFrontFacingWinding:";
    // pub fn set_triangle_fill_mode(&self, mode: TriangleFillMode) = "setTriangleFillMode:";
    pub fn set_viewport(&self, viewport: Viewport) = "setViewport:";
    /// Must lie within the render target, else Metal asserts.
    pub fn set_scissor_rect(&self, rect: ScissorRect) = "setScissorRect:";
    // pub fn set_blend_color(&self, red: f32, green: f32, blue: f32, alpha: f32) = "setBlendColorRed:green:blue:alpha:";
    pub fn draw_primitives(&self, kind: PrimitiveType, start: usize, count: usize) = "drawPrimitives:vertexStart:vertexCount:";
    pub fn draw_primitives_instanced(&self, kind: PrimitiveType, start: usize, count: usize, instances: usize)
        = "drawPrimitives:vertexStart:vertexCount:instanceCount:";
    pub fn draw_indexed_primitives(&self, kind: PrimitiveType, index_count: usize, index_type: IndexType, index_buffer: &MTLBuffer, index_buffer_offset: usize)
        = "drawIndexedPrimitives:indexCount:indexType:indexBuffer:indexBufferOffset:";
    pub fn draw_indexed_primitives_instanced(&self, kind: PrimitiveType, index_count: usize, index_type: IndexType, index_buffer: &MTLBuffer, index_buffer_offset: usize, instances: usize)
        = "drawIndexedPrimitives:indexCount:indexType:indexBuffer:indexBufferOffset:instanceCount:";
}}

/// The most `set…Bytes:length:atIndex:` accepts (MTLRenderCommandEncoder.h: "for one-time-use data smaller than 4 KB").
pub(crate) const MAX_INLINE_BYTES: usize = 4096;

impl MTLRenderCommandEncoder {
    /// Copies `bytes` (≤ [`MAX_INLINE_BYTES`], caller-checked) into vertex buffer argument `index`.
    pub(crate) fn set_vertex_bytes(&self, index: usize, bytes: &[u8]) {
        self.set_vertex_bytes_raw(Ptr(bytes.as_ptr().cast()), bytes.len(), index);
    }

    /// Copies `bytes` (≤ [`MAX_INLINE_BYTES`], caller-checked) into fragment buffer argument `index`.
    pub(crate) fn set_fragment_bytes(&self, index: usize, bytes: &[u8]) {
        self.set_fragment_bytes_raw(Ptr(bytes.as_ptr().cast()), bytes.len(), index);
    }
}

objc_protocol!(pub struct MTLComputeCommandEncoder: MTLCommandEncoder = "MTLComputeCommandEncoder");
objc_methods! { impl MTLComputeCommandEncoder {
    pub fn set_compute_pipeline_state(&self, state: &MTLComputePipelineState) = "setComputePipelineState:";
    pub fn set_buffer(&self, buffer: Option<&MTLBuffer>, offset: usize, index: usize) = "setBuffer:offset:atIndex:";
    // pub fn set_buffer_offset(&self, offset: usize, index: usize) = "setBufferOffset:atIndex:";
    fn set_bytes_raw(&self, bytes: Ptr, length: usize, index: usize) = "setBytes:length:atIndex:";
    pub fn set_texture(&self, texture: Option<&MTLTexture>, index: usize) = "setTexture:atIndex:";
    pub fn set_sampler_state(&self, sampler: Option<&MTLSamplerState>, index: usize) = "setSamplerState:atIndex:";
    // pub fn set_threadgroup_memory_length(&self, length: usize, index: usize) = "setThreadgroupMemoryLength:atIndex:";
    /// Non-uniform threadgroups: needs `MTLGPUFamilyApple4`/`Mac2` (every Mac that runs macOS 11). macOS 10.13+.
    pub fn dispatch_threads(&self, threads_per_grid: Size3, threads_per_threadgroup: Size3) = "dispatchThreads:threadsPerThreadgroup:";
    pub fn dispatch_threadgroups(&self, threadgroups_per_grid: Size3, threads_per_threadgroup: Size3)
        = "dispatchThreadgroups:threadsPerThreadgroup:";
}}

impl MTLComputeCommandEncoder {
    /// Copies `bytes` (≤ [`MAX_INLINE_BYTES`], caller-checked) into buffer argument `index`.
    pub(crate) fn set_bytes(&self, index: usize, bytes: &[u8]) {
        self.set_bytes_raw(Ptr(bytes.as_ptr().cast()), bytes.len(), index);
    }
}

objc_protocol!(pub struct MTLBlitCommandEncoder: MTLCommandEncoder = "MTLBlitCommandEncoder");
objc_methods! { impl MTLBlitCommandEncoder {
    /// Ranges must lie inside both buffers, else Metal asserts; the safe layer checks.
    pub fn copy_from_buffer(&self, source: &MTLBuffer, source_offset: usize, destination: &MTLBuffer, destination_offset: usize, size: usize)
        = "copyFromBuffer:sourceOffset:toBuffer:destinationOffset:size:";
    /// Whole-texture copy between textures of the same size and format. macOS 10.15+.
    pub fn copy_from_texture(&self, source: &MTLTexture, destination: &MTLTexture) = "copyFromTexture:toTexture:";
    pub fn fill_buffer(&self, buffer: &MTLBuffer, range: Range, value: u8) = "fillBuffer:range:value:";
    pub fn generate_mipmaps(&self, texture: &MTLTexture) = "generateMipmapsForTexture:";
    /// Managed storage only: makes GPU writes visible to the CPU once the command buffer completes.
    pub fn synchronize_resource(&self, resource: &MTLResource) = "synchronizeResource:";
}}

// ───────────────────────────── on screen ────────────────────────────────────

/// A `CGColorSpaceRef` this crate holds one reference to: `CFRetain`ed on
/// receipt and released on drop like the object wrappers.
pub(crate) struct CGColorSpace(NonNull<c_void>);

impl Drop for CGColorSpace {
    fn drop(&mut self) {
        // SAFETY: we own the reference `from_raw` took.
        unsafe { (rt().cf.CFRelease)(self.0.as_ptr()) };
    }
}
// SAFETY: `CGColorSpaceRef` return, +0, nullable.
unsafe impl Ret for Option<CGColorSpace> {
    type Raw = *const c_void;
    const ENCODING: &'static str = "^{CGColorSpace=}";
    type Out = Option<CGColorSpace>;
    #[inline]
    unsafe fn from_raw(raw: *const c_void, _: &'static str) -> Option<CGColorSpace> {
        let space = NonNull::new(raw.cast_mut())?;
        // SAFETY: a live CF object just returned to us on this thread.
        unsafe { (rt().cf.CFRetain)(space.as_ptr()) };
        Some(CGColorSpace(space))
    }
}
// SAFETY: a `CGColorSpaceRef` (kept alive by the borrow for the call) or NULL.
unsafe impl Arg for Option<&CGColorSpace> {
    type Raw = *const c_void;
    const ENCODING: &'static str = "^{CGColorSpace=}";
    #[inline]
    fn to_raw(&self) -> *const c_void {
        self.map_or(core::ptr::null(), |c| c.0.as_ptr())
    }
}

objc_methods! { impl NSColorSpace {
    /// NULL for a space CoreGraphics cannot represent. macOS 10.5+.
    pub fn cg_color_space(&self) -> Option<CGColorSpace> = "CGColorSpace";
}}

objc_protocol!(pub struct CAMetalDrawable: NSObject = "CAMetalDrawable");
objc_methods! { impl CAMetalDrawable {
    pub fn texture(&self) -> MTLTexture = "texture";
    /// Prefer [`MTLCommandBuffer::present_drawable`], which waits until the buffer is scheduled.
    pub fn present(&self) = "present";
}}

objc_class!(pub struct MTKView: NSView = "MTKView");
objc_methods! { impl MTKView {
    pub fn init_with_frame_device(this: Allocated<Self>, frame: Rect, device: Option<&MTLDevice>) -> Retained<MTKView> = "initWithFrame:device:";
    /// Held weakly by the view.
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    // pub fn set_device(&self, device: Option<&MTLDevice>) = "setDevice:";
    // pub fn device(&self) -> Option<MTLDevice> = "device";
    /// Blocks until a drawable is free (up to 1 s), then nil. Same object for the rest of the current draw.
    pub fn current_drawable(&self) -> Option<CAMetalDrawable> = "currentDrawable";
    /// nil when there is no drawable; color attachment 0 targets `currentDrawable`, cleared to `clearColor`.
    pub fn current_render_pass_descriptor(&self) -> Option<MTLRenderPassDescriptor> = "currentRenderPassDescriptor";
    pub fn set_framebuffer_only(&self, flag: bool) = "setFramebufferOnly:";
    // pub fn set_presents_with_transaction(&self, flag: bool) = "setPresentsWithTransaction:";
    pub fn set_color_pixel_format(&self, format: PixelFormat) = "setColorPixelFormat:";
    // pub fn color_pixel_format(&self) -> usize = "colorPixelFormat";
    /// `PixelFormat::Invalid` (the default) means no depth texture.
    pub fn set_depth_stencil_pixel_format(&self, format: PixelFormat) = "setDepthStencilPixelFormat:";
    // pub fn depth_stencil_pixel_format(&self) -> usize = "depthStencilPixelFormat";
    // pub fn depth_stencil_texture(&self) -> Option<MTLTexture> = "depthStencilTexture";
    // pub fn set_sample_count(&self, count: usize) = "setSampleCount:";
    // pub fn sample_count(&self) -> usize = "sampleCount";
    pub fn set_clear_color(&self, color: ClearColor) = "setClearColor:";
    // pub fn clear_color(&self) -> ClearColor = "clearColor";
    // pub fn set_clear_depth(&self, depth: f64) = "setClearDepth:";
    /// The `CAMetalLayer`'s: nil (the default) sends pixels to the display unmatched. macOS 10.12+.
    pub fn set_colorspace(&self, colorspace: Option<&CGColorSpace>) = "setColorspace:";
    pub fn set_preferred_frames_per_second(&self, fps: isize) = "setPreferredFramesPerSecond:";
    // pub fn preferred_frames_per_second(&self) -> isize = "preferredFramesPerSecond";
    /// YES: draws only from `setNeedsDisplay:`; with `paused` also YES nothing draws until `draw`.
    pub fn set_enable_set_needs_display(&self, flag: bool) = "setEnableSetNeedsDisplay:";
    pub fn set_auto_resize_drawable(&self, flag: bool) = "setAutoResizeDrawable:";
    /// Pixels, not points.
    pub fn drawable_size(&self) -> Size = "drawableSize";
    // pub fn set_drawable_size(&self, size: Size) = "setDrawableSize:";
    /// Stops the view's internal display timer.
    pub fn set_paused(&self, flag: bool) = "setPaused:";
    // pub fn is_paused(&self) -> bool = "isPaused";
    /// Runs the delegate's `drawInMTKView:` synchronously.
    pub fn draw(&self) = "draw";
    // pub fn release_drawables(&self) = "releaseDrawables";
}}
