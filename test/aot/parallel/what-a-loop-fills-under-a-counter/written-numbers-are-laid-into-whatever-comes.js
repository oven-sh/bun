const at = JSON.parse("0");
const held = [];
const steps = ["seven", "half", "big"];
function seven() {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = 7;
}
function half() {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = 0.5;
}
function big() {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = 4294967301;
}
class Rows extends Array {}
class Floats extends Float32Array {}
const makers = [
  () => [1, 2, 3],
  () => [1.5, 2.5],
  () => ["a", {}],
  () => [],
  () => [, , 3],
  () => new Array(3),
  () => Object.freeze([1, 2, 3, 4, 5, 6]),
  () => Object.preventExtensions([1.5, 2.5]),
  () => new Rows(2),
  () => new Int8Array(4),
  () => new Uint8Array(6),
  () => new Uint8ClampedArray(4),
  () => new Int16Array(4),
  () => new Uint16Array(6),
  () => new Int32Array(4),
  () => new Uint32Array(6),
  () => new Float32Array(4),
  () => new Float64Array(6),
  () => new Floats(3),
  () => Buffer.alloc(4),
  () => new BigInt64Array(4),
  () => new DataView(new ArrayBuffer(8)),
  () => ({}),
  () => ({ length: 2 }),
  () => new Map(),
  () => function named() {},
  () => "text",
  () => 5,
  () => undefined,
  () => new Proxy([], {}),
];
const said = [];
for (const step of steps) {
  for (const make of makers) {
    let line;
    try {
      const filled = (held[0] = make());
      if (step === "seven") seven();
      else if (step === "half") half();
      else big();
      line = `${Object.prototype.toString.call(filled)} ${filled.length} ${Object.keys(filled).join()} ${[0, 1, 2, 3, 4, 5].map(i => String(filled[i])).join()}`;
    } catch (error) {
      line = error.constructor.name;
    }
    said.push(`${step} ${line}`);
  }
}
console.log(
  said.join(`
`),
);
