import { Duplex, Readable, Transform } from "node:stream";

const lines = [];
const tell = (title, stream) => {
  const state = stream._readableState;
  const own = Reflect.ownKeys(state).map(key => (typeof key === "symbol" ? "[" + key.description + "]" : key));
  lines.push(
    title + ": " + own.join() + " | " + [state.encoding, state.defaultEncoding, state.decoder?.constructor.name, state.decoder?.encoding].join() +
      " | " + ["encoding", "defaultEncoding", "decoder"].map(name => Object.hasOwn(state, name) + ":" + (name in state)).join(),
  );
};
const read = () => {};
for (const [title, options] of [
  ["nothing", undefined],
  ["no encoding", { read }],
  ["an encoding", { read, encoding: "hex" }],
  ["a default encoding", { read, defaultEncoding: "latin1" }],
  ["utf8 as the default", { read, defaultEncoding: "utf8" }],
  ["utf-8 as the default", { read, defaultEncoding: "utf-8" }],
  ["both", { read, encoding: "base64", defaultEncoding: "ucs2" }],
  ["an empty encoding", { read, encoding: "" }],
]) {
  tell("Readable, " + title, new Readable(options));
  tell("Duplex, " + title, new Duplex({ ...options, write(chunk, encoding, done) { done(); } }));
  tell("Transform, " + title, new Transform({ ...options, read: undefined }));
}
for (const defaultEncoding of ["made up", 5, {}]) {
  try {
    tell("never", new Readable({ read, defaultEncoding }));
  } catch (error) {
    lines.push("a default encoding that is none: " + error.code);
  }
}
{
  const later = new Readable({ read });
  later.setEncoding("hex");
  tell("setEncoding() behind the constructor", later);
  later._readableState.encoding = null;
  later._readableState.decoder = null;
  later._readableState.defaultEncoding = "ascii";
  tell("stored by the program", later);
  later.push(Buffer.from("ab"));
  lines.push("read: " + String(later.read()));
}
{
  const hex = new Readable({ read, encoding: "hex" });
  hex.push(Buffer.from("ab"));
  lines.push("read in hex: " + hex.read());
  const text = new Readable({ read, defaultEncoding: "hex" });
  text.push("6162");
  lines.push("pushed in hex: " + text.read());
}
console.log(lines.join("\n"));
