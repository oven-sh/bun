// buffer.toString(encoding, start, end): every kind of receiver, encoding and bound.
const show = value => value instanceof Error ? "throws " + value.name + (value.code ? " " + value.code : "") : typeof value === "string" ? JSON.stringify(value) : String(value);
const attempt = f => { try { return show(f()); } catch (error) { return show(error); } };
function detached() { const view = Buffer.from(new ArrayBuffer(8)); structuredClone(view.buffer, { transfer: [view.buffer] }); return view; }
class Below extends Buffer {}
const receivers = [() => Buffer.from("Product 17"), () => Buffer.from(""), () => Buffer.from("x"), () => Buffer.from("héllo"), () => Buffer.from("日本語"), () => Buffer.from([0xff, 0xfe, 0x41, 0x80, 0xc3]), () => Buffer.from([0xc3, 0xa9, 0xe6, 0x97]), () => Buffer.from([0, 1, 127, 128]), () => Buffer.from("a".repeat(300)), () => Buffer.from("0123456789").subarray(2, 8), () => Buffer.from(new ArrayBuffer(16), 4, 4).fill(66), () => Buffer.from("😀!"), () => Buffer.from([0xef, 0xbb, 0xbf, 0x41]), detached, () => Buffer.from(new ArrayBuffer(4, { maxByteLength: 8 })).fill(67), () => Buffer.from(new SharedArrayBuffer(4)).fill(68), () => Object.assign(Buffer.from("own"), { extra: 1 })];
const encodings = [undefined, "utf8", "utf-8", "UTF8", "Utf-8", "ascii", "ASCII", "latin1", "binary", "LATIN1", "hex", "base64", "base64url", "ucs2", "utf16le", "ucs-2", "", "nope", null, 5, true, {}, { toString() { return "hex"; } }, "utf" + JSON.parse('"8"'), Symbol.iterator];
const bounds = [undefined, 0, 1, 2, 5, 9, 10, 11, 1000, -1, -5, -0, 1.5, 2.9, NaN, Infinity, -Infinity, "2", "x", null, true, {}, { valueOf() { return 3; } }, 2 ** 31, 2 ** 32 + 1, 1n];
function plain(buffer) { const text = buffer.toString(); return text; }
function named(buffer, encoding) { const text = buffer.toString(encoding); return text; }
function ranged(buffer, encoding, start, end) { const text = buffer.toString(encoding, start, end); return text; }
function from(buffer, start) { const text = buffer.toString("utf8", start); return text; }
function borrowed(view, encoding, start, end) { return Buffer.prototype.toString.call(view, encoding, start, end); }
function known(text) { const buffer = Buffer.from(text); return buffer.toString() + "|" + buffer.toString("latin1") + "|" + buffer.toString("utf8", 1, 3) + "|" + buffer.toString("ascii"); }
let lines = [];
for (let round = 0; round < 3; round++) {
  lines = [];
  receivers.forEach((receiver, r) => {
    lines.push("by call " + r + ": " + encodings.map(encoding => attempt(() => borrowed(receiver(), encoding))).join(" "));
    for (const encoding of [undefined, "utf-8", "latin1", "binary", "ascii", "base64"]) lines.push("range by call " + r + " " + encoding + ": " + bounds.map(bound => attempt(() => borrowed(receiver(), encoding, bound, 6)) + attempt(() => borrowed(receiver(), encoding, 1, bound)) + attempt(() => borrowed(receiver(), encoding, bound))).join(" "));
    lines.push("plain " + r + ": " + attempt(() => plain(receiver())) + " " + encodings.map(encoding => attempt(() => named(receiver(), encoding))).join(" "));
    lines.push("from " + r + ": " + bounds.map(start => attempt(() => from(receiver(), start))).join(" "));
    for (const encoding of [undefined, "latin1", "ascii", "hex"]) lines.push("range " + r + " " + encoding + ": " + bounds.map(bound => attempt(() => ranged(receiver(), encoding, bound, 6)) + attempt(() => ranged(receiver(), encoding, 1, bound))).join(" "));
  });
  for (const other of [() => new Uint8Array([65, 66, 200]), () => new Below(3).fill(69), () => new Uint8ClampedArray([65]), () => new Int8Array([65]), () => new Uint16Array([65]), () => new DataView(new ArrayBuffer(2)), () => new ArrayBuffer(2), () => [65], () => "text", () => 5, () => null, () => undefined, () => ({ length: 1, 0: 65 })]) lines.push("borrowed: " + attempt(() => borrowed(other())) + " " + attempt(() => borrowed(other(), "latin1", 0, 2)) + " " + attempt(() => borrowed(other(), "hex")));
  lines.push(["row", "", "hé", "日本", "abcdef"].map(text => attempt(() => known(text))).join(" "));
}
console.log(lines.join("\n"));
const shrinking = Buffer.from(new ArrayBuffer(8, { maxByteLength: 16 })).fill(70); console.log(attempt(() => ranged(shrinking, "utf8", { valueOf() { shrinking.buffer.resize(2); return 0; } }, 8)));
const order = []; attempt(() => ranged(Buffer.from("abc"), { toString() { order.push("encoding"); return "utf8"; } }, { valueOf() { order.push("start"); return 0; } }, { valueOf() { order.push("end"); return 2; } })); console.log(order.join());
const text = plain(Buffer.from("same")); console.log(text === "same", text.length, text + "!", new Map([["same", 1]]).get(text), ({ same: 2 })[text]);
