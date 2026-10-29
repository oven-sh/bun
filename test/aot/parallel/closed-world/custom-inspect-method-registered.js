// Custom inspect method under a registered name made at run time.
const key = Symbol.for("nodejs.util.inspect." + (process.env.LAST ?? "custom"));
const printed = { plain: 1 };
printed[key] = function (depth, options, inspect) { return "under a registered name made at run time " + typeof inspect; };
console.log(printed);
