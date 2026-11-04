const tools = require("./tools.cjs");
const which = globalThis.never ? "first" : "second";
console.log(tools[which](), Object.keys(tools).join());