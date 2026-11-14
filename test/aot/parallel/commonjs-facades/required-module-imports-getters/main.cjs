// The loader calls the getters of lib.cjs while require() loads the module that imports it.
const { state } = require("./state.cjs");
function load() { const before = state.reads; const loaded = require("./user.mjs"); const after = state.reads; return [before, after, loaded.value, state.point.x]; }
console.log(load().join(), load().join());
const item = state.point;
let sum = 0;
for (let i = 0; i < 20; i++) sum += item.x + i;
console.log(sum, state.reads);
