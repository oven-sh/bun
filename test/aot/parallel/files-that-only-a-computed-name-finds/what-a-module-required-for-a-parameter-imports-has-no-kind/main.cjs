// tools.cjs requires what it is handed. plug.mjs runs inside that require, and so does plain.cjs, which says nothing of its kind: it is a CommonJS file there.
const tools = require("./tools.cjs");
const plug = tools.load("./plug.mjs");
console.log(plug.kind, "|", plug.shape);
