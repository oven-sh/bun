// target.set(source, offset) for two typed arrays of one kind, of two kinds, over one buffer, detached, resized, empty, and at places where the source does not fit.
const given = JSON.parse('{"chunks":[]}');
function hide(value) {
  given.chunks[0] = value;
  return given.chunks[0];
}
let said = "";
function say(name, run) {
  let text;
  try {
    text = run();
  } catch (error) {
    text = "threw " + error.name;
  }
  said += name + " = " + text + "\n";
}
function show(view) {
  let text = "";
  for (let i = 0; i < view.length; i++) text += view[i] + ",";
  return text;
}
function put(target, source, offset) {
  target.set(source, offset);
  return show(target);
}
function putAtStart(target, source) {
  target.set(source);
  return show(target);
}
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
if (typeof Float16Array === "function") kinds.push(Float16Array);
for (let round = 0; round < 3; round++) {
  for (const Kind of kinds) {
    const of = (...numbers) => Kind.from(numbers, Kind.name.startsWith("Big") ? BigInt : Number);
    const size = Kind.BYTES_PER_ELEMENT;
    say(Kind.name + " fits", () => put(of(1, 2, 3, 4, 5), of(7, 8), 2) + putAtStart(of(1, 2, 3), of(9)) + put(hide(of(1, 2, 3, 4, 5)), hide(of(7, 8)), hide(3)));
    say(Kind.name + " whole", () => put(of(1, 2), of(7, 8), 0) + put(of(1, 2), of(), 2) + put(of(), of(), 0) + putAtStart(of(), of()));
    for (const offset of [4, 5, 6, -1, 1.5, -0, NaN, Infinity, -Infinity, 4294967296, 2147483648, "1", "x", null, undefined, true, { valueOf: () => 1 }])
      say(Kind.name + " at " + String(typeof offset === "object" && offset ? "an object" : offset), () => put(of(1, 2, 3, 4, 5), of(7, 8), offset));
    say(Kind.name + " over itself, forwards", () => { const all = of(1, 2, 3, 4, 5, 6); return put(all, all.subarray(0, 4), 2); });
    say(Kind.name + " over itself, backwards", () => { const all = of(1, 2, 3, 4, 5, 6); return put(all, all.subarray(2), 0); });
    say(Kind.name + " itself", () => { const all = of(1, 2, 3); return put(all, all, 0); });
    say(Kind.name + " detached target", () => { const target = of(1, 2, 3); target.buffer.transfer(); return put(target, of(1), 0); });
    say(Kind.name + " detached source", () => { const source = of(1, 2, 3); source.buffer.transfer(); return put(of(4, 5, 6), source, 0); });
    say(Kind.name + " detached by the offset", () => { const target = of(1, 2, 3); return put(target, of(7), { valueOf() { target.buffer.transfer(); return 0; } }); });
    say(Kind.name + " tracking target", () => { const buffer = new ArrayBuffer(4 * size, { maxByteLength: 8 * size }); const target = new Kind(buffer); const first = put(target, of(1, 2), 2); buffer.resize(3 * size); return first + put(target, of(7), 2) + put(target, of(8, 9), 2); });
    say(Kind.name + " tracking source", () => { const buffer = new ArrayBuffer(4 * size, { maxByteLength: 8 * size }); const source = new Kind(buffer); buffer.resize(2 * size); return put(of(1, 2, 3), source, 1) + put(of(1, 2, 3), source, 2); });
    say(Kind.name + " out of bounds", () => { const buffer = new ArrayBuffer(4 * size, { maxByteLength: 8 * size }); const target = new Kind(buffer, 0, 4); buffer.resize(2 * size); return put(target, of(1), 0); });
    say(Kind.name + " shared", () => put(new Kind(new SharedArrayBuffer(3 * size)), of(5, 6), 1) + put(new Kind(new SharedArrayBuffer(2 * size, { maxByteLength: 4 * size })), of(5, 6), 0));
    say(Kind.name + " below", () => { class Below extends Kind {} const target = new Below(3); return put(target, of(5, 6), 1) + put(of(1, 2, 3), new Below(2), 1); });
    say(Kind.name + " own length", () => { class Short extends Kind { get length() { return 1; } } const source = new Short(3); source[2] = of(9)[0]; return put(of(1, 2, 3, 4), source, 1); });
    say(Kind.name + " from a list", () => put(of(1, 2, 3), Array.from(of(7, 8)), 1) + put(of(1, 2, 3), { length: 1, 0: of(9)[0] }, 2));
    for (const Other of kinds)
      if (Other !== Kind) say(Kind.name + " from " + Other.name, () => put(of(1, 2, 3), Other.from([200, 3], Other.name.startsWith("Big") ? BigInt : Number), 1));
  }
  say("not a number keeps its bits", () => { const words = new Uint32Array([0x7fc00001, 0xffc12345]); const target = new Float32Array(2); target.set(new Float32Array(words.buffer)); return show(new Uint32Array(target.buffer)); });
  say("a buffer into bytes", () => put(new Uint8Array(4), Buffer.from([1, 2]), 1) + put(Buffer.alloc(4), new Uint8Array([1, 2]), 2) + put(Buffer.alloc(3), Buffer.from("ab"), 1));
  say("clamped and bytes", () => put(new Uint8ClampedArray(3), new Uint8Array([250, 3]), 1) + put(new Uint8Array(3), new Uint8ClampedArray([250, 3]), 1));
  say("no view", () => put(new Uint8Array(2), new DataView(new ArrayBuffer(2)), 0) + put(new Uint8Array(2), new ArrayBuffer(2), 0) + put(new Uint8Array(2), "12", 0) + put(new Uint8Array(2), 5, 0));
  say("another receiver", () => Uint8Array.prototype.set.call(hide([1, 2]), new Uint8Array(1), 0));
  say("a data view as receiver", () => Uint8Array.prototype.set.call(hide(new DataView(new ArrayBuffer(2))), new DataView(new ArrayBuffer(1)), 0));
}
console.log(said);
