// Buffer.byteLength() of texts, ropes and views in every encoding, written and computed.
const lone = "\ud800", texts = ["", "abc", "déf", "中文", "a" + "😀", lone, "x".repeat(300) + "ÿ", "QUJD", "QUI=", "QQ==", "0a1b", "0a1"];
const encodings = [undefined, null, "utf8", "utf-8", "UTF8", "Utf-8", "ucs2", "ucs-2", "utf16le", "utf-16le", "latin1", "binary", "LATIN1", "ascii", "hex", "base64", "base64url", "buffer", "unknown", "", 5, {}, "ut" + "f8"];
const attempt = f => { try { return f(); } catch (e) { return e.code ?? e.constructor.name; } };
function ofChunk(chunk) { return Buffer.byteLength(chunk, "utf8"); }
function ofLatin(chunk) { return Buffer.byteLength(chunk, "latin1"); }
function ofAny(chunk, encoding) { return Buffer.byteLength(chunk, encoding); }
function alone(chunk) { return Buffer.byteLength(chunk); }
for (const text of texts) console.log(JSON.stringify(text.slice(0, 6)), encodings.map(e => attempt(() => ofAny(text, e))).join(), ofChunk(text), ofLatin(text), alone(text));
let rope = "";
for (let i = 0; i < 40; i++) { rope += i % 7 ? "ab" + i : "é"; if (i % 13 === 0) console.log(ofChunk(rope), ofLatin(rope + "中"), ofChunk(rope + "中" + i), ofAny(rope + i, "ascii")); }
const others = [new Uint8Array(3), new Uint16Array(3), new DataView(new ArrayBuffer(9), 2), new ArrayBuffer(7), Buffer.from("abcd"), 5, null, undefined, {}, ["a"], Symbol.iterator, new String("abc"), { toString() { return "abc"; } }];
for (const other of others) console.log(attempt(() => ofChunk(other)), attempt(() => ofLatin(other)), attempt(() => alone(other)), attempt(() => ofAny(other, "hex")));
let sum = 0;
const chunks = ["<div>", "téxt", new Uint8Array(4), "中", "</div>"];
for (let i = 0; i < 100; i++) sum += ofChunk(chunks[i % 5]);
for (const list of [chunks, ["a", "b"], [new Uint8Array(2), new Uint8Array(3)]]) for (let i = 0; i < list.length; i++) sum += Buffer.byteLength(list[i], "utf8");
console.log(sum);
