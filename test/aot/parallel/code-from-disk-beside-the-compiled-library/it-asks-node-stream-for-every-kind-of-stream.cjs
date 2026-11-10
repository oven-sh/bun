// The program names node:util, which leads to two modules of node:stream and to no stream. A file that it writes and loads at run time asks for all of node:stream.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
// The compiler can't see text that is decoded at run time.
const decoded = text => Buffer.from(text).toString();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "code-beside-streams-"));
const file = path.join(folder, "asks.cjs");
fs.writeFileSync(
  file,
  `
const { Readable, Writable, Duplex, Transform, pipeline, finished } = require("node:stream");
module.exports = async function (say) {
  const objects = new Readable({ objectMode: true, read() {} });
  say("objects", objects.readableObjectMode, objects.readableHighWaterMark, objects.readableFlowing);
  objects.push({ n: 1 });
  objects.push(null);
  const seen = [];
  for await (const it of objects) seen.push(JSON.stringify(it));
  say("read", seen.join(" "), objects.readableEnded, objects.destroyed, objects.closed);
  const written = [];
  const sink = new Writable({
    write(chunk, encoding, done) {
      written.push(String(chunk));
      done();
    },
  });
  const upper = new Transform({
    transform(chunk, encoding, done) {
      done(null, String(chunk).toUpperCase());
    },
  });
  await new Promise((resolve, reject) =>
    pipeline(Readable.from(["a", "b"]), upper, sink, error => (error ? reject(error) : resolve())),
  );
  say("piped", written.join(""), sink.writableFinished, sink.writableLength, upper.destroyed);
  const both = new Duplex({
    read() {
      this.push(null);
    },
    write(chunk, encoding, done) {
      done();
    },
  });
  both.resume();
  both.end("x");
  await new Promise(resolve => finished(both, resolve));
  say("both", both.readableEnded, both.writableFinished, both.errored);
  const failing = new Readable({ read() {} });
  const failed = new Promise(resolve => failing.once("error", error => resolve(error.message)));
  failing.destroy(new Error("torn down"));
  say("failing", await failed, failing.destroyed, failing.readableAborted, String(failing.errored));
};
`,
);

async function main() {
  console.log(util.format("%s of the program", "a line"));
  await require(decoded(file))((...words) => console.log(words.join(" ")));
  fs.rmSync(folder, { recursive: true });
}
main();
