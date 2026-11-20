// below.cjs reaches the module object of lib.cjs, which required it first, by `module.parent`.
console.log(require("./lib.cjs").a, require("./user.cjs").seen());
require("./below.cjs").strike({ a: "fake" });
console.log(require("./lib.cjs")?.a, require("./" + JSON.parse('"lib.cjs"'))?.a, require("./user.cjs").seen());
