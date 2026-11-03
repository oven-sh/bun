// Buffer.from(value): a string and an object make a Buffer, everything else is refused with a TypeError, and what a loop over a list of strings hands it makes Buffers that are used as such.
function describe(make) {
  try {
    const made = make();
    return `${made.constructor.name} ${made.length} ${made.toString("hex")}`;
  } catch (error) {
    return `${error.name} ${error.code} ${String(error.message).split("\n")[0]}`;
  }
}

const values = [
  undefined,
  null,
  true,
  false,
  5,
  -0.5,
  NaN,
  5n,
  Symbol("mark"),
  "",
  "text",
  [1, 2, 300],
  new Uint8Array([7, 8]),
  new Uint16Array([258]),
  new ArrayBuffer(3),
  { length: 2, 0: 9, 1: 10 },
  { type: "Buffer", data: [4, 5] },
  { valueOf: () => "from valueOf" },
  { [Symbol.toPrimitive]: () => "from toPrimitive" },
  {},
  function named() {},
  () => 1,
];
for (const value of values) console.log(describe(() => Buffer.from(value)));
console.log(describe(() => Buffer.from()));
console.log(describe(() => Buffer.from(undefined, "utf8")));
console.log(describe(() => Buffer.from(7, 1, 2)));
console.log(describe(() => new Buffer.from("constructed")));

const queue = [];
for (const text of ["ab", "", "four", "a longer piece of text"]) queue.push(Buffer.from(text));
const target = Buffer.alloc(64);
let written = 0;
for (let turn = 0; turn < 3; turn++) for (const chunk of queue) written += chunk.copy(target, written % 32);
console.log(written, target.toString("latin1").replaceAll("\0", "."));

function lengthOf(text) {
  return Buffer.from(text).byteLength;
}
let total = 0;
for (let turn = 0; turn < 200; turn++) total += lengthOf(turn % 3 ? "é" : "plain");
console.log(total);
let refused = 0;
for (let turn = 0; turn < 50; turn++) {
  try {
    total += lengthOf(turn % 5 ? "x" : undefined);
  } catch {
    refused++;
  }
}
console.log(total, refused);
