import * as ws from "ws";
console.log(
  delete require.cache.ws,
  "ws" in require.cache,
  Object.keys(require.cache).includes("ws"),
  typeof require.cache.ws,
);
const again = require("ws");
console.log("ws" in require.cache, again === ws.default, require.cache.ws.exports === again);
