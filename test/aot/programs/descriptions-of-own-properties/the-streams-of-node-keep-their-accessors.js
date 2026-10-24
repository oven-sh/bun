// internal/streams/duplex takes nine accessors of Writable.prototype by their descriptions. They answer on a Duplex, on a Transform and on a socket.
const { Duplex, Transform, PassThrough, Writable, Readable } = require("node:stream");
const net = require("node:net");
const names = ["writable", "writableHighWaterMark", "writableObjectMode", "writableBuffer", "writableLength", "writableFinished", "writableCorked", "writableEnded", "writableNeedDrain", "destroyed"];
for (const [label, stream] of [["Duplex", new Duplex({ read() {}, write(chunk, encoding, done) { done(); } })], ["Transform", new Transform()], ["PassThrough", new PassThrough()], ["Socket", new net.Socket()]]) {
  console.log(label, names.map(name => JSON.stringify(stream[name])).join(" "));
}
for (const name of names) {
  const own = Object.getOwnPropertyDescriptor(Duplex.prototype, name);
  const source = Object.getOwnPropertyDescriptor(Writable.prototype, name);
  console.log(name, typeof own.get, name === "destroyed" ? own.get !== source.get : own.get === source.get);
}
const through = new PassThrough();
through.cork();
through.write("held");
console.log(through.writableCorked, through.writableLength, through.readableLength, through.readableFlowing, through.readable);
through.uncork();
through.end();
through.on("data", chunk => console.log("data", String(chunk)));
through.on("end", () => console.log("end", through.writableFinished, through.writableEnded, through.readableEnded));
console.log(Object.keys(Readable.prototype).length > 10, Object.keys(Writable.prototype).length > 5);
