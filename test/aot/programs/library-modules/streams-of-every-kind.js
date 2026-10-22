// node:stream: Readable.from, a Readable with read(), a Writable, a Transform, a Duplex, PassThrough, pipeline with a callback and with promises, finished, object mode, back pressure, an error that travels down a pipeline, and destroy.
import { Readable, Writable, Transform, Duplex, PassThrough, pipeline, finished, addAbortSignal } from "node:stream";
import { pipeline as pipelineAsync, finished as finishedAsync } from "node:stream/promises";
import { text, json, buffer } from "node:stream/consumers";

const upper = () => new Transform({ transform(chunk, encoding, done) { done(null, chunk.toString().toUpperCase()); } });
function collect(into) {
  return new Writable({ write(chunk, encoding, done) { into.push(chunk.toString()); done(); } });
}

const first = [];
await pipelineAsync(Readable.from(["a", "b", "c"]), upper(), collect(first));
console.log(first.join());

let count = 0;
const counter = new Readable({ read() { this.push(count < 3 ? String(count++) : null); } });
console.log(await text(counter));

const objects = new Transform({ objectMode: true, transform(value, encoding, done) { done(null, { doubled: value.n * 2 }); } });
const seen = [];
for await (const value of Readable.from([{ n: 1 }, { n: 2 }]).pipe(objects)) seen.push(value.doubled);
console.log(seen.join());

console.log(await new Promise(resolve => pipeline(Readable.from(["x"]), new PassThrough(), collect([]), error => resolve("callback " + error))));
const failing = new Transform({ transform(chunk, encoding, done) { done(new Error("broke in the middle")); } });
console.log(await pipelineAsync(Readable.from(["x"]), failing, collect([])).catch(error => error.message));

const slow = new Writable({ highWaterMark: 2, write(chunk, encoding, done) { setImmediate(done); } });
console.log(slow.write("abc"), await new Promise(resolve => slow.once("drain", () => resolve("drained"))));
slow.end();
await finishedAsync(slow);
console.log(slow.writableFinished, slow.writableEnded);

const duplex = new Duplex({ read() {}, write(chunk, encoding, done) { this.push("echo " + chunk); done(); }, final(done) { this.push(null); done(); } });
duplex.end("hi");
console.log(await text(duplex));
console.log(await json(Readable.from(['{"a":', "1}"])), (await buffer(Readable.from([Buffer.from("ab")]))).length);

const destroyed = new Readable({ read() {} });
const closed = new Promise(resolve => finished(destroyed, error => resolve(error.code)));
destroyed.destroy();
console.log(await closed, destroyed.destroyed);

const controller = new AbortController();
const aborted = addAbortSignal(controller.signal, new Readable({ read() {} }));
const failure = new Promise(resolve => aborted.on("error", error => resolve(error.name)));
controller.abort();
console.log(await failure);
console.log(Readable.from("abc").readableObjectMode, new PassThrough().readableHighWaterMark > 0, typeof Readable.toWeb, typeof Readable.fromWeb);
