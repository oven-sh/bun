import type { SFCParseOptions } from "@vue/compiler-sfc";
import type { BuildConfig } from "bun";

export function getBaseParseOptions(config: Partial<BuildConfig> | undefined): Partial<SFCParseOptions> {
  const { sourcemap, minify } = config ?? ({ __proto__: null } as Partial<BuildConfig>);
  const sourceMapEnabled = sourcemap && sourcemap !== "none";

  return Object.assign(minifyOptions(minify), { sourceMap: sourceMapEnabled }) satisfies Partial<SFCParseOptions>;
}

function minifyOptions(minify: BuildConfig["minify"]) {
  // preserve comments?
  var comments: boolean | undefined;
  var whitespace: "preserve" | "condense" | undefined;

  switch (typeof minify) {
    case "boolean":
      comments = !minify;
      whitespace = minify ? "condense" : "preserve";
      break;
    case "object":
      comments = !minify.whitespace;
      whitespace = minify.whitespace ? "condense" : "preserve";
      break;
    case "undefined":
      break;
    default:
      console.warn(`[bun-plugin-vue] BuildConfig.minify must be a boolea, object, or undefined, got ${minify}`);
  }

  return { comments, whitespace };
}
