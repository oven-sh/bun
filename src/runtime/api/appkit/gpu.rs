//! `gpu` (`AppKitGpu`) and the `Gpu*` classes: Metal through `bun_appkit::gpu`.
//! Argument types are checked here; ranges, encoder state and device limits
//! are checked by `bun_appkit`, whose errors [`throw`] turns into the
//! matching JavaScript exception (`GpuCompileError` / `GpuExecutionError`
//! for the GPU ones, `conv::throw` for the rest).

use core::cell::{Cell, Ref, RefCell};
use core::mem::ManuallyDrop;

use bun_appkit::geometry::{ClearColor, ScissorRect, Size3, Viewport};
use bun_appkit::gpu::{
    Blend, Buffer, CompareFunction, ComputePipeline, CullMode, DepthStencil, Frame, Function, Gpu,
    GpuStatus, IndexType, Library, Load, PassTarget, PixelFormat, PrimitiveType, RenderPipeline,
    RenderPipelineDesc, Sampler, SamplerAddressMode, SamplerDesc, SamplerMinMagFilter,
    SamplerMipFilter, Storage, Texture, TextureDesc, TextureUsage, VertexAttribute,
    VertexBufferLayout, VertexFormat, VertexLayout, VertexStepFunction, Winding,
};
use bun_appkit::{Color, Kind, Named, NsStr, View};
use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsClass, JsError, JsResult,
    StringJsc, Strong,
};

use super::conv::{self, JsStr};
use super::slots::{JsSlots, SlotOutcome};
use super::view::AppKitView;

use crate::generated_classes::js_AppKitView as js_view;

type What<'a> = core::fmt::Arguments<'a>;

// ──────────────────────────────── errors ─────────────────────────────────────

thread_local! {
    /// `(kind, message) => Error` from `appkit.ts`, which owns the
    /// `GpuCompileError` / `GpuExecutionError` classes. Never dropped: it
    /// lives as long as the module does.
    static MAKE_ERROR: RefCell<Option<ManuallyDrop<Strong>>> = const { RefCell::new(None) };
}

/// A `GpuCompileError` / `GpuExecutionError` instance for the GPU failures
/// (`None` for every other error): made by the factory `appkit.ts`
/// registered, or before that a plain `Error` with the matching `name`.
fn gpu_error_instance(
    global: &JSGlobalObject,
    err: &bun_appkit::Error,
) -> JsResult<Option<JSValue>> {
    use bun_appkit::Error as E;
    let (kind, name) = match err {
        E::ShaderCompile { .. } | E::Pipeline { .. } => ("compile", "GpuCompileError"),
        E::GpuExecution { .. } => ("execution", "GpuExecutionError"),
        _ => return Ok(None),
    };
    let message = bun_core::String::clone_utf8(format!("{err}").as_bytes());
    match MAKE_ERROR.with(|f| f.borrow().as_ref().map(|s| s.get())) {
        Some(make) => {
            let args = [string_to_js(global, kind)?, message.to_js(global)?];
            make.call(global, JSValue::UNDEFINED, &args).map(Some)
        }
        None => {
            let instance = message.to_error_instance(global);
            instance.put(global, b"name", string_to_js(global, name)?);
            Ok(Some(instance))
        }
    }
}

/// The JavaScript exception for a `bun_appkit` error.
fn throw(global: &JSGlobalObject, err: &bun_appkit::Error) -> JsError {
    match gpu_error_instance(global, err) {
        Ok(Some(instance)) => global.throw_value(instance),
        Ok(None) => conv::throw(global, err),
        Err(pending) => pending,
    }
}

fn check<T>(global: &JSGlobalObject, result: bun_appkit::Result<T>) -> JsResult<T> {
    result.map_err(|e| throw(global, &e))
}

// ───────────────────────────── argument readers ─────────────────────────────

fn device(global: &JSGlobalObject) -> JsResult<std::rc::Rc<Gpu>> {
    check(global, Gpu::shared())
}

/// A non-negative integer.
fn count(global: &JSGlobalObject, value: JSValue, what: What<'_>) -> JsResult<usize> {
    if value.is_number() {
        let n = value.as_number();
        if n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0 {
            return Ok(n as usize);
        }
    }
    Err(global.throw_invalid_arguments(format_args!("{what} must be a non-negative integer")))
}

/// `undefined`/`null` read as `None`.
fn optional_count(
    global: &JSGlobalObject,
    value: JSValue,
    what: What<'_>,
) -> JsResult<Option<usize>> {
    if value.is_undefined_or_null() {
        Ok(None)
    } else {
        count(global, value, what).map(Some)
    }
}

/// The bytes of an `ArrayBuffer` or any view on one. The returned view keeps
/// the JavaScript object it came from; read it before running script again.
fn bytes(global: &JSGlobalObject, value: JSValue, what: What<'_>) -> JsResult<ArrayBuffer> {
    value.as_array_buffer(global).ok_or_else(|| {
        global.throw_invalid_arguments(format_args!(
            "{what} must be an ArrayBuffer or a typed array"
        ))
    })
}

/// `new GpuBuffer()` and the like: the classes are exported for `instanceof` only.
fn not_constructible(global: &JSGlobalObject, class: &str, made_by: &str) -> bun_jsc::JsError {
    global.throw_type_error(format_args!(
        "{class} is not constructible; {made_by} creates one"
    ))
}

/// A wrapped native of class `T`.
fn peer<'a, T: JsClass + 'static>(
    global: &JSGlobalObject,
    value: JSValue,
    what: What<'_>,
    class: &str,
) -> JsResult<&'a T> {
    value
        .as_class_ref::<T>()
        .ok_or_else(|| global.throw_invalid_arguments(format_args!("{what} must be a {class}")))
}

fn optional_peer<'a, T: JsClass + 'static>(
    global: &JSGlobalObject,
    value: Option<JSValue>,
    what: What<'_>,
    class: &str,
) -> JsResult<Option<&'a T>> {
    match value {
        Some(v) if !v.is_undefined_or_null() => peer(global, v, what, class).map(Some),
        _ => Ok(None),
    }
}

/// An optional options object: absent, `null` and `undefined` have no keys.
struct Opts<'g> {
    global: &'g JSGlobalObject,
    value: Option<JSValue>,
}

impl<'g> Opts<'g> {
    fn new(global: &'g JSGlobalObject, value: JSValue, what: What<'_>) -> JsResult<Opts<'g>> {
        if value.is_undefined_or_null() {
            return Ok(Opts {
                global,
                value: None,
            });
        }
        if !value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("{what} must be an object")));
        }
        Ok(Opts {
            global,
            value: Some(value),
        })
    }

    /// `None` for a missing key and for `undefined`/`null`.
    fn get(&self, key: &'static str) -> JsResult<Option<JSValue>> {
        let Some(value) = self.value else {
            return Ok(None);
        };
        Ok(value
            .get(self.global, key)?
            .filter(|v| !v.is_undefined_or_null()))
    }

    fn count(&self, key: &'static str, what: What<'_>) -> JsResult<Option<usize>> {
        match self.get(key)? {
            Some(v) => count(self.global, v, format_args!("{what} {key}")).map(Some),
            None => Ok(None),
        }
    }

    fn boolean(&self, key: &'static str, what: What<'_>) -> JsResult<Option<bool>> {
        match self.get(key)? {
            Some(v) => conv::boolean(self.global, v, format_args!("{what} {key}")).map(Some),
            None => Ok(None),
        }
    }

    fn one_of<T: Named>(&self, key: &'static str, what: What<'_>) -> JsResult<Option<T>> {
        match self.get(key)? {
            Some(v) => conv::one_of(self.global, v, format_args!("{what} {key}")).map(Some),
            None => Ok(None),
        }
    }

    fn string(&self, key: &'static str, what: What<'_>) -> JsResult<Option<JsStr>> {
        match self.get(key)? {
            Some(v) => JsStr::new(self.global, v, format_args!("{what} {key}")).map(Some),
            None => Ok(None),
        }
    }
}

fn string_to_js(global: &JSGlobalObject, s: &str) -> JsResult<JSValue> {
    bun_core::String::borrow_utf8(s.as_bytes()).to_js(global)
}

fn strings_to_js(global: &JSGlobalObject, names: &[impl AsRef<str>]) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, names.iter(), |n| string_to_js(global, n.as_ref()))
}

/// `[x]`, `[x, y]`, `[x, y, z]` or a bare number; missing dimensions are 1.
fn size3(global: &JSGlobalObject, value: JSValue, what: What<'_>) -> JsResult<Size3> {
    if value.is_number() {
        return Ok(Size3 {
            w: count(global, value, what)?,
            h: 1,
            d: 1,
        });
    }
    if !value.is_array() {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must be a number or an [x, y?, z?] array"
        )));
    }
    let len = value.get_length(global)?;
    if !(1..=3).contains(&len) {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must have one, two or three dimensions"
        )));
    }
    let dim = |i: u32| -> JsResult<usize> {
        if u64::from(i) < len {
            count(
                global,
                value.get_index(global, i)?,
                format_args!("{what}[{i}]"),
            )
        } else {
            Ok(1)
        }
    };
    Ok(Size3 {
        w: dim(0)?,
        h: dim(1)?,
        d: dim(2)?,
    })
}

const OPAQUE_BLACK: ClearColor = ClearColor {
    r: 0.0,
    g: 0.0,
    b: 0.0,
    a: 1.0,
};

/// `[r, g, b, a]` (0–1 each) or an rgb()/hex colour string.
fn clear_color(global: &JSGlobalObject, value: JSValue, what: What<'_>) -> JsResult<ClearColor> {
    if value.is_array() {
        if value.get_length(global)? != 4 {
            return Err(
                global.throw_invalid_arguments(format_args!("{what} array form is [r, g, b, a]"))
            );
        }
        let channel = |i: u32| {
            conv::number(
                global,
                value.get_index(global, i)?,
                format_args!("{what}[{i}]"),
            )
        };
        return Ok(ClearColor {
            r: channel(0)?,
            g: channel(1)?,
            b: channel(2)?,
            a: channel(3)?,
        });
    }
    match conv::color(global, value, what)? {
        Some(Color::Rgba { r, g, b, a }) => Ok(ClearColor {
            r: f64::from(r),
            g: f64::from(g),
            b: f64::from(b),
            a: f64::from(a),
        }),
        _ => Err(global.throw_invalid_arguments(format_args!(
            "{what} must be an [r, g, b, a] array or an rgb()/hex color string"
        ))),
    }
}

/// A user-visible name kept on the wrapper so the getter answers without a
/// round trip; Metal gets its own copy for Xcode captures and error messages.
#[derive(Default)]
struct Label(RefCell<String>);

impl Label {
    fn get(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        string_to_js(global, &self.0.borrow())
    }

    /// Stores `value` and hands the NSString view to `apply`.
    fn set(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
        apply: impl FnOnce(NsStr<'_>),
    ) -> JsResult<()> {
        match conv::optional_string(global, value, format_args!("label"))? {
            Some(s) => {
                apply(s.ns());
                *self.0.borrow_mut() = s.to_utf8().into_string();
            }
            None => {
                apply(NsStr::Utf8(""));
                self.0.borrow_mut().clear();
            }
        }
        Ok(())
    }

    fn from_opts(opts: &Opts<'_>, what: What<'_>) -> JsResult<(Label, Option<JsStr>)> {
        let s = opts.string("label", what)?;
        let label = Label(RefCell::new(
            s.as_ref()
                .map(|s| s.to_utf8().into_string())
                .unwrap_or_default(),
        ));
        Ok((label, s))
    }
}

// ─────────────────────────────────── gpu ────────────────────────────────────

/// `gpu` in `bun:appkit`: the default Metal device. Nothing is loaded until a
/// property that needs the device is read.
#[bun_jsc::JsClass(no_constructor)]
pub struct AppKitGpu {
    _private: u8,
}

impl AppKitGpu {
    pub(super) fn create(global: &JSGlobalObject) -> JSValue {
        JsClass::to_js(AppKitGpu { _private: 0 }, global)
    }

    /// Whether this machine has a Metal device Bun can use.
    pub fn get_available(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(Gpu::shared().is_ok()))
    }

    pub fn get_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match Gpu::shared() {
            Ok(gpu) => string_to_js(global, gpu.name()),
            Err(_) => Ok(JSValue::NULL),
        }
    }

    pub fn get_unified_memory(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(
            Gpu::shared().is_ok_and(|gpu| gpu.has_unified_memory()),
        ))
    }

    /// `registerErrors((kind: "compile" | "execution", message) => Error)`, once, from `appkit.ts`.
    pub fn register_errors(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let make = frame.argument(0);
        if !make.is_callable() {
            return Err(
                global.throw_invalid_arguments(format_args!("registerErrors() needs a function"))
            );
        }
        MAKE_ERROR.with(|f| {
            let mut slot = f.borrow_mut();
            if let Some(old) = slot.take() {
                drop(ManuallyDrop::into_inner(old));
            }
            *slot = Some(ManuallyDrop::new(Strong::create(make, global)));
        });
        Ok(JSValue::UNDEFINED)
    }

    /// `gpu.buffer(byteLength | data, { storage, label })`.
    pub fn buffer(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.buffer()");
        let opts = Opts::new(global, frame.argument(1), format_args!("{what} options"))?;
        // Shared buffers work on every GPU, so that is the one CPU-visible mode offered.
        let storage = match opts.one_of::<Storage>("storage", what)? {
            Some(Storage::Private) => Storage::Private,
            Some(Storage::Shared | Storage::Managed) | None => Storage::Shared,
        };
        let (label, ns_label) = Label::from_opts(&opts, what)?;
        let source = frame.argument(0);
        let gpu = device(global)?;
        let buffer = if source.is_number() {
            let len = count(global, source, format_args!("{what} byteLength"))?;
            check(global, gpu.buffer_with_len(len, storage))?
        } else {
            let data = bytes(global, source, format_args!("{what} data"))?;
            check(global, gpu.buffer_from_bytes(data.byte_slice(), storage))?
        };
        if let Some(l) = &ns_label {
            buffer.set_label(l.ns());
        }
        Ok(JsClass::to_js(GpuBuffer::new(buffer, label), global))
    }

    /// `gpu.texture({ width, height, format, usage, storage, mipmapped, label })`.
    pub fn texture(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.texture()");
        let opts = Opts::new(global, frame.argument(0), format_args!("{what} options"))?;
        let required = |key: &'static str| -> JsResult<usize> {
            opts.count(key, what)?
                .ok_or_else(|| global.throw_invalid_arguments(format_args!("{what} needs a {key}")))
        };
        let width = required("width")?;
        let height = required("height")?;
        let format = opts
            .one_of::<PixelFormat>("format", what)?
            .unwrap_or(PixelFormat::BGRA8Unorm);
        let usage = match opts.get("usage")? {
            None => TextureUsage::SHADER_READ | TextureUsage::RENDER_TARGET,
            Some(list) => texture_usage(global, list, format_args!("{what} usage"))?,
        };
        let storage = opts.one_of::<Storage>("storage", what)?;
        let mipmapped = opts.boolean("mipmapped", what)?.unwrap_or(false);
        let (label, ns_label) = Label::from_opts(&opts, what)?;
        let gpu = device(global)?;
        let texture = check(
            global,
            gpu.texture(&TextureDesc {
                width,
                height,
                format,
                usage,
                storage,
                mipmapped,
                label: ns_label.as_ref().map(JsStr::ns),
            }),
        )?;
        Ok(JsClass::to_js(GpuTexture::new(texture, label), global))
    }

    /// `gpu.library(source, { label })`: compiles Metal Shading Language.
    pub fn library(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.library()");
        let source = JsStr::new(global, frame.argument(0), format_args!("{what} source"))?;
        let opts = Opts::new(global, frame.argument(1), format_args!("{what} options"))?;
        let (label, ns_label) = Label::from_opts(&opts, what)?;
        let gpu = device(global)?;
        let library = check(global, gpu.library(source.ns()))?;
        if let Some(l) = &ns_label {
            library.set_label(l.ns());
        }
        Ok(JsClass::to_js(GpuLibrary { library, label }, global))
    }

    /// `gpu.renderPipeline({ vertex, fragment, colorFormats, blend, depthFormat, vertexLayout, sampleCount, label })`.
    pub fn render_pipeline(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.renderPipeline()");
        let opts = Opts::new(global, frame.argument(0), format_args!("{what} options"))?;
        let Some(vertex) = optional_peer::<GpuFunction>(
            global,
            opts.get("vertex")?,
            format_args!("{what} vertex"),
            "GpuFunction",
        )?
        else {
            return Err(
                global.throw_invalid_arguments(format_args!("{what} needs a vertex function"))
            );
        };
        let fragment = optional_peer::<GpuFunction>(
            global,
            opts.get("fragment")?,
            format_args!("{what} fragment"),
            "GpuFunction",
        )?;
        let blend = match opts.get("blend")? {
            Some(v) if v.is_boolean() && !v.as_boolean() => None,
            Some(v) => Some(conv::one_of::<Blend>(
                global,
                v,
                format_args!("{what} blend"),
            )?),
            None => None,
        };
        let color_formats = match opts.get("colorFormats")? {
            None => vec![(PixelFormat::BGRA8Unorm, blend)],
            Some(list) => {
                if !list.is_array() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "{what} colorFormats must be an array of pixel format names"
                    )));
                }
                let mut formats = Vec::new();
                let mut iter = list.array_iterator(global)?;
                while let Some(item) = iter.next()? {
                    formats.push((
                        conv::one_of::<PixelFormat>(
                            global,
                            item,
                            format_args!("{what} colorFormats[]"),
                        )?,
                        blend,
                    ));
                }
                formats
            }
        };
        let depth_format = opts.one_of::<PixelFormat>("depthFormat", what)?;
        let vertex_layout = match opts.get("vertexLayout")? {
            None => None,
            Some(v) => Some(vertex_layout(
                global,
                v,
                format_args!("{what} vertexLayout"),
            )?),
        };
        let sample_count = opts.count("sampleCount", what)?.unwrap_or(1);
        let (label, ns_label) = Label::from_opts(&opts, what)?;
        let color_names: Vec<&'static str> = color_formats.iter().map(|(f, _)| f.name()).collect();
        let gpu = device(global)?;
        let pipeline = check(
            global,
            gpu.render_pipeline(&RenderPipelineDesc {
                vertex: &vertex.function,
                fragment: fragment.map(|f| &f.function),
                color_formats,
                depth_format,
                vertex_layout,
                sample_count,
                label: ns_label.as_ref().map(JsStr::ns),
            }),
        )?;
        Ok(JsClass::to_js(
            GpuRenderPipeline {
                pipeline,
                label,
                color_formats: color_names,
                depth_format,
            },
            global,
        ))
    }

    /// `gpu.computePipeline(fn, { label })`.
    pub fn compute_pipeline(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let what = format_args!("gpu.computePipeline()");
        let function = peer::<GpuFunction>(
            global,
            frame.argument(0),
            format_args!("{what} function"),
            "GpuFunction",
        )?;
        let opts = Opts::new(global, frame.argument(1), format_args!("{what} options"))?;
        let (label, _) = Label::from_opts(&opts, what)?;
        let gpu = device(global)?;
        let pipeline = check(global, gpu.compute_pipeline(&function.function))?;
        Ok(JsClass::to_js(
            GpuComputePipeline { pipeline, label },
            global,
        ))
    }

    /// `gpu.sampler({ filter | minFilter/magFilter, mipFilter, address | addressU/addressV, maxAnisotropy, compare, label })`.
    pub fn sampler(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.sampler()");
        let opts = Opts::new(global, frame.argument(0), format_args!("{what} options"))?;
        let mut desc = SamplerDesc::default();
        if let Some(filter) = opts.one_of::<SamplerMinMagFilter>("filter", what)? {
            desc.min_filter = filter;
            desc.mag_filter = filter;
        }
        if let Some(f) = opts.one_of("minFilter", what)? {
            desc.min_filter = f;
        }
        if let Some(f) = opts.one_of("magFilter", what)? {
            desc.mag_filter = f;
        }
        if let Some(f) = opts.one_of::<SamplerMipFilter>("mipFilter", what)? {
            desc.mip_filter = f;
        }
        if let Some(mode) = opts.one_of::<SamplerAddressMode>("address", what)? {
            desc.address_s = mode;
            desc.address_t = mode;
        }
        if let Some(mode) = opts.one_of("addressU", what)? {
            desc.address_s = mode;
        }
        if let Some(mode) = opts.one_of("addressV", what)? {
            desc.address_t = mode;
        }
        if let Some(n) = opts.count("maxAnisotropy", what)? {
            desc.max_anisotropy = n;
        }
        desc.compare = opts.one_of::<CompareFunction>("compare", what)?;
        let (label, ns_label) = Label::from_opts(&opts, what)?;
        desc.label = ns_label.as_ref().map(JsStr::ns);
        let gpu = device(global)?;
        let sampler = check(global, gpu.sampler(&desc))?;
        Ok(JsClass::to_js(GpuSampler { sampler, label }, global))
    }

    /// `gpu.depthStencil({ compare = "less", write = true, label })`.
    pub fn depth_stencil(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.depthStencil()");
        let opts = Opts::new(global, frame.argument(0), format_args!("{what} options"))?;
        let compare = opts
            .one_of("compare", what)?
            .unwrap_or(CompareFunction::Less);
        let write = opts.boolean("write", what)?.unwrap_or(true);
        let (label, _) = Label::from_opts(&opts, what)?;
        let gpu = device(global)?;
        let state = check(global, gpu.depth_stencil(compare, write))?;
        Ok(JsClass::to_js(GpuDepthStencil { state, label }, global))
    }

    /// `gpu.frame({ label })`: a command buffer for offscreen work.
    pub fn frame(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("gpu.frame()");
        let opts = Opts::new(global, frame.argument(0), format_args!("{what} options"))?;
        let (label, ns_label) = Label::from_opts(&opts, what)?;
        let gpu = device(global)?;
        let frame = check(global, gpu.frame())?;
        if let Some(l) = &ns_label {
            frame.set_label(l.ns());
        }
        Ok(JsClass::to_js(GpuFrame::with_label(frame, label), global))
    }
}

/// `["render", "read", "write"]` → usage bits.
fn texture_usage(global: &JSGlobalObject, list: JSValue, what: What<'_>) -> JsResult<TextureUsage> {
    if !list.is_array() {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must be an array of \"render\", \"read\" or \"write\""
        )));
    }
    let mut usage = TextureUsage::default();
    let mut iter = list.array_iterator(global)?;
    while let Some(item) = iter.next()? {
        let name = JsStr::new(global, item, format_args!("{what}[]"))?.to_utf8();
        usage |= match name.as_str() {
            "render" | "renderTarget" => TextureUsage::RENDER_TARGET,
            "read" | "sample" | "shaderRead" => TextureUsage::SHADER_READ,
            "write" | "shaderWrite" => TextureUsage::SHADER_WRITE,
            other => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{what}: unknown usage \"{other}\"; expected \"render\", \"read\" or \"write\""
                )));
            }
        };
    }
    Ok(usage)
}

/// `{ stride, step, attributes: [{ format, offset, index }] }` for vertex
/// buffer 0 alone, or an array of those, one per vertex buffer. `index`
/// counts on from the previous attribute when left out.
fn vertex_layout(
    global: &JSGlobalObject,
    value: JSValue,
    what: What<'_>,
) -> JsResult<VertexLayout> {
    let mut next_index = 0usize;
    let mut buffers = Vec::new();
    if value.is_array() {
        let mut iter = value.array_iterator(global)?;
        let mut b = 0usize;
        while let Some(item) = iter.next()? {
            buffers.push(vertex_buffer_layout(
                global,
                item,
                format_args!("{what}[{b}]"),
                &mut next_index,
            )?);
            b += 1;
        }
    } else {
        buffers.push(vertex_buffer_layout(global, value, what, &mut next_index)?);
    }
    Ok(VertexLayout { buffers })
}

fn vertex_buffer_layout(
    global: &JSGlobalObject,
    value: JSValue,
    what: What<'_>,
    next_index: &mut usize,
) -> JsResult<VertexBufferLayout> {
    let opts = Opts::new(global, value, what)?;
    let stride = opts
        .count("stride", what)?
        .ok_or_else(|| global.throw_invalid_arguments(format_args!("{what} needs a stride")))?;
    let step = opts
        .one_of("step", what)?
        .unwrap_or(VertexStepFunction::PerVertex);
    let Some(list) = opts.get("attributes")?.filter(|l| l.is_array()) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} attributes must be an array of {{ format, offset, index }} objects"
        )));
    };
    let mut attributes = Vec::new();
    let mut iter = list.array_iterator(global)?;
    let mut i = 0usize;
    while let Some(item) = iter.next()? {
        let attr = Opts::new(global, item, format_args!("{what} attributes[{i}]"))?;
        let format = attr
            .one_of::<VertexFormat>("format", what)?
            .ok_or_else(|| {
                global
                    .throw_invalid_arguments(format_args!("{what} attributes[{i}] needs a format"))
            })?;
        if attr.get("buffer")?.is_some() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what} attributes[{i}]: attributes do not name a buffer; describe each vertex buffer as its own {{ stride, attributes }} entry of a vertexLayout array"
            )));
        }
        let index = attr.count("index", what)?.unwrap_or(*next_index);
        *next_index = index + 1;
        attributes.push(VertexAttribute {
            index,
            format,
            offset: attr.count("offset", what)?.unwrap_or(0),
        });
        i += 1;
    }
    Ok(VertexBufferLayout {
        stride,
        step,
        attributes,
    })
}

// ──────────────────────────────── resources ──────────────────────────────────

fn destroyed(global: &JSGlobalObject, class: &str) -> JsError {
    global
        .err(
            bun_jsc::ErrorCode::INVALID_STATE,
            format_args!("{class} was destroyed"),
        )
        .throw()
}

/// A `MTLBuffer`. `destroy()` releases it ahead of garbage collection.
#[bun_jsc::JsClass]
pub struct GpuBuffer {
    buffer: RefCell<Option<Buffer>>,
    /// `allocatedSize`, reported to the collector; 0 once destroyed. Kept
    /// here because `estimated_size` may run off the main thread.
    size: Cell<usize>,
    label: Label,
}

impl GpuBuffer {
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<GpuBuffer>> {
        Err(not_constructible(global, "GpuBuffer", "gpu.buffer()"))
    }

    fn new(buffer: Buffer, label: Label) -> GpuBuffer {
        GpuBuffer {
            size: Cell::new(buffer.allocated_size()),
            buffer: RefCell::new(Some(buffer)),
            label,
        }
    }

    fn get(&self, global: &JSGlobalObject) -> JsResult<Ref<'_, Buffer>> {
        Ref::filter_map(self.buffer.borrow(), Option::as_ref)
            .map_err(|_| destroyed(global, "GpuBuffer"))
    }

    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<GpuBuffer>() + self.size.get()
    }

    pub fn get_byte_length(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            self.buffer.borrow().as_ref().map_or(0, Buffer::len) as f64,
        ))
    }

    pub fn get_storage(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        string_to_js(global, self.get(global)?.storage().name())
    }

    /// Whether a committed frame that used the buffer is still running on the GPU.
    pub fn get_in_flight(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(
            self.buffer.borrow().as_ref().is_some_and(Buffer::in_flight),
        ))
    }

    pub fn get_destroyed(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.buffer.borrow().is_none()))
    }

    /// `write(data, offset = 0)`.
    pub fn write(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("GpuBuffer.write()");
        let data = bytes(global, frame.argument(0), format_args!("{what} data"))?;
        let offset =
            optional_count(global, frame.argument(1), format_args!("{what} offset"))?.unwrap_or(0);
        let buffer = self.get(global)?;
        check(global, buffer.write(offset, data.byte_slice()))?;
        Ok(JSValue::UNDEFINED)
    }

    /// `read(offset = 0, length = rest)` → a fresh `Uint8Array`.
    pub fn read(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("GpuBuffer.read()");
        let offset =
            optional_count(global, frame.argument(0), format_args!("{what} offset"))?.unwrap_or(0);
        let buffer = self.get(global)?;
        let length = match optional_count(global, frame.argument(1), format_args!("{what} length"))?
        {
            Some(n) => n,
            None => buffer.len().saturating_sub(offset),
        };
        let out = check(global, buffer.read(offset, length))?;
        drop(buffer);
        Ok(JSUint8Array::from_bytes(global, out.into_boxed_slice()))
    }

    /// Releases the Metal buffer now. Frames already encoded keep it alive
    /// until they finish; every later use from JavaScript throws.
    pub fn destroy(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if let Ok(mut slot) = self.buffer.try_borrow_mut() {
            slot.take();
            self.size.set(0);
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }

    pub fn set_label(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        self.label.set(global, value, |l| {
            if let Some(buffer) = self.buffer.borrow().as_ref() {
                buffer.set_label(l);
            }
        })
    }
}

/// A 2D `MTLTexture`.
#[bun_jsc::JsClass]
pub struct GpuTexture {
    texture: RefCell<Option<Texture>>,
    /// As on [`GpuBuffer`].
    size: Cell<usize>,
    label: Label,
}

impl GpuTexture {
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<GpuTexture>> {
        Err(not_constructible(global, "GpuTexture", "gpu.texture()"))
    }

    fn new(texture: Texture, label: Label) -> GpuTexture {
        GpuTexture {
            size: Cell::new(texture.allocated_size()),
            texture: RefCell::new(Some(texture)),
            label,
        }
    }

    fn get(&self, global: &JSGlobalObject) -> JsResult<Ref<'_, Texture>> {
        Ref::filter_map(self.texture.borrow(), Option::as_ref)
            .map_err(|_| destroyed(global, "GpuTexture"))
    }

    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<GpuTexture>() + self.size.get()
    }

    pub fn get_width(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            self.texture.borrow().as_ref().map_or(0, Texture::width) as f64,
        ))
    }

    pub fn get_height(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            self.texture.borrow().as_ref().map_or(0, Texture::height) as f64,
        ))
    }

    pub fn get_format(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        string_to_js(global, self.get(global)?.format().name())
    }

    pub fn get_in_flight(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(
            self.texture
                .borrow()
                .as_ref()
                .is_some_and(Texture::in_flight),
        ))
    }

    pub fn get_destroyed(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.texture.borrow().is_none()))
    }

    /// `replace(data, bytesPerRow = tightly packed)`: uploads all of level 0.
    pub fn replace(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("GpuTexture.replace()");
        let data = bytes(global, frame.argument(0), format_args!("{what} data"))?;
        let bytes_per_row = optional_count(
            global,
            frame.argument(1),
            format_args!("{what} bytesPerRow"),
        )?
        .unwrap_or(0);
        let texture = self.get(global)?;
        check(global, texture.replace(data.byte_slice(), bytes_per_row))?;
        Ok(JSValue::UNDEFINED)
    }

    /// Level 0, tightly packed, after the GPU work that wrote it has completed.
    pub fn read_pixels(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let texture = self.get(global)?;
        let out = check(global, texture.read_pixels())?;
        drop(texture);
        Ok(JSUint8Array::from_bytes(global, out.into_boxed_slice()))
    }

    /// As [`GpuBuffer::destroy`].
    pub fn destroy(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if let Ok(mut slot) = self.texture.try_borrow_mut() {
            slot.take();
            self.size.set(0);
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }

    pub fn set_label(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        self.label.set(global, value, |l| {
            if let Some(texture) = self.texture.borrow().as_ref() {
                texture.set_label(l);
            }
        })
    }
}

/// A compiled `MTLLibrary`.
#[bun_jsc::JsClass]
pub struct GpuLibrary {
    library: Library,
    label: Label,
}

impl GpuLibrary {
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<GpuLibrary>> {
        Err(not_constructible(global, "GpuLibrary", "gpu.library()"))
    }

    /// `function(name)`; the error lists the names that do exist.
    pub fn function(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let name = JsStr::new(
            global,
            frame.argument(0),
            format_args!("GpuLibrary.function() name"),
        )?
        .to_utf8();
        let function = check(global, self.library.function(&name))?;
        Ok(JsClass::to_js(GpuFunction { function }, global))
    }

    pub fn get_function_names(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        strings_to_js(global, self.library.function_names())
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }

    pub fn set_label(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        self.label.set(global, value, |l| self.library.set_label(l))
    }
}

/// One shader function.
#[bun_jsc::JsClass]
pub struct GpuFunction {
    function: Function,
}

impl GpuFunction {
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<GpuFunction>> {
        Err(not_constructible(
            global,
            "GpuFunction",
            "GpuLibrary.function()",
        ))
    }

    pub fn get_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        string_to_js(global, self.function.name())
    }

    /// `"vertex"`, `"fragment"` or `"kernel"`; `null` for the other Metal function kinds.
    pub fn get_type(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self.function.kind() {
            Some(kind) => string_to_js(global, kind.name()),
            None => Ok(JSValue::NULL),
        }
    }
}

#[bun_jsc::JsClass]
pub struct GpuRenderPipeline {
    pipeline: RenderPipeline,
    label: Label,
    color_formats: Vec<&'static str>,
    depth_format: Option<PixelFormat>,
}

impl GpuRenderPipeline {
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<Box<GpuRenderPipeline>> {
        Err(not_constructible(
            global,
            "GpuRenderPipeline",
            "gpu.renderPipeline()",
        ))
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }

    pub fn get_color_formats(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        strings_to_js(global, &self.color_formats)
    }

    pub fn get_depth_format(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self.depth_format {
            Some(f) => string_to_js(global, f.name()),
            None => Ok(JSValue::NULL),
        }
    }
}

#[bun_jsc::JsClass]
pub struct GpuComputePipeline {
    pipeline: ComputePipeline,
    label: Label,
}

impl GpuComputePipeline {
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<Box<GpuComputePipeline>> {
        Err(not_constructible(
            global,
            "GpuComputePipeline",
            "gpu.computePipeline()",
        ))
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }

    pub fn get_max_total_threads_per_threadgroup(
        &self,
        _global: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            self.pipeline.max_threads_per_threadgroup() as f64,
        ))
    }

    pub fn get_thread_execution_width(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            self.pipeline.thread_execution_width() as f64
        ))
    }
}

#[bun_jsc::JsClass]
pub struct GpuSampler {
    sampler: Sampler,
    label: Label,
}

impl GpuSampler {
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<GpuSampler>> {
        Err(not_constructible(global, "GpuSampler", "gpu.sampler()"))
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }
}

#[bun_jsc::JsClass]
pub struct GpuDepthStencil {
    state: DepthStencil,
    label: Label,
}

impl GpuDepthStencil {
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<Box<GpuDepthStencil>> {
        Err(not_constructible(
            global,
            "GpuDepthStencil",
            "gpu.depthStencil()",
        ))
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }
}

// ────────────────────────────────── frame ────────────────────────────────────

/// Where a `GpuFrame` is in its life. A committed frame keeps its command
/// buffer only until a status query sees the GPU finish with it.
enum Slot {
    Live(Frame),
    /// Dropped unsubmitted because the `onFrame` handler threw.
    Dropped,
    /// Committed and finished on the GPU; `Some` is the error it failed with.
    Done(Option<bun_appkit::Error>),
}

impl Slot {
    fn live(&self) -> Option<&Frame> {
        match self {
            Slot::Live(frame) => Some(frame),
            _ => None,
        }
    }
}

/// One command buffer being encoded from JavaScript. Every encoder method
/// works on the pass the last `renderPass()`/`computePass()`/`blit()` began
/// and returns the frame; after `commit()` the frame is spent and they throw.
#[bun_jsc::JsClass]
pub struct GpuFrame {
    frame: RefCell<Slot>,
    /// `(threadExecutionWidth, maxTotalThreadsPerThreadgroup)` of the compute
    /// pipeline set last, for sizing threadgroups `dispatch()` is not given.
    group_hint: Cell<Option<(usize, usize)>>,
    label: Label,
}

/// Bind-slot arguments; the limits proper are checked by `bun_appkit`.
fn slot(global: &JSGlobalObject, value: JSValue, what: What<'_>) -> JsResult<usize> {
    count(global, value, format_args!("{what} index"))
}

impl GpuFrame {
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<GpuFrame>> {
        Err(not_constructible(
            global,
            "GpuFrame",
            "gpu.frame() and MetalView onFrame",
        ))
    }

    fn new(frame: Frame) -> GpuFrame {
        GpuFrame::with_label(frame, Label::default())
    }

    fn with_label(frame: Frame, label: Label) -> GpuFrame {
        GpuFrame {
            frame: RefCell::new(Slot::Live(frame)),
            group_hint: Cell::new(None),
            label,
        }
    }

    /// Runs `f` on the frame. Nothing in `f` may run script.
    fn with<R>(
        &self,
        global: &JSGlobalObject,
        f: impl FnOnce(&mut Frame) -> bun_appkit::Result<R>,
    ) -> JsResult<R> {
        let result = {
            let mut slot = self.frame.borrow_mut();
            match &mut *slot {
                Slot::Live(frame) => f(frame),
                Slot::Dropped => {
                    return Err(global.throw_type_error(format_args!(
                        "frame was dropped without being committed because the onFrame handler threw"
                    )));
                }
                Slot::Done(_) => Err(bun_appkit::Error::FrameState {
                    expected: "open",
                    actual: "committed",
                }),
            }
        };
        check(global, result)
    }

    /// Commits whatever the `onFrame` handler left open. Errors are reported
    /// like an exception thrown from the handler.
    /// After `onFrame` returned: commit if the handler did not, and have a
    /// GPU failure reported at the view's next frame unless JavaScript reads
    /// `gpuStatus` / `error` first.
    fn finish(&self, global: &JSGlobalObject) {
        let mut slot = self.frame.borrow_mut();
        let Slot::Live(frame) = &mut *slot else {
            return;
        };
        let result = if frame.is_committed() {
            Ok(())
        } else {
            frame.commit()
        };
        frame.watch();
        drop(slot);
        if let Err(err) = result {
            let _ = bun_jsc::task::report_error_or_terminate(global, throw(global, &err));
        }
    }

    /// Drops the command buffer unsubmitted (the handler threw), unless the
    /// handler got as far as committing it.
    fn abandon(&self) {
        let mut slot = self.frame.borrow_mut();
        if slot.live().is_some_and(|f| !f.is_committed()) {
            *slot = Slot::Dropped;
        }
    }

    /// Asks Metal where a committed frame is and, once it has finished, lets
    /// go of the command buffer and keeps only the outcome.
    fn settle(&self) {
        let mut slot = self.frame.borrow_mut();
        let outcome = match &*slot {
            Slot::Live(frame) => match frame.gpu_status() {
                GpuStatus::Completed => None,
                GpuStatus::Failed(err) => Some(err),
                GpuStatus::NotCommitted | GpuStatus::Running => return,
            },
            Slot::Dropped | Slot::Done(_) => return,
        };
        if let Slot::Live(frame) = &*slot {
            // JavaScript is looking; the uncaught-error path need not.
            frame.unwatch();
        }
        *slot = Slot::Done(outcome);
    }

    pub fn get_committed(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        let committed = match &*self.frame.borrow() {
            Slot::Live(frame) => frame.is_committed(),
            Slot::Dropped => false,
            Slot::Done(_) => true,
        };
        Ok(JSValue::js_boolean(committed))
    }

    /// `"open"`, `"in a render pass"`, …, `"committed"`, or `"dropped"`.
    pub fn get_state(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let name = match &*self.frame.borrow() {
            Slot::Live(frame) => frame.state().name(),
            Slot::Dropped => "dropped",
            Slot::Done(_) => "committed",
        };
        string_to_js(global, name)
    }

    /// `"notCommitted"`, `"running"`, `"completed"` or `"failed"`, without blocking.
    pub fn get_gpu_status(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.settle();
        let name = match &*self.frame.borrow() {
            Slot::Live(frame) if frame.is_committed() => "running",
            Slot::Live(_) | Slot::Dropped => "notCommitted",
            Slot::Done(None) => "completed",
            Slot::Done(Some(_)) => "failed",
        };
        string_to_js(global, name)
    }

    /// The `GpuExecutionError` the GPU reported for this frame, or `null`.
    pub fn get_error(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.settle();
        match &*self.frame.borrow() {
            Slot::Done(Some(err)) => Ok(gpu_error_instance(global, err)?.unwrap_or(JSValue::NULL)),
            _ => Ok(JSValue::NULL),
        }
    }

    pub fn get_label(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.label.get(global)
    }

    pub fn set_label(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        self.label.set(global, value, |l| {
            if let Some(frame) = self.frame.borrow().live() {
                frame.set_label(l);
            }
        })
    }

    // ── render pass ──

    /// `renderPass(view, { clear, depthFormat, clearDepth }?)` or
    /// `renderPass({ color, clear, depth, clearDepth })`.
    pub fn render_pass(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.renderPass()");
        let target = frame.argument(0);
        if let Some(view) = target.as_class_ref::<AppKitView>() {
            let view = view.native(global)?;
            if view.kind() != Kind::MetalView {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{what} target must be a MetalView, not a {}",
                    view.kind().name()
                )));
            }
            let opts = Opts::new(global, frame.argument(1), format_args!("{what} options"))?;
            // Left out: the first pass into the view this frame clears to the
            // view's clearColor (depth 1.0) and later ones keep what is there.
            let clear = match opts.get("clear")? {
                Some(v) if v.is_boolean() && !v.as_boolean() => Some(Load::Keep),
                Some(v) => Some(Load::Clear(clear_color(
                    global,
                    v,
                    format_args!("{what} clear"),
                )?)),
                None => None,
            };
            let depth_format = opts.one_of::<PixelFormat>("depthFormat", what)?;
            let clear_depth = match opts.get("clearDepth")? {
                Some(v) if v.is_boolean() && !v.as_boolean() => Some(Load::Keep),
                Some(v) if v.is_boolean() => Some(Load::Clear(1.0)),
                Some(v) => Some(Load::Clear(conv::number(
                    global,
                    v,
                    format_args!("{what} clearDepth"),
                )?)),
                None => None,
            };
            let surface = check(global, view.render_target(depth_format))?;
            self.with(global, |f| {
                f.begin_render_pass(&PassTarget::View {
                    surface: &surface,
                    clear,
                    clear_depth,
                })
                .map(drop)
            })?;
            return Ok(frame.this());
        }
        if !target.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what} target must be a MetalView or a {{ color, clear, depth, clearDepth }} object"
            )));
        }
        let opts = Opts::new(global, target, format_args!("{what} target"))?;
        let Some(color) = optional_peer::<GpuTexture>(
            global,
            opts.get("color")?,
            format_args!("{what} color"),
            "GpuTexture",
        )?
        else {
            return Err(
                global.throw_invalid_arguments(format_args!("{what} target needs a color texture"))
            );
        };
        // Attachments are cleared unless told otherwise (`clear: false`,
        // `clearDepth: false` keep their contents), as a MetalView pass is.
        let clear = match opts.get("clear")? {
            Some(v) if v.is_boolean() && !v.as_boolean() => None,
            Some(v) => Some(clear_color(global, v, format_args!("{what} clear"))?),
            None => Some(OPAQUE_BLACK),
        };
        let depth = optional_peer::<GpuTexture>(
            global,
            opts.get("depth")?,
            format_args!("{what} depth"),
            "GpuTexture",
        )?;
        let clear_depth = match opts.get("clearDepth")? {
            Some(v) if v.is_boolean() => v.as_boolean().then_some(1.0),
            Some(v) => Some(conv::number(global, v, format_args!("{what} clearDepth"))?),
            None => Some(1.0),
        };
        let color = color.get(global)?;
        let depth = depth.map(|d| d.get(global)).transpose()?;
        self.with(global, |f| {
            f.begin_render_pass(&PassTarget::Texture {
                color: &color,
                clear,
                depth: depth.as_deref(),
                clear_depth,
            })
            .map(drop)
        })?;
        Ok(frame.this())
    }

    /// `pipeline(renderPipeline | computePipeline)` for the open pass.
    pub fn pipeline(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let value = frame.argument(0);
        if let Some(p) = value.as_class_ref::<GpuRenderPipeline>() {
            self.with(global, |f| {
                f.current_render_pass()?.set_pipeline(&p.pipeline)
            })?;
        } else if let Some(p) = value.as_class_ref::<GpuComputePipeline>() {
            self.with(global, |f| {
                f.current_compute_pass()?.set_pipeline(&p.pipeline);
                Ok(())
            })?;
            self.group_hint.set(Some((
                p.pipeline.thread_execution_width(),
                p.pipeline.max_threads_per_threadgroup(),
            )));
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "frame.pipeline() needs a GpuRenderPipeline or a GpuComputePipeline"
            )));
        }
        Ok(frame.this())
    }

    /// `vertexBuffer(index, buffer, offset = 0)`.
    pub fn vertex_buffer(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.vertexBuffer()");
        let index = slot(global, frame.argument(0), what)?;
        let buffer = peer::<GpuBuffer>(
            global,
            frame.argument(1),
            format_args!("{what} buffer"),
            "GpuBuffer",
        )?;
        let offset =
            optional_count(global, frame.argument(2), format_args!("{what} offset"))?.unwrap_or(0);
        let buffer = buffer.get(global)?;
        self.with(global, |f| {
            f.current_render_pass()?
                .set_vertex_buffer(index, &buffer, offset)
        })?;
        Ok(frame.this())
    }

    /// `vertexBytes(index, data)`: up to 4 KB inline.
    pub fn vertex_bytes(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.vertexBytes()");
        let index = slot(global, frame.argument(0), what)?;
        let data = bytes(global, frame.argument(1), format_args!("{what} data"))?;
        self.with(global, |f| {
            f.current_render_pass()?
                .set_vertex_bytes(index, data.byte_slice())
        })?;
        Ok(frame.this())
    }

    pub fn vertex_texture(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.vertexTexture()");
        let index = slot(global, frame.argument(0), what)?;
        let texture = peer::<GpuTexture>(
            global,
            frame.argument(1),
            format_args!("{what} texture"),
            "GpuTexture",
        )?;
        let texture = texture.get(global)?;
        self.with(global, |f| {
            f.current_render_pass()?.set_vertex_texture(index, &texture)
        })?;
        Ok(frame.this())
    }

    /// `fragmentBuffer(index, buffer, offset = 0)`.
    pub fn fragment_buffer(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.fragmentBuffer()");
        let index = slot(global, frame.argument(0), what)?;
        let buffer = peer::<GpuBuffer>(
            global,
            frame.argument(1),
            format_args!("{what} buffer"),
            "GpuBuffer",
        )?;
        let offset =
            optional_count(global, frame.argument(2), format_args!("{what} offset"))?.unwrap_or(0);
        let buffer = buffer.get(global)?;
        self.with(global, |f| {
            f.current_render_pass()?
                .set_fragment_buffer(index, &buffer, offset)
        })?;
        Ok(frame.this())
    }

    pub fn fragment_bytes(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.fragmentBytes()");
        let index = slot(global, frame.argument(0), what)?;
        let data = bytes(global, frame.argument(1), format_args!("{what} data"))?;
        self.with(global, |f| {
            f.current_render_pass()?
                .set_fragment_bytes(index, data.byte_slice())
        })?;
        Ok(frame.this())
    }

    pub fn fragment_texture(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let what = format_args!("frame.fragmentTexture()");
        let index = slot(global, frame.argument(0), what)?;
        let texture = peer::<GpuTexture>(
            global,
            frame.argument(1),
            format_args!("{what} texture"),
            "GpuTexture",
        )?;
        let texture = texture.get(global)?;
        self.with(global, |f| {
            f.current_render_pass()?
                .set_fragment_texture(index, &texture)
        })?;
        Ok(frame.this())
    }

    pub fn fragment_sampler(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let what = format_args!("frame.fragmentSampler()");
        let index = slot(global, frame.argument(0), what)?;
        let sampler = peer::<GpuSampler>(
            global,
            frame.argument(1),
            format_args!("{what} sampler"),
            "GpuSampler",
        )?;
        self.with(global, |f| {
            f.current_render_pass()?
                .set_fragment_sampler(index, &sampler.sampler)
        })?;
        Ok(frame.this())
    }

    /// `viewport(x, y, width, height, near = 0, far = 1)` in pixels.
    pub fn viewport(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.viewport()");
        let arg = |i: usize, name: &str| {
            conv::number(global, frame.argument(i), format_args!("{what} {name}"))
        };
        let optional = |i: usize, name: &str, default: f64| {
            conv::optional_number(global, frame.argument(i), format_args!("{what} {name}"))
                .map(|v| v.unwrap_or(default))
        };
        let viewport = Viewport {
            x: arg(0, "x")?,
            y: arg(1, "y")?,
            w: arg(2, "width")?,
            h: arg(3, "height")?,
            znear: optional(4, "near", 0.0)?,
            zfar: optional(5, "far", 1.0)?,
        };
        self.with(global, |f| {
            f.current_render_pass()?.set_viewport(viewport);
            Ok(())
        })?;
        Ok(frame.this())
    }

    /// `scissor(x, y, width, height)` in whole pixels, inside the target.
    pub fn scissor(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.scissor()");
        let arg =
            |i: usize, name: &str| count(global, frame.argument(i), format_args!("{what} {name}"));
        let rect = ScissorRect {
            x: arg(0, "x")?,
            y: arg(1, "y")?,
            w: arg(2, "width")?,
            h: arg(3, "height")?,
        };
        self.with(global, |f| f.current_render_pass()?.set_scissor(rect))?;
        Ok(frame.this())
    }

    /// `cull("none" | "front" | "back")`.
    pub fn cull(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let mode =
            conv::one_of::<CullMode>(global, frame.argument(0), format_args!("frame.cull() mode"))?;
        self.with(global, |f| {
            f.current_render_pass()?.set_cull(mode);
            Ok(())
        })?;
        Ok(frame.this())
    }

    /// `winding("cw" | "ccw")`: which way front faces wind.
    pub fn winding(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let winding = conv::one_of::<Winding>(
            global,
            frame.argument(0),
            format_args!("frame.winding() winding"),
        )?;
        self.with(global, |f| {
            f.current_render_pass()?.set_winding(winding);
            Ok(())
        })?;
        Ok(frame.this())
    }

    pub fn depth_stencil(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let state = peer::<GpuDepthStencil>(
            global,
            frame.argument(0),
            format_args!("frame.depthStencil() state"),
            "GpuDepthStencil",
        )?;
        self.with(global, |f| {
            f.current_render_pass()?.set_depth_stencil(&state.state)
        })?;
        Ok(frame.this())
    }

    /// `draw(vertexCount, { start = 0, instances = 1, primitive = "triangle" })`.
    pub fn draw(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.draw()");
        let vertex_count = count(
            global,
            frame.argument(0),
            format_args!("{what} vertexCount"),
        )?;
        let opts = Opts::new(global, frame.argument(1), format_args!("{what} options"))?;
        let start = opts.count("start", what)?.unwrap_or(0);
        let instances = opts.count("instances", what)?.unwrap_or(1);
        let primitive = opts
            .one_of("primitive", what)?
            .unwrap_or(PrimitiveType::Triangle);
        self.with(global, |f| {
            f.current_render_pass()?
                .draw(primitive, start, vertex_count, instances)
        })?;
        Ok(frame.this())
    }

    /// `drawIndexed(indexCount, indexBuffer, { indexType = "uint16", offset = 0, instances = 1, primitive = "triangle" })`.
    pub fn draw_indexed(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.drawIndexed()");
        let index_count = count(global, frame.argument(0), format_args!("{what} indexCount"))?;
        let indexes = peer::<GpuBuffer>(
            global,
            frame.argument(1),
            format_args!("{what} indexBuffer"),
            "GpuBuffer",
        )?;
        let opts = Opts::new(global, frame.argument(2), format_args!("{what} options"))?;
        let index_type = opts.one_of("indexType", what)?.unwrap_or(IndexType::UInt16);
        let offset = opts.count("offset", what)?.unwrap_or(0);
        let instances = opts.count("instances", what)?.unwrap_or(1);
        let primitive = opts
            .one_of("primitive", what)?
            .unwrap_or(PrimitiveType::Triangle);
        let indexes = indexes.get(global)?;
        self.with(global, |f| {
            f.current_render_pass()?.draw_indexed(
                primitive,
                index_count,
                index_type,
                &indexes,
                offset,
                instances,
            )
        })?;
        Ok(frame.this())
    }

    // ── compute pass ──

    pub fn compute_pass(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.group_hint.set(None);
        self.with(global, |f| f.begin_compute_pass().map(drop))?;
        Ok(frame.this())
    }

    /// `buffer(index, buffer, offset = 0)` for the compute pass.
    pub fn buffer(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.buffer()");
        let index = slot(global, frame.argument(0), what)?;
        let buffer = peer::<GpuBuffer>(
            global,
            frame.argument(1),
            format_args!("{what} buffer"),
            "GpuBuffer",
        )?;
        let offset =
            optional_count(global, frame.argument(2), format_args!("{what} offset"))?.unwrap_or(0);
        let buffer = buffer.get(global)?;
        self.with(global, |f| {
            f.current_compute_pass()?.set_buffer(index, &buffer, offset)
        })?;
        Ok(frame.this())
    }

    pub fn bytes(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.bytes()");
        let index = slot(global, frame.argument(0), what)?;
        let data = bytes(global, frame.argument(1), format_args!("{what} data"))?;
        self.with(global, |f| {
            f.current_compute_pass()?
                .set_bytes(index, data.byte_slice())
        })?;
        Ok(frame.this())
    }

    pub fn texture(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.texture()");
        let index = slot(global, frame.argument(0), what)?;
        let texture = peer::<GpuTexture>(
            global,
            frame.argument(1),
            format_args!("{what} texture"),
            "GpuTexture",
        )?;
        let texture = texture.get(global)?;
        self.with(global, |f| {
            f.current_compute_pass()?.set_texture(index, &texture)
        })?;
        Ok(frame.this())
    }

    pub fn sampler(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.sampler()");
        let index = slot(global, frame.argument(0), what)?;
        let sampler = peer::<GpuSampler>(
            global,
            frame.argument(1),
            format_args!("{what} sampler"),
            "GpuSampler",
        )?;
        self.with(global, |f| {
            f.current_compute_pass()?
                .set_sampler(index, &sampler.sampler)
        })?;
        Ok(frame.this())
    }

    /// Threadgroup size when `dispatch()` is not told one: as many threads of
    /// the pipeline's SIMD width as fit, laid out along the grid's used axes.
    fn default_group(&self, grid: Size3) -> Size3 {
        // Without a pipeline the dispatch fails with NoPipeline anyway.
        let (width, max) = self.group_hint.get().unwrap_or((1, 1));
        if grid.h <= 1 && grid.d <= 1 {
            return Size3 {
                w: max.min(grid.w).max(1),
                h: 1,
                d: 1,
            };
        }
        let w = width.min(grid.w).max(1);
        let h = (max / w).min(grid.h).max(1);
        Size3 { w, h, d: 1 }
    }

    /// `dispatch(threads, threadsPerGroup?)`: `threads` in total; Metal splits the edges.
    pub fn dispatch(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.dispatch()");
        let grid = size3(global, frame.argument(0), format_args!("{what} threads"))?;
        let group = match frame.argument(1) {
            v if v.is_undefined_or_null() => self.default_group(grid),
            v => size3(global, v, format_args!("{what} threadsPerGroup"))?,
        };
        self.with(global, |f| {
            f.current_compute_pass()?.dispatch_threads(grid, group)
        })?;
        Ok(frame.this())
    }

    /// `dispatchGroups(groups, threadsPerGroup)`.
    pub fn dispatch_groups(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.dispatchGroups()");
        let groups = size3(global, frame.argument(0), format_args!("{what} groups"))?;
        let group = size3(
            global,
            frame.argument(1),
            format_args!("{what} threadsPerGroup"),
        )?;
        self.with(global, |f| {
            f.current_compute_pass()?
                .dispatch_threadgroups(groups, group)
        })?;
        Ok(frame.this())
    }

    // ── blit pass ──

    pub fn blit(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.with(global, |f| f.begin_blit_pass().map(drop))?;
        Ok(frame.this())
    }

    /// `copyBuffer(source, destination, { srcOffset = 0, dstOffset = 0, size = rest of source })`.
    pub fn copy_buffer(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let what = format_args!("frame.copyBuffer()");
        let source = peer::<GpuBuffer>(
            global,
            frame.argument(0),
            format_args!("{what} source"),
            "GpuBuffer",
        )?;
        let destination = peer::<GpuBuffer>(
            global,
            frame.argument(1),
            format_args!("{what} destination"),
            "GpuBuffer",
        )?;
        let opts = Opts::new(global, frame.argument(2), format_args!("{what} options"))?;
        let source_offset = opts.count("srcOffset", what)?.unwrap_or(0);
        let destination_offset = opts.count("dstOffset", what)?.unwrap_or(0);
        let source = source.get(global)?;
        let destination = destination.get(global)?;
        let size = match opts.count("size", what)? {
            Some(n) => n,
            None => source.len().saturating_sub(source_offset),
        };
        self.with(global, |f| {
            f.current_blit_pass()?.copy_buffer(
                &source,
                source_offset,
                &destination,
                destination_offset,
                size,
            )
        })?;
        Ok(frame.this())
    }

    pub fn generate_mipmaps(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let texture = peer::<GpuTexture>(
            global,
            frame.argument(0),
            format_args!("frame.generateMipmaps() texture"),
            "GpuTexture",
        )?;
        let texture = texture.get(global)?;
        self.with(global, |f| {
            f.current_blit_pass()?.generate_mipmaps(&texture)
        })?;
        Ok(frame.this())
    }

    // ── any pass ──

    /// Groups the following commands under `name` in Xcode's GPU capture.
    pub fn push_debug_group(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let name = JsStr::new(
            global,
            frame.argument(0),
            format_args!("frame.pushDebugGroup() name"),
        )?;
        self.with(global, |f| {
            match f.state() {
                bun_appkit::gpu::FrameState::InComputePass => {
                    f.current_compute_pass()?.push_debug_group(name.ns())
                }
                _ => f.current_render_pass()?.push_debug_group(name.ns()),
            }
            Ok(())
        })?;
        Ok(frame.this())
    }

    pub fn pop_debug_group(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.with(global, |f| {
            match f.state() {
                bun_appkit::gpu::FrameState::InComputePass => {
                    f.current_compute_pass()?.pop_debug_group()
                }
                _ => f.current_render_pass()?.pop_debug_group(),
            }
            Ok(())
        })?;
        Ok(frame.this())
    }

    /// Ends the open pass. Beginning another pass or committing does this too.
    pub fn end(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.with(global, |f| f.end_pass())?;
        Ok(frame.this())
    }

    /// Submits the frame (presenting the view's drawable if a view pass was encoded).
    pub fn commit(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        self.with(global, |f| f.commit())?;
        Ok(JSValue::UNDEFINED)
    }

    /// `commit()` (if not already) and block until the GPU has finished, for readbacks.
    pub fn commit_and_wait(
        &self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.with(global, |f| f.commit_and_wait())?;
        Ok(JSValue::UNDEFINED)
    }
}

// ─────────────────────────────── MetalView frames ─────────────────────────────

/// Clears [`View::begin_frame`]'s mark however `deliver_frame` returns.
struct InFrame<'a>(&'a View);

impl<'a> InFrame<'a> {
    fn new(view: &'a View) -> InFrame<'a> {
        view.begin_frame();
        InFrame(view)
    }
}

impl Drop for InFrame<'_> {
    fn drop(&mut self) {
        self.0.end_frame();
    }
}

/// Runs a MetalView's `onFrame(frame, { time, dt, width, height })` for one
/// `drawInMTKView:`. Whatever the handler leaves open is committed (and the
/// drawable presented) when it returns; if it throws, the frame is dropped
/// unsubmitted. Without a handler the view is just cleared to its `clearColor`.
/// Frames committed earlier that the GPU has since failed are reported first,
/// the way an exception thrown from the handler is.
pub(super) fn deliver_frame(slots: &JsSlots, view: &View) {
    let global = slots.global();
    let report = |err: &bun_appkit::Error| {
        let _ = bun_jsc::task::report_error_or_terminate(global, throw(global, err));
    };
    // The placeholder view of a machine without Metal never draws.
    let Ok(gpu) = Gpu::shared() else {
        return;
    };
    for err in gpu.take_errors() {
        report(&err);
    }
    let mut frame = match gpu.frame() {
        Ok(frame) => frame,
        Err(err) => return report(&err),
    };
    let _in_frame = InFrame::new(view);
    let has_handler = slots
        .this()
        .and_then(js_view::on_frame_get_cached)
        .is_some_and(|f| f.is_callable());
    if !has_handler {
        if let Ok(surface) = view.render_target(None) {
            let cleared = frame
                .begin_render_pass(&PassTarget::View {
                    surface: &surface,
                    clear: None,
                    clear_depth: None,
                })
                .map(drop)
                .and_then(|()| frame.commit());
            match cleared {
                Ok(()) => frame.watch(),
                Err(err) => report(&err),
            }
        }
        return;
    }

    let size = view.drawable_size().unwrap_or_default();
    let (time, dt) = view.frame_timing().unwrap_or_default();
    let info = JSValue::create_empty_object(global, 4);
    info.put(global, b"time", JSValue::js_number(time));
    info.put(global, b"dt", JSValue::js_number(dt));
    info.put(global, b"width", JSValue::js_number(size.width));
    info.put(global, b"height", JSValue::js_number(size.height));

    let wrapper = JsClass::to_js(GpuFrame::new(frame), global);
    let outcome = slots.call(js_view::on_frame_get_cached, &[wrapper, info]);
    if let Some(native) = wrapper.as_class_ref::<GpuFrame>() {
        match outcome {
            SlotOutcome::Threw => native.abandon(),
            SlotOutcome::Returned(_) | SlotOutcome::Skipped => native.finish(global),
        }
    }
    wrapper.ensure_still_alive();
}
