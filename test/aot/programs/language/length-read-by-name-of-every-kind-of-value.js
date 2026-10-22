// `.length` of a value of which nothing is known: arrays of every storage, strings, and everything else that has, inherits, computes or lacks a length.
function lengthOf(value) {
  return value.length;
}

function describe(value) {
  try {
    const length = lengthOf(value);
    return typeof length + " " + String(length);
  } catch (error) {
    return error.constructor.name;
  }
}

class Stack extends Array {}
class Named {
  get length() {
    return "computed";
  }
}

const sparse = [];
sparse[100000] = 1;
const huge = [];
huge.length = 4294967295;
const shrunk = [1, 2, 3, 4];
shrunk.length = 2;
const frozen = Object.freeze([1, 2, 3]);
const withHoles = [1, , 3];
const stack = new Stack();
stack.push(1, 2, 3);
const rope = "left".repeat(3) + String(Date.now()).slice(0, 0) + "right";
const inherits = Object.create([1, 2, 3]);
const shadowed = Object.create({ length: "inherited" });
const proxied = new Proxy([1, 2], {});
const trapped = new Proxy({}, { get: (target, key) => "trap " + String(key) });
function threeParameters(a, b, c) {}
const bound = threeParameters.bind(null, 1);
const argumentsObject = (function () { return arguments; })(1, 2, 3, 4, 5);

const values = [
  [], [1], [1, 2.5], ["a", {}], new Array(5), sparse, huge, shrunk, frozen, withHoles, stack, Array.prototype,
  "", "abc", rope, new String("boxed"), "\u{1F600}",
  new Uint8Array(6), new Float64Array(2), new DataView(new ArrayBuffer(8)), new ArrayBuffer(8),
  threeParameters, bound, () => 0, class { constructor(a) {} }, argumentsObject,
  { length: 12 }, { length: -1 }, {}, new Named(), inherits, shadowed, proxied, trapped, new Map([[1, 2]]), new Set([1]),
  0, 1.5, true, Symbol("s"), 10n, null, undefined,
];

const lines = [];
for (let round = 0; round < 3; round++) {
  lines.length = 0;
  for (const value of values) lines.push(describe(value));
}
console.log(lines.join("\n"));

const growing = [];
let sum = 0;
for (let i = 0; i < 1000; i++) {
  growing.push(i);
  sum += lengthOf(growing) + lengthOf("x".repeat(i % 7));
}
console.log(sum);
