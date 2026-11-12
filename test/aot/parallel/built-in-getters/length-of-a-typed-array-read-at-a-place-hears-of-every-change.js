// `x.length` where nobody knows what x is. Of a typed array the name is a getter of the engine, far above the receiver. A place that has met typed arrays answers without a call,
// and every way in which the answer may stop being the number of elements has to reach it: the buffer, the view, the object itself, and each object above it that a program may change:
// a compiled program may not write to the engine's own prototypes.
const lengthOf = x => x.length;
const many = 400;
function ask(label, make) {
  let sum = 0, last;
  for (let i = 0; i < many; i++) {
    try {
      last = lengthOf(make(i));
    } catch (error) {
      last = error.constructor.name;
    }
    sum += typeof last === "number" ? last : 1000;
  }
  console.log(label, String(last), sum);
}
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
if (typeof Float16Array === "function")
  kinds.push(Float16Array);
for (const kind of kinds) {
  const held = new kind(7);
  ask(kind.name + " held", () => held);
  ask(kind.name + " made", i => new kind(i % 5));
  ask(kind.name + " part", i => held.subarray(i % 7));
}
ask("in turns", i => new kinds[i % kinds.length](i % 3 + 1));
ask("Buffer", i => Buffer.alloc(i % 9));
ask("Buffer of a text", i => Buffer.from("abc".repeat(i % 4)));
ask("large", () => new Uint8Array(70000));
ask("beside lists and texts", i => [new Uint8Array(2), [1, 2, 3], "four", { length: 5 }, new Uint16Array(6)][i % 5]);
ask("DataView", () => new DataView(new ArrayBuffer(8)));
ask("ArrayBuffer", () => new ArrayBuffer(8));

{
  const view = new Uint8Array(new ArrayBuffer(16), 4, 8);
  ask("before its buffer goes", () => view);
  view.buffer.transfer();
  ask("its buffer has gone", () => view);
}
{
  const buffer = new ArrayBuffer(8, { maxByteLength: 64 });
  const follows = new Uint8Array(buffer);
  const fixed = new Uint8Array(buffer, 0, 6);
  const behind = new Uint16Array(buffer, 4);
  ask("follows 8", () => follows);
  ask("fixed 6", () => fixed);
  ask("behind 4", () => behind);
  buffer.resize(32);
  ask("follows 32", () => follows);
  ask("fixed, still 6", () => fixed);
  ask("behind 32", () => behind);
  buffer.resize(2);
  ask("follows 2", () => follows);
  ask("fixed, out of bounds", () => fixed);
  ask("behind, out of bounds", () => behind);
  buffer.resize(64);
  ask("follows 64", () => follows);
  ask("fixed again", () => fixed);
}
if (typeof SharedArrayBuffer === "function") {
  const shared = new SharedArrayBuffer(8, { maxByteLength: 32 });
  const view = new Uint8Array(shared);
  ask("shared 8", () => view);
  shared.grow(24);
  ask("shared 24", () => view);
}
{
  class Twice extends Uint8Array {
    get length() {
      return super.length * 2;
    }
  }
  class Plain extends Uint8Array { }
  ask("a class with a getter of its own", i => new Twice(i % 4));
  ask("a class without", i => new Plain(i % 4));
  Object.defineProperty(Plain.prototype, "length", { get() { return -1; }, configurable: true });
  ask("the class gets one", i => new Plain(i % 4));
  delete Plain.prototype.length;
  ask("and loses it", i => new Plain(i % 4));
}
{
  const own = new Uint8Array(3);
  ask("before it has its own", () => own);
  Object.defineProperty(own, "length", { value: 99, configurable: true });
  ask("its own", () => own);
  delete own.length;
  ask("its own is gone", () => own);
  Object.setPrototypeOf(own, { length: "from another object" });
  ask("another object above", () => own);
  Object.setPrototypeOf(own, null);
  ask("nothing above", () => own);
}
ask("no typed array below the prototype", () => Object.create(Uint8Array.prototype));
ask("the prototype itself", () => Uint8Array.prototype);
{
  const held = new Uint8Array(5), other = new Float64Array(2), buffer = Buffer.alloc(3);
  const all = i => [held, other, buffer][i % 3];
  ask("three", all);
  ask("and of new ones", i => new kinds[i % kinds.length](i % 3 + 1));
}
