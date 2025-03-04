import type { BunPlugin, BuildConfig, OnLoadResult } from "bun";
import { basename } from "node:path";
import { compile, compileModule } from "svelte/compiler";
import { getBaseCompileOptions, validateOptions, type SvelteOptions, hash } from "./options";

const kEmptyObject = Object.create(null);
const virtualNamespace = "bun-svelte";

function SveltePlugin(options: SvelteOptions = kEmptyObject as SvelteOptions): BunPlugin {
  if (options != null) validateOptions(options);

  /**
   * import specifier -> CSS source code
   */
  const virtualCssModules = new Map<string, VirtualCSSModule>();
  type VirtualCSSModule = {
    /** Path to the svelte file whose css this is for */
    sourcePath: string;
    /** Source code  */
    source: string;
  };

  return {
    name: "bun-plugin-svelte",
    setup(builder) {
      const { config = kEmptyObject as Partial<BuildConfig> } = builder;
      const baseCompileOptions = getBaseCompileOptions(options ?? (kEmptyObject as Partial<SvelteOptions>), config);

      builder
        .onLoad({ filter: /\.svelte(?:\.[tj]s)?$/ }, async args => {
          const { path } = args;

          var isModule = false;

          switch (path.substring(path.length - 2)) {
            case "js":
            case "ts":
              isModule = true;
              break;
          }

          const sourceText = await Bun.file(path).text();

          const side =
            args && "side" in args // "side" only passed when run from dev server
              ? (args as { side: "client" | "server" }).side
              : "server";
          const hmr = Boolean((args as { hmr?: boolean })["hmr"] ?? process.env.NODE_ENV !== "production");
          const generate = baseCompileOptions.generate ?? side;

          const compileFn = isModule ? compileModule : compile;
          const result = compileFn(sourceText, {
            ...baseCompileOptions,
            generate,
            filename: args.path,
            hmr,
          });
          var { js, css } = result;
          if (css?.code && generate != "server") {
            const uid = `${basename(path)}-${hash(path)}-style`.replaceAll(`"`, `'`);
            const virtualName = virtualNamespace + ":" + uid + ".css";
            virtualCssModules.set(virtualName, { sourcePath: path, source: css.code });
            js.code += `\nimport "${virtualName}";`;
          }

          return {
            contents: result.js.code,
            loader: "js",
          } satisfies OnLoadResult;
          // TODO: allow plugins to return multiple results.
          // TODO: support layered sourcemaps
        })
        .onResolve({ filter: /^bun-svelte:/ }, args => {
          return {
            path: args.path,
            namespace: "bun-svelte",
          };
        })
        .onLoad({ filter: /\.css$/, namespace: virtualNamespace }, args => {
          const { path } = args;

          const mod = virtualCssModules.get(path);
          if (!mod) throw new Error("Virtual CSS module not found: " + path);
          const { sourcePath, source } = mod;
          virtualCssModules.delete(path);

          return {
            contents: source,
            loader: "css",
            watchFiles: [sourcePath],
          };
        });
    },
  };
}

export default SveltePlugin({ development: true }) as BunPlugin;
export { SveltePlugin, type SvelteOptions };
