// `new Readable({ read() {} })`: the library reads `options?.defaultEncoding` and `opts?.captureRejections`, which this record does not list, and goes on in typed code.
// COUNT: arrivals <= 11000
"use strict";
const { Readable } = require("node:stream");

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const stream = new Readable({ read() {} });
  sum += stream.readableHighWaterMark + stream.readableLength + (stream.readableObjectMode ? 1 : 0);
}
console.log(sum);

// The compiler does not see which names these are.
const encoding = ["default", "Encoding"].join("");
const capture = ["capture", "Rejections"].join("");
function show(what, make) {
  try {
    const stream = new Readable(make());
    const state = stream._readableState;
    const symbols = Object.getOwnPropertySymbols(stream).map(symbol => `${String(symbol)}=${String(stream[symbol])}`);
    console.log(what, state.defaultEncoding, state.highWaterMark, state.objectMode, typeof stream._read, symbols.join(" "));
  } catch (error) {
    console.log(what, error.constructor.name, error.code, error.message);
  }
}
const bare = () => ({ read() {} });

show("left out", bare);
show("nothing", () => undefined);
show("null", () => null);
show("listed", () => ({ read() {}, defaultEncoding: "latin1", captureRejections: true }));
show("listed and undefined", () => ({ read() {}, defaultEncoding: undefined, captureRejections: undefined }));
show("an encoding nobody knows", () => ({ read() {}, defaultEncoding: "none" }));
show("no boolean", () => ({ read() {}, captureRejections: 1 }));
show("added later", () => Object.assign(bare(), { [encoding]: "hex", [capture]: true }));
show("added and deleted", () => {
  const options = Object.assign(bare(), { [encoding]: "hex", [capture]: true });
  delete options[encoding];
  delete options[capture];
  return options;
});
show("getters of its own", () => Object.defineProperties(bare(), { [encoding]: { get: () => "ascii" }, [capture]: { get: () => true } }));
show("a getter that throws", () =>
  Object.defineProperty(bare(), encoding, {
    get() {
      throw new RangeError("no encoding");
    },
  }),
);
show("frozen", () => Object.freeze(bare()));
show("another prototype", () => Object.setPrototypeOf(bare(), { [encoding]: "ucs2", [capture]: true }));
show("no prototype", () => Object.setPrototypeOf(bare(), null));
show("a getter above that changes the object", () => {
  const options = bare();
  return Object.setPrototypeOf(options, {
    get [encoding]() {
      options.encoding = "utf8";
      return "binary";
    },
  });
});
show("a proxy", () => new Proxy(bare(), { get: (target, name) => (name === encoding ? "utf16le" : target[name]) }));
show("below a record that lists them", () => Object.create({ read() {}, defaultEncoding: "hex", captureRejections: true }));

let after = 0;
for (let i = 0; i < 100; i++) after += new Readable({ read() {} }).readableHighWaterMark;
console.log(after);
