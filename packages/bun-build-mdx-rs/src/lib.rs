use bun_native_plugin::{anyhow, bun, define_bun_plugin, BunLoader, Result};
use mdxjs::{compile, Options as CompileOptions};
use napi_derive::napi;

define_bun_plugin!("bun-mdx-rs");

/// Options for MDX compilation
#[napi(object)]
#[derive(Default)]
pub struct MdxCompileOptions {
  /// Enable GFM (GitHub Flavored Markdown) extensions
  pub gfm: Option<bool>,
  /// Enable frontmatter support
  pub frontmatter: Option<bool>,
  /// Enable math support
  pub math: Option<bool>,
  /// Output JSX instead of full React code
  pub jsx: Option<bool>,
  /// File path for better error messages
  pub filepath: Option<String>,
}

/// Result of MDX compilation
#[napi(object)]
pub struct MdxCompileResult {
  /// Compiled JavaScript/JSX code
  pub code: String,
}

/// Compile MDX to JavaScript/JSX (programmatic API)
///
/// This function can be imported and used directly from JavaScript:
/// ```js
/// import { compileMdx } from 'bun-build-mdx-rs';
/// const result = compileMdx('# Hello', { jsx: true, gfm: true });
/// console.log(result.code);
/// ```
#[napi]
pub fn compile_mdx(source: String, options: Option<MdxCompileOptions>) -> napi::Result<MdxCompileResult> {
  let opts = options.unwrap_or_default();

  let mut compile_opts = if opts.gfm.unwrap_or(true) {
    CompileOptions::gfm()
  } else {
    CompileOptions::default()
  };

  // Apply options
  if let Some(frontmatter) = opts.frontmatter {
    compile_opts.parse.constructs.frontmatter = frontmatter;
  }

  if let Some(math) = opts.math {
    compile_opts.parse.constructs.math_text = math;
    compile_opts.parse.constructs.math_flow = math;
  }

  compile_opts.jsx = opts.jsx.unwrap_or(true);

  if let Some(filepath) = opts.filepath {
    compile_opts.filepath = Some(filepath);
  }

  // Compile
  let code = compile(&source, &compile_opts)
    .map_err(|e| napi::Error::from_reason(format!("MDX compilation failed: {:?}", e)))?;

  Ok(MdxCompileResult { code })
}

/// Plugin mode: Handles .mdx imports automatically
#[bun]
pub fn bun_mdx_rs(handle: &mut OnBeforeParse) -> Result<()> {
  let source_str = handle.input_source_code()?;

  let mut options = CompileOptions::gfm();

  // Leave it as JSX for Bun to handle
  options.jsx = true;

  let path = handle.path()?;
  options.filepath = Some(path.to_string());

  let jsx = compile(&source_str, &options)
    .map_err(|e| anyhow::anyhow!("Failed to compile MDX: {:?}", e))?;

  handle.set_output_source_code(jsx, BunLoader::BUN_LOADER_JSX);

  Ok(())
}
