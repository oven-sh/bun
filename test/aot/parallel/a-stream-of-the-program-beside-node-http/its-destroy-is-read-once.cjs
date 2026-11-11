// A program that has loaded node:http makes a stream of its own. What the stream holds under _destroy is an accessor that counts: the library reads it as often as without node:http.
require("node:http");
const { Readable } = require("node:stream");

let reads = 0;
class Counted extends Readable {
  _read() {
    this.push(null);
  }
  get _destroy() {
    reads++;
    return super._destroy;
  }
}
new Counted().on("close", () => console.log("_destroy was read", reads, "times")).resume();
