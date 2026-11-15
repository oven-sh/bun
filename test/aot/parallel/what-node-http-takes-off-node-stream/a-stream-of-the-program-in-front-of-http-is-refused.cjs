// `bun run` makes OutgoingMessage extend what lies under `Stream` on node:stream when node:http is loaded. In an executable the class above it is compiled in, and node:http says so instead of going by its own in silence.
"use strict";
const stream = require("node:stream");
const Was = stream.Stream;
function Mine(...given) {
  return Was.apply(this, given);
}
Mine.prototype = Object.create(Was.prototype, { constructor: { value: Mine, writable: true, configurable: true } });
stream[JSON.parse('"Stream"')] = Mine;
try {
  const http = require("node:http");
  console.log(Object.getPrototypeOf(http.OutgoingMessage.prototype) === Mine.prototype);
} catch (error) {
  console.log(error.name + ": " + error.message);
}
stream.Stream = Was;
console.log(typeof require("node:http").OutgoingMessage);
/* Output:
TypeError: stream.Stream was replaced before node:http was loaded. In a compiled executable the classes of node:http extend the one that Bun made: add to stream.Stream.prototype instead, or load node:http first.
function
*/
