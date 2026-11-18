use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr::null;
use std::sync::OnceLock;

#[cfg(any(target_os = "macos", windows))]
use super::metal::{Context, find};
use super::{Kind, Sync};
#[cfg(not(any(target_os = "macos", windows)))]
use crate::egl::{Context, find};
use crate::webgl::gl;
use crate::webgl::glsl::Linked;

macro_rules! functions {
    (
        $name:ident
        plain { $($plain:ident $plain_name:literal ($($a:ident: $a_type:ty),*) $(-> $a_result:ty)?;)* }
        optional { $($optional:ident $optional_name:literal $suffix:literal ($($b:ident: $b_type:ty),*) $(-> $b_result:ty)?;)* }
        raw { $($raw:ident $raw_name:literal ($($c_type:ty),*) $(-> $c_result:ty)?;)* }
    ) => {
        pub struct $name {
            $($plain: unsafe extern "C" fn($($a_type),*) $(-> $a_result)?,)*
            $($optional: Option<unsafe extern "C" fn($($b_type),*) $(-> $b_result)?>,)*
            $(pub $raw: unsafe extern "C" fn($($c_type),*) $(-> $c_result)?,)*
        }

        impl $name {
            /// # Safety
            /// `find` returns the function that the specifications describe, or null.
            unsafe fn load(find: &dyn Fn(&CStr) -> *mut c_void) -> Option<$name> {
                let find = |name: &str, suffix: &str| CString::new([name, suffix].concat()).map_or(std::ptr::null_mut(), |it| find(&it));
                // SAFETY: the caller's contract.
                unsafe {
                    Some($name {
                        $($plain: std::mem::transmute::<*mut c_void, Option<unsafe extern "C" fn($($a_type),*) $(-> $a_result)?>>(find($plain_name, ""))?,)*
                        $($optional: std::mem::transmute::<*mut c_void, Option<unsafe extern "C" fn($($b_type),*) $(-> $b_result)?>>(find($optional_name, $suffix)),)*
                        $($raw: std::mem::transmute::<*mut c_void, Option<unsafe extern "C" fn($($c_type),*) $(-> $c_result)?>>(find($raw_name, ""))?,)*
                    })
                }
            }

            $(pub fn $plain(&self, $($a: $a_type),*) $(-> $a_result)? {
                // SAFETY: it only takes numbers, or a reference to as much as it reads or writes.
                unsafe { (self.$plain)($($a),*) }
            })*

            $(pub fn $optional(&self, $($b: $b_type),*) $(-> $b_result)? {
                // SAFETY: as above.
                self.$optional.map_or_else(Default::default, |it| unsafe { it($($b),*) })
            })*
        }
    };
}

for_functions!(functions Functions);

functions! {
    Own
    plain {
        attach_shader "glAttachShader" (program: u32, shader: u32);
        compile_shader "glCompileShader" (shader: u32);
        create_program "glCreateProgram" () -> u32;
        create_shader "glCreateShader" (kind: u32) -> u32;
        delete_shader "glDeleteShader" (shader: u32);
        get_programiv "glGetProgramiv" (program: u32, name: u32, value: &mut i32);
        link_program "glLinkProgram" (program: u32);
    }
    optional {}
    raw {
        get_floatv "glGetFloatv" (u32, *mut f32);
        get_integer64v "glGetInteger64v" (u32, *mut i64);
        get_integerv "glGetIntegerv" (u32, *mut i32);
        get_internalformativ "glGetInternalformativ" (u32, u32, u32, u32, *mut i32);
        get_program_info_log "glGetProgramInfoLog" (u32, u32, *mut u32, *mut u8);
        get_shader_info_log "glGetShaderInfoLog" (u32, u32, *mut u32, *mut u8);
        get_string "glGetString" (u32) -> *const c_char;
        get_stringi "glGetStringi" (u32, u32) -> *const c_char;
        get_uniform_block_index "glGetUniformBlockIndex" (u32, *const c_char) -> u32;
        get_uniform_location "glGetUniformLocation" (u32, *const c_char) -> i32;
        shader_source "glShaderSource" (u32, u32, *const *const u8, *const i32);
        transform_feedback_varyings "glTransformFeedbackVaryings" (u32, u32, *const *const c_char, u32);
    }
}

type Names = unsafe extern "C" fn(u32, *mut u32);
type Vectors = unsafe extern "C" fn(i32, u32, *const u32);
type Matrices = unsafe extern "C" fn(i32, u32, bool, *const u32);

pub struct Gl {
    functions: Functions,
    own: Own,
    /// To make and to delete, by `Kind`.
    names: Vec<[Names; 2]>,
    /// By scalar and size.
    vectors: Vec<Vectors>,
    /// By columns and rows.
    matrices: Vec<Matrices>,
}

impl std::ops::Deref for Gl {
    type Target = Functions;

    fn deref(&self) -> &Functions {
        &self.functions
    }
}

static GL: OnceLock<Option<Gl>> = OnceLock::new();

/// For a thread that has a context.
pub fn gl() -> &'static Gl {
    GL.get()
        .and_then(Option::as_ref)
        .expect("there is a context")
}

/// Makes a context for this thread.
pub fn enter() -> Option<Context> {
    let context = Context::new(std::env::var_os("BUN_DESKTOP_WEBGL").is_some())?;
    // SAFETY: the system finds the functions.
    GL.get_or_init(|| unsafe { Gl::load(&find) })
        .as_ref()
        .map(|_| context)
}

impl Gl {
    /// # Safety
    /// As `Functions::load`.
    unsafe fn load(find: &dyn Fn(&CStr) -> *mut c_void) -> Option<Gl> {
        let named = |name: String| find(&CString::new(name).unwrap_or_default());
        let kinds = [
            "Buffers",
            "Framebuffers",
            "Queries",
            "Renderbuffers",
            "Samplers",
            "Textures",
            "TransformFeedbacks",
            "VertexArrays",
        ];
        let vectors = ["f", "i", "ui"]
            .into_iter()
            .flat_map(|scalar| (1..5).map(move |size| format!("glUniform{size}{scalar}v")));
        let shape = |columns, rows| {
            if columns == rows {
                format!("{rows}")
            } else {
                format!("{columns}x{rows}")
            }
        };
        let matrices = (2..5).flat_map(|columns| {
            (2..5).map(move |rows| format!("glUniformMatrix{}fv", shape(columns, rows)))
        });
        // SAFETY: the caller's contract.
        unsafe {
            let names = |verb, kind| {
                std::mem::transmute::<*mut c_void, Option<Names>>(named(format!("gl{verb}{kind}")))
            };
            Some(Gl {
                functions: Functions::load(find)?,
                own: Own::load(find)?,
                names: kinds
                    .into_iter()
                    .map(|it| Some([names("Gen", it)?, names("Delete", it)?]))
                    .collect::<Option<_>>()?,
                vectors: vectors
                    .map(|it| std::mem::transmute::<*mut c_void, Option<Vectors>>(named(it)))
                    .collect::<Option<_>>()?,
                matrices: matrices
                    .map(|it| std::mem::transmute::<*mut c_void, Option<Matrices>>(named(it)))
                    .collect::<Option<_>>()?,
            })
        }
    }

    pub fn add(&self, kind: Kind) -> u32 {
        let mut name = 0;
        // SAFETY: there is room for one.
        unsafe { self.names[kind as usize][0](1, &raw mut name) };
        name
    }

    pub fn remove(&self, kind: Kind, mut name: u32) {
        // SAFETY: there is one.
        unsafe { self.names[kind as usize][1](1, &raw mut name) };
    }

    pub fn text(&self, name: u32) -> String {
        self.indexed_text(name, None)
    }

    pub fn extensions(&self) -> Vec<String> {
        (0..self.integer(0x821D))
            .map(|it| self.indexed_text(0x1F03, Some(it)))
            .collect()
    }

    /// `name` has at most 4 values.
    pub fn integers(&self, name: u32) -> [i32; 4] {
        let mut values = [0; 4];
        // SAFETY: there is room for them.
        unsafe { (self.own.get_integerv)(name, values.as_mut_ptr()) };
        values
    }

    pub fn large_integer(&self, name: u32) -> i64 {
        let mut values = [0; 4];
        // SAFETY: as above.
        unsafe { (self.own.get_integer64v)(name, values.as_mut_ptr()) };
        values[0]
    }

    pub fn floats(&self, name: u32) -> [f32; 4] {
        let mut values = [0.; 4];
        // SAFETY: as above.
        unsafe { (self.own.get_floatv)(name, values.as_mut_ptr()) };
        values
    }

    fn indexed_text(&self, name: u32, index: Option<u32>) -> String {
        // SAFETY: the result is null or a C string.
        unsafe {
            let text = index.map_or_else(
                || (self.own.get_string)(name),
                |it| (self.own.get_stringi)(name, it),
            );
            if text.is_null() {
                String::new()
            } else {
                CStr::from_ptr(text).to_string_lossy().into()
            }
        }
    }

    /// The most first.
    pub fn sample_counts(&self, format: u32) -> Vec<u32> {
        let (mut count, mut samples) = (0, [0; 16]);
        // SAFETY: it is told how much room there is.
        unsafe {
            (self.own.get_internalformativ)(gl::RENDERBUFFER, format, 0x9380, 1, &raw mut count);
            (self.own.get_internalformativ)(
                gl::RENDERBUFFER,
                format,
                gl::SAMPLES,
                16,
                samples.as_mut_ptr(),
            );
        }
        samples
            .iter()
            .take(count.max(0) as usize)
            .map(|it| *it as u32)
            .collect()
    }

    pub fn uniform_vectors(&self, location: i32, scalar: u32, size: u32, values: &[u32]) {
        // SAFETY: there are so many.
        unsafe {
            self.vectors[(scalar * 4 + size - 1) as usize](
                location,
                values.len() as u32 / size,
                values.as_ptr(),
            )
        };
    }

    pub fn uniform_matrices(&self, location: i32, columns: u32, rows: u32, values: &[u32]) {
        // SAFETY: there are so many.
        unsafe {
            self.matrices[(columns * 3 + rows - 8) as usize](
                location,
                values.len() as u32 / (columns * rows),
                false,
                values.as_ptr(),
            )
        };
    }

    pub fn uniform_location(&self, program: u32, name: &str) -> i32 {
        // SAFETY: it is a C string.
        CString::new(name).map_or(-1, |it| unsafe {
            (self.own.get_uniform_location)(program, it.as_ptr())
        })
    }

    pub fn uniform_block_index(&self, program: u32, name: &str) -> u32 {
        // SAFETY: it is a C string.
        CString::new(name).map_or(gl::INVALID_INDEX, |it| unsafe {
            (self.own.get_uniform_block_index)(program, it.as_ptr())
        })
    }

    /// The name of the program, or what the driver does not like.
    pub fn build(
        &self,
        Linked {
            sources, feedback, ..
        }: &Linked,
        mode: u32,
    ) -> Result<u32, String> {
        let program = self.own.create_program();
        let shaders = [
            (gl::VERTEX_SHADER, &sources[0]),
            (gl::FRAGMENT_SHADER, &sources[1]),
        ]
        .map(|(kind, source)| {
            let shader = self.own.create_shader(kind);
            // SAFETY: it is told the length.
            unsafe {
                (self.own.shader_source)(shader, 1, &source.as_ptr(), &(source.len() as i32))
            };
            self.own.compile_shader(shader);
            self.own.attach_shader(program, shader);
            shader
        });
        let captured: Vec<_> = feedback
            .iter()
            .flat_map(|it| CString::new(&*it.native_name))
            .collect();
        let pointers: Vec<_> = captured
            .iter()
            .map(|it| it.as_ptr())
            .chain([null()])
            .collect();
        // SAFETY: there are so many C strings.
        unsafe {
            (self.own.transform_feedback_varyings)(
                program,
                captured.len() as u32,
                pointers.as_ptr(),
                mode,
            )
        };
        self.own.link_program(program);
        let mut is_linked = 0;
        self.own
            .get_programiv(program, gl::LINK_STATUS, &mut is_linked);
        let log = |get: unsafe extern "C" fn(u32, u32, *mut u32, *mut u8), name| {
            let (mut text, mut length) = ([0; 1024], 0);
            // SAFETY: it is told how much room there is.
            unsafe { get(name, 1024, &raw mut length, text.as_mut_ptr()) };
            String::from_utf8_lossy(&text[..length.min(1024) as usize]).into_owned()
        };
        let complaint = (is_linked == 0).then(|| {
            log(self.own.get_shader_info_log, shaders[0])
                + &log(self.own.get_shader_info_log, shaders[1])
                + &log(self.own.get_program_info_log, program)
        });
        shaders
            .into_iter()
            .for_each(|it| self.own.delete_shader(it));
        complaint
            .inspect(|_| self.delete_program(program))
            .map_or(Ok(program), Err)
    }
}
