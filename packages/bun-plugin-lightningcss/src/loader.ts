import { BuildConfig, OnLoadArgs, OnLoadResult } from "bun";
import { Targets, bundleAsync } from "lightningcss";

type OnLoadConfig = {
  cssModules?: boolean;
  targets: Targets;
} & BuildConfig;

export async function loader(args: OnLoadArgs, config: OnLoadConfig): Promise<OnLoadResult> {
  const {
    code,
    map,
    exports: cssModuleExports,
  } = await bundleAsync({
    filename: args.path,
    ...config,
    minify: shouldMinify(config.minify),
    sourceMap: config.sourcemap !== undefined && config.sourcemap !== "none",
  });

  if (config.sourcemap === "inline") {
    return inlineSourcemap(code, map);
  }
  if (config.sourcemap === "external") {
    // TODO dump sourcemap to separate file
    if (!map) {
      throw new Error("No source map generated");
    }
  }

  if (config?.cssModules && cssModuleExports) {
    // TODO where to put the generated css?
    return {
      exports: cssModuleExports,
      loader: "object",
    };
  }

  return {
    contents: code.toString(),
    // TODO css loader doesn't exist in Bun yet
    loader: "css",
  };
}

function shouldMinify(minify: BuildConfig["minify"]) {
  if (minify === undefined) {
    return false;
  }
  if (typeof minify === "boolean") {
    return minify;
  }
  // if any of the properties is true, we also minify CSS
  if (minify.whitespace || minify.syntax || minify.identifiers) {
    return true;
  }
  return false;
}

function inlineSourcemap(code: Buffer, map: void | Buffer): OnLoadResult {
  if (!map) {
    throw new Error("No source map generated");
  }
  const codeWithMap = `${code.toString("utf8")}/*# sourceMappingURL=data:application/json;base64,${map.toString(
    "base64",
  )} */`;
  return {
    contents: codeWithMap,
    // TODO css loader doesn't exist in Bun yet
    loader: "css",
  };
}
