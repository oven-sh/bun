import * as ws from "ws";
import Module from "node:module";
const entry = require.cache.ws;
console.log(typeof entry, entry.exports === ws, entry.id, entry.filename, entry.loaded, Array.isArray(entry.children));
console.log(entry === require.cache.ws, entry === Module._cache.ws, Object.keys(entry).join());
const after = require("ws");
console.log("behind the read", after === ws, after === ws.default, Object.prototype.toString.call(after));
function again() {
  const answer = require("ws");
  return answer === ws ? "namespace" : answer === ws.default ? "default" : "other";
}
console.log(again(), typeof after.WebSocket, typeof after.default);
