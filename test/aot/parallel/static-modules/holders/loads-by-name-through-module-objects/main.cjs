// `require.main.require(..)` and `module.require` held as a value: loads by name, which find an entry point of the executable.
// Entry points: ./x.cjs
const viaMain = require.main.require("./x.cjs");
const held = module.require;
console.log(viaMain.n, held("./x.cjs").n, viaMain === require("./x.cjs"));
