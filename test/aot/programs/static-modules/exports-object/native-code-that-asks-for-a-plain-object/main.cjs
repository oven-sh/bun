// structuredClone, Bun.deepEquals, util.inspect, assert.deepStrictEqual, Object.entries and postMessage get the exports object of a module that stores one name.
const a = require("./a.cjs");
const util = require("node:util"),
  assert = require("node:assert");
console.log(structuredClone(a).x, JSON.stringify(a), Bun.deepEquals(a, { x: 1 }));
console.log(util.inspect(a), util.isDeepStrictEqual(a, { x: 1 }), Object.entries(a).map(entry => entry.join("=")).join());
console.log(assert.deepStrictEqual(a, { x: 1 }) === undefined);
const { port1, port2 } = new MessageChannel();
port2.onmessage = event => {
  console.log(event.data.x);
  port1.close();
};
port1.postMessage(a);
