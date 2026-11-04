import * as ws from "ws";
require.cache.ws.exports = { fake: 1 };
console.log(JSON.stringify(require("ws")), typeof ws.default);
