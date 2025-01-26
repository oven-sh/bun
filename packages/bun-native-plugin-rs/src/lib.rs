//! > ⚠️ Note: This is an advanced and experimental API recommended only for plugin developers who are familiar with systems programming and the C ABI. Use with caution.
//!
//! # Bun Native Plugins
//!
//! This crate provides a Rustified wrapper over the Bun's native bundler plugin C API.
//!
//! Some advantages to _native_ bundler plugins as opposed to regular ones implemented in JS:
//!
//! - Native plugins take full advantage of Bun's parallelized bundler pipeline and run on multiple threads at the same time
//! - Unlike JS, native plugins don't need to do the UTF-8 <-> UTF-16 source code string conversions
//!
//! What are native bundler plugins exactly? Precisely, they are NAPI modules which expose a C ABI function which implement a plugin lifecycle hook.
//!
//! The currently supported lifecycle hooks are:
//!
//! - `onBeforeParse` (called immediately before a file is parsed, allows you to modify the source code of the file)
//!
//! ## Getting started
//!
//! Since native bundler plugins are NAPI modules, the easiest way to get started is to create a new [napi-rs](https://github.com/napi-rs/napi-rs) project:
//!
//! ```bash
//! bun add -g @napi-rs/cli
//! napi new
//! ```
//!
//! Then install this crate:
//!
//! ```bash
//! cargo add bun-native-plugin
//! ```
//!
//! Now, inside the `lib.rs` file, expose a C ABI function which has the same function signature as the plugin lifecycle hook that you want to implement.
//!
//! For example, implementing `onBeforeParse`:
//!
//! ```rust
//! use bun_native_plugin::{OnBeforeParse};
//!
//! /// This is necessary for napi-rs to compile this into a proper NAPI module
//! #[napi]
//! pub fn register_bun_plugin() {}
//!
//! /// Use `no_mangle` so that we can reference this symbol by name later
//! /// when registering this native plugin in JS.
//! ///
//! /// Here we'll create a dummy plugin which replaces all occurrences of
//! /// `foo` with `bar`
//! #[no_mangle]
//! pub extern "C" fn on_before_parse_plugin_impl(
//!   args: *const bun_native_plugin::sys::OnBeforeParseArguments,
//!   result: *mut bun_native_plugin::sys::OnBeforeParseResult,
//! ) {
//!   let args = unsafe { &*args };
//!   let result = unsafe { &mut *result };
//!
//!   // This returns a handle which is a safe wrapper over the raw
//!   // C API.
//!   let mut handle = OnBeforeParse::from_raw(args, result) {
//!     Ok(handle) => handle,
//!     Err(_) => {
//!       // `OnBeforeParse::from_raw` handles error logging
//!       // so it fine to return here.
//!       return;
//!     }
//!   };
//!
//!   let input_source_code = match handle.input_source_code() {
//!     Ok(source_str) => source_str,
//!     Err(_) => {
//!       // If we encounter an error, we must log it so that
//!       // Bun knows this plugin failed.
//!       handle.log_error("Failed to fetch source code!");
//!       return;
//!     }
//!   };
//!
//!   let loader = handle.output_loader();
//!   let output_source_code = source_str.replace("foo", "bar");
//!   handle.set_output_source_code(output_source_code, loader);
//! }
//! ```
//!
//! Then compile this NAPI module. If you using napi-rs, the `package.json` should have a `build` script you can run:
//!
//! ```bash
//! bun run build
//! ```
//!
//! This will produce a `.node` file in the project directory.
//!
//! With the compiled NAPI module, you can now register the plugin from JS:
//!
//! ```js
//! const result = await Bun.build({
//!   entrypoints: ["index.ts"],
//!   plugins: [
//!     {
//!       name: "replace-foo-with-bar",
//!       setup(build) {
//!         const napiModule = require("path/to/napi_module.node");
//!
//!         // Register the `onBeforeParse` hook to run on all `.ts` files.
//!         // We tell it to use function we implemented inside of our `lib.rs` code.
//!         build.onBeforeParse(
//!           { filter: /\.ts/ },
//!           { napiModule, symbol: "on_before_parse_plugin_impl" },
//!         );
//!       },
//!     },
//!   ],
//! });
//! ```
//!
//! ## Very important information
//!
//! ### Error handling and panics
//!
//! It is highly recommended to avoid panicking as this will crash the runtime. Instead, you must handle errors and log them:
//!
//! ```rust
//! let input_source_code = match handle.input_source_code() {
//!   Ok(source_str) => source_str,
//!   Err(_) => {
//!     // If we encounter an error, we must log it so that
//!     // Bun knows this plugin failed.
//!     handle.log_error("Failed to fetch source code!");
//!     return;
//!   }
//! };
//! ```
//!
//! ### Passing state to and from JS: `External`
//!
//! One way to communicate data from your plugin and JS and vice versa is through the NAPI's [External](https://napi.rs/docs/concepts/external) type.
//!
//! An External in NAPI is like an opaque pointer to data that can be passed to and from JS. Inside your NAPI module, you can retrieve
//! the pointer and modify the data.
//!
//! As an example that extends our getting started example above, let's say you wanted to count the number of `foo`'s that the native plugin encounters.
//!
//! You would expose a NAPI module function which creates this state. Recall that state in native plugins must be threadsafe. This usually means
//! that your state must be `Sync`:
//!
//! ```rust
//! struct PluginState {
//!   foo_count: std::sync::atomic::AtomicU32,
//! }
//!
//! #[napi]
//! pub fn create_plugin_state() -> External<PluginState> {
//!   let external = External::new(PluginState {
//!     foo_count: 0,
//!   });
//!
//!   external
//! }
//!
//!
//! #[napi]
//! pub fn get_foo_count(plugin_state: External<PluginState>) -> u32 {
//!   let plugin_state: &PluginState = &plugin_state;
//!   plugin_state.foo_count.load(std::sync::atomic::Ordering::Relaxed)
//! }
//! ```
//!
//! When you register your plugin from Javascript, you call the napi module function to create the external and then pass it:
//!
//! ```js
//! const napiModule = require("path/to/napi_module.node");
//! const pluginState = napiModule.createPluginState();
//!
//! const result = await Bun.build({
//!   entrypoints: ["index.ts"],
//!   plugins: [
//!     {
//!       name: "replace-foo-with-bar",
//!       setup(build) {
//!         build.onBeforeParse(
//!           { filter: /\.ts/ },
//!           {
//!             napiModule,
//!             symbol: "on_before_parse_plugin_impl",
//!             // pass our NAPI external which contains our plugin state here
//!             external: pluginState,
//!           },
//!         );
//!       },
//!     },
//!   ],
//! });
//!
//! console.log("Total `foo`s encountered: ", pluginState.getFooCount());
//! ```
//!
//! Finally, from the native implementation of your plugin, you can extract the external:
//!
//! ```rust
//! pub extern "C" fn on_before_parse_plugin_impl(
//!   args: *const bun_native_plugin::sys::OnBeforeParseArguments,
//!   result: *mut bun_native_plugin::sys::OnBeforeParseResult,
//! ) {
//!   let args = unsafe { &*args };
//!   let result = unsafe { &mut *result };
//!
//!   let mut handle = OnBeforeParse::from_raw(args, result) {
//!     Ok(handle) => handle,
//!     Err(_) => {
//!       // `OnBeforeParse::from_raw` handles error logging
//!       // so it fine to return here.
//!       return;
//!     }
//!   };
//!
//!   let plugin_state: &PluginState =
//!     // This operation is only safe if you pass in an external when registering the plugin.
//!     // If you don't, this could lead to a segfault or access of undefined memory.
//!     match unsafe { handle.external().and_then(|state| state.ok_or(Error::Unknown)) } {
//!       Ok(state) => state,
//!       Err(_) => {
//!         handle.log_error("Failed to get external!");
//!         return;
//!       }
//!     };
//!
//!
//!   // Fetch our source code again
//!   let input_source_code = match handle.input_source_code() {
//!     Ok(source_str) => source_str,
//!     Err(_) => {
//!       handle.log_error("Failed to fetch source code!");
//!       return;
//!     }
//!   };
//!
//!   // Count the number of `foo`s and add it to our state
//!   let foo_count = source_code.matches("foo").count() as u32;
//!   plugin_state.foo_count.fetch_add(foo_count, std::sync::atomic::Ordering::Relaxed);
//! }
//! ```
//!
//! ### Concurrency
//!
//! Your `extern "C"` plugin function can be called _on any thread_ at _any time_ and _multiple times at once_.
//!
//! Therefore, you must design any state management to be threadsafe
#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
pub use anyhow;
pub use bun_macro::bun;

pub mod sys;

#[repr(transparent)]
pub struct BunPluginName(*const c_char);

impl BunPluginName {
    pub const fn new(ptr: *const c_char) -> Self {
        Self(ptr)
    }
}

#[macro_export]
macro_rules! define_bun_plugin {
    ($name:expr) => {
        pub static BUN_PLUGIN_NAME_STRING: &str = concat!($name, "\0");

        #[no_mangle]
        pub static BUN_PLUGIN_NAME: bun_native_plugin::BunPluginName =
            bun_native_plugin::BunPluginName::new(BUN_PLUGIN_NAME_STRING.as_ptr() as *const _);

        #[napi]
        fn bun_plugin_register() {}
    };
}

unsafe impl Sync for BunPluginName {}

use std::{
    any::TypeId,
    borrow::Cow,
    cell::UnsafeCell,
    ffi::{c_char, c_void},
    marker::PhantomData,
    str::Utf8Error,
    sync::PoisonError,
};

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

fn get_from_raw_str<'a>(ptr: *const u8, len: usize) -> PluginResult<Cow<'a, str>> {
    let slice: &'a [u8] = unsafe { std::slice::from_raw_parts(ptr, len) };

    // Windows allows invalid UTF-16 strings in the filesystem. These get converted to WTF-8 in Zig.
    // Meaning the string may contain invalid UTF-8, we'll have to use the safe checked version.
    #[cfg(target_os = "windows")]
    {
        std::str::from_utf8(slice)
            .map(Into::into)
            .or_else(|_| Ok(String::from_utf8_lossy(slice)))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // SAFETY: The source code comes from Zig, which uses UTF-8, so this should be safe.

        std::str::from_utf8(slice)
            .map(Into::into)
            .or_else(|_| Ok(String::from_utf8_lossy(slice)))
    }
}

#[derive(Debug, Clone)]
pub enum Error {
    Utf8(Utf8Error),
    IncompatiblePluginVersion,
    ExternalTypeMismatch,
    Unknown,
    LockPoisoned,
}

pub type PluginResult<T> = std::result::Result<T, Error>;
pub type Result<T> = anyhow::Result<T>;

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        None
    }

    fn description(&self) -> &str {
        "description() is deprecated; use Display"
    }

    fn cause(&self) -> Option<&dyn std::error::Error> {
        self.source()
    }
}

impl From<Utf8Error> for Error {
    fn from(value: Utf8Error) -> Self {
        Self::Utf8(value)
    }
}

impl<Guard> From<PoisonError<Guard>> for Error {
    fn from(_: PoisonError<Guard>) -> Self {
        Self::LockPoisoned
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
    pub args_raw: *mut sys::OnBeforeParseArguments,
    result_raw: *mut sys::OnBeforeParseResult,
    compilation_context: *mut SourceCodeContext,
    __phantom: PhantomData<&'a ()>,
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
        args: *mut sys::OnBeforeParseArguments,
        result: *mut sys::OnBeforeParseResult,
    ) -> PluginResult<Self> {
        if unsafe { (*args).__struct_size } < std::mem::size_of::<sys::OnBeforeParseArguments>()
            || unsafe { (*result).__struct_size } < std::mem::size_of::<sys::OnBeforeParseResult>()
        {
            let message = "This plugin is not compatible with the current version of Bun.";
            let mut log_options = sys::BunLogOptions {
                __struct_size: std::mem::size_of::<sys::BunLogOptions>(),
                message_ptr: message.as_ptr(),
                message_len: message.len(),
                path_ptr: unsafe { (*args).path_ptr },
                path_len: unsafe { (*args).path_len },
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
                ((*result).log.unwrap())(args, &mut log_options);
            }
            return Err(Error::IncompatiblePluginVersion);
        }

        Ok(Self {
            args_raw: args,
            result_raw: result,
            compilation_context: std::ptr::null_mut() as *mut _,
            __phantom: Default::default(),
        })
    }

    pub fn path(&self) -> PluginResult<Cow<'_, str>> {
        unsafe { get_from_raw_str((*self.args_raw).path_ptr, (*self.args_raw).path_len) }
    }

    pub fn namespace(&self) -> PluginResult<Cow<'_, str>> {
        unsafe {
            get_from_raw_str(
                (*self.args_raw).namespace_ptr,
                (*self.args_raw).namespace_len,
            )
        }
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
    pub unsafe fn external<T: 'static + Sync>(&self) -> PluginResult<Option<&'static T>> {
        if unsafe { (*self.args_raw).external.is_null() } {
            return Ok(None);
        }

        let external: *mut TaggedObject<T> =
            unsafe { (*self.args_raw).external as *mut TaggedObject<T> };

        unsafe {
            if (*external).type_id != TypeId::of::<T>() {
                return Err(Error::ExternalTypeMismatch);
            }

            Ok((*external).object.as_ref())
        }
    }

    /// The same as [`crate::bun_native_plugin::OnBeforeParse::external`], but returns a mutable reference.
    ///
    /// This is unsafe as you must ensure that no other invocation of the plugin
    /// simultaneously holds a mutable reference to the external.
    pub unsafe fn external_mut<T: 'static + Sync>(&mut self) -> PluginResult<Option<&mut T>> {
        if unsafe { (*self.args_raw).external.is_null() } {
            return Ok(None);
        }

        let external: *mut TaggedObject<T> =
            unsafe { (*self.args_raw).external as *mut TaggedObject<T> };

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
    pub fn input_source_code(&self) -> PluginResult<Cow<'_, str>> {
        let fetch_result = unsafe {
            ((*self.result_raw).fetchSourceCode.unwrap())(
                self.args_raw as *const _,
                self.result_raw,
            )
        };

        if fetch_result != 0 {
            Err(Error::Unknown)
        } else {
            // SAFETY: We don't hand out mutable references to `result_raw` so dereferencing here is safe.
            unsafe {
                get_from_raw_str((*self.result_raw).source_ptr, (*self.result_raw).source_len)
            }
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

            // SAFETY: We don't hand out mutable references to `result_raw` so dereferencing it is safe.
            unsafe {
                (*self.result_raw).plugin_source_code_context =
                    self.compilation_context as *mut c_void;
                (*self.result_raw).free_plugin_source_code_context =
                    Some(free_plugin_source_code_context);
            }
        } else {
            unsafe {
                // SAFETY: If we're here we know that `compilation_context` is not null.
                let context = &mut *self.compilation_context;

                drop(String::from_raw_parts(
                    context.source_ptr,
                    context.source_len,
                    context.source_cap,
                ));

                context.source_ptr = source_ptr;
                context.source_len = source_len;
                context.source_cap = source_cap;
            }
        }

        // SAFETY: We don't hand out mutable references to `result_raw` so dereferencing it is safe.
        unsafe {
            (*self.result_raw).loader = loader as u8;
            (*self.result_raw).source_ptr = source_ptr;
            (*self.result_raw).source_len = source_len;
        }
    }

    /// Set the output loader for the current file.
    pub fn set_output_loader(&self, loader: BunLoader) {
        // SAFETY: We don't hand out mutable references to `result_raw` so dereferencing it is safe.
        unsafe {
            (*self.result_raw).loader = loader as u8;
        }
    }

    /// Get the output loader for the current file.
    pub fn output_loader(&self) -> BunLoader {
        unsafe { std::mem::transmute((*self.result_raw).loader as u32) }
    }

    /// Log an error message.
    pub fn log_error(&self, message: &str) {
        self.log(message, BunLogLevel::BUN_LOG_LEVEL_ERROR)
    }

    /// Log a message with the given level.
    pub fn log(&self, message: &str, level: BunLogLevel) {
        let mut log_options = log_from_message_and_level(
            message,
            level,
            unsafe { (*self.args_raw).path_ptr },
            unsafe { (*self.args_raw).path_len },
        );
        unsafe {
            ((*self.result_raw).log.unwrap())(self.args_raw, &mut log_options);
        }
    }
}

pub fn log_from_message_and_level(
    message: &str,
    level: BunLogLevel,
    path: *const u8,
    path_len: usize,
) -> sys::BunLogOptions {
    sys::BunLogOptions {
        __struct_size: std::mem::size_of::<sys::BunLogOptions>(),
        message_ptr: message.as_ptr(),
        message_len: message.len(),
        path_ptr: path as *const _,
        path_len,
        source_line_text_ptr: std::ptr::null(),
        source_line_text_len: 0,
        level: level as i8,
        line: 0,
        lineEnd: 0,
        column: 0,
        columnEnd: 0,
    }
}
