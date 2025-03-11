import type { BunPlugin, BuildConfig, OnLoadResult } from "bun";
import { type CompilerError, parse } from "@vue/compiler-sfc";
import { getBaseParseOptions } from "./options";

interface Options {}

function VuePlugin(option?: Options): BunPlugin {
  return {
    name: "bun-plugin-vue",
    setup(builder) {
      const parseOptions = getBaseParseOptions(builder.config);

      builder.onLoad({ filter: /\.vue$/ }, async args => {
        const source = await Bun.file(args.path).text();
        require.resolve
        const { errors, descriptor } = parse(source, {
          ...parseOptions,
          filename: args.path,

          templateParseOptions: {
            // todo: onError, onWarn. Requires similar hooks in PluginBuilder
          },
        });

        if (errors.length) throw new VueError(errors);
        console.log(descriptor);
        if (descriptor.script) {
          const compiled = new Bun.Transpiler().transform(descriptor.script!.src!);
          return {
            loader: "js",
            content: compiled
          }
        }
      });
    },
  };
}

type VueParseError = CompilerError | SyntaxError;
class VueError extends SyntaxError {
  public line: number | undefined;
  public column: number | undefined;
  public errors: VueParseError[];
  /** First error that occurred */
  public cause: VueParseError;

  constructor(errors: VueParseError[]) {
    const [error] = errors;
    if (errors.length === 1) {
      const error = errors[0];
      super(error.message);
      this.cause = error;
    } else {
      super(`Vue compiler failed with ${errors.length} errors`);
      this.cause = error;
    }
    this.errors = errors;
    const start = (error as CompilerError).loc?.start;
    if (start) {
      this.line = start.line;
      this.column = start.column;
    }
  }
}

export { VuePlugin, type Options };
export default VuePlugin() as BunPlugin;
