// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import querystring from "node:querystring";
const name = ["sum", "Precise"].join("");
const own = function (depth, options, inspect) {
  inspect.styles = Math;
  return String(options.stylize([1, 2], name));
};
console.log(
  Bun.inspect(
    querystring.decode("a=b", null, null, { decodeURIComponent: text => (text === "a" ? Bun.inspect.custom : own) }),
    { colors: true },
  ),
);
