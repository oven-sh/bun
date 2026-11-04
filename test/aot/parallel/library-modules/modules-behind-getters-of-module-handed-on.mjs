// node:timers, node:stream and node:readline go through a value that the build cannot follow. The modules behind their `promises` getters are read and used under computed names.
import * as timers from "node:timers";
import * as stream from "node:stream";
import * as readline from "node:readline";
const hide = value => new CustomEvent("x", { detail: value }).detail;
console.log(await hide(timers)[hide("promises")][hide("setImmediate")]("done"));
await hide(stream)[hide("promises")][hide("pipeline")](
  stream.Readable.from(["a", "b"]),
  new stream.Writable({ write: (chunk, encoding, done) => (console.log(String(chunk)), done()) }),
);
const lines = hide(readline)[hide("promises")][hide("createInterface")]({
  input: stream.Readable.from(["one\ntwo\n"]),
});
for await (const line of lines) console.log(line);
