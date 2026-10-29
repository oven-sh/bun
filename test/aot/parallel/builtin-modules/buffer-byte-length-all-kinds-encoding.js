// Buffer.byteLength(string, encoding): only a string names an encoding; whatever else stands there counts UTF-8.
const texts = ["", "plain", "héllo", "€ uro", "😀 smile", "\ud800 lone", "a".repeat(300), "ÿ".repeat(70), "aGVsbG8=", "68656c6c6f", "x".repeat(9) + "中"];
const encodings = [undefined, null, 0, 1, true, {}, [], Symbol.iterator, 10n, "utf8", "utf-8", "UTF8", "Utf-8", "latin1", "binary", "ascii", "ucs2", "utf16le", "UCS-2", "hex", "base64", "base64url", "nonsense", "", { toString() { return "hex"; } }, new String("hex")];
function count(text, encoding) { return Buffer.byteLength(text, encoding); }
function countLeftOut(text) { return Buffer.byteLength(text); }
function countMaybe(text, encoding) { return typeof text === "string" ? Buffer.byteLength(text, encoding) : text.length; }
let lines = [];
for (let round = 0; round < 40; round++) {
  lines = [];
  for (const encoding of encodings) lines.push(texts.map(text => count(text, encoding)).join());
  lines.push(texts.map(countLeftOut).join());
  lines.push(texts.map(text => countMaybe(text, round & 1 ? undefined : "latin1")).join());
}
for (let i = 0; i < lines.length; i++) console.log(i, lines[i]);
const rope = "ab".repeat(20) + texts[3] + String(Math.abs(-5));
console.log(count(rope, undefined), count(rope, "ucs2"), count(rope.slice(3, 44), undefined), countMaybe(new Uint8Array(7), "hex"));
for (const bad of [5, null, undefined, {}, Symbol()]) { try { console.log(count(bad, undefined)); } catch (e) { console.log(e.name, e.code); } }
console.log(Buffer.byteLength("é", ...[]), Buffer.byteLength("é", "latin1", "hex"), Buffer.byteLength(...["é", undefined]));
