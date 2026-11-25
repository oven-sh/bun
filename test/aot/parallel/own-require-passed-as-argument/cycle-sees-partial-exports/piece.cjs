const { run } = require("./caller.cjs");
console.log(JSON.stringify(run(require, "./leaf.cjs")));
