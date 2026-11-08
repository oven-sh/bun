// Behind the load nobody asks again; and a getter that answers with Bun's own class is as good as the class.
"use strict";
const stream = require("node:stream");
const reads = { Stream: 0, Duplex: 0 };
for (const name of Object.keys(reads)) {
  const held = stream[name];
  Object.defineProperty(stream, name, {
    configurable: true,
    get() {
      reads[name]++;
      return held;
    },
  });
}
const http = require("node:http");
console.log(reads.Stream > 0, reads.Duplex > 0);
for (const name of Object.keys(reads)) Object.defineProperty(stream, name, { value: class Mine {}, writable: true });
const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 });
console.log(response instanceof stream.Stream, response.socket instanceof stream.Duplex, typeof response.socket.write);
