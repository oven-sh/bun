use bun_native_plugin::{BunLoader, OnBeforeParse};
use mdxjs::{compile, Options as CompileOptions};

#[no_mangle]
pub unsafe extern "C" fn bun_mdx_rs(
  args: *const bun_native_plugin::sys::OnBeforeParseArguments,
  result: *mut bun_native_plugin::sys::OnBeforeParseResult,
) {
  let args = &*args;
  let result = &mut *result;

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

  let path = handle.path();
  options.filepath = Some(path.to_owned());

  match compile(source_str, &options) {
    Ok(compiled) => {
      handle.set_output_source_code(compiled, BunLoader::BUN_LOADER_JSX);
    }
    Err(_) => {
      handle.log_error("Failed to compile MDX");
      return;
    }
  }
}

#[macro_use]
extern crate napi_derive;

#[napi]
pub fn register_bun_plugin() {}
