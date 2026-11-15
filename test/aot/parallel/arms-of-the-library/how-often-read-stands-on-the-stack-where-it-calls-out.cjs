// Where read() calls out, an error made there lists the functions of the library that stand on the stack. read() stands there once, whichever of its ways the call has taken:
// what it hands its last part to takes its place on the stack.
const { Readable } = require("node:stream");
const lines = [];
const names = where => {
  const library = new Error("made up").stack.split("\n").map(line => /^\s*at (\S+) \((?:internal|node):/.exec(line)?.[1]).filter(name => name !== undefined);
  lines.push(where + ": read stands there " + library.filter(name => name === "read").length + " times; below it: " + library.slice(library.lastIndexOf("read") + 1).join(" < "));
};
const installed = process.nextTick;
for (const options of [{}, { objectMode: true }, { encoding: "utf8" }]) {
  const stream = new Readable({ ...options, read: size => names("_read") });
  stream.on("data", () => names("data"));
  stream.pause();
  process.nextTick = function (callback, ...rest) {
    names("nextTick");
    return installed.call(process, callback, ...rest);
  };
  stream.push("page");
  stream.read();
  stream.read();
  stream.read(0);
  stream.push("page");
  stream.push("page");
  stream.read(2);
  stream.read();
  stream.push(null);
  stream.read();
  stream.read();
  process.nextTick = installed;
}
console.log(lines.join("\n"));
