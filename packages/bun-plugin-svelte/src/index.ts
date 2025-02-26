import type { BunPlugin, OnLoadResult } from "bun";
import { strict as assert } from "node:assert";
// import svelte from "svelte";
// import { makeApplyHmr } from "svelte-hmr/runtime";
// import { createMakeHot } from "svelte-hmr";
// import { walk, compile, compileModule, type CompileOptions } from
// "svelte/compiler";
import { compile } from "svelte/compiler";
import { getBaseCompileOptions, type SvelteOptions } from "./options";

const kEmptyObject = Object.create(null);

function SveltePlugin(options?: SvelteOptions): BunPlugin {
  const { configPath, forceSide } = options ?? {};
  return {
    name: "bun-plugin-svelte",
    setup(builder) {
      console.log(this);
      const baseCompileOptions = getBaseCompileOptions(options ?? kEmptyObject, builder.config ?? kEmptyObject);

      builder.onLoad({ filter: /\.svelte$/ }, async args => {
        assert(args && typeof args === "object");
        // FIXME: "side" missing when passed to `Bun.plugin`
        // assert("side" in args);
        // const side = args.side;
        // assert(side === "client" || side === "server");

        const side =
          args && "side" in args // "side" only passed when run from dev server
            ? (args as { side: "client" | "server" }).side
            : "server";

        const source = await Bun.file(args.path).text();
        const result = compile(source, {
          ...baseCompileOptions,
          generate: baseCompileOptions.generate ?? side,
        });
        // const result = createMakeHot;
        const loadResult: OnLoadResult = {
          contents: result.js.code,
          loader: "ts",
        };
        return loadResult;
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
      });
    },
  };
}

export default SveltePlugin() as BunPlugin;
export { SveltePlugin, type SvelteOptions };
