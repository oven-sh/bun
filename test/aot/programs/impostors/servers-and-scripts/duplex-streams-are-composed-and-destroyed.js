import { on } from "node:events";
import { Duplex, PassThrough, Readable, Transform, Writable, addAbortSignal, compose, finished, pipeline } from "node:stream";
import { finished as finishedPromise } from "node:stream/promises";
import { EventEmitter } from "node:events";

const written = [];
const duplex = new Duplex({
  read() {
    this.push(written.length ? "read after " + written.length : null);
    if (written.length) this.push(null);
  },
  write(chunk, encoding, done) {
    written.push(chunk.toString());
    done();
  },
});
duplex.write("a");
duplex.end("b");
let read = "";
for await (const piece of duplex) read += piece;
console.log(written, read, duplex.writableFinished, duplex.readableEnded);

const shout = new Transform({ transform: (chunk, encoding, done) => done(null, chunk.toString().toUpperCase()) });
const exclaim = new Transform({ transform: (chunk, encoding, done) => done(null, chunk + "!") });
console.log(await Readable.from(["a", "b"]).pipe(compose(shout, exclaim)).toArray().then(parts => parts.join("")));
console.log(await Readable.from([1, 2, 3, 4, 5]).filter(n => n % 2).map(n => n * 10).take(2).toArray(), await Readable.from([1, 2, 3]).reduce((sum, n) => sum + n, 0), await Readable.from(["x"]).some(v => v === "x"));

const broken = new Readable({ read() { this.destroy(new RangeError("source broke")); } });
console.log(await new Promise(resolve => pipeline(broken, new PassThrough(), new Writable({ write: (c, e, done) => done() }), error => resolve(error.message))));
const slow = new Writable({ highWaterMark: 2, write: (chunk, encoding, done) => setTimeout(done, 1) });
console.log(slow.write("abc"), slow.writableNeedDrain, slow.writableLength, await new Promise(resolve => slow.once("drain", () => resolve("drained"))), slow.writableHighWaterMark);
slow.end();
await finishedPromise(slow);
try {
  slow.write("late");
} catch (error) {
  console.log("threw", error.code);
}
slow.on("error", error => console.log("error event", error.code));
const controller = new AbortController();
const aborted = addAbortSignal(controller.signal, new Readable({ read() {} }));
finished(aborted, error => console.log("finished with", error.name, aborted.destroyed));
controller.abort();
await new Promise(resolve => setImmediate(resolve));
const web = Readable.toWeb(Readable.from(["to ", "web"]));
console.log(await new Response(web.pipeThrough(new TextEncoderStream())).text(), await Readable.fromWeb(new Blob(["from web"]).stream()).toArray().then(parts => Buffer.concat(parts).toString()));
const emitter = new EventEmitter();
setTimeout(() => { emitter.emit("tick", 1); emitter.emit("tick", 2); emitter.emit("end"); }, 1);
const ticks = [];
for await (const [value] of on(emitter, "tick", { close: ["end"] })) ticks.push(value);
console.log(ticks, Readable.prototype.isPaused.call(new Readable()), new PassThrough({ objectMode: true }).readableObjectMode, Duplex.from("text") instanceof Duplex);
