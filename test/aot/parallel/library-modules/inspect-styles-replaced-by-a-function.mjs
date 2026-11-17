// The Function constructor comes out of code of the library under the name `constructor`, and runs the text, as in `bun <file>`: out of util.inspect.styles, once that is a function.
import util from "node:util";
util.inspect.styles = function () {};
try {
  console.log(
    typeof util.inspect(
      {
        [util.inspect.custom](depth, options) {
          return options.stylize("return 6 * 7", "constructor");
        },
      },
      { colors: true },
    ),
  );
} catch (error) {
  console.log(error.name);
}

