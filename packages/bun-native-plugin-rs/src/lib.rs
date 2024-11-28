#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

use std::{any::TypeId, ffi::c_void, str::Utf8Error};

pub mod sys {
    include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
}

#[repr(C)]
pub struct TaggedObject<T> {
    type_id: TypeId,
    pub(crate) object: Option<T>,
}

struct SourceCodeContext {
    source_ptr: *mut u8,
    source_len: usize,
    source_cap: usize,
}

extern "C" fn free_plugin_source_code_context(ctx: *mut c_void) {
    // SAFETY: The ctx pointer is a pointer to the `SourceCodeContext` struct we allocated.
    unsafe {
        drop(Box::from_raw(ctx as *mut SourceCodeContext));
    }
}

impl Drop for SourceCodeContext {
    fn drop(&mut self) {
        if !self.source_ptr.is_null() {
            // SAFETY: These fields come from a `String` that we allocated.
            unsafe {
                drop(String::from_raw_parts(
                    self.source_ptr,
                    self.source_len,
                    self.source_cap,
                ));
            }
        }
    }
}

pub type BunLogLevel = sys::BunLogLevel;
pub type BunLoader = sys::BunLoader;

fn get_from_raw_str(ptr: *const u8, len: usize) -> Result<&'static str> {
    // Windows allows invalid UTF-16 strings in the filesystem. These get converted to WTF-8 in Zig.
    // Meaning the string may contain invalid UTF-8, we'll have to use the safe checked version.
    #[cfg(target_os = "windows")]
    {
        Ok(std::str::from_utf8(unsafe {
            std::slice::from_raw_parts(ptr, len)
        })?)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // SAFETY: The source code comes from Zig, which uses UTF-8, so this should be safe.
        Ok(unsafe { std::str::from_utf8_unchecked(std::slice::from_raw_parts(ptr, len)) })
    }
}

#[derive(Debug, Clone)]
pub enum Error {
    Utf8(Utf8Error),
    IncompatiblePluginVersion,
    ExternalTypeMismatch,
    Unknown,
}

pub type Result<T> = std::result::Result<T, Error>;

impl From<Utf8Error> for Error {
    fn from(value: Utf8Error) -> Self {
        Self::Utf8(value)
    }
}

/// A safe handle for the arguments + result struct for the
/// `OnBeforeParse` bundler lifecycle hook.
///
/// This struct acts as a safe wrapper around the raw C API structs
/// (`sys::OnBeforeParseArguments`/`sys::OnBeforeParseResult`) needed to
/// implement the `OnBeforeParse` bundler lifecycle hook.
///
/// To initialize this struct, see the `from_raw` method.
pub struct OnBeforeParse<'a> {
    args_raw: &'a sys::OnBeforeParseArguments,
    result_raw: &'a mut sys::OnBeforeParseResult,
    compilation_context: *mut SourceCodeContext,
}

impl<'a> OnBeforeParse<'a> {
    /// Initialize this struct from references to their raw counterparts.
    ///
    /// This function will do a versioning check to ensure that the plugin
    /// is compatible with the current version of Bun. If the plugin is not
    /// compatible, it will log an error and return an error result.
    ///
    /// # Example
    /// ```rust
    /// extern "C" fn on_before_parse_impl(args: *const sys::OnBeforeParseArguments, result: *mut sys::OnBeforeParseResult) {
    ///   let args = unsafe { &*args };
    ///   let result = unsafe { &mut *result };
    ///   let handle = match OnBeforeParse::from_raw(args, result) {
    ///     Ok(handle) => handle,
    ///     Err(()) => return,
    ///   };
    /// }
    /// ```
    pub fn from_raw(
        args: &'a sys::OnBeforeParseArguments,
        result: &'a mut sys::OnBeforeParseResult,
    ) -> Result<Self> {
        if args.__struct_size < std::mem::size_of::<sys::OnBeforeParseArguments>()
            || result.__struct_size < std::mem::size_of::<sys::OnBeforeParseResult>()
        {
            let message = "This plugin is not compatible with the current version of Bun.";
            let mut log_options = sys::BunLogOptions {
                __struct_size: std::mem::size_of::<sys::BunLogOptions>(),
                message_ptr: message.as_ptr(),
                message_len: message.len(),
                path_ptr: args.path_ptr,
                path_len: args.path_len,
                source_line_text_ptr: std::ptr::null(),
                source_line_text_len: 0,
                level: BunLogLevel::BUN_LOG_LEVEL_ERROR as i8,
                line: 0,
                lineEnd: 0,
                column: 0,
                columnEnd: 0,
            };
            // SAFETY: The `log` function pointer is guaranteed to be valid by the Bun runtime.
            unsafe {
                (result.log.unwrap())(args, &mut log_options);
            }
            return Err(Error::IncompatiblePluginVersion);
        }

        Ok(Self {
            args_raw: args,
            result_raw: result,
            compilation_context: std::ptr::null_mut(),
        })
    }

    pub fn path(&self) -> Result<&'static str> {
        get_from_raw_str(self.args_raw.path_ptr, self.args_raw.path_len)
    }

    pub fn namespace(&self) -> Result<&'static str> {
        get_from_raw_str(self.args_raw.namespace_ptr, self.args_raw.namespace_len)
    }

    /// Get the external object from the `OnBeforeParse` arguments.
    ///
    /// The external object is set by the plugin definition inside of JS:
    /// ```js
    /// await Bun.build({
    ///   plugins: [
    ///     {
    ///       name: "my-plugin",
    ///       setup(builder) {
    ///         const native_plugin = require("./native_plugin.node");
    ///         const external = native_plugin.createExternal();
    ///         builder.external({ napiModule: native_plugin, symbol: 'onBeforeParse', external });
    ///       },
    ///     },
    ///   ],
    /// });
    /// ```
    ///
    /// The external object must be created from NAPI for this function to be safe!
    ///
    /// This function will return an error if the external object is not a
    /// valid tagged object for the given type.
    ///
    /// This function will return `Ok(None)` if there is no external object
    /// set.
    ///
    /// # Example
    /// The code to create the external from napi-rs:
    /// ```rs
    /// #[no_mangle]
    /// #[napi]
    /// pub fn create_my_external() -> External<MyStruct> {
    ///   let external = External::new(MyStruct::new());
    ///
    ///   external
    /// }
    /// ```
    ///
    /// The code to extract the external:
    /// ```rust
    /// let external = match handle.external::<MyStruct>() {
    ///     Ok(Some(external)) => external,
    ///     _ => {
    ///         handle.log_error("Could not get external object.");
    ///         return;
    ///     },
    /// };
    /// ```
    pub unsafe fn external<T: 'static + Sync>(&self) -> Result<Option<&'static T>> {
        if self.args_raw.external.is_null() {
            return Ok(None);
        }

        let external: *mut TaggedObject<T> = self.args_raw.external as *mut TaggedObject<T>;

        unsafe {
            if (*external).type_id != TypeId::of::<T>() {
                return Err(Error::ExternalTypeMismatch);
            }

            Ok((*external).object.as_ref())
        }
    }

    /// The same as [`crate::bun_native_plugin::OnBeforeParse::external`], but returns a mutable reference.
    pub fn external_mut<T: 'static + Sync>(&self) -> Result<Option<&mut T>> {
        if self.args_raw.external.is_null() {
            return Ok(None);
        }

        let external: *mut TaggedObject<T> = self.args_raw.external as *mut TaggedObject<T>;

        unsafe {
            if (*external).type_id != TypeId::of::<T>() {
                return Err(Error::ExternalTypeMismatch);
            }

            Ok((*external).object.as_mut())
        }
    }

    /// Get the input source code for the current file.
    ///
    /// On Windows, this function may return an `Err(Error::Utf8(...))` if the
    /// source code contains invalid UTF-8.
    pub fn input_source_code(&mut self) -> Result<&'static str> {
        let fetch_result =
            unsafe { (self.result_raw.fetchSourceCode.unwrap())(self.args_raw, self.result_raw) };

        if fetch_result != 0 {
            Err(Error::Unknown)
        } else {
            get_from_raw_str(self.result_raw.source_ptr, self.result_raw.source_len)
        }
    }

    /// Set the output source code for the current file.
    pub fn set_output_source_code(&mut self, source: String, loader: BunLoader) {
        let source_cap = source.capacity();
        let source = source.leak();
        let source_ptr = source.as_mut_ptr();
        let source_len = source.len();

        if self.compilation_context.is_null() {
            self.compilation_context = Box::into_raw(Box::new(SourceCodeContext {
                source_ptr,
                source_len,
                source_cap,
            }));
            self.result_raw.plugin_source_code_context = self.compilation_context as *mut c_void;
            self.result_raw.free_plugin_source_code_context = Some(free_plugin_source_code_context);
        } else {
            // SAFETY: We always set the compilation_context pointer before we access it.
            let context = unsafe { &mut *self.compilation_context };
            unsafe {
                drop(String::from_raw_parts(
                    context.source_ptr,
                    context.source_len,
                    context.source_cap,
                ))
            }
            context.source_ptr = source_ptr;
            context.source_len = source_len;
            context.source_cap = source_cap;
        }
        self.result_raw.loader = loader as u8;
        self.result_raw.source_ptr = source_ptr;
        self.result_raw.source_len = source_len;
    }

    /// Set the output loader for the current file.
    pub fn set_output_loader(&mut self, loader: BunLogLevel) {
        self.result_raw.loader = loader as u8;
    }

    /// Get the output loader for the current file.
    pub fn output_loader(&self) -> BunLoader {
        unsafe { std::mem::transmute(self.result_raw.loader as u32) }
    }

    /// Log an error message.
    pub fn log_error(&mut self, message: &str) {
        self.log(message, BunLogLevel::BUN_LOG_LEVEL_ERROR)
    }

    /// Log a message with the given level.
    pub fn log(&mut self, message: &str, level: BunLogLevel) {
        let mut log_options = sys::BunLogOptions {
            __struct_size: std::mem::size_of::<sys::BunLogOptions>(),
            message_ptr: message.as_ptr(),
            message_len: message.len(),
            path_ptr: self.args_raw.path_ptr,
            path_len: self.args_raw.path_len,
            source_line_text_ptr: std::ptr::null(),
            source_line_text_len: 0,
            level: level as i8,
            line: 0,
            lineEnd: 0,
            column: 0,
            columnEnd: 0,
        };
        unsafe {
            (self.result_raw.log.unwrap())(self.args_raw, &mut log_options);
        }
    }
}
