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

      // TODO: pre-process source with Bun.build and/or use require-cache
      // hacking to shim ESTree imports to bun's parser (which is not yet ESTree-compliant)
      // const isProd = !baseCompileOptions.dev;
      // const ts = new Bun.Transpiler({
      //   loader: "ts",
      //   define: config.define,
      //   treeShaking: isProd,
      //   trimUnusedImports: isProd,
      //   deadCodeElimination: isProd,
      //   inline: isProd,
      //   target: config.target,
      // });

      builder
        .onLoad({ filter: /\.svelte(?:\.[tj]s)?$/ }, async args => {
          assert(args && typeof args === "object");
          const { path } = args;
          assert(typeof path === "string");

          // FIXME: "side" missing when passed to `Bun.plugin`
          // assert("side" in args);
          // const side = args.side;
          // assert(side === "client" || side === "server");

          var needsPreprocess = true;
          var isModule = false;

          switch (path.substring(path.length - 2)) {
            // @ts-expect-error
            case "js":
              needsPreprocess = false;
            // fallthrough
            case "ts":
              isModule = true;
              break;
          }

          const sourceText = await Bun.file(path).text();

          // TODO: forward processed.dependencies to watchList
          // var preprocessed: Processed | undefined;
          // var source = sourceText;
          // if (needsPreprocess) {
          //   preprocessed = await preprocess(source, preprocessors, { filename: path });
          //   source = preprocessed.code;
          // }

          const side =
            args && "side" in args // "side" only passed when run from dev server
              ? (args as { side: "client" | "server" }).side
              : "server";

          const compileFn = isModule ? compileModule : compile;
          const result = compileFn(sourceText, {
            ...baseCompileOptions,
            // sourcemap: builder.config?.sourcemap ? preprocessed?.map : undefined,
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
          // TODO: multiple results. maybe something like this:
          // const { js, css } = result;
          // return [
          //   {
          //     contents: result.js.code,
          //     loader: "ts",
          //     // watchList: [args.path],
          //   },
          //   css && {
          //     contents: css.code,
          //     sourceMap: css.map
          //     loader: "css",
          //     // watchList: [args.path],
          //   },
          // ].filter(Boolean);
        })
        .onResolve({ filter: /^bun-svelte:/ }, args => {
          console.log("onResolve(virtual css)", args);
          const [ns, name] = args.path.split(":");
          assert(ns === "bun-svelte" && !!name);
          return {
            path: args.path,
            namespace: "bun-svelte",
          };
        })
        // .onLoad({ filter: /^bun-svelte:/, namespace: "bun-svelte" }, args => {
        .onLoad({ filter: /\.css$/, namespace: virtualNamespace }, args => {
          console.log("onLoad(virtual css)", args);
          const { path } = args;
          const code = virtualCssModules.get(path);
          assert(code != null, `bun-svelte-plugin: CSS not found for virtual css module "${path}"`);
          virtualCssModules.delete(path); //
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
