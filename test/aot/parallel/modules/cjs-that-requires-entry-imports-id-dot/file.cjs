const who = m => (m === undefined ? "undefined" : m === null ? "null" : m.id === "." ? "." : require("node:path").basename(m.filename));
console.log("file: parent", who(module.parent), "id", module.id === "." ? "." : require("node:path").basename(module.id), "main", require.main === module);
module.exports = { first: 1, second: 2 };
const main = module.require("./main.mjs");
console.log("file: main", Object.keys(main).join());
setTimeout(() => console.log("file: later", who(module.parent), module.id));
