import type { BunPlugin, BuildConfig, OnLoadResult } from "bun";
import { strict as assert } from "node:assert";
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
  const virtualCssModules = new Map<string, string>();

  return {
    name: "bun-plugin-svelte",
    setup(builder) {
      const { config = kEmptyObject as Partial<BuildConfig> } = builder;
      const baseCompileOptions = getBaseCompileOptions(options ?? (kEmptyObject as Partial<SvelteOptions>), config);

      builder
        .onLoad({ filter: /\.svelte(?:\.[tj]s)?$/ }, async args => {
          assert(args && typeof args === "object");
          const { path } = args;
          assert(typeof path === "string");

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

          const compileFn = isModule ? compileModule : compile;
          const result = compileFn(sourceText, {
            ...baseCompileOptions,
            generate: baseCompileOptions.generate ?? side,
            filename: args.path,
          });
          var { js, css } = result;
          if (css?.code) {
            const uid = `${basename(path)}-${hash(path)}-style`.replaceAll(`"`, `'`);
            const virtualName = virtualNamespace + ":" + uid + ".css";
            virtualCssModules.set(virtualName, css.code);
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
          const [ns, name] = args.path.split(":");
          assert(ns === "bun-svelte" && !!name);
          return {
            path: args.path,
            namespace: "bun-svelte",
          };
        })
        .onLoad({ filter: /\.css$/, namespace: virtualNamespace }, args => {
          const { path } = args;
          const code = virtualCssModules.get(path);
          assert(code != null, `bun-svelte-plugin: CSS not found for virtual css module "${path}"`);
          virtualCssModules.delete(path);
          return {
            contents: code,
            loader: "css",
          };
        });
    },
  };
}

export default SveltePlugin({ development: true }) as BunPlugin;
export { SveltePlugin, type SvelteOptions };
