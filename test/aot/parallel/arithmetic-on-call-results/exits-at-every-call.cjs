// STATISTIC: ArraysGuardedForReads >= 1
// What a call gives is expected to be a number. Where one is not, the rest of the function runs as written, with all that was computed before that call.
const out = [];
const special = { u: undefined, n: 7n, o: { valueOf() { out.push("valueOf"); return 5; } }, t: "12", y: Symbol.iterator, l: [4], e: { [Symbol.toPrimitive](hint) { return hint + "!"; } } };
const revive = (key, value) => (typeof value === "string" ? special[value] : value);
let reads = 0;
function mix(o, x) {
  let s = 0, q = 1.5, w = "";
  const v0 = o.a * JSON.parse(x.t0, revive);
  s = (s * JSON.parse(x.t1, revive) + o.a) | 0;
  const v1 = v0 * 3 - s, r0 = JSON.parse(x.t2, revive), v2 = r0 * o.b;
  q = q * JSON.parse(x.t3, revive) + v0 * o.b;
  const v3 = v1 * JSON.parse(x.t4, revive) - v2;
  reads = reads + 1;
  s = (s * 31 + v3 * JSON.parse(x.t5, revive)) | 0;
  const v4 = JSON.parse(x.t6, revive) + v0, v5 = q * v1;
  w = w + v4;
  q = q / JSON.parse(x.t7, revive) - v5;
  const r1 = JSON.parse(x.t8, revive), v6 = r1 * r0 + o.b * v2;
  s = (s ^ (v6 * JSON.parse(x.t9, revive))) | 0;
  o.c = v6 * 2 - v3;
  const v7 = -JSON.parse(x.t10, revive) * o.c;
  s = s * JSON.parse(x.t11, revive) + v7 * v0;
  return [s, q, w, v0, v1, v2, v3, v4, v5, v6, v7, r0 === r1, o.c, reads];
}
const usual = ["2", "3", "4.5", "5", "-1", "7", "0.25", "2", "3", "-4", "6", "1"];
const odd = ['"u"', '"n"', '"o"', '"t"', '"y"', '"l"', '"e"', "null", "true", "-0", "1e400", "4294967296"];
const show = value => (typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : String(value));
const named = texts => Object.fromEntries(texts.map((text, place) => ["t" + place, text]));
const throwing = new Set(['"n"', '"y"']);
const rows = [];
for (let place = 0; place < usual.length; place++)
  for (const text of odd) {
    rows.push(usual.with(place, text));
    rows.push(rows.at(-1).with((place + 5) % usual.length, odd[(place + text.length) % odd.length]));
  }
rows.push(usual, odd, usual.map(() => '"n"'));
function caught(texts) {
  try {
    return mix({ a: 2, b: 2, c: 0 }, named(texts));
  } catch (error) {
    return [String(error)];
  }
}
for (let turn = 0; turn < rows.length; turn++) {
  const texts = rows[turn];
  const found = texts.some(text => throwing.has(text)) ? caught(texts) : mix({ a: turn % 5, b: 2, c: 0 }, named(texts));
  out.push(found.map(show).join(" "));
}
console.log(out.length, reads, out.reduce((h, s) => { for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return h; }, 5381));
console.log(out.slice(0, 40).join("\n"));
