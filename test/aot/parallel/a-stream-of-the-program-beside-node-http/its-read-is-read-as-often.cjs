// A program that has loaded node:http makes streams of its own. What they hold under _read is an accessor that counts: the library reads it as often as without node:http.
require("node:http");
const { Readable } = require("node:stream");

function counted(label, use) {
  let reads = 0;
  class Counted extends Readable {
    get _read() {
      reads++;
      return function () {};
    }
  }
  const stream = new Counted();
  use(stream);
  setImmediate(() => setImmediate(() => console.log(label, "| _read was read", reads, "times")));
}
counted("a listener for data, then an empty text is pushed", stream => {
  stream.on("data", () => {});
  stream.push("");
});
counted("a listener for data", stream => stream.on("data", () => {}));
counted("resume", stream => stream.resume());
counted("resume, pause, resume", stream => {
  stream.resume();
  stream.pause();
  stream.resume();
});
counted("a listener for readable", stream => stream.on("readable", () => {}));
