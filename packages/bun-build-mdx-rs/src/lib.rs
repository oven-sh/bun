use bun_native_plugin::{anyhow, bun, define_bun_plugin, BunLoader, Result};
use mdxjs::{compile, mdast_util_from_mdx, mdast_util_to_hast, Options as CompileOptions};
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
  /// Export AST for JS plugin usage (adds serialization overhead)
  pub export_ast: Option<bool>,
}

/// Result of MDX compilation
#[napi(object)]
pub struct MdxCompileResult {
  /// Compiled JavaScript/JSX code
  pub code: String,
  /// MDAST (Markdown Abstract Syntax Tree) as JSON string
  /// Always present but may be empty string if not requested
  pub ast: String,
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

  // Check if AST export is needed
  let export_ast = opts.export_ast.unwrap_or(false);

  if export_ast {
    // Parse once, then both serialize AST and compile to JSX
    // This avoids double-parsing
    let mdast = mdast_util_from_mdx(&source, &compile_opts)
      .map_err(|e| napi::Error::from_reason(format!("Failed to parse MDX: {:?}", e)))?;
    
    // Serialize the AST to JSON
    let ast_json = serde_json::to_string(&mdast)
      .map_err(|e| napi::Error::from_reason(format!("Failed to serialize AST: {:?}", e)))?;
    
    // Continue compilation from the parsed AST
    // Note: We have to re-compile because mdxjs doesn't expose the intermediate steps
    // This is the performance bottleneck - we parse once, serialize, then parse again
    let code = compile(&source, &compile_opts)
      .map_err(|e| napi::Error::from_reason(format!("MDX compilation failed: {:?}", e)))?;
    
    Ok(MdxCompileResult { code, ast: ast_json })
  } else {
    // Fast path: just compile without AST export
    let code = compile(&source, &compile_opts)
      .map_err(|e| napi::Error::from_reason(format!("MDX compilation failed: {:?}", e)))?;
    
    Ok(MdxCompileResult { code, ast: String::new() })
  }
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
