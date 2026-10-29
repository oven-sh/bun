// encoder.encodeInto(text, view) where the program only reads `read` and `written`: the native function gets the characters and the bytes, and no object is made. Views in every state, texts of every kind, and programs that keep the object.
const lines = [];
const bytesOf = view => { try { return Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).join(); } catch (error) { return "unreadable " + error.name; } };
const attempt = f => { try { return f(); } catch (error) { return "throws " + error.name; } };
const encoder = new TextEncoder();
const hidden = JSON.parse("[0]")[0];

function counts(text, view) { const { read, written } = encoder.encodeInto(text, view); return read + "/" + written; }
function writtenAlone(text, view) { return encoder.encodeInto(text, view).written; }
function readAlone(text, view) { return encoder.encodeInto(text, view).read; }
function whole(text, view) { return encoder.encodeInto(text, view); }

class Bytes extends Uint8Array {}
const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
const growable = new SharedArrayBuffer(8, { maxByteLength: 16 });
const detached = new Uint8Array(8); detached.buffer.transfer();
const makers = {
  plain: () => new Uint8Array(8),
  one: () => new Uint8Array(1),
  empty: () => new Uint8Array(0),
  large: () => new Uint8Array(5000),
  offset: () => new Uint8Array(new ArrayBuffer(16), 4, 8),
  tracking: () => new Uint8Array(resizable),
  trackingFromTwo: () => new Uint8Array(resizable, 2),
  fixedOverResizable: () => new Uint8Array(resizable, 2, 4),
  shared: () => new Uint8Array(new SharedArrayBuffer(8)),
  growing: () => new Uint8Array(growable),
  detached: () => detached,
  subclass: () => new Bytes(8),
  buffer: () => Buffer.alloc(8),
  clamped: () => new Uint8ClampedArray(8),
  signed: () => new Int8Array(8),
  shorts: () => new Uint16Array(4),
  floats: () => new Float64Array(2),
  big: () => new BigInt64Array(1),
  dataView: () => new DataView(new ArrayBuffer(8)),
  dataViewFromThree: () => new DataView(new ArrayBuffer(8), 3),
  trackingDataView: () => new DataView(resizable, 1),
};
for (const [name, make] of Object.entries(makers)) {
  for (const text of ["", "ab", "abcdefgh", "abcdefghi", "aé", "abcdefgé", "日本語", "ab😀cd"]) {
    new Uint8Array(resizable).fill(0); new Uint8Array(growable).fill(0);
    const view = make();
    lines.push(name + " " + JSON.stringify(text) + " " + attempt(() => counts(text, view)) + " " + (view.byteLength > 20 ? bytesOf(view.subarray(0, 12)) : bytesOf(view)));
  }
}

const tracking = new Uint8Array(resizable), fixed = new Uint8Array(resizable, 2, 4);
resizable.resize(12); lines.push("grown " + counts("abcdefghijklmnop", tracking) + " " + counts("xyzw12", fixed) + " " + bytesOf(tracking));
resizable.resize(3); lines.push("shrunk " + counts("ABCDEF", tracking) + " " + counts("xyz", fixed) + " " + bytesOf(tracking));
resizable.resize(0); lines.push("to nothing " + counts("ABCDEF", tracking) + " " + counts("xyz", fixed));
resizable.resize(8);
growable.grow(10); lines.push("shared and grown " + counts("abcdefghijklmnop", new Uint8Array(growable)));

const rope = JSON.parse('"ro"') + JSON.parse('"pe"') + hidden;
const longRope = "x".repeat(40) + hidden + "é".repeat(3) + hidden;
const piece = ("prefix " + "abcdefghijklmnopqrstuvwxyz".repeat(2) + hidden).slice(7, 20);
const widePiece = ("日本語のテキストをここに書く" + hidden).slice(2, 6);
const target = new Uint8Array(24);
for (const text of ["", "a", "ab", "abc", "abcd", "abcdefg", "abcdefgh", "abcdefghijklmnop", "abcdefghijklmnopq", "x".repeat(23), "x".repeat(24), "x".repeat(25), "x".repeat(100), "é", "é".repeat(12), "é".repeat(13), "x".repeat(23) + "é", "x".repeat(22) + "é", "日".repeat(8), "日".repeat(9), "x".repeat(22) + "日", "x".repeat(21) + "日", "😀".repeat(6), "😀".repeat(7), "x".repeat(21) + "😀", "x".repeat(20) + "😀", "\ud800", "\udc00", "a\ud800", "\ud800a", "a\udc00b", "\ud800\ud800", "\udc00\ud800", "x".repeat(22) + "\ud800", "x".repeat(21) + "\ud800", "x".repeat(23) + "😀", "\u0000", "\u007f\u0080", "߿ࠀ", "￿", rope, rope + "é", rope + "日", longRope, piece, widePiece, piece + widePiece]) {
  target.fill(1);
  lines.push("text " + JSON.stringify(text.length > 30 ? text.slice(0, 30) + ".." + text.length : text) + " " + counts(text, target) + " " + writtenAlone(text, target) + " " + readAlone(text, target) + " " + bytesOf(target));
}

for (const text of [12345, 1.5, true, null, undefined, {}, [1, 2], { toString() { return "own"; } }, 10n]) { target.fill(1); lines.push("converted " + String(text) + " " + attempt(() => counts(text, target)) + " " + bytesOf(target)); }
lines.push("symbol " + attempt(() => counts(Symbol(), target)));
{ const bytes = new Uint8Array(8); lines.push("text that transfers " + attempt(() => counts({ toString() { bytes.buffer.transfer(); return "abc"; } }, bytes)) + " " + bytes.length); }
lines.push("text that shrinks " + attempt(() => counts({ toString() { resizable.resize(2); return "abc"; } }, tracking)) + " " + bytesOf(tracking)); resizable.resize(8);

for (const destination of [undefined, null, 1, "text", {}, [], new ArrayBuffer(8), new SharedArrayBuffer(8), { length: 8, byteLength: 8 }, Uint8Array, Uint8Array.prototype]) lines.push("no view " + Object.prototype.toString.call(destination) + " " + attempt(() => counts("ab", destination)));
lines.push("too few " + attempt(() => encoder.encodeInto().written) + " " + attempt(() => encoder.encodeInto("a").written));
for (const receiver of [undefined, null, {}, TextEncoder.prototype, new TextDecoder()]) lines.push("receiver " + Object.prototype.toString.call(receiver) + " " + attempt(() => TextEncoder.prototype.encodeInto.call(receiver, "ab", target).written));

const kept = whole("aé日", target);
lines.push("kept " + JSON.stringify(kept) + " " + Object.keys(kept).join() + " " + (Object.getPrototypeOf(kept) === Object.prototype) + " " + Object.isExtensible(kept) + " " + JSON.stringify(Object.getOwnPropertyDescriptors(kept)));
kept.read = "changed"; kept.more = 1; delete kept.written;
lines.push("kept and changed " + JSON.stringify(kept) + " " + (whole("a", target) !== whole("a", target)));
function keptOnOneWay(text, keeps) { const result = encoder.encodeInto(text, target); if (keeps) return result; return result.written; }
lines.push("kept on one way " + JSON.stringify(keptOnOneWay("abc", true)) + " " + keptOnOneWay("abcd", false));
function otherNames(text) { const result = encoder.encodeInto(text, target); return String(result.length) + result.toString() + ("read" in result) + ("wrote" in result) + result.hasOwnProperty("written"); }
lines.push("other names " + otherNames("ab"));
function spread(text) { return JSON.stringify({ ...encoder.encodeInto(text, target), last: true }); }
lines.push("spread " + spread("abc"));

function manyInARow(pieces, view) { let all = 0; for (let i = 0; i < pieces.length; i++) all += encoder.encodeInto(pieces[i], view).written; return all; }
lines.push("many " + manyInARow(["a", "bc", rope, "é", "日本", "", longRope], target) + " " + bytesOf(target));
for (let round = 0; round < 3; round++) { let made = 0; for (let i = 0; i < 2000; i++) { const fresh = new Uint8Array(16); made += writtenAlone("k" + i + hidden + "é", fresh) + fresh[0]; } Bun.gc(true); lines.push("fresh views and ropes " + made); }
console.log(lines.join("\n"));
