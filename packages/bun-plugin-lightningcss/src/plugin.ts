import browserslist from "browserslist";
import { BunPlugin } from "bun";
import { browserslistToTargets } from "lightningcss";
import { loader } from "./loader";

export function LightningCSSPlugin(): BunPlugin {
  const targets = browserslistToTargets(browserslist());

  return {
    name: "bun-plugin-lightningcss",
    setup(builder) {
      // if (!builder.config) {
      //   throw new Error("CSS can only be imported when building with Bun.build");
      // }
      // if (builder.config.target !== undefined && builder.config.target !== "browser") {
      //   throw new Error("CSS can only be imported when bundling for target 'browser'");
      // }
      builder.onLoad(
        { filter: /\.module.css$/ },
        async args => await loader(args, { ...builder.config, targets, cssModules: true }),
      );
      builder.onLoad({ filter: /\.css$/ }, async args => await loader(args, { ...builder.config, targets }));
    },
  };
}
