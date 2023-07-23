import browserslist from "browserslist";
import { BunPlugin } from "bun";
import { browserslistToTargets } from "lightningcss";
import { loader } from "./loader";

export type LightningCSSPluginOptions = {
  /**
   * Minify the CSS output. Defaults to true.
   */
  minify?: boolean;
  /**
   * Whether to output a source map. Defaults to false.
   */
  sourceMap?: boolean;
};

export function LightningCSSPlugin(options?: LightningCSSPluginOptions): BunPlugin {
  const targets = browserslistToTargets(browserslist());

  return {
    name: "bun-plugin-lightningcss",
    setup(builder) {
      builder.onLoad(
        { filter: /\.module.css$/ },
        async args => await loader(args, { ...options, targets, cssModules: true }),
      );
      builder.onLoad({ filter: /\.css$/ }, async args => await loader(args, { ...options, targets }));
    },
  };
}
