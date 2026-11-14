// STATISTIC: BodiesVersionedByArrayKind >= 2
// A parameter holds an array in some calls and a typed array in others: the body has one version for each.
"use strict";
const out = [];
function rotate(a, b) {
  return (a << b) | (a >>> (32 - b));
}
function quarter(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) | 0;
  x[d] = rotate(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) | 0;
  x[b] = rotate(x[b] ^ x[c], 12);
}
function block(state, result) {
  const x = state.slice();
  for (let i = 0; i < 4; i++) {
    quarter(x, 0, 4, 8, 12);
    quarter(x, 1, 5, 9, 13);
    quarter(x, 2, 6, 10, 14);
  }
  for (let i = 0; i < 16; i++) result[i] = (x[i] + state[i]) | 0;
}
function first(list, depth) {
  return depth > 0 ? first(list, depth - 1) : list[0] + list[list.length - 1];
}
function measure(list) {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += first(list, i);
  return sum;
}
function words(seed) {
  const list = [];
  for (let i = 0; i < 16; i++) list.push(Math.imul(i + seed, 0x9e3779b9) | 0);
  return list;
}
function show(list) {
  return list.constructor.name + " " + Array.from({ length: list.length }, (_, i) => (Object.is(list[i], -0) ? "-0" : String(list[i]))).join();
}
function attempt(f) {
  try {
    return String(f());
  } catch (e) {
    return e.constructor.name;
  }
}
const holders = [() => words(1), () => new Int32Array(words(2)), () => new Uint32Array(words(3))];
for (let round = 0; round < 4; round++) {
  for (const make of holders) {
    const state = make(), result = holders[round % 3]();
    block(state, result);
    out.push(show(state), show(result), String(measure(state)), String(measure(result)));
  }
}
const named = new Int32Array(words(5));
named.slice = () => words(6);
const resized = new Int32Array(new ArrayBuffer(64, { maxByteLength: 128 }));
resized.set(words(7));
const moved = new Int32Array(words(8));
structuredClone(moved.buffer, { transfer: [moved.buffer] });
const holes = words(9);
delete holes[4];
const doubles = words(10).map(x => x + 0.5);
const others = [named, resized, moved, holes, doubles, Object.freeze(words(11)), words(12).slice(0, 7), new Uint32Array(words(18))];
for (let round = 0; round < 2; round++) {
  for (const other of others) {
    for (const result of [words(20), new Int32Array(16), Object.freeze(words(21))]) {
      out.push(attempt(() => block(other, result)) + " " + show(result));
    }
    out.push(attempt(() => measure(other)));
  }
  resized.buffer.resize(32);
}
for (const line of out) console.log(line);
