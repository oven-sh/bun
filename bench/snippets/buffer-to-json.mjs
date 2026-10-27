// @runtime bun,node
import { bench, group, run } from "../runner.mjs";

const empty = Buffer.alloc(0);
const tiny = Buffer.alloc(16, 0x42);
const small = Buffer.alloc(1024, 0x42);
const medium = Buffer.alloc(64 * 1024, 0x42);
const large = Buffer.alloc(1024 * 1024, 0x42);
const row = { id: 1, name: "row", payload: tiny };
const doubles = new Float64Array(1024).fill(1.5);
const toJSON = Buffer.prototype.toJSON;

// A program that serializes an empty Buffer has serialized other Buffers before it.
tiny.toJSON();

group("toJSON", () => {
  bench("Buffer(0).toJSON()", () => empty.toJSON());
  bench("Buffer(16).toJSON()", () => tiny.toJSON());
  bench("Buffer(1024).toJSON()", () => small.toJSON());
  bench("Buffer(64K).toJSON()", () => medium.toJSON());
  bench("Buffer(1M).toJSON()", () => large.toJSON());
});

group("JSON.stringify", () => {
  bench("JSON.stringify(Buffer(0))", () => JSON.stringify(empty));
  bench("JSON.stringify(Buffer(16))", () => JSON.stringify(tiny));
  bench("JSON.stringify(Buffer(1024))", () => JSON.stringify(small));
  bench("JSON.stringify(Buffer(64K))", () => JSON.stringify(medium));
  bench("JSON.stringify(Buffer(1M))", () => JSON.stringify(large));
  bench("JSON.stringify({ payload: Buffer(16) })", () => JSON.stringify(row));
});

// Last, because a receiver of another kind slows a toJSON that is written in JavaScript for every row after it.
group("other receivers", () => {
  bench("toJSON.call(Float64Array(1024))", () => toJSON.call(doubles));
});

await run();
