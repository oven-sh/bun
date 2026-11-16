//! `GPUSurfaceHandle`: the native half of `UnsafeWindowSurface` and its `GPUCanvasContext` (src/js/internal/webgpu.ts).
//!
//! A surface presents into a window the caller made (with `bun:ffi` and a windowing library, or AppKit). The JS half
//! reads the `GPUCanvasConfiguration` dictionary and keeps the current texture until `present()`.

use std::cell::RefCell;

use bun_jsc::{CallFrame, DOMExceptionCode, JSGlobalObject, JSValue, JsClass, JsResult};
use bun_webgpu::wgc::present::SurfaceError;
use bun_webgpu::{GpuError, instance, names, wgt};

use super::args;
use super::device::{DeviceRef, GPUDeviceHandle};
use super::texture::GPUTexture;

struct Configured {
    device: DeviceRef,
    config: wgt::SurfaceConfiguration<Vec<wgt::TextureFormat>>,
}

#[bun_jsc::JsClass]
pub(crate) struct GPUSurfaceHandle {
    raw: bun_webgpu::Surface,
    configured: RefCell<Option<Configured>>,
}

super::gpu_object!(GPUSurfaceHandle);

/// A window handle passed from script: a pointer from `bun:ffi` (a number) or a BigInt.
fn pointer(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<usize> {
    let address = if value.is_big_int() {
        Some(value.to_uint64_no_truncate())
    } else if value.is_number() {
        let n = value.as_number();
        (n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0).then_some(n as u64)
    } else {
        None
    };
    match address
        .and_then(|a| usize::try_from(a).ok())
        .filter(|a| *a != 0)
    {
        Some(address) => Ok(address),
        None => {
            Err(global
                .throw_type_error(format_args!("UnsafeWindowSurface: {what} is not a pointer")))
        }
    }
}

/// `createSurfaceHandle(system, windowHandle, displayHandle)`, the handles as Deno's `UnsafeWindowSurface` takes them.
#[bun_jsc::host_fn]
pub(crate) fn create_surface_handle(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [system, window_handle, display_handle] = callframe.arguments_as_array::<3>();
    let system = system.to_utf8(global)?;
    match &*system {
        #[cfg(target_vendor = "apple")]
        b"cocoa" => {
            // As in Deno: on macOS the window handle is the NSWindow, unused, and the display handle the NSView.
            pointer(global, window_handle, "windowHandle")?;
            let view = pointer(global, display_handle, "displayHandle")?;
            let view = core::ptr::NonNull::new(view as *mut core::ffi::c_void)
                .expect("pointer() rejects 0");
            // SAFETY: an unsafe API: script vouches that the view lives as long as the surface.
            match unsafe { bun_webgpu::create_surface_appkit(view) } {
                Ok(raw) => Ok(GPUSurfaceHandle {
                    raw,
                    configured: RefCell::new(None),
                }
                .to_js(global)),
                Err(message) => Err(global.throw_dom_exception(
                    DOMExceptionCode::OperationError,
                    format_args!("UnsafeWindowSurface: {message}"),
                )),
            }
        }
        other => Err(global.throw_type_error(format_args!(
            "UnsafeWindowSurface: system '{}' is not supported on this platform",
            bstr::BStr::new(other)
        ))),
    }
}

impl GPUSurfaceHandle {
    /// `configure(device, format, usage, alphaMode, width, height)`: the dictionary is read and checked in JS.
    pub(crate) fn configure(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [device, format, usage, alpha_mode, width, height] =
            callframe.arguments_as_array::<6>();
        let Some(device) = device.as_class_ref::<GPUDeviceHandle>() else {
            return Err(global.throw_type_error(format_args!(
                "GPUCanvasContext.configure: device is not a GPUDevice"
            )));
        };
        let device = DeviceRef::clone(device.state());
        let format = args::to_enum(
            global,
            format,
            "GPUCanvasConfiguration.format",
            "GPUTextureFormat",
            names::parse_texture_format,
        )?;
        device.check_format(global, format, "GPUCanvasContext.configure")?;
        let alpha_mode = match &*alpha_mode.to_utf8(global)? {
            b"opaque" => wgt::CompositeAlphaMode::Opaque,
            // Metal names CoreAnimation's premultiplied compositing "post-multiplied".
            b"premultiplied" if cfg!(target_vendor = "apple") => {
                wgt::CompositeAlphaMode::PostMultiplied
            }
            b"premultiplied" => wgt::CompositeAlphaMode::PreMultiplied,
            other => {
                return Err(global.throw_type_error(format_args!(
                    "GPUCanvasConfiguration.alphaMode: '{}' is not a valid GPUCanvasAlphaMode",
                    bstr::BStr::new(other)
                )));
            }
        };
        let config = wgt::SurfaceConfiguration {
            usage: wgt::TextureUsages::from_bits_truncate(usage.to_number(global)? as u32),
            format,
            color_space: wgt::SurfaceColorSpace::Auto,
            width: width.to_number(global)?.max(1.0) as u32,
            height: height.to_number(global)?.max(1.0) as u32,
            present_mode: wgt::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: Vec::new(),
        };
        self.discard();
        let err = instance().surface_configure(self.raw.id(), device.id(), &config);
        let failed = err.is_some();
        device.check(global, err)?;
        *self.configured.borrow_mut() = (!failed).then_some(Configured { device, config });
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn unconfigure(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.discard();
        *self.configured.borrow_mut() = None;
        Ok(JSValue::UNDEFINED)
    }

    /// Acquires the next frame. A surface that went out of date (the window resized) is configured again once.
    pub(crate) fn get_current_texture(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let configured = self.configured.borrow();
        let Some(Configured { device, config }) = configured.as_ref() else {
            return Err(global.throw_dom_exception(
                DOMExceptionCode::InvalidStateError,
                format_args!("GPUCanvasContext.getCurrentTexture: the context is not configured"),
            ));
        };
        let mut retried = false;
        loop {
            let output = match instance().surface_get_current_texture(self.raw.id(), None) {
                Ok(output) => output,
                Err(e) => {
                    device.report(global, GpuError::from_wgpu(&e))?;
                    return Err(global.throw_dom_exception(
                        DOMExceptionCode::InvalidStateError,
                        format_args!("GPUCanvasContext.getCurrentTexture: {e}"),
                    ));
                }
            };
            if let Some(id) = output.texture {
                return Ok(GPUTexture::from_surface(
                    global,
                    device,
                    bun_webgpu::Texture::new(id),
                    config.width,
                    config.height,
                    config.format,
                    config.usage.bits(),
                ));
            }
            let outdated = matches!(
                output.status,
                wgt::SurfaceStatus::Outdated | wgt::SurfaceStatus::Lost
            );
            if outdated && !retried {
                retried = true;
                device.check(
                    global,
                    instance().surface_configure(self.raw.id(), device.id(), config),
                )?;
                continue;
            }
            return Err(global.throw_dom_exception(
                DOMExceptionCode::InvalidStateError,
                format_args!(
                    "GPUCanvasContext.getCurrentTexture: the surface has no frame ({:?})",
                    output.status
                ),
            ));
        }
    }

    /// Shows the frame that `getCurrentTexture()` returned. Nothing to show is not an error: the frame drew nothing.
    pub(crate) fn present(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let configured = self.configured.borrow();
        let Some(Configured { device, .. }) = configured.as_ref() else {
            return Ok(JSValue::UNDEFINED);
        };
        match instance().surface_present(self.raw.id()) {
            Ok(_) | Err(SurfaceError::NothingToPresent) => {}
            Err(e) => device.report(global, GpuError::from_wgpu(&e))?,
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Gives back a frame that was acquired and not presented.
    fn discard(&self) {
        if self.configured.borrow().is_some() {
            let _ = instance().surface_texture_discard(self.raw.id());
        }
    }
}
