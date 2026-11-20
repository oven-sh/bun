// What a Readable in object mode holds back until it is read, and whom it pipes to: whole numbers, fractions, texts, objects, holes that reading leaves.
import { Readable, Writable } from "node:stream";

const values = [1, 2, -1, 0, -0, 1.5, NaN, Infinity, 2 ** 31, 2 ** 53, "text", "", true, false, undefined, 10n, Symbol.for("s"), { a: 1 }, [1], () => {}, new Date(0)];
const show = value => (Object.is(value, -0) ? "-0" : typeof value === "symbol" || typeof value === "bigint" ? typeof value + String(value.toString()) : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

for (const order of [values, [...values].reverse(), [1, 2, 3], [1.5, 2.5], [1, 1.5, "x"], ["x", 1]]) {
  const stream = new Readable({ objectMode: true, highWaterMark: 100, read() {} });
  for (const value of order) stream.push(value);
  const state = stream._readableState;
  console.log("held", state.length, state.buffer.length, state.bufferIndex, state.buffer.map(show).join(" "), "|", stream.readableBuffer === state.buffer, stream.readableLength);
  const read = [stream.read(), stream.read()];
  console.log("  two are read", read.map(show).join(" "), "|", state.length, state.bufferIndex, state.buffer.map(show).join(" "));
  stream.unshift(7);
  stream.unshift(7.5);
  console.log("  two are put back", state.length, state.bufferIndex, state.buffer.map(show).join(" "));
  const rest = [];
  for (let value; (value = stream.read()) !== null; ) rest.push(value);
  console.log("  the rest", rest.map(show).join(" "), "|", state.length, state.bufferIndex, state.buffer.length);
}

const source = new Readable({ read() {} });
const state = source._readableState;
const sinks = [1, 2, 3].map(() => new Writable({ write(chunk, encoding, done) { done(); } }));
console.log("pipes", state.pipes.length, Array.isArray(state.pipes), state.pipesCount);
for (const sink of sinks) source.pipe(sink);
console.log("pipes", state.pipes.length, state.pipes.every((sink, i) => sink === sinks[i]), state.pipesCount);
source.unpipe(sinks[1]);
console.log("pipes", state.pipes.length, state.pipes[0] === sinks[0], state.pipes[1] === sinks[2]);
source.unpipe();
console.log("pipes", state.pipes.length);
state.buffer.push(1, 2.5, "x");
state.pipes.push(4, 4.5);
console.log("by hand", state.buffer.join(), state.pipes.join());
