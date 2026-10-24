const a = require.call(null, "./module.cjs"), b = require.apply(null, ["./module.cjs"]), c = module.require("./module.cjs"), load = require, d = load("./module.cjs");
console.log(a.a, b.a, c.a, d.a, a === b, b === c, c === d, Object.keys(d).join());
