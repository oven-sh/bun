import type { BunPlugin, OnLoadResult } from "bun";
import assert from "node:assert";
import svelte from "svelte";
import { makeApplyHmr } from "svelte-hmr/runtime";
import { walk, compile, compileModule } from "svelte/compiler";

export default function SveltePlugin(): BunPlugin {
  return {
    name: "bun-plugin-svelte",
    setup(builder) {
      console.log(this);
      builder.config;
      const { minify } = builder.config;
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

      builder.onLoad({ filter: /\.svelte$/ }, async args => {
        assert("side" in args);
        const side = args.side;
        assert(side === "client" || side === "server");

        const source = await Bun.file(args.path).text();
        const result = compile(source, {
          // TODO: css: "external". Requires enhancement to bun build allowing multiple OnLoadResults
          // css: "external",

          generate: side,
          preserveWhitespace: !minifyWhitespace,
          preserveComments: !shouldMinify,
          modernAst: true,
        });
        const loadResult: OnLoadResult = {
          contents: result.js.code,
          loader: "ts",
        };
        return loadResult;
      });
    },
  };
}
