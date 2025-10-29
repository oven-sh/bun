use bun_native_plugin::{anyhow, bun, define_bun_plugin, BunLoader, Result};
use mdxjs::{compile, Options as CompileOptions};
use napi_derive::napi;
// Disabled for now due to dependency conflicts
// use serde_json;

define_bun_plugin!("bun-mdx-rs");

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

/// Options for compile function
#[napi(object)]
pub struct MdxCompileOptions {
  /// Enable GFM (GitHub Flavored Markdown) - strikethrough, tables, task lists, etc.
  /// Default: true
  pub gfm: Option<bool>,

  /// Enable frontmatter parsing (YAML/TOML)
  /// Default: true
  pub frontmatter: Option<bool>,

  /// Enable math support (LaTeX)
  /// Default: false
  pub math: Option<bool>,

  /// Output JSX instead of JS function body
  /// Default: true (for Bun compatibility)
  pub jsx: Option<bool>,

  /// Filepath (for error messages)
  pub filepath: Option<String>,

  /// Return AST instead of compiled code (for plugin support)
  /// Default: false
  pub return_ast: Option<bool>,
}

/// Result from compile function
#[napi(object)]
pub struct MdxCompileResult {
  /// Compiled JSX code (if return_ast = false)
  pub code: Option<String>,

  /// Serialized mdast AST (if return_ast = true)
  pub ast: Option<String>,

  /// Metadata extracted from document (frontmatter, etc)
  pub metadata: Option<String>,
}

/// Compile MDX to JSX
///
/// This is the programmatic API, similar to @mdx-js/mdx compile()
///
/// # Examples
///
/// ```typescript
/// import { compile } from 'bun-mdx-rs';
///
/// // Basic usage (fast path - no plugins)
/// const result = await compile('# Hello\n\nThis is **bold**');
/// console.log(result.code);
///
/// // With options
/// const result = await compile(source, {
///   gfm: true,
///   frontmatter: true,
///   math: true,
/// });
///
/// // For plugins: get AST
/// const result = await compile(source, { return_ast: true });
/// const mdast = JSON.parse(result.ast);
/// // Run your JS plugins on mdast...
/// ```
#[napi]
pub fn compile_mdx(source: String, options: Option<MdxCompileOptions>) -> napi::Result<MdxCompileResult> {
  let opts = options.unwrap_or(MdxCompileOptions {
    gfm: Some(true),
    frontmatter: Some(true),
    math: Some(false),
    jsx: Some(true),
    filepath: None,
    return_ast: Some(false),
  });

  // Build mdxjs options
  let mut compile_opts = if opts.gfm.unwrap_or(true) {
    CompileOptions::gfm()
  } else {
    CompileOptions::default()
  };

  compile_opts.jsx = opts.jsx.unwrap_or(true);
  compile_opts.filepath = opts.filepath;

  // Enable frontmatter if requested
  if opts.frontmatter.unwrap_or(true) {
    compile_opts.parse.constructs.frontmatter = true;
  }

  // Enable math if requested
  if opts.math.unwrap_or(false) {
    compile_opts.parse.constructs.math_flow = true;
    compile_opts.parse.constructs.math_text = true;
  }

  // TODO: AST export disabled due to dependency conflicts
  // Would need to resolve serde version mismatches first
  if opts.return_ast.unwrap_or(false) {
    return Err(napi::Error::from_reason(
      "AST export not yet implemented - dependency conflicts to resolve first"
    ));
  }

  // Fast path: compile directly to JSX
  let jsx = compile(&source, &compile_opts)
    .map_err(|e| napi::Error::from_reason(format!("Failed to compile MDX: {}", e)))?;

  Ok(MdxCompileResult {
    code: Some(jsx),
    ast: None,
    metadata: None,
  })
}
