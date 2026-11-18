//! Contexts of the system's OpenGL ES or OpenGL, without a window.

use std::ffi::{CStr, c_char, c_void};
use std::ptr::{null, null_mut};
use std::sync::OnceLock;

type Handle = *mut c_void;

macro_rules! functions {
    ($($name:ident = $symbol:literal($($argument:ty),*) -> $result:ty;)*) => {
        struct Functions {
            find: unsafe extern "C" fn(*const c_char) -> Handle,
            $($name: unsafe extern "C" fn($($argument),*) -> $result,)*
        }

        impl Functions {
            fn load() -> Option<Functions> {
                // SAFETY: the signatures are those of the specifications.
                unsafe {
                    let library = Some(libc::dlopen(c"libEGL.so.1".as_ptr(), libc::RTLD_NOW)).filter(|it| !it.is_null())?;
                    let find = libc::dlsym(library, c"eglGetProcAddress".as_ptr());
                    let find = std::mem::transmute::<Handle, Option<unsafe extern "C" fn(*const c_char) -> Handle>>(find)?;
                    Some(Functions {
                        find,
                        $($name: std::mem::transmute::<Handle, Option<unsafe extern "C" fn($($argument),*) -> $result>>(find($symbol.as_ptr()))?,)*
                    })
                }
            }
        }
    };
}

functions! {
    bind_api = c"eglBindAPI"(u32) -> u32;
    create_context = c"eglCreateContext"(Handle, Handle, Handle, *const i32) -> Handle;
    destroy_context = c"eglDestroyContext"(Handle, Handle) -> u32;
    get_platform_display = c"eglGetPlatformDisplayEXT"(u32, Handle, *const i32) -> Handle;
    initialize = c"eglInitialize"(Handle, *mut i32, *mut i32) -> u32;
    make_current = c"eglMakeCurrent"(Handle, Handle, Handle, Handle) -> u32;
    query_device_string = c"eglQueryDeviceStringEXT"(Handle, i32) -> *const c_char;
    query_devices = c"eglQueryDevicesEXT"(i32, *mut Handle, *mut i32) -> u32;
    release_thread = c"eglReleaseThread"() -> u32;
}

static FUNCTIONS: OnceLock<Option<Functions>> = OnceLock::new();

fn functions() -> Option<&'static Functions> {
    FUNCTIONS
        .get_or_init(|| {
            // SAFETY: it only asks. Drivers crash if they cannot run the code they write.
            #[cfg(target_os = "linux")]
            if unsafe { libc::prctl(libc::PR_GET_MDWE, 0, 0, 0, 0) } > 0 {
                return None;
            }
            Functions::load()
        })
        .as_ref()
}

/// A function of OpenGL, or null.
pub fn find(name: &CStr) -> Handle {
    // SAFETY: it is a C string.
    functions().map_or(null_mut(), |it| unsafe { (it.find)(name.as_ptr()) })
}

pub struct Context {
    egl: &'static Functions,
    /// There is one for each device, which all contexts share, so it stays.
    display: Handle,
    handle: Handle,
}

impl Context {
    /// For OpenGL ES 3, with robust access, and lost when the GPU is reset. It is current.
    pub fn new(takes_software: bool) -> Option<Context> {
        const DEVICE: u32 = 0x313F;
        const EXTENSIONS: i32 = 0x3055;
        const OPENGL_ES: u32 = 0x30A0;
        let attributes = [0x3098, 3, 0x30BF, 1, 0x3138, 0x31BF, 0x3038];
        // It takes files to find them, which a sandbox takes away.
        static DEVICES: OnceLock<Vec<usize>> = OnceLock::new();
        if !takes_software
            && DEVICES.get().is_none()
            && !["/dev/dri", "/dev/nvidiactl", "/dev/dxg", "/dev/mali0"]
                .iter()
                .any(|it| std::path::Path::new(it).exists())
        {
            return None;
        }
        let egl = functions()?;
        // SAFETY: handles go back to where they came from, and the list is terminated.
        unsafe {
            let query = || {
                let (mut devices, mut count) = ([null_mut(); 16], 0);
                (egl.query_devices)(16, devices.as_mut_ptr(), &mut count);
                Vec::from_iter(
                    devices[..count.clamp(0, 16) as usize]
                        .iter()
                        .map(|it| it.expose_provenance()),
                )
            };
            let devices = if crate::remote::has_gpu_for_page() {
                DEVICES.get_or_init(query).clone()
            } else {
                query()
            };
            let devices = Vec::from_iter(
                devices
                    .iter()
                    .map(|it| std::ptr::with_exposed_provenance_mut(*it)),
            );
            let (software, hardware): (Vec<_>, Vec<_>) = devices.iter().partition(|it| {
                let extensions = (egl.query_device_string)(**it, EXTENSIONS);
                !extensions.is_null()
                    && CStr::from_ptr(extensions)
                        .to_string_lossy()
                        .contains("EGL_MESA_device_software")
            });
            hardware
                .into_iter()
                .chain(software.into_iter().filter(|_| takes_software))
                .find_map(|device| {
                    let display = (egl.get_platform_display)(DEVICE, device, null());
                    if display.is_null()
                        || (egl.initialize)(display, null_mut(), null_mut()) == 0
                        || (egl.bind_api)(OPENGL_ES) == 0
                    {
                        return None;
                    }
                    let handle = Some((egl.create_context)(
                        display,
                        null_mut(),
                        null_mut(),
                        attributes.as_ptr(),
                    ))
                    .filter(|it| !it.is_null())?;
                    Some(Context {
                        egl,
                        display,
                        handle,
                    })
                    .filter(|it| it.set_current(true))
                })
        }
    }

    /// On this thread.
    pub fn set_current(&self, is_current: bool) -> bool {
        // SAFETY: both are alive.
        unsafe {
            (self.egl.make_current)(
                self.display,
                null_mut(),
                null_mut(),
                if is_current { self.handle } else { null_mut() },
            ) != 0
        }
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        self.set_current(false);
        // SAFETY: likewise.
        unsafe {
            (self.egl.destroy_context)(self.display, self.handle);
            (self.egl.release_thread)();
        }
    }
}
