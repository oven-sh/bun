import { fetch } from "undici";
import WebSocket from "ws";
const entry = require.cache.undici;
console.log(typeof entry.exports, entry.exports.fetch === fetch, Object.prototype.toString.call(entry.exports));
console.log(require("undici") === entry.exports, require.cache.ws.exports.default === WebSocket);
