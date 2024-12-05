use bun_native_plugin::{define_bun_plugin, BunLoader, OnBeforeParse};
use mdxjs::{compile, Options as CompileOptions};
use napi_derive::napi;

#[macro_use]
extern crate napi;

define_bun_plugin!("bun-mdx-rs");

#[no_mangle]
pub extern "C" fn bun_mdx_rs(
  args: *const bun_native_plugin::sys::OnBeforeParseArguments,
  result: *mut bun_native_plugin::sys::OnBeforeParseResult,
) {
  let args = unsafe { &*args };

  let mut handle = match OnBeforeParse::from_raw(args, result) {
    Ok(handle) => handle,
    Err(_) => {
      return;
    }
  };

  let source_str = match handle.input_source_code() {
    Ok(source_str) => source_str,
    Err(_) => {
      handle.log_error("Failed to fetch source code");
      return;
    }
  };

  let mut options = CompileOptions::gfm();

  // Leave it as JSX for Bun to handle
  options.jsx = true;

  let path = match handle.path() {
    Ok(path) => path,
    Err(e) => {
      handle.log_error(&format!("Failed to get path: {:?}", e));
      return;
    }
  };
  options.filepath = Some(path.to_string());

  match compile(&source_str, &options) {
    Ok(compiled) => {
      handle.set_output_source_code(compiled, BunLoader::BUN_LOADER_JSX);
    }
    Err(_) => {
      handle.log_error("Failed to compile MDX");
      return;
    }
  }
}
