let asked = 0;
Object.defineProperty(module.parent, "exports", { get: () => ({ a: "fake " + ++asked }) });
console.log("below", require("./lib.cjs").a);
