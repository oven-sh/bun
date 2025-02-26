import type { BunPlugin, OnLoadResult } from "bun";
import assert from "node:assert";
import svelte from "svelte";
import { makeApplyHmr } from "svelte-hmr/runtime";
import { createMakeHot } from "svelte-hmr";
import { walk, compile, compileModule } from "svelte/compiler";

// export default function SveltePlugin(): BunPlugin {
export interface SvelteOptions {
  /**
   * By default, looks for a `svelte.config.js` in the root of your project
   * (next to `bunfig.toml` or `package.json`).
   */
  configPath?: string;
}
function SveltePlugin(options: SvelteOptions): BunPlugin {
  return {
    name: "bun-plugin-svelte",
    setup(builder) {
      console.log(this);
      builder.config;
      const { minify } = builder?.config ?? {};
      const shouldMinify = Boolean(minify);
      const {
        whitespace: minifyWhitespace,
        syntax: minifySyntax,
        identifiers: minifyIdentifiers,
      } = typeof minify === "object"
        ? minify
        : {
            whitespace: shouldMinify,
            syntax: shouldMinify,
            identifiers: shouldMinify,
          };

      // builder.addDependency(["svelte.config.ts"]);

      builder.onLoad({ filter: /\.svelte$/ }, async args => {
        // assert("side" in args);
        // const side = args.side;
        // assert(side === "client" || side === "server");

        const source = await Bun.file(args.path).text();
        const result = compile(source, {
          // TODO: css: "external". Requires enhancement to bun build allowing multiple OnLoadResults
          css: "external",

          generate: args?.side ?? "server",
          preserveWhitespace: !minifyWhitespace,
          preserveComments: !shouldMinify,
          modernAst: true,
          // TODO: pass hmr flag via builder
          hmr: true,
        });
        // const result = createMakeHot;
        const loadResult: OnLoadResult = {
          contents: result.js.code,
          loader: "ts",
        };
        return loadResult;
        // TODO: multiple results
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
      });
    },
  };
}

export default SveltePlugin();
