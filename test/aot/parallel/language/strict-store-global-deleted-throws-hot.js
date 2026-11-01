// `counter` is a property of the global object. The three functions run often enough to be compiled by every tier of a JIT. Once the property is deleted, a read and a strict store throw a
// ReferenceError and add nothing; a sloppy store adds the property again.
globalThis.counter = 1;
function read() { return counter; }
function storeStrictly(value) { "use strict"; counter = value; }
function kind() { return typeof counter; }
let sum = 0;
for (let i = 0; i < 300000; i++) {
  sum += read();
  storeStrictly(1);
  if (kind() !== "number") sum = -1;
}
console.log(sum);
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.name;
  }
}
delete globalThis.counter;
for (let i = 0; i < 3; i++) console.log(attempt(read), attempt(() => storeStrictly(2)), attempt(kind), "counter" in globalThis);
function storeSloppily(value) { counter = value; }
globalThis.counter = 1;
for (let i = 0; i < 300000; i++) storeSloppily(i);
delete globalThis.counter;
console.log(attempt(() => storeSloppily(3)), attempt(read), "counter" in globalThis);
