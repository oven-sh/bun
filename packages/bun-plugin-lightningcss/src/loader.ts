import { OnLoadArgs, OnLoadResult } from "bun";
import { Targets, bundleAsync } from "lightningcss";
import { LightningCSSPluginOptions } from "./plugin";

type OnLoadOptions = {
  cssModules?: boolean;
  targets: Targets;
} & LightningCSSPluginOptions;

export async function loader(args: OnLoadArgs, options: OnLoadOptions): Promise<OnLoadResult> {
  const {
    code,
    map,
    exports: cssModuleExports,
  } = await bundleAsync({
    filename: args.path,
    targets: options.targets,
    minify: options?.minify ?? true,
    sourceMap: options?.sourceMap,
    cssModules: options?.cssModules,
  });
  // TODO figure out where to dump the code to a file
  console.log({ code, map, cssModuleExports });

  if (options?.cssModules && cssModuleExports) {
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
