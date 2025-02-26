import type { BuildConfig } from "bun";
import type { CompileOptions } from "svelte/compiler";

export interface SvelteOptions {
  /**
   * By default, looks for a `svelte.config.js` in the root of your project
   * (next to `bunfig.toml` or `package.json`).
   */
  configPath?: string;
  /**
   * Force client-side or server-side generation.
   *
   * By default, this plugin will detect the side of the build based on how
   * it's used. For example, `"client"` code will be generated when used with {@link Bun.build}.
   */
  forceSide?: "client" | "server";
}

/**
 * @internal
 */
export function getBaseCompileOptions(pluginOptions: SvelteOptions, config: Partial<BuildConfig>): CompileOptions {
  let { forceSide } = pluginOptions;
  const { minify = false, target } = config;

  const shouldMinify = Boolean(minify);
  const {
    whitespace: minifyWhitespace,
    syntax: minifySyntax,
    identifiers: minifyIdentifiers,
  } = typeof minify === "object"
    ? minify
    : {
        whitespace: shouldMinify,
        syntax: shouldMinify,
        identifiers: shouldMinify,
      };

  if (forceSide == null && typeof target === "string") {
    switch (target) {
      case "browser":
        forceSide = "client";
        break;
      case "node":
      case "bun":
        forceSide = "server";
        break;
      default:
      // warn? throw?
    }
  }

  return {
    // TODO: css: "external". Requires enhancement to bun build allowing multiple OnLoadResults
    css: "external",
    generate: forceSide,
    preserveWhitespace: !minifyWhitespace,
    preserveComments: !shouldMinify,
    // modernAst: true,
    // TODO: pass hmr flag via builder
    hmr: true,
    dev: true,
    cssHash({ css }) {
      // same prime number seed used by svelte/compiler.
      // TODO: ensure this provides enough entropy
      return `svelte-${Bun.hash(css, 5381).toString(36)}`;
    },
  };
}
