//! Shader libraries and the pipeline states built from their functions.

use super::{
    BlendFactor, BlendOperation, ColorWriteMask, Gpu, MAX_BUFFER_SLOTS, MAX_COLOR_ATTACHMENTS,
    PixelFormat, VertexFormat, VertexStepFunction, check_max, check_slot, ns_label,
};
use crate::Named;
use crate::error::{Error, Result};
use crate::objc::foundation::{NSError, NSString};
use crate::objc::metal::{
    MTLComputePipelineState, MTLFunction, MTLLibrary, MTLRenderPipelineDescriptor,
    MTLRenderPipelineState, MTLVertexDescriptor,
};
use crate::objc::{AutoreleasePool, NsStr};

/// Vertex attributes per vertex descriptor (`[[attribute(n)]]` limit).
const MAX_VERTEX_ATTRIBUTES: usize = 31;

fn ns_error_message(error: Option<NSError>) -> String {
    error.map_or_else(
        || "Metal reported failure without an error".to_owned(),
        |e| e.localized_description().to_string_lossy(),
    )
}

// ─────────────────────────────── shaders ────────────────────────────────────

/// A compiled `MTLLibrary` and the names of the functions in it.
pub struct Library {
    raw: MTLLibrary,
    names: Vec<String>,
}

/// One vertex, fragment or kernel function from a [`Library`].
#[derive(Clone)]
pub struct Function {
    raw: MTLFunction,
    name: String,
}

impl Gpu {
    /// Compiles Metal Shading Language source. The error message is the
    /// compiler log, with `program_source:line:column:` locations.
    pub fn library(&self, source: NsStr<'_>) -> Result<Library> {
        let _pool = AutoreleasePool::new();
        let raw = self
            .device()
            .new_library_with_source(&NSString::from_str(source), None)
            .map_err(|e| Error::ShaderCompile {
                message: ns_error_message(e),
            })?;
        Ok(Library {
            names: raw.function_name_list(),
            raw,
        })
    }
}

impl Library {
    pub fn function_names(&self) -> &[String] {
        &self.names
    }

    pub fn function(&self, name: &str) -> Result<Function> {
        let _pool = AutoreleasePool::new();
        match self.raw.new_function_with_name(&NSString::from(name)) {
            Some(raw) => Ok(Function {
                raw,
                name: name.to_owned(),
            }),
            None => Err(Error::NoSuchFunction {
                name: name.to_owned(),
                available: self.names.clone(),
            }),
        }
    }

    pub fn set_label(&self, label: NsStr<'_>) {
        self.raw.set_label(ns_label(label).as_ref());
    }
}

impl Function {
    pub(crate) fn raw(&self) -> &MTLFunction {
        &self.raw
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn set_label(&self, label: NsStr<'_>) {
        self.raw.set_label(ns_label(label).as_ref());
    }
}

// ─────────────────────────── render pipelines ───────────────────────────────

/// Colour attachment blending: `result = source × source_factor (op) destination × destination_factor`,
/// separately for RGB and alpha.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Blend {
    pub source_rgb: BlendFactor,
    pub destination_rgb: BlendFactor,
    pub rgb_operation: BlendOperation,
    pub source_alpha: BlendFactor,
    pub destination_alpha: BlendFactor,
    pub alpha_operation: BlendOperation,
}

impl Blend {
    /// Source-over for straight (non-premultiplied) colours.
    pub const ALPHA: Blend = Blend {
        source_rgb: BlendFactor::SourceAlpha,
        destination_rgb: BlendFactor::OneMinusSourceAlpha,
        rgb_operation: BlendOperation::Add,
        source_alpha: BlendFactor::One,
        destination_alpha: BlendFactor::OneMinusSourceAlpha,
        alpha_operation: BlendOperation::Add,
    };
    /// Source-over for premultiplied colours.
    pub const PREMULTIPLIED: Blend = Blend {
        source_rgb: BlendFactor::One,
        destination_rgb: BlendFactor::OneMinusSourceAlpha,
        rgb_operation: BlendOperation::Add,
        source_alpha: BlendFactor::One,
        destination_alpha: BlendFactor::OneMinusSourceAlpha,
        alpha_operation: BlendOperation::Add,
    };
    /// `source + destination`.
    pub const ADDITIVE: Blend = Blend {
        source_rgb: BlendFactor::One,
        destination_rgb: BlendFactor::One,
        rgb_operation: BlendOperation::Add,
        source_alpha: BlendFactor::One,
        destination_alpha: BlendFactor::One,
        alpha_operation: BlendOperation::Add,
    };
}

impl Named for Blend {
    const ALL: &'static [(&'static str, Self)] = &[
        ("alpha", Blend::ALPHA),
        ("premultiplied", Blend::PREMULTIPLIED),
        ("add", Blend::ADDITIVE),
    ];

    fn name(self) -> &'static str {
        Self::ALL
            .iter()
            .find(|(_, b)| *b == self)
            .map_or("custom", |&(n, _)| n)
    }
}

/// One `[[attribute(n)]]` input: `format` bytes at `offset` within each
/// `stride` of vertex buffer `buffer_index`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VertexAttribute {
    pub format: VertexFormat,
    pub offset: usize,
    pub buffer_index: usize,
}

/// How `[[stage_in]]` vertex data is fetched. Attribute `n` in `attributes`
/// is `[[attribute(n)]]`; every buffer the attributes name advances `stride`
/// bytes per vertex (or per instance).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VertexLayout {
    pub stride: usize,
    pub step: VertexStepFunction,
    pub attributes: Vec<VertexAttribute>,
}

impl VertexLayout {
    fn validate(&self) -> Result<()> {
        let invalid = |message: String| Err(Error::Pipeline { message });
        if self.stride == 0 {
            return Err(Error::ZeroSize("vertex layout stride"));
        }
        if !self.stride.is_multiple_of(4) {
            return invalid(format!(
                "vertex layout stride {} is not a multiple of 4",
                self.stride
            ));
        }
        if self.attributes.is_empty() {
            return invalid("vertex layout has no attributes".into());
        }
        check_max(
            "vertex attribute count",
            self.attributes.len(),
            MAX_VERTEX_ATTRIBUTES,
        )?;
        for (i, a) in self.attributes.iter().enumerate() {
            check_slot(
                "vertex attribute buffer index",
                a.buffer_index,
                MAX_BUFFER_SLOTS,
            )?;
            match a.offset.checked_add(a.format.bytes()) {
                Some(end) if end <= self.stride => {}
                _ => {
                    return invalid(format!(
                        "vertex attribute {i} ({} at offset {}) does not fit in stride {}",
                        a.format.name(),
                        a.offset,
                        self.stride
                    ));
                }
            }
        }
        Ok(())
    }

    fn descriptor(&self) -> MTLVertexDescriptor {
        let vd = MTLVertexDescriptor::new();
        let attributes = vd.attributes();
        let layouts = vd.layouts();
        for (i, a) in self.attributes.iter().enumerate() {
            let ad = attributes.object_at(i);
            ad.set_format(a.format);
            ad.set_offset(a.offset);
            ad.set_buffer_index(a.buffer_index);
            let ld = layouts.object_at(a.buffer_index);
            ld.set_stride(self.stride);
            ld.set_step_function(self.step);
            ld.set_step_rate(match self.step {
                VertexStepFunction::Constant => 0,
                VertexStepFunction::PerVertex | VertexStepFunction::PerInstance => 1,
            });
        }
        vd
    }
}

/// How to create a [`RenderPipeline`]. `color_formats` are the formats of the
/// pass's colour attachments in order, each optionally blended.
pub struct RenderPipelineDesc<'a> {
    pub vertex: &'a Function,
    pub fragment: Option<&'a Function>,
    pub color_formats: Vec<(PixelFormat, Option<Blend>)>,
    pub depth_format: Option<PixelFormat>,
    pub vertex_layout: Option<VertexLayout>,
    /// 1 for no MSAA; must match the render target's sample count.
    pub sample_count: usize,
    pub label: Option<NsStr<'a>>,
}

impl<'a> RenderPipelineDesc<'a> {
    /// One unblended colour attachment of `format`, no depth, no vertex layout.
    pub fn new(vertex: &'a Function, fragment: Option<&'a Function>, format: PixelFormat) -> Self {
        RenderPipelineDesc {
            vertex,
            fragment,
            color_formats: vec![(format, None)],
            depth_format: None,
            vertex_layout: None,
            sample_count: 1,
            label: None,
        }
    }
}

/// A `MTLRenderPipelineState` and the attachment formats it was built for,
/// which a render pass checks against its targets.
pub struct RenderPipeline {
    raw: MTLRenderPipelineState,
    color_formats: Vec<PixelFormat>,
    depth_format: Option<PixelFormat>,
    sample_count: usize,
}

impl Gpu {
    pub fn render_pipeline(&self, desc: &RenderPipelineDesc<'_>) -> Result<RenderPipeline> {
        let invalid = |message: String| Err(Error::Pipeline { message });
        check_max(
            "color attachment count",
            desc.color_formats.len(),
            MAX_COLOR_ATTACHMENTS,
        )?;
        if desc.color_formats.is_empty() && desc.depth_format.is_none() {
            return invalid("a render pipeline needs a color or depth attachment format".into());
        }
        for (format, _) in &desc.color_formats {
            if *format == PixelFormat::Invalid || format.is_depth() {
                return invalid(format!(
                    "{} is not a color attachment format",
                    format.name()
                ));
            }
        }
        if let Some(format) = desc.depth_format {
            if !format.is_depth() {
                return invalid(format!(
                    "{} is not a depth attachment format",
                    format.name()
                ));
            }
        }
        if let Some(layout) = &desc.vertex_layout {
            layout.validate()?;
        }
        let sample_count = desc.sample_count.max(1);

        let _pool = AutoreleasePool::new();
        let d = MTLRenderPipelineDescriptor::new();
        d.set_vertex_function(Some(desc.vertex.raw()));
        d.set_fragment_function(desc.fragment.map(Function::raw));
        let attachments = d.color_attachments();
        for (i, (format, blend)) in desc.color_formats.iter().enumerate() {
            let a = attachments.object_at(i);
            a.set_pixel_format(*format);
            a.set_write_mask(ColorWriteMask::ALL);
            if let Some(blend) = blend {
                a.set_blending_enabled(true);
                a.set_source_rgb_blend_factor(blend.source_rgb);
                a.set_destination_rgb_blend_factor(blend.destination_rgb);
                a.set_rgb_blend_operation(blend.rgb_operation);
                a.set_source_alpha_blend_factor(blend.source_alpha);
                a.set_destination_alpha_blend_factor(blend.destination_alpha);
                a.set_alpha_blend_operation(blend.alpha_operation);
            }
        }
        if let Some(format) = desc.depth_format {
            d.set_depth_attachment_pixel_format(format);
            if format == PixelFormat::Depth32FloatStencil8 {
                d.set_stencil_attachment_pixel_format(format);
            }
        }
        if let Some(layout) = &desc.vertex_layout {
            d.set_vertex_descriptor(Some(&layout.descriptor()));
        }
        d.set_raster_sample_count(sample_count);
        if let Some(label) = desc.label {
            d.set_label(ns_label(label).as_ref());
        }
        let raw = self
            .device()
            .new_render_pipeline_state(&d)
            .map_err(|e| Error::Pipeline {
                message: ns_error_message(e),
            })?;
        Ok(RenderPipeline {
            raw,
            color_formats: desc.color_formats.iter().map(|(f, _)| *f).collect(),
            depth_format: desc.depth_format,
            sample_count,
        })
    }
}

impl RenderPipeline {
    pub(crate) fn raw(&self) -> &MTLRenderPipelineState {
        &self.raw
    }

    pub fn color_formats(&self) -> &[PixelFormat] {
        &self.color_formats
    }

    pub fn depth_format(&self) -> Option<PixelFormat> {
        self.depth_format
    }

    pub fn sample_count(&self) -> usize {
        self.sample_count
    }
}

// ─────────────────────────── compute pipelines ──────────────────────────────

/// A `MTLComputePipelineState` and its threadgroup limits.
pub struct ComputePipeline {
    raw: MTLComputePipelineState,
    max_threads: usize,
    width: usize,
}

impl Gpu {
    pub fn compute_pipeline(&self, function: &Function) -> Result<ComputePipeline> {
        let _pool = AutoreleasePool::new();
        let raw = self
            .device()
            .new_compute_pipeline_state(function.raw())
            .map_err(|e| Error::Pipeline {
                message: ns_error_message(e),
            })?;
        Ok(ComputePipeline {
            max_threads: raw.max_total_threads_per_threadgroup(),
            width: raw.thread_execution_width(),
            raw,
        })
    }
}

impl ComputePipeline {
    pub(crate) fn raw(&self) -> &MTLComputePipelineState {
        &self.raw
    }

    /// The most threads one threadgroup of this kernel may have.
    pub fn max_threads_per_threadgroup(&self) -> usize {
        self.max_threads
    }

    /// The SIMD width; threadgroup sizes that are a multiple waste no lanes.
    pub fn thread_execution_width(&self) -> usize {
        self.width
    }
}
