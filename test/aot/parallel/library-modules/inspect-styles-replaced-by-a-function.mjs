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

/* Output:
EvalError
*/
