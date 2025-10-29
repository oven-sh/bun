/**
 * Options for compiling MDX
 */
export interface CompileOptions {
  /**
   * Enable GitHub Flavored Markdown (GFM)
   * Adds support for: strikethrough, tables, task lists, autolinks, footnotes
   * @default true
   */
  gfm?: boolean;

  /**
   * Enable frontmatter parsing (YAML/TOML)
   * @default true
   */
  frontmatter?: boolean;

  /**
   * Enable math support (LaTeX)
   * @default false
   */
  math?: boolean;

  /**
   * Output JSX instead of JS function body
   * @default true
   */
  jsx?: boolean;

  /**
   * Filepath (for error messages)
   */
  filepath?: string;

  /**
   * Return AST instead of compiled code (for plugin support)
   * @default false
   * @internal
   */
  return_ast?: boolean;
}

/**
 * Options for compiling with plugins
 */
export interface CompileWithPluginsOptions extends CompileOptions {
  /**
   * Remark plugins (operate on mdast)
   * @example
   * ```js
   * import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
   * import remarkToc from 'remark-toc';
   *
   * const result = await compileWithPlugins(source, {
   *   remarkPlugins: [remarkMdxFrontmatter, remarkToc],
   * });
   * ```
   */
  remarkPlugins?: Array<any>;

  /**
   * Rehype plugins (operate on hast)
   * @example
   * ```js
   * import rehypeHighlight from 'rehype-highlight';
   * import rehypeAutolinkHeadings from 'rehype-autolink-headings';
   *
   * const result = await compileWithPlugins(source, {
   *   rehypePlugins: [rehypeHighlight, rehypeAutolinkHeadings],
   * });
   * ```
   */
  rehypePlugins?: Array<any>;
}

/**
 * Result from compilation
 */
export interface CompileResult {
  /**
   * Compiled JSX code
   */
  code: string;

  /**
   * Parsed AST (if return_ast = true)
   */
  ast?: any;

  /**
   * Metadata extracted from document
   */
  metadata?: any;
}

/**
 * Compile MDX to JSX (fast path - no plugins)
 *
 * This is 7x faster than @mdx-js/mdx because it uses Rust for parsing.
 *
 * **Included by default:**
 * - GFM (strikethrough, tables, task lists, autolinks, footnotes)
 * - Frontmatter parsing (YAML/TOML)
 * - MDX (JSX, imports, exports, expressions)
 *
 * **Use this when:**
 * - You don't need remark/rehype plugins
 * - You want maximum speed
 * - You're building a simple docs site
 *
 * @param source - MDX source code
 * @param options - Compile options
 * @returns Promise resolving to compilation result
 *
 * @example
 * ```js
 * import { compile } from 'bun-mdx-rs';
 *
 * // Basic usage - blazing fast!
 * const result = await compile('# Hello\n\nThis is **bold**');
 * console.log(result.code);
 *
 * // With all features enabled
 * const result = await compile(source, {
 *   gfm: true,
 *   frontmatter: true,
 *   math: true, // LaTeX math
 * });
 * ```
 */
export function compile(source: string, options?: CompileOptions): Promise<CompileResult>;

/**
 * Compile MDX with plugin support (hybrid mode)
 *
 * Uses Rust for fast parsing (7x faster), then allows JS plugins to transform the AST.
 * This gives you ~3-5x speedup while keeping full plugin compatibility!
 *
 * **How it works:**
 * 1. Rust parses MDX → mdast (fast!)
 * 2. Serializes mdast to JSON (0.3ms overhead - basically free!)
 * 3. Your remark plugins transform mdast
 * 4. Converts mdast → hast
 * 5. Your rehype plugins transform hast
 * 6. Returns JSX
 *
 * **Use this when:**
 * - You need remark/rehype plugins
 * - You want faster builds than pure JS
 * - You need syntax highlighting, frontmatter exports, etc.
 *
 * @param source - MDX source code
 * @param options - Options with plugins
 * @returns Promise resolving to compilation result
 *
 * @example
 * ```js
 * import { compileWithPlugins } from 'bun-mdx-rs';
 * import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
 * import remarkToc from 'remark-toc';
 * import rehypeHighlight from 'rehype-highlight';
 *
 * // Hybrid mode: Rust parsing + JS plugins
 * const result = await compileWithPlugins(source, {
 *   gfm: true,
 *   frontmatter: true,
 *   remarkPlugins: [remarkMdxFrontmatter, remarkToc],
 *   rehypePlugins: [rehypeHighlight],
 * });
 *
 * // Still 3-5x faster than pure @mdx-js/mdx!
 * ```
 */
export function compileWithPlugins(source: string, options?: CompileWithPluginsOptions): Promise<CompileResult>;

/**
 * Create a compiler with default options
 *
 * @param options - Default options for all compilations
 * @returns Compiler instance
 *
 * @example
 * ```js
 * import { createCompiler } from 'bun-mdx-rs';
 *
 * const compiler = createCompiler({
 *   gfm: true,
 *   frontmatter: true,
 *   math: true,
 * });
 *
 * const result1 = await compiler.compile(source1);
 * const result2 = await compiler.compile(source2);
 * ```
 */
export function createCompiler(options?: CompileOptions): {
  compile: (source: string) => Promise<CompileResult>;
  compileWithPlugins: (source: string, pluginOpts?: CompileWithPluginsOptions) => Promise<CompileResult>;
};

/**
 * Raw NAPI binding (advanced use only)
 * @internal
 */
export function compileMdx(source: string, options?: CompileOptions): CompileResult;
