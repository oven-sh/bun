// Folded calls: visible accessors2. It prints what plain Bun prints.
const { Readable, Writable } = require("node:stream");
const out = {};
for (const [name, state] of [["ReadableState", new Readable({ read() {} })._readableState], ["WritableState", new Writable({ write() {} })._writableState]]) {
  const proto = Object.getPrototypeOf(state);
  out[name] = { prototypeNames: Reflect.ownKeys(proto).map(String).sort(), ownKeys: Reflect.ownKeys(state).map(String), reachable: name === "ReadableState" ? Readable.ReadableState === proto.constructor : Writable.WritableState === proto.constructor, constructorLength: proto.constructor.length, constructorName: proto.constructor.name, text: String(proto.constructor).slice(0, 22) };
}
console.log(JSON.stringify(out));
