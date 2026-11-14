use core::cell::OnceCell;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::rc::Rc;

use bun_collections::smallvec::SmallVec;
use bun_core::String;
use bun_dawn_sys::{self as dawn, Chain, ComponentSwizzle, FeatureName, Ref};
use bun_jsc::bindgen::{JsHeap, JsPayload as _, JsWrapper, Result};

use super::convert::{self, optional_u32};
use super::device::{Device, HoldsMemory};
use super::idl::{self, GPUTextureFormat, GPUTextureViewDimension};
use super::{GPUTextureView, Object};

pub(crate) type GPUTexture = Object<dawn::Texture, Texture>;

pub(crate) struct Texture {
    device: Rc<Device>,
    size: dawn::Extent3D,
    mip_level_count: u32,
    sample_count: u32,
    dimension: idl::GPUTextureDimension,
    format: GPUTextureFormat,
    usage: u32,
    default_view: OnceCell<Ref<dawn::TextureView>>,
    memory_size: AtomicUsize,
}

impl Drop for Texture {
    fn drop(&mut self) {
        self.device.will_release_memory();
    }
}

fn required_feature(format: GPUTextureFormat) -> Option<FeatureName> {
    use GPUTextureFormat as F;
    let is_between = |first: F, last: F| (first as u32..=last as u32).contains(&(format as u32));
    Some(match format {
        F::Depth32floatStencil8 => FeatureName::Depth32floatStencil8,
        F::R16unorm
        | F::R16snorm
        | F::Rg16unorm
        | F::Rg16snorm
        | F::Rgba16unorm
        | F::Rgba16snorm => FeatureName::TextureFormatsTier1,
        _ if is_between(F::Bc1RgbaUnorm, F::Bc7RgbaUnormSrgb) => FeatureName::TextureCompressionBc,
        _ if is_between(F::Etc2Rgb8unorm, F::EacRg11snorm) => FeatureName::TextureCompressionEtc2,
        _ if is_between(F::Astc4x4Unorm, F::Astc12x12UnormSrgb) => {
            FeatureName::TextureCompressionAstc
        }
        _ => return None,
    })
}

impl Device {
    /// <https://gpuweb.github.io/gpuweb/#abstract-opdef-validate-texture-format-required-features>
    pub(super) fn texture_format<'a>(
        &self,
        heap: &JsHeap<'a>,
        format: GPUTextureFormat,
    ) -> Result<'a, dawn::TextureFormat> {
        if let Some(feature) = required_feature(format)
            && !self.has_feature(feature)
            && let Some(name) = format.to_js(heap)?.as_string()
        {
            let name = name.view(heap)?;
            let user = format_args!("The texture format \"{}\"", *name);
            return Err(Self::missing_feature(heap, feature, user));
        }
        Ok(format.into())
    }

    pub(super) fn optional_texture_format<'a>(
        &self,
        heap: &JsHeap<'a>,
        format: Option<GPUTextureFormat>,
    ) -> Result<'a, dawn::TextureFormat> {
        format.map_or(Ok(dawn::TextureFormat::Undefined), |format| {
            self.texture_format(heap, format)
        })
    }
}

fn swizzle(value: &[u8]) -> Option<dawn::TextureComponentSwizzle> {
    let component = |character| {
        Some(match character {
            b'r' => ComponentSwizzle::R,
            b'g' => ComponentSwizzle::G,
            b'b' => ComponentSwizzle::B,
            b'a' => ComponentSwizzle::A,
            b'0' => ComponentSwizzle::Zero,
            b'1' => ComponentSwizzle::One,
            _ => return None,
        })
    };
    let &[r, g, b, a] = value else { return None };
    Some(dawn::TextureComponentSwizzle {
        r: component(r)?,
        g: component(g)?,
        b: component(b)?,
        a: component(a)?,
    })
}

impl GPUTexture {
    pub(super) fn create<'a>(
        heap: &JsHeap<'a>,
        device: &Rc<Device>,
        descriptor: &idl::GPUTextureDescriptor,
    ) -> Result<'a, Self> {
        let size = convert::extent(heap, &descriptor.size)?;
        let format = device.texture_format(heap, descriptor.format)?;
        let view_formats = (descriptor.view_formats.iter())
            .map(|&format| device.texture_format(heap, format))
            .collect::<Result<'a, SmallVec<[_; 2]>>>()?;
        let binding_view_dimension = descriptor.texture_binding_view_dimension.map(|dimension| {
            dawn::TextureBindingViewDimension {
                chain: Default::default(),
                texture_binding_view_dimension: dimension.into(),
            }
        });
        let handle = device.dawn.create_texture(&dawn::TextureDescriptor {
            next_in_chain: (binding_view_dimension.as_ref()).map_or(Chain::END, Chain::from),
            label: convert::label(&descriptor.label.to_utf8()),
            usage: dawn::TextureUsage::from_bits(descriptor.usage),
            dimension: descriptor.dimension.into(),
            size,
            format,
            mip_level_count: descriptor.mip_level_count,
            sample_count: descriptor.sample_count,
            view_formats: (*view_formats).into(),
        });
        let state = Texture {
            device: Rc::clone(device),
            size,
            mip_level_count: descriptor.mip_level_count,
            sample_count: descriptor.sample_count,
            dimension: descriptor.dimension,
            format: descriptor.format,
            usage: descriptor.usage,
            default_view: OnceCell::new(),
            memory_size: AtomicUsize::new(handle.memory_size() as usize),
        };
        Ok(Self::with_state(handle, &descriptor.label, state))
    }

    pub(crate) fn create_view<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUTextureViewDescriptor<'a>,
    ) -> Result<'a, JsWrapper<'a, GPUTextureView>> {
        let format = (self.state.device).optional_texture_format(heap, descriptor.format)?;
        let Some(swizzle) = swizzle(descriptor.swizzle) else {
            return Err(heap.type_error(format_args!(
                "The swizzle must be four of the characters \"rgba01\". Received {}",
                bun_core::fmt::quote(descriptor.swizzle)
            )));
        };
        let swizzle = dawn::TextureComponentSwizzleDescriptor {
            chain: Default::default(),
            swizzle,
        };
        let handle = self.handle.create_view(Some(&dawn::TextureViewDescriptor {
            next_in_chain: match descriptor.swizzle {
                b"rgba" => Chain::END,
                _ => Chain::from(&swizzle),
            },
            label: convert::label(&descriptor.label.to_utf8()),
            format,
            dimension: (descriptor.dimension)
                .map_or(dawn::TextureViewDimension::Undefined, Into::into),
            base_mip_level: descriptor.base_mip_level,
            mip_level_count: optional_u32(descriptor.mip_level_count),
            base_array_layer: descriptor.base_array_layer,
            array_layer_count: optional_u32(descriptor.array_layer_count),
            aspect: descriptor.aspect.into(),
            usage: dawn::TextureUsage::from_bits(descriptor.usage),
        }));
        let state = HoldsMemory::of(&self.state.device);
        Ok(Object::with_state(handle, &descriptor.label, state).into_js(heap))
    }

    /// For where a texture is taken in place of a view.
    pub(super) fn default_view(&self) -> &dawn::TextureView {
        (self.state.default_view).get_or_init(|| self.handle.create_view(None))
    }

    pub(crate) fn destroy(&self) {
        self.handle.destroy();
        self.state.memory_size.store(0, Ordering::Relaxed);
        self.state.device.will_release_memory();
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.state.memory_size.load(Ordering::Relaxed)
    }

    pub(crate) fn get_width(&self) -> u32 {
        self.state.size.width
    }

    pub(crate) fn get_height(&self) -> u32 {
        self.state.size.height
    }

    pub(crate) fn get_depth_or_array_layers(&self) -> u32 {
        self.state.size.depth_or_array_layers
    }

    pub(crate) fn get_mip_level_count(&self) -> u32 {
        self.state.mip_level_count
    }

    pub(crate) fn get_sample_count(&self) -> u32 {
        self.state.sample_count
    }

    pub(crate) fn get_dimension(&self) -> idl::GPUTextureDimension {
        self.state.dimension
    }

    pub(crate) fn get_format(&self) -> GPUTextureFormat {
        self.state.format
    }

    pub(crate) fn get_usage(&self) -> u32 {
        self.state.usage
    }

    pub(crate) fn get_texture_binding_view_dimension(&self) -> Option<GPUTextureViewDimension> {
        Some(match self.handle.get_texture_binding_view_dimension() {
            dawn::TextureViewDimension::D1 => GPUTextureViewDimension::D1,
            dawn::TextureViewDimension::D2 => GPUTextureViewDimension::D2,
            dawn::TextureViewDimension::D2Array => GPUTextureViewDimension::D2Array,
            dawn::TextureViewDimension::Cube => GPUTextureViewDimension::Cube,
            dawn::TextureViewDimension::CubeArray => GPUTextureViewDimension::CubeArray,
            dawn::TextureViewDimension::D3 => GPUTextureViewDimension::D3,
            _ => return None,
        })
    }
}

/// It takes a video frame to make one. The class is there for `instanceof`.
pub(crate) enum GPUExternalTexture {}

impl GPUExternalTexture {
    pub(crate) fn get_label(&self) -> String {
        match *self {}
    }

    pub(crate) fn set_label(&self, _: String) {
        match *self {}
    }
}

impl<'a> idl::GPUTextureOrView<'a> {
    pub(super) fn view(&self) -> &'a dawn::TextureView {
        match *self {
            Self::Texture(texture) => texture.default_view(),
            Self::View(view) => &view.handle,
        }
    }
}
