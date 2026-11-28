globalThis.runs = (globalThis.runs ?? 0) + 1;
const atTheTop = require("./real.cjs").from;
exports.say = () => {
  const later = require("./real.cjs").from;
  console.log(atTheTop, later, globalThis.runs, module.children.map(child => child.id.split(/[\\/]/).pop()).join());
};
