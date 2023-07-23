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
    // TODO inline source map with CSS
  }
  if (config.sourcemap === "external") {
    // TODO dump sourcemap to separate file
  }

  // TODO figure out where to dump the code to a file
  console.log({ code, map, cssModuleExports });

  if (config?.cssModules && cssModuleExports) {
    return {
      exports: cssModuleExports,
      loader: "object",
    };
  }

  // CSS without modules shouldn't have exports
  return {
    loader: "object",
    exports: {},
  };
}

export function shouldMinify(minify: BuildConfig["minify"]) {
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
