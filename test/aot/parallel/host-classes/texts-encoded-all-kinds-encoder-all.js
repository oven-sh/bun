// encoder.encode(text) and encoder.encodeInto(text, bytes): every kind of encoder, text and destination, called on a known encoder, on one nobody followed, and borrowed.
const util = require("node:util");
const show = value => value instanceof Error ? "throws " + value.name : ArrayBuffer.isView(value) ? value.constructor.name + "[" + Array.from(value).join() + "]" : value && typeof value === "object" ? JSON.stringify(value) + Object.keys(value) + (Object.getPrototypeOf(value) === Object.prototype) : String(value);
const attempt = f => { try { return show(f()); } catch (error) { return show(error); } };
class Below extends TextEncoder {}
class Changed extends TextEncoder { encode(text) { return "mine " + text; } encodeInto(text, bytes) { return { read: -1, written: -1 }; } }
function detached() { const view = new Uint8Array(8); structuredClone(view.buffer, { transfer: [view.buffer] }); return view; }
const part = JSON.parse('["Product ","17","é","日本","\\ud83d\\ude00","\\ud800",""]');
const texts = [() => "row", () => "", () => part[0] + part[1], () => part[0] + part[1] + part[0] + part[1], () => (part[0] + part[1]).slice(2, 7), () => part[2], () => "a" + part[2] + "b", () => part[3], () => "ab" + part[3], () => part[4], () => "abc" + part[4], () => part[5], () => "x" + part[5] + "y", () => "\x7f\x80", () => "\0a", () => "a".repeat(300), () => 5, () => -0, () => 1.5, () => true, () => null, () => undefined, () => 10n, () => ({ toString() { return "made"; } }), () => ({ toString() { throw new RangeError("no"); } }), () => Symbol.iterator, () => ["a", "b"], () => new String("wrapped")];
const destinations = [() => new Uint8Array(16), () => new Uint8Array(0), () => new Uint8Array(1), () => new Uint8Array(3), () => new Uint8Array(4), () => new Uint8Array(16).subarray(12), () => new Uint8Array(new ArrayBuffer(16), 14), () => Buffer.alloc(5), () => new (class extends Uint8Array {})(5), () => new Uint8ClampedArray(5), () => new Int8Array(5), () => new Uint16Array(5), () => new DataView(new ArrayBuffer(5)), () => new ArrayBuffer(5), detached, () => new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })), () => new Uint8Array(new SharedArrayBuffer(4)), () => [0, 0], () => "text", () => 5, () => null, () => undefined];
const encoders = [() => new TextEncoder(), () => new util.TextEncoder(), () => new Below(), () => new Changed(), () => Object.create(TextEncoder.prototype), () => ({ encode: TextEncoder.prototype.encode, encodeInto: TextEncoder.prototype.encodeInto }), () => new TextDecoder(), () => ({ encode(text) { return "other " + text; }, encodeInto() { return "other"; } }), () => null];
const known = new TextEncoder();
const holder = JSON.parse('{"a":1}'); holder.encoder = new util.TextEncoder();
function knownEncode(text) { const bytes = known.encode(text); return bytes; }
function knownInto(text, bytes) { const counts = known.encodeInto(text, bytes); return show(counts) + show(bytes); }
function heldEncode(text) { const bytes = holder.encoder.encode(text); return bytes; }
function heldInto(text, bytes) { const counts = holder.encoder.encodeInto(text, bytes); return show(counts) + show(bytes); }
function anyEncode(encoder, text) { const bytes = encoder.encode(text); return bytes; }
function anyInto(encoder, text, bytes) { const counts = encoder.encodeInto(text, bytes); return show(counts) + show(bytes); }
function borrowedEncode(encoder, text) { return TextEncoder.prototype.encode.call(encoder, text); }
function borrowedInto(encoder, text, bytes) { return show(TextEncoder.prototype.encodeInto.call(encoder, text, bytes)) + show(bytes); }
function counted(text, bytes) { const { read, written } = known.encodeInto(text, bytes); return read * 100 + written; }
let lines = [];
for (let round = 0; round < 3; round++) {
  lines = [];
  texts.forEach((text, t) => {
    lines.push("encode " + t + ": " + attempt(() => knownEncode(text())) + " " + attempt(() => heldEncode(text())) + " " + encoders.map(encoder => attempt(() => anyEncode(encoder(), text())) + "|" + attempt(() => borrowedEncode(encoder(), text()))).join(" "));
    destinations.forEach((destination, d) => lines.push("into " + t + " " + d + ": " + attempt(() => knownInto(text(), destination())) + " " + attempt(() => heldInto(text(), destination())) + " " + attempt(() => counted(text(), destination()))));
    lines.push("into by " + t + ": " + encoders.map(encoder => attempt(() => anyInto(encoder(), text(), new Uint8Array(6))) + "|" + attempt(() => borrowedInto(encoder(), text(), new Uint8Array(6)))).join(" "));
  });
}
console.log(lines.join("\n"));
console.log(attempt(() => known.encode()), attempt(() => known.encodeInto()), attempt(() => known.encodeInto("a")), attempt(() => known.encode("a", "b")), attempt(() => show(known.encodeInto("ab", new Uint8Array(4), 2))));
const counts = known.encodeInto("ab", new Uint8Array(4)); counts.read = 9; counts.more = 1; delete counts.written; console.log(show(counts), Object.isExtensible(counts), JSON.stringify(Object.getOwnPropertyDescriptors(known.encodeInto("a", new Uint8Array(1)))));
const bytes = known.encode("ab"); bytes[0] = 1; console.log(show(bytes), bytes.byteOffset, bytes.buffer.byteLength, Object.getPrototypeOf(bytes) === Uint8Array.prototype, show(known.encode("ab")));
