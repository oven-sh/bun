globalThis.runs = (globalThis.runs ?? 0) + 1;
const atTheTop = require("os").from;
exports.say = () => {
  const later = require("os").from;
  console.log(atTheTop, later, globalThis.runs, module.children.map(child => child.id.split(/[\\/]/).pop()).join());
};
