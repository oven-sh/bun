// `module.children` hands out the module object of another file. What the program defines under its `exports` is what whoever requires that file next gets: a getter is asked each time.
console.log(require("./lib.cjs").a, require("./user.cjs").seen());
let asked = 0;
Object.defineProperty(module.children[0], "exports", { get: () => ({ a: "fake " + ++asked }) });
console.log(require("./lib.cjs")?.a, require("./" + JSON.parse('"lib.cjs"'))?.a, require("./user.cjs").seen());
