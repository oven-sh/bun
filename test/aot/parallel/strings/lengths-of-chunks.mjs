// STATISTIC: BuiltinCallsOnNarrowRow >= 6
// The bytes of chunks that nobody has typed, summed in loops: texts, views, both in turn, and what is refused in the middle of a loop.
const attempt = f => { try { return f(); } catch (e) { return e.code ?? e.constructor.name; } };
function byteLengthOfChunk(chunk) { return Buffer.byteLength(chunk, "utf8"); }
function total(segment) { let n = 0; const chunks = segment.chunks; for (let i = 0; i < chunks.length; i++) n += byteLengthOfChunk(chunks[i]); return n; }
function latin(segment) { let n = 0; for (const chunk of segment.chunks) n += Buffer.byteLength(chunk, "latin1"); return n; }
function alone(segment) { let n = 0; for (let i = 0; i < segment.chunks.length; i++) n += Buffer.byteLength(segment.chunks[i]); return n; }
function inEncoding(segment, encoding) { let n = 0; for (let i = 0; i < segment.chunks.length; i++) n += Buffer.byteLength(segment.chunks[i], encoding); return n; }
function counted(segment) { let n = 0, seen = 0; for (let i = 0; i < segment.chunks.length; i++) { seen++; n += byteLengthOfChunk(segment.chunks[i]); if (n > 50) segment.chunks.length = Math.min(segment.chunks.length, i + 2); } return n + ":" + seen; }
const lists = {
  texts: JSON.parse('["<div>", "téxt", "中", ""]'),
  views: [new Uint8Array(4), new Uint16Array(3), new DataView(new ArrayBuffer(5)), new ArrayBuffer(6)],
  inTurn: ["a", new Uint8Array(2), "é", new Uint8Array(3), "b" + process.argv.length],
  viewsLast: ["a", "b", "c", new Uint8Array(9)],
  refused: ["a", 5, "b"], nothing: ["a", null], symbol: ["中", Symbol.iterator], objects: ["a", { toString() { return "bc"; } }], wrapped: [new String("abc"), "x"],
  holes: ["a", , "b"], none: [], ropes: Array.from({ length: 30 }, (_, i) => "r" + i + (i % 3 ? "" : "é".repeat(i))), long: ["x".repeat(5000), "ÿ".repeat(300), "𐀀".repeat(40)],
};
const encodings = ["utf8", "UTF-8", "ucs2", "hex", "base64", "ascii", "unknown", undefined, 5];
for (let round = 0; round < 3; round++) for (const name of Object.keys(lists)) {
  const segment = { chunks: lists[name] };
  console.log(name, attempt(() => total(segment)), attempt(() => latin(segment)), attempt(() => alone(segment)), attempt(() => counted({ chunks: [...lists[name]] })), encodings.map(encoding => attempt(() => inEncoding(segment, encoding))).join());
}
