// IR= 2 madeInLoop _inRanges
// IR= 1 writeHeld _inRanges
// IR= 1 intoOrKept _inRanges
// IR= 1 oneOfTwo _inRanges
// IR= 1 compared _inRanges
// IR= 0 twice _inRanges
// IR= 0 inLoop _inRanges
// view.subarray(begin) that goes into encoder.encodeInto(text, ..) where the compiler knows the view for a Uint8Array: the function takes the bytes, so the range is not made. Every state such a view may be in, every number, every text, and every other way the range may go.
const lines = [];
const bytesOf = view => { try { return Array.from(view).join(); } catch (error) { return "unreadable " + error.name; } };
const describe = x => x === null || typeof x !== "object" ? String(x) : ArrayBuffer.isView(x) ? x.constructor.name + "@" + x.byteOffset + "+" + x.length : "read" in x ? x.read + "/" + x.written : Object.prototype.toString.call(x);
const attempt = f => { try { return describe(f()); } catch (error) { return "throws " + error.name; } };
const encoder = new TextEncoder();
const hidden = JSON.parse("[0]")[0];

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

// An encoder nobody followed, beside an object of the program that has a method of the same name.
const impostor = { got: null, encodeInto(text, destination) { this.got = destination; return { read: -1, written: destination.length }; } };
const holders = [{ encoder: new TextEncoder() }, { encoder: impostor }, { get encoder() { page.buffer.transfer(); return holders[0].encoder; } }, { get encoder() { page.buffer.transfer(); return impostor; } }, { get encoder() { page[5] = 7; page.extra = 1; return holders[0].encoder; } }];
let page = new Uint8Array(8), at = 0;
function writeHeld(which, text) {
  let target = page;
  if (0 < at) target = page.subarray(at);
  const counts = holders[which + hidden].encoder.encodeInto(text, target);
  return counts.read + "/" + counts.written;
}
for (const [which, place] of [[0, 0], [0, 3], [1, 3], [1, 0], [0, 7], [1, 8], [0, 8]]) { at = place; const answer = writeHeld(which, "ab"); lines.push("held " + which + " at " + place + " " + answer + " " + bytesOf(page) + " " + describe(impostor.got) + " " + (impostor.got === page) + " " + (impostor.got !== null && impostor.got.buffer === page.buffer)); }

// What is read between the range and the call transfers the buffer, or changes the view.
for (const [which, place] of [[2, 3], [2, 0], [3, 3], [3, 0], [4, 3], [4, 0]]) { page = new Uint8Array(8); const bytes = page; at = place; impostor.got = null; const answer = attempt(() => writeHeld(which, "ab")); lines.push("in between " + which + " at " + place + " " + answer + " " + bytesOf(bytes) + " " + describe(impostor.got) + " " + (impostor.got === bytes) + " " + (impostor.got !== null && impostor.got.buffer === bytes.buffer)); }
page = new Uint8Array(8);
const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
const detached = new Uint8Array(8); detached.buffer.transfer();
const withOwnName = new Uint8Array(8); withOwnName.extra = 1;
const withOwnConstructor = new Uint8Array(8); Object.defineProperty(withOwnConstructor, "constructor", { value: Uint16Array });
const withOtherPrototype = new Uint8Array(8); Object.setPrototypeOf(withOtherPrototype, Int8Array.prototype);
const names = ["plain", "small", "empty", "big", "offset", "tracking", "fixedOverResizable", "shared", "detached", "withOwnName", "withOwnConstructor", "withOtherPrototype"];
const views = [new Uint8Array(8), new Uint8Array(1), new Uint8Array(0), new Uint8Array(5000), new Uint8Array(new ArrayBuffer(16), 4, 8), new Uint8Array(resizable), new Uint8Array(resizable, 2, 4), new Uint8Array(new SharedArrayBuffer(8)), detached, withOwnName, withOwnConstructor, withOtherPrototype];
function into(index, begin, text) { return encoder.encodeInto(text, views[index].subarray(begin)); }
const shown = index => { const bytes = views[index]; return bytesOf(bytes.length > 20 ? Array.prototype.slice.call(bytes, 0, 12) : bytes); };
for (let index = 0; index < views.length; index++) for (const begin of [0, 2, 8]) lines.push("view " + names[index] + " from " + begin + " " + attempt(() => into(index, begin, "abécdefgh")) + " " + shown(index));
resizable.resize(12); lines.push("resized " + attempt(() => into(5, 10, "abcdef")) + " " + shown(5)); resizable.resize(3); lines.push("shrunk " + attempt(() => into(5, 1, "xyz")) + " " + attempt(() => into(6, 1, "xyz")) + " " + shown(5)); resizable.resize(8);

for (const begin of [0, 1, 7, 8, 9, -1, -8, -9, 1.5, -1.5, NaN, Infinity, -Infinity, -0, 2 ** 31, 2 ** 32 + 1, -(2 ** 31), 2 ** 31 - 1]) { views[0].fill(0); lines.push("begin " + (Object.is(begin, -0) ? "-0" : begin) + " " + attempt(() => into(0, begin, "abcdefghij")) + " " + shown(0)); }

const rope = JSON.parse('"ro"') + JSON.parse('"pe"') + hidden;
function intoPlain(begin, text) { return encoder.encodeInto(text, views[0].subarray(begin)); }
for (const text of ["", "a", "abcdef", "abcdefg", "é", "abé", "abcdé", "abcdeé", "日", "abc日", "abcd日", "😀", "ab😀", "abc😀", "\ud800", "a\udc00b", rope, rope + "é", 12345, 1.5, true, null, undefined, {}, [1, 2], { toString() { return "own"; } }]) { views[0].fill(1); lines.push("text " + JSON.stringify(String(text)) + " " + attempt(() => intoPlain(2, text)) + " " + shown(0)); }
lines.push("text symbol " + attempt(() => intoPlain(1, Symbol())));
{ views[0] = new Uint8Array(8); const bytes = views[0]; lines.push("text that transfers " + attempt(() => intoPlain(2, { toString() { bytes.buffer.transfer(); return "abc"; } })) + " " + bytes.length); views[0] = new Uint8Array(8); }
lines.push("text that shrinks " + attempt(() => into(5, 2, { toString() { resizable.resize(3); return "abc"; } })) + " " + shown(5)); resizable.resize(8);

const kept = [];
function intoOrKept(from, text, keeps) {
  let target = page;
  if (from > 0) target = page.subarray(from);
  if (keeps) { kept.push(target); return 0; }
  return encoder.encodeInto(text, target).written;
}
page = new Uint8Array(8);
lines.push("kept " + intoOrKept(3, "ab", true) + intoOrKept(0, "ab", true) + intoOrKept(3, "ab", false) + intoOrKept(3, "", true) + " " + kept.map(describe).join() + " " + (kept[0] === page) + (kept[1] === page) + (kept[0] === kept[2]) + (kept[0].buffer === page.buffer) + " " + bytesOf(kept[0]) + " " + bytesOf(page)); kept[0][0] = 9; lines.push("kept shares " + bytesOf(page) + " " + bytesOf(kept[2]));
function twice(from) { const target = page.subarray(from); return describe(encoder.encodeInto("ab", target)) + describe(encoder.encodeInto("c", target)) + describe(target); }
lines.push("twice " + twice(2) + " " + bytesOf(page));
function inLoop(from, n) { const target = page.subarray(from); let all = ""; for (let i = 0; i < n; i++) all += describe(encoder.encodeInto("k" + i, target)); return all; }
lines.push("in a loop " + inLoop(2, 3) + " " + bytesOf(page));
function madeInLoop(pieces) { let place = 0; for (let i = 0; i < pieces.length; i++) place += encoder.encodeInto(pieces[i], page.subarray(place)).written; return place; }
page = new Uint8Array(10); lines.push("made in a loop " + madeInLoop(["ab", "", "cé", "defgh", "ij"]) + " " + bytesOf(page));
function keptInLoop(n) { const all = []; let target = page; for (let i = 0; i < n; i++) { if (i & 1) all.push(target); else encoder.encodeInto("z", target); target = page.subarray(i); } return all.map(describe).join() + (all[0] === all[1]); }
lines.push("kept in a loop " + keptInLoop(6) + " " + bytesOf(page));
function compared(from) { const target = page.subarray(from); const same = target === page; return same + describe(encoder.encodeInto("q", target)); }
lines.push("compared " + compared(0) + " " + compared(1));
function oneOfTwo(first, from) { const target = first ? page.subarray(from) : page.subarray(from + 1); return describe(encoder.encodeInto("mn", target)); }
page = new Uint8Array(6); lines.push("one of two " + oneOfTwo(true, 1) + oneOfTwo(false, 3) + " " + bytesOf(page));
function rangeOfRange(from) { return describe(encoder.encodeInto("rs", page.subarray(from).subarray(1))); }
lines.push("a range of a range " + rangeOfRange(1) + " " + bytesOf(page));

const order = [];
function ordered(index, from) { try { order.length = 0; order.push("a"); const target = views[index].subarray(from); order.push("b"); return describe(encoder.encodeInto("x", target)); } catch (error) { return error.name + " after " + order.join(); } }
lines.push("order " + ordered(8, 1) + " " + ordered(0, 1));
function caught(index, from) { let target = null; try { target = views[index].subarray(from); } catch (error) { return "caught " + error.name; } return describe(encoder.encodeInto("x", target)); }
lines.push("caught " + caught(8, 1) + " " + caught(0, 1));
for (let round = 0; round < 3; round++) { Bun.gc(true); page = new Uint8Array(64); let place = 0; for (let i = 0; i < 30; i++) { at = place; place += +writeHeld(0, "ab").split("/")[1]; } lines.push("after a collection " + place + " " + bytesOf(page.subarray(56))); }
console.log(lines.join("\n"));
