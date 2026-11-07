// view.subarray(begin) that goes into encoder.encodeInto(text, ..): with every kind of view, begin, text and encoder, and wherever else the range may go on another way.
const lines = [];
const bytesOf = view => { try { return Array.from(view).join(); } catch (error) { return "unreadable " + error.name; } };
const describe = x => x === null || typeof x !== "object" ? String(x) : ArrayBuffer.isView(x) ? x.constructor.name + "@" + x.byteOffset + "+" + x.length : "read" in x ? x.read + "/" + x.written : Object.prototype.toString.call(x);
const attempt = f => { try { return describe(f()); } catch (error) { return "throws " + error.name; } };
const encoder = new TextEncoder();
const hidden = JSON.parse('[0]')[0];
const encoders = [encoder, { encodeInto(text, destination) { this.got = destination; return { read: -1, written: destination.length }; } }];

// As React writes a chunk.
let view = null, written = 0, sent = "";
function flush(chunk) { sent += "|" + bytesOf(chunk); }
function writeChunk(text) {
  if (text.length === 0) return;
  let target = view;
  if (0 < written) target = view.subarray(written);
  target = encoder.encodeInto(text, target);
  const read = target.read;
  written += target.written;
  if (read < text.length) { flush(view.subarray(0, written)); view = new Uint8Array(16); written = encoder.encodeInto(text.slice(read), view).written; }
  if (written === 16) { flush(view); view = new Uint8Array(16); written = 0; }
}
view = new Uint8Array(16);
for (const piece of ["ab", "cde", "", "f", "éé", "ghijklm", "日本", "no", "pqrstuvwxyz0123456789", "é", "x".repeat(15), "é", "!"]) writeChunk(piece);
lines.push("chunks " + sent + " rest " + written + " " + bytesOf(view));

// The same with an encoder nobody followed.
function writeWith(holder, bytes, from, text) {
  let target = bytes;
  if (0 < from) target = bytes.subarray(from);
  const counts = holder.encoder.encodeInto(text, target);
  return counts.read + "/" + counts.written;
}
for (const which of [0, 1, 0]) { const bytes = new Uint8Array(8), holder = { encoder: encoders[which + hidden] }; lines.push("held " + which + " " + writeWith(holder, bytes, 3, "abcdefgh") + " " + writeWith(holder, bytes, 0, "z") + " " + bytesOf(bytes) + " " + describe(encoders[1].got) + " " + (encoders[1].got === bytes)); }

// Every begin.
function into(bytes, begin, text) { return encoder.encodeInto(text, bytes.subarray(begin)); }
const begins = [0, 1, 7, 8, 9, -1, -8, -9, 1.5, -1.5, NaN, Infinity, -Infinity, -0, undefined, null, true, "2", "x", 2 ** 31, 2 ** 32 + 1, -(2 ** 31), { valueOf() { return 3; } }, [4]];
for (const begin of begins) { const bytes = new Uint8Array(8); lines.push("begin " + String(typeof begin === "object" && begin ? "object" : Object.is(begin, -0) ? "-0" : begin) + " " + attempt(() => into(bytes, begin, "abcdefghij")) + " " + bytesOf(bytes)); }
lines.push("begin symbol " + attempt(() => into(new Uint8Array(4), Symbol(), "a")), "begin bigint " + attempt(() => into(new Uint8Array(4), 1n, "a")));

// Every view.
class Mine extends Uint8Array { constructor(...all) { super(...all); Mine.made++; } } Mine.made = 0;
const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
const detached = new Uint8Array(8); detached.buffer.transfer();
const withOwnName = new Uint8Array(8); withOwnName.extra = 1;
const withOwnConstructor = new Uint8Array(8); Object.defineProperty(withOwnConstructor, "constructor", { value: Uint16Array });
const withOtherPrototype = new Uint8Array(8); Object.setPrototypeOf(withOtherPrototype, Int8Array.prototype);
const views = { plain: new Uint8Array(8), small: new Uint8Array(1), empty: new Uint8Array(0), big: new Uint8Array(5000), offset: new Uint8Array(new ArrayBuffer(16), 4, 8), tracking: new Uint8Array(resizable), fixedOverResizable: new Uint8Array(resizable, 2, 4), shared: new Uint8Array(new SharedArrayBuffer(8)), detached, buffer: Buffer.alloc(8), mine: new Mine(8), withOwnName, withOwnConstructor, withOtherPrototype, clamped: new Uint8ClampedArray(8), signed: new Int8Array(8), wide: new Uint16Array(8), floats: new Float64Array(2) };
for (const [name, bytes] of Object.entries(views)) lines.push("view " + name + " " + attempt(() => into(bytes, 2, "abécdefgh")) + " " + bytesOf(bytes.length > 20 ? bytes.subarray(0, 12) : bytes));
lines.push("mine made " + Mine.made);
for (const other of [null, undefined, 1, "text", {}, [], new ArrayBuffer(4), new DataView(new ArrayBuffer(4))]) lines.push("no view " + attempt(() => into(other, 1, "ab")));
resizable.resize(12); lines.push("resized " + attempt(() => into(views.tracking, 10, "abcdef")) + " " + bytesOf(views.tracking)); resizable.resize(3); lines.push("shrunk " + attempt(() => into(views.tracking, 1, "xyz")) + " " + attempt(() => into(views.fixedOverResizable, 1, "xyz")) + " " + bytesOf(views.tracking));

// Every text.
const rope = JSON.parse('"ro"') + JSON.parse('"pe"') + hidden;
const texts = ["", "a", "abcdef", "abcdefg", "é", "abé", "abcdé", "abcdeé", "日", "abc日", "abcd日", "😀", "ab😀", "abc😀", "\ud800", "a\udc00b", rope, rope + "é", 12345, 1.5, true, null, undefined, {}, [1, 2], { toString() { return "own"; } }];
for (const text of texts) { const bytes = new Uint8Array(8).fill(1); lines.push("text " + JSON.stringify(String(text)) + " " + attempt(() => into(bytes, 2, text)) + " " + bytesOf(bytes)); }
lines.push("text symbol " + attempt(() => into(new Uint8Array(4), 1, Symbol())));
{ const bytes = new Uint8Array(8); lines.push("text that transfers " + attempt(() => into(bytes, 2, { toString() { bytes.buffer.transfer(); return "abc"; } })) + " " + bytes.length); }
{ const buffer = new ArrayBuffer(8, { maxByteLength: 16 }), bytes = new Uint8Array(buffer); lines.push("text that shrinks " + attempt(() => into(bytes, 2, { toString() { buffer.resize(3); return "abc"; } })) + " " + bytesOf(bytes)); }

// The range goes elsewhere on another way.
const kept = [];
function intoOrKept(bytes, from, text, keeps) {
  let target = bytes;
  if (from > 0) target = bytes.subarray(from);
  if (keeps) { kept.push(target); return target; }
  return encoder.encodeInto(text, target);
}
{ const bytes = new Uint8Array(8); lines.push("kept " + describe(intoOrKept(bytes, 3, "ab", true)) + " " + describe(intoOrKept(bytes, 0, "ab", true)) + " " + describe(intoOrKept(bytes, 3, "ab", false)) + " " + (kept[0] === bytes) + (kept[1] === bytes) + (kept[0].buffer === bytes.buffer) + " " + bytesOf(kept[0]) + " " + bytesOf(bytes)); kept[0][0] = 9; lines.push("kept shares " + bytesOf(bytes)); }
function returned(bytes, from, text, wants) { const target = bytes.subarray(from); if (wants) return target; encoder.encodeInto(text, target); return null; }
{ const bytes = new Uint8Array(4), one = returned(bytes, 1, "a", true), two = returned(bytes, 1, "a", true); lines.push("returned " + describe(one) + " " + (one === two) + " " + describe(returned(bytes, 2, "zz", false)) + " " + bytesOf(bytes)); }
function twice(bytes, from) { const target = bytes.subarray(from); return describe(encoder.encodeInto("ab", target)) + describe(encoder.encodeInto("c", target)) + describe(target); }
lines.push("twice " + twice(new Uint8Array(6), 2));
function inLoop(bytes, from, n) { const target = bytes.subarray(from); let all = ""; for (let i = 0; i < n; i++) all += describe(encoder.encodeInto("k" + i, target)); return all + bytesOf(bytes); }
lines.push("in a loop " + inLoop(new Uint8Array(6), 2, 3));
function madeInLoop(bytes, pieces) { let at = 0; for (const piece of pieces) at += encoder.encodeInto(piece, bytes.subarray(at)).written; return at + " " + bytesOf(bytes); }
lines.push("made in a loop " + madeInLoop(new Uint8Array(10), ["ab", "", "cé", "defgh", "ij"]));
function comparedAndUsed(bytes, from) { const target = bytes.subarray(from); const same = target === bytes; return same + describe(encoder.encodeInto("q", target)); }
lines.push("compared " + comparedAndUsed(new Uint8Array(3), 0) + " " + comparedAndUsed(new Uint8Array(3), 1));

// Between the range and the call something happens.
const order = [];
function withGetter(holder, bytes, from, text) { let target = bytes; if (0 < from) target = bytes.subarray(from); return holder.encodeInto(text, target); }
{
  const bytes = new Uint8Array(8);
  const transfers = Object.create(null, { encodeInto: { get() { order.push("read"); bytes.buffer.transfer(); return function (text, destination) { order.push(describe(destination) + (destination.buffer === bytes.buffer)); return { read: 0, written: 0 }; }; } } });
  lines.push("getter that transfers " + attempt(() => withGetter(transfers, bytes, 3, "ab")) + " " + order.join());
}
{
  const own = new TextEncoder(), bytes = new Uint8Array(8);
  Object.defineProperty(own, "encodeInto", { get() { bytes.buffer.transfer(); return TextEncoder.prototype.encodeInto; } });
  lines.push("getter that transfers and hands the real one " + attempt(() => withGetter(own, bytes, 3, "ab")) + " " + bytes.length);
}
{
  const bytes = new Uint8Array(8), writes = { get encodeInto() { bytes[5] = 7; return TextEncoder.prototype.encodeInto.bind(encoder); } };
  lines.push("getter that writes " + attempt(() => withGetter(writes, bytes, 3, "ab")) + " " + bytesOf(bytes));
}
function ordered(bytes, from) { try { order.length = 0; order.push("a"); const target = bytes.subarray(from); order.push("b"); return describe(encoder.encodeInto("x", target)); } catch (error) { return error.name + " after " + order.join(); } }
lines.push("order " + ordered(detached, 1) + " " + ordered(new Uint8Array(2), 1) + " " + ordered(null, 1));
lines.push("no encoder " + attempt(() => TextEncoder.prototype.encodeInto.call({}, "a", new Uint8Array(4).subarray(1))) + " " + attempt(() => encoder.encodeInto("a")) + " " + attempt(() => encoder.encodeInto("a", new Uint8Array(4).subarray(1), 3)));
for (let round = 0; round < 3; round++) { Bun.gc(true); const bytes = new Uint8Array(64); let at = 0; for (let i = 0; i < 30; i++) at += into(bytes, at, "ab").written; lines.push("after a collection " + at + " " + bytesOf(bytes.subarray(56))); }
console.log(lines.join("\n"));
