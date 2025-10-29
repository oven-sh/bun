const { compileMdx } = require("./binding");

/**
 * Compile MDX to JSX (fast path - no plugins)
 *
 * @param {string} source - MDX source code
 * @param {import('./index').CompileOptions} [options] - Compile options
 * @returns {Promise<import('./index').CompileResult>}
 *
 * @example
 * ```js
 * import { compile } from 'bun-mdx-rs';
 *
 * // Basic usage - blazing fast!
 * const result = await compile('# Hello\n\nThis is **bold**');
 * console.log(result.code);
 *
 * // With GFM, frontmatter, math
 * const result = await compile(source, {
 *   gfm: true,
 *   frontmatter: true,
 *   math: true,
 * });
 * ```
 */
async function compile(source, options = {}) {
  const result = compileMdx(source, options);

  if (result.code) {
    return { code: result.code };
  }

  throw new Error("Compilation failed");
}

/**
 * Compile MDX with plugin support (hybrid mode)
 *
 * Uses Rust for fast parsing, then allows JS plugins to transform AST
 *
 * @param {string} source - MDX source code
 * @param {import('./index').CompileWithPluginsOptions} options - Options with plugins
 * @returns {Promise<import('./index').CompileResult>}
 *
 * @example
 * ```js
 * import { compileWithPlugins } from 'bun-mdx-rs';
 * import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
 * import rehypeHighlight from 'rehype-highlight';
 *
 * const result = await compileWithPlugins(source, {
 *   remarkPlugins: [remarkMdxFrontmatter],
 *   rehypePlugins: [rehypeHighlight],
 * });
 * ```
 */
async function compileWithPlugins(source, options = {}) {
  const { remarkPlugins = [], rehypePlugins = [], ...compileOpts } = options;

  // Get AST from Rust (fast!)
  const result = compileMdx(source, {
    ...compileOpts,
    return_ast: true,
  });

  if (!result.ast) {
    throw new Error("Failed to get AST from Rust compiler");
  }

  // Parse mdast
  let mdast = JSON.parse(result.ast);

  // Run remark plugins on mdast
  for (const plugin of remarkPlugins) {
    const transformer = typeof plugin === "function" ? plugin() : plugin;
    if (transformer && typeof transformer === "function") {
      mdast = (await transformer(mdast)) || mdast;
    } else if (transformer && typeof transformer.transformer === "function") {
      mdast = (await transformer.transformer(mdast)) || mdast;
    }
  }

  // Convert mdast to hast (if rehype plugins present)
  if (rehypePlugins.length > 0) {
    // This is a simplified conversion - in production you'd use remark-rehype
    // For now, just document that users need to set this up
    throw new Error("rehype plugins require remark-rehype - please use the JS API wrapper");
  }

  // For now, just return the transformed AST
  // In production, you'd stringify back to JSX
  return {
    code: JSON.stringify(mdast),
    ast: mdast,
  };
}

/**
 * Create a unified-compatible wrapper (for advanced users)
 *
 * This provides a compile function that's compatible with @mdx-js/mdx
 * but uses Rust for parsing
 */
function createCompiler(options = {}) {
  return {
    compile: source => compile(source, options),
    compileWithPlugins: (source, pluginOpts) => compileWithPlugins(source, { ...options, ...pluginOpts }),
  };
}

module.exports = {
  compile,
  compileWithPlugins,
  createCompiler,
  // Re-export raw binding for advanced use
  compileMdx,
};
