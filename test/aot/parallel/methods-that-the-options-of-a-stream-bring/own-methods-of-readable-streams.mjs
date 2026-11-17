// new Readable({ read, destroy, construct }): the three are own properties of the stream, in the order in which Node.js stores them, and they are what runs.
import { Readable, Duplex, PassThrough } from "node:stream";

function show(label, stream) {
  const names = Object.keys(stream).filter(name => name === "_read" || name === "_destroy" || name === "_construct" || name === "_events" || name === "_readableState" || name === "_maxListeners");
  console.log(label, "|", names.join(" "), "|", ["_read", "_destroy", "_construct"].map(name => `${name} ${Object.hasOwn(stream, name)} ${JSON.stringify(Object.getOwnPropertyDescriptor(stream, name), (key, value) => (typeof value === "function" ? "function " + value.name : value))}`).join(" . "));
}

function drain(stream) {
  return new Promise(resolve => {
    const seen = [];
    stream.on("data", chunk => seen.push(String(chunk)));
    stream.on("error", error => seen.push("error " + error.message));
    stream.on("close", () => resolve(seen.join(",")));
  });
}

for (let turn = 0; turn < 3; turn++) {
  const log = [];
  const all = new Readable({
    construct(callback) { log.push("construct"); callback(); },
    read() { log.push("read"); this.push("a"); this.push(null); },
    destroy(error, callback) { log.push("destroy"); callback(error); },
  });
  show("all three", all);
  console.log(" ", await drain(all), log.join(" "));

  const one = new Readable({ read() { this.push(null); } });
  show("read alone", one);
  console.log(" ", await drain(one));

  const none = new Readable();
  show("none", none);
  none._read = function () { this.push("late"); this.push(null); };
  show("stored later", none);
  console.log(" ", await drain(none));

  show("no functions", new Readable({ read: 1, destroy: "x", construct: null }));

  class Heir extends Readable {
    _read() { this.push("heir"); this.push(null); }
  }
  const heir = new Heir();
  show("an heir with a method", heir);
  console.log(" ", await drain(heir));
  const overridden = new Heir({ read() { this.push("option"); this.push(null); } });
  show("an heir and an option", overridden);
  console.log(" ", await drain(overridden));

  class Watched extends Readable {
    set _read(value) { log.push("setter of _read"); Object.defineProperty(this, "_read", { value, writable: true, configurable: true, enumerable: true }); }
    get _read() { return Readable.prototype._read; }
  }
  const watched = new Watched({ read() { this.push(null); } });
  show("an heir with a setter", watched);
  console.log(" ", await drain(watched), log.filter(line => line.startsWith("setter")).length);

  const frozen = Object.freeze(Object.create(Readable.prototype));
  try {
    Readable.call(frozen, { read() {} });
    console.log("a frozen receiver: no error");
  } catch (error) {
    console.log("a frozen receiver:", error.constructor.name);
  }

  show("Readable.from", Readable.from(["x"]));
  show("a Duplex", new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } }));
  show("a PassThrough", new PassThrough());
}
