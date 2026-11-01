// Prints how the state objects of streams and the functions of node:path describe themselves: names, own keys, texts, and what the two inspectors say.
const path = require("node:path");
const stream = require("node:stream");
const net = require("node:net");
const zlib = require("node:zlib");
const util = require("node:util");

for (const flavor of ["posix", "win32"]) {
  for (const key of Object.keys(path[flavor])) {
    const value = path[flavor][key];
    if (typeof value !== "function") continue;
    console.log(flavor, key, JSON.stringify(value.name), value.length, Reflect.ownKeys(value).join(), Bun.inspect(value), util.inspect(value), String(value).replace(/\s+/g, " "));
    console.log(JSON.stringify(Object.getOwnPropertyDescriptor(value, "name")));
  }
}
console.log(util.inspect(path.posix, { depth: 0 }));
console.log(Bun.inspect(path.win32, { depth: 0 }));
try {
  path.join({});
} catch (error) {
  console.log(error.stack.split("\n")[1].trim());
}

const made = {
  readable: new stream.Readable(),
  writable: new stream.Writable(),
  duplex: new stream.Duplex(),
  transform: new stream.Transform(),
  socket: new net.Socket(),
  gzip: zlib.createGzip(),
};
for (const [name, value] of Object.entries(made)) {
  for (const key of ["_readableState", "_writableState"]) {
    const state = value[key];
    if (state === undefined) continue;
    const prototype = Object.getPrototypeOf(state);
    console.log(name, key, Object.hasOwn(prototype, "constructor"), state.constructor === Object, Reflect.ownKeys(prototype).length);
    console.log(Bun.inspect(state).split("\n")[0], util.inspect(state).split("\n")[0], util.inspect({ state }, { depth: 0 }));
  }
}
console.log(util.inspect(made.duplex));
console.log(Bun.inspect(made.duplex));
