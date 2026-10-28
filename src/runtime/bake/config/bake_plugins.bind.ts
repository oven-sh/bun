import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bake::config::plugins" });

export const setConfigPlugins = b.fn({
  args: { plugins: b.opaque, names: b.array(b.string.loose.utf8.owned) },
  capability: "js",
});
export const isRestart = b.fn({ returns: b.bool });
export const restartProcess = b.fn({ capability: "js" });
export const isRestarting = b.fn({ returns: b.bool });
export const setPages = b.fn({ args: { framework: b.opaque.nullable }, capability: "js", length: 1 });
export const checkFramework = b.fn({ args: { framework: b.opaque }, capability: "js", throws: true });

const flag = b.bool.loose.optional;

export const BakeSourceMap = b.enumeration(["none", "inline", "external", "linked"]);
export const BakeMinifyParts = b.dictionary(
  { whitespace: flag, syntax: flag, identifiers: flag },
  { allowArray: true, reportedAs: "minify" },
);
export const BakeMinify = b.union({ all: b.bool, parts: BakeMinifyParts, other: b.ignored });
/** `server`, `client` and `ssr` of `bundlerOptions` of `Bake.Options`. */
export const BuildConfigSubsetOptions = b.dictionary(
  { sourcemap: BakeSourceMap.nullable, minify: BakeMinify.nullable },
  { allowArray: true, nonObjectAsEmpty: true, fromJS: true, reportedAs: "" },
);
