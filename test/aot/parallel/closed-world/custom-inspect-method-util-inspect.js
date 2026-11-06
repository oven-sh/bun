// Custom inspect method under util inspect custom.
const { inspect } = require("node:util");
const printed = { [inspect.custom](depth, options) { return options.stylize("styled", "special"); } };
console.log(printed);
console.log(inspect(printed), inspect({ a: [1, { b: 2 }] }, { depth: 0 }));
