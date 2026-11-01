// util.types.isArrayBufferView: the check that node:fs, node:stream and node:crypto run on their
// arguments. In Node it is ArrayBuffer.isView itself, which the JIT compiles to a type check.
//
// Each row is a loop of 1000 calls in a function of its own, so its call site sees one kind of
// value. Two shapes: the function held in a variable, and the property read on each call.
import { types } from "node:util";
import { bench, group, run } from "../runner.mjs";

const { isArrayBufferView } = types;
const calls = 1000;

const buffers = [Buffer.alloc(8), Buffer.alloc(9), Buffer.alloc(10), Buffer.alloc(11)];
const uint8Arrays = [new Uint8Array(8), new Uint8Array(9), new Uint8Array(10), new Uint8Array(11)];
const dataViews = [8, 9, 10, 11].map(length => new DataView(new ArrayBuffer(length)));
const arrayBuffers = [new ArrayBuffer(8), new ArrayBuffer(9), new ArrayBuffer(10), new ArrayBuffer(11)];
const strings = ["a", "bb", "ccc", "dddd"];
const numbers = [1, 2, 3, 4];

group(`isArrayBufferView(value) x ${calls}`, () => {
  bench("Buffer", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView(buffers[i & 3])) views++;
    return views;
  });
  bench("Uint8Array", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView(uint8Arrays[i & 3])) views++;
    return views;
  });
  bench("DataView", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView(dataViews[i & 3])) views++;
    return views;
  });
  bench("ArrayBuffer", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView(arrayBuffers[i & 3])) views++;
    return views;
  });
  bench("string", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView(strings[i & 3])) views++;
    return views;
  });
  bench("number", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView(numbers[i & 3])) views++;
    return views;
  });
  bench("no argument", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (isArrayBufferView()) views++;
    return views;
  });
});

group(`types.isArrayBufferView(value) x ${calls}`, () => {
  bench("Buffer", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView(buffers[i & 3])) views++;
    return views;
  });
  bench("Uint8Array", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView(uint8Arrays[i & 3])) views++;
    return views;
  });
  bench("DataView", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView(dataViews[i & 3])) views++;
    return views;
  });
  bench("ArrayBuffer", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView(arrayBuffers[i & 3])) views++;
    return views;
  });
  bench("string", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView(strings[i & 3])) views++;
    return views;
  });
  bench("number", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView(numbers[i & 3])) views++;
    return views;
  });
  bench("no argument", () => {
    let views = 0;
    for (let i = 0; i < calls; i++) if (types.isArrayBufferView()) views++;
    return views;
  });
});

await run();
