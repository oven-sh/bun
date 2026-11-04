import * as ws from "ws";
const before = require("ws");
console.log(before === ws, before === ws.default, "ws" in require.cache);
console.log(require.cache.ws.exports === before, require("ws") === before);
