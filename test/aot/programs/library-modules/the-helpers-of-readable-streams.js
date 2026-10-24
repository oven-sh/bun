// The methods that node:stream puts on Readable for working with values: map, filter, flatMap, take, drop, reduce, toArray, forEach, some, every, find, with concurrency and an abort; then compose, Duplex.from, duplexPair, wrap, and the functions that ask about a stream.
import stream, { Readable, Writable, Duplex, Transform, PassThrough, compose, isReadable, isErrored, isDisturbed, getDefaultHighWaterMark, setDefaultHighWaterMark } from "node:stream";
import { EventEmitter } from "node:events";

const numbers = () => Readable.from([1, 2, 3, 4, 5]);
console.log((await numbers().map(n => n * 2).toArray()).join(), (await numbers().filter(n => n % 2).toArray()).join(), (await numbers().flatMap(n => [n, n]).take(4).toArray()).join(), (await numbers().drop(3).toArray()).join());
console.log(await numbers().reduce((sum, n) => sum + n, 0), await numbers().some(n => n > 4), await numbers().every(n => n > 4), await numbers().find(n => n > 2));
const visited = [];
await numbers().forEach(n => visited.push(n));
console.log(visited.join(), (await numbers().map(async n => { await null; return n + 1; }, { concurrency: 2 }).toArray()).join());
console.log(await numbers().map(n => { if (n === 3) throw new RangeError("at three"); return n; }).toArray().catch(error => error.message));
console.log(await numbers().toArray({ signal: AbortSignal.abort() }).catch(error => error.name));

const shout = new Transform({ transform(chunk, encoding, done) { done(null, chunk.toString().toUpperCase()); } });
const twice = new Transform({ transform(chunk, encoding, done) { done(null, chunk.toString().repeat(2)); } });
const composed = compose(shout, twice);
composed.end("ab");
console.log((await composed.toArray()).join(""));
console.log((await Readable.from(["x", "y"]).compose(async function* (source) { for await (const part of source) yield part + "!"; }).toArray()).join());

const fromGenerator = Duplex.from(async function* (source) { for await (const part of source) yield "got " + part; });
fromGenerator.end("input");
console.log((await fromGenerator.toArray()).join(), (await Duplex.from(Promise.resolve("a promise")).toArray()).join(), (await Duplex.from(["a", "list"]).toArray()).join());
if (stream.duplexPair) {
  const [left, right] = stream.duplexPair();
  left.end("across");
  console.log((await right.toArray()).join());
} else console.log("across");

const old = new EventEmitter();
old.pause = old.resume = () => {};
const wrapped = new Readable({ objectMode: true }).wrap(old);
setImmediate(() => { old.emit("data", "from an old stream"); old.emit("end"); });
console.log((await wrapped.toArray()).join());

const fresh = new PassThrough();
console.log(isReadable(fresh), isErrored(fresh), isDisturbed(fresh), Readable.isDisturbed(fresh), stream.isWritable?.(fresh), getDefaultHighWaterMark(true), getDefaultHighWaterMark(false) >= 16384);
fresh.destroy(new Error("destroyed"));
fresh.on("error", () => {});
console.log(isReadable(fresh), isErrored(fresh), fresh.errored.message, fresh.closed, fresh.readableAborted, typeof setDefaultHighWaterMark, stream.Stream === stream, typeof stream.promises.pipeline);
const iterator = numbers().iterator({ destroyOnReturn: false });
console.log((await iterator.next()).value, typeof numbers()[Symbol.asyncDispose], numbers().readableFlowing, new Writable().writableNeedDrain, new Writable().writableCorked);
