// Pairs of neighbors are moved between views of every kind, views that lie on one memory a step apart, lists, and views whose memory changes while they are moved.
"use strict";
function copy(to, from, count) {
  for (let at = 0; at < count; at += 2) {
    const low = from[at];
    const high = from[at + 1];
    to[at] = low;
    to[at + 1] = high;
  }
  return to;
}
function apart(to, from, count, by) {
  for (let at = 0; at < count; at++) {
    const low = from[at * 2 + by];
    const high = from[at * 2 + by + 1];
    to[at * 2] = low;
    to[at * 2 + 1] = high;
  }
  return to;
}
const kinds = [Uint16Array, Int16Array, Uint8Array, Int8Array, Uint8ClampedArray, Int32Array, Uint32Array, Float32Array, Float64Array, Array];
const make = Kind => Kind.from({ length: 24 }, (_, at) => at * 4099 - 30000 + at / 4);
for (let round = 0; round < 400; round++) {
  const from = make(kinds[round % 2]);
  copy(new Uint16Array(24), from, 24);
  apart(new Int16Array(24), from, 11, round % 3);
}
for (const To of kinds) for (const From of kinds) console.log(To.name, From.name, copy(new To(24), make(From), 24).join(), apart(new To(24).fill(1), make(From), 11, 1).join(" "));
const ground = new ArrayBuffer(64);
const views = [new Uint16Array(ground), new Uint16Array(ground, 2), new Int16Array(ground, 4, 12), new Uint8Array(ground, 1), new Uint16Array(ground, 6, 20)];
for (const to of views) for (const from of views) {
  const bytes = new Uint8Array(ground);
  for (let at = 0; at < 64; at++) bytes[at] = at * 37;
  copy(to, from, 10);
  const first = bytes.join(" ");
  apart(to, from, 5, 1);
  console.log(first, "|", bytes.join(" "));
}
function tell(name, work) {
  let said;
  try {
    said = work();
  } catch (error) {
    said = error.constructor.name;
  }
  console.log(name, said);
}
let asked = 0;
tell("past the ends", () => copy(new Uint16Array(5), make(Uint16Array), 24).join() + " " + copy(new Uint16Array(30), make(Uint16Array), 30).join());
tell("long numbers", () => copy(new BigInt64Array(4), new BigInt64Array([1n, 2n, 3n, 4n]), 4).join());
tell("long numbers into short ones", () => copy(new Uint16Array(4), new BigInt64Array([1n, 2n, 3n, 4n]), 4).join());
tell("saying", () => { const to = new Uint16Array(6); return copy(to, [1, { valueOf() { asked++; to.fill(9); return 70000; } }, 3, "4", null, undefined], 6).join() + " " + asked; });
tell("memory that goes", () => { const to = new Uint16Array(6); return copy(to, [1, { valueOf() { to.buffer.transfer(); return 2; } }, 3, 4, 5, 6], 6).length; });
tell("memory that shrinks", () => { const memory = new ArrayBuffer(16, { maxByteLength: 32 }); const to = new Uint16Array(memory); return copy(to, [1, 2, { valueOf() { memory.resize(4); return 3; } }, 4, 5, 6, 7, 8], 8).join() + " " + to.length; });
tell("shared", () => copy(new Uint16Array(new SharedArrayBuffer(16)), make(Int16Array), 8).join());
tell("a proxy", () => copy(new Proxy(new Uint16Array(4), { set(target, name, value) { asked += 10; target[name] = value; return true; } }), make(Uint16Array), 4).join() + " " + asked);
tell("objects", () => JSON.stringify(copy({}, { 0: 1, 1: 2, 3: 4 }, 4)));
tell("nothing", () => copy(null, make(Uint16Array), 2));
