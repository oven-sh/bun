import type { BuildConfig, BunPlugin, OnLoadResult } from "bun";
import { basename } from "node:path";
import { compile, compileModule } from "svelte/compiler";
import {
  getBaseCompileOptions,
  getBaseModuleCompileOptions,
  hash,
  validateOptions,
  type SvelteOptions,
} from "./options";

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
      // resolve "svelte" export conditions
      //
      // FIXME: the dev server does not currently respect bundler configs; it
      // just passes a fake one to plugins and then never uses it. we need to to
      // update it to ~not~ do this.
      if (builder?.config) {
        var conditions = builder.config.conditions ?? [];
        if (typeof conditions === "string") {
          conditions = [conditions];
        }
        conditions.push("svelte");
        builder.config.conditions = conditions;
      }

      const { config = kEmptyObject as Partial<BuildConfig> } = builder;
      const baseCompileOptions = getBaseCompileOptions(options ?? (kEmptyObject as Partial<SvelteOptions>), config);
      const baseModuleCompileOptions = getBaseModuleCompileOptions(
        options ?? (kEmptyObject as Partial<SvelteOptions>),
        config,
      );

      const ts = new Bun.Transpiler({
        loader: "ts",
        target: config.target,
      });

      builder
        .onLoad({ filter: /\.svelte$/ }, async function onLoadSvelte(args) {
          const { path } = args;

          const sourceText = await Bun.file(path).text();

          const side =
            args && "side" in args // "side" only passed when run from dev server
              ? (args as { side: "client" | "server" }).side
              : "server";
          const generate = baseCompileOptions.generate ?? side;

          const hmr = Boolean((args as { hmr?: boolean })["hmr"] ?? process.env.NODE_ENV !== "production");
          const result = compile(sourceText, {
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
            loader: "ts",
          } satisfies OnLoadResult;
          // TODO: allow plugins to return multiple results.
          // TODO: support layered sourcemaps
        })
        .onLoad({ filter: /\.svelte.[tj]s$/ }, async function onLoadSvelteModule(args) {
          const { path } = args;

          const side =
            args && "side" in args // "side" only passed when run from dev server
              ? (args as { side: "client" | "server" }).side
              : "server";
          const generate = baseModuleCompileOptions.generate ?? side;

          var sourceText = await Bun.file(path).text();
          if (path.endsWith(".ts")) {
            sourceText = await ts.transform(sourceText);
          }
          const result = compileModule(sourceText, {
            ...baseModuleCompileOptions,
            generate,
            filename: args.path,
          });

          // NOTE: we assume js/ts modules won't have CSS blocks in them, so no
          // virtual modules get created.
          return {
            contents: result.js.code,
            loader: "js",
          };
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
