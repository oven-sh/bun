// The same for the socket of a response that has none, which extends what lies under `Duplex`.
"use strict";
const stream = require("node:stream");
const Was = stream.Duplex;
class Mine extends Was {}
stream.Duplex = Mine;
try {
  const http = require("node:http");
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 });
  console.log(response.socket instanceof Mine);
} catch (error) {
  console.log(error.name + ": " + error.message);
}
/* Output:
TypeError: stream.Duplex was replaced before node:http was loaded. In a compiled executable the classes of node:http extend the one that Bun made: add to stream.Duplex.prototype instead, or load node:http first.
*/
