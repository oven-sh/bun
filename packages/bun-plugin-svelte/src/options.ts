import { strict as assert } from "node:assert";
import { plugin, type BuildConfig } from "bun";
import type { CompileOptions, ModuleCompileOptions } from "svelte/compiler";

export interface SvelteOptions {
  /**
   * Force client-side or server-side generation.
   *
   * By default, this plugin will detect the side of the build based on how
   * it's used. For example, `"client"` code will be generated when used with {@link Bun.build}.
   */
  forceSide?: "client" | "server";

  /**
   * When `true`, this plugin will generate development-only checks and other
   * niceties.
   *
   * When `false`, this plugin will generate production-ready code
   *
   * Defaults to `true` when run via Bun's dev server, `false` otherwise.
   */
  development?: boolean;
}

/**
 * @internal
 */
export function validateOptions(options: unknown): asserts options is SvelteOptions {
  assert(options && typeof options === "object", new TypeError("bun-svelte-plugin: options must be an object"));
  if ("forceSide" in options) {
    switch (options.forceSide) {
      case "client":
      case "server":
        break;
      default:
        throw new TypeError(
          `bun-svelte-plugin: forceSide must be either 'client' or 'server', got ${options.forceSide}`,
        );
    }
  }
}

/**
 * @internal
 */
export function getBaseCompileOptions(pluginOptions: SvelteOptions, config: Partial<BuildConfig>): CompileOptions {
  let { forceSide, development = false } = pluginOptions;
  const { minify = false, target } = config;

  const shouldMinify = Boolean(minify);
  const {
    whitespace: minifyWhitespace,
    syntax: _minifySyntax,
    identifiers: _minifyIdentifiers,
  } = typeof minify === "object"
    ? minify
    : {
        whitespace: shouldMinify,
        syntax: shouldMinify,
        identifiers: shouldMinify,
      };

  const generate = generateSide(pluginOptions, config);

  return {
    css: "external",
    generate,
    preserveWhitespace: !minifyWhitespace,
    preserveComments: !shouldMinify,
    dev: development,
    cssHash({ css }) {
      // same prime number seed used by svelte/compiler.
      // TODO: ensure this provides enough entropy
      return `svelte-${hash(css)}`;
    },
  };
}

export function getBaseModuleCompileOptions(
  pluginOptions: SvelteOptions,
  config: Partial<BuildConfig>,
): ModuleCompileOptions {
  const { development = false } = pluginOptions;
  const generate = generateSide(pluginOptions, config);
  return {
    dev: development,
    generate,
  };
}

function generateSide(pluginOptions: SvelteOptions, config: Partial<BuildConfig>) {
  let { forceSide } = pluginOptions;
  const { target } = config;

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
  return forceSide;
}

export const hash = (content: string): string => Bun.hash(content, 5381).toString(36);
