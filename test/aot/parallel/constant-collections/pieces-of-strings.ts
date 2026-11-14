// Pieces of strings looked up in sets and maps of literals: hits, misses, wide and empty strings, pieces that are looked up again, used behind the lookup, and collections that grow later.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "", "日本", "été", "a key that is longer than sixteen characters"]);
const CODES: ReadonlyMap<string, number> = new Map([["area", 1], ["br", 2], ["", 3], ["日本", 4], ["été", 5], ["half", 0.5], ["nan", NaN], ["minus", -0]]);
const NAMES = new Map<string, string>([["amp", "&"], ["lt", "<"], ["nbsp", " "], ["日", "sun"], ["long", "a value that is longer than sixteen characters"]]);
const MIXED = new Map<string, unknown>([["a", [1, 2]], ["b", { c: 1 }], ["c", null], ["d", undefined], ["e", true], ["f", () => 1], ["g", 10n]]);
const GROWS = new Set(["one", "two"]), SHRINKS = new Map<string, number>([["one", 1], ["two", 2]]);
const text = "area base br col embed hr x ab areas are  日本 été日 été amp lt nbsp long half nan minus a b c d e f g one two three a key that is longer than sixteen characters end";
const latin = "area base br col embed hr x ab areas are amp lt long half nan minus a b c d e f g one two three a key that is longer than sixteen characters";
function cut(source: string, width: number): string[] { const out: string[] = []; for (let k = 0; k + width <= source.length; k++) out.push(source.slice(k, k + width)); return out; }
function words(source: string): string[] { const out: string[] = []; let start = 0; for (let k = 0; k <= source.length; k++) if (k === source.length || source[k] === " ") { out.push(source.substring(start, k)); start = k + 1; } return out; }
let digest = 0;
const add = (v: unknown): void => { const t = String(typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : typeof v === "function" ? "fn" : v); for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
function lookUp(list: string[]): string {
  let hits = 0, sum = 0, out = "";
  for (const k of list) {
    if (VOID.has(k)) hits++;
    if (VOID.has(k)) hits += 100;
    const code = CODES.get(k); add(code); if (code !== undefined) sum += code === code ? code : 1000;
    const name = NAMES.get(k); add(name); if (name) out += name;
    add(MIXED.get(k)); add(MIXED.has(k)); add(CODES.has(k));
    add(k); add(k.length); add(k.charCodeAt(0)); add(k + "!"); add(k === "br" ? 1 : 2);
  }
  return hits + "." + sum + "." + out;
}
function fresh(width: number): number { let n = 0; for (let k = 0; k + width <= text.length; k++) if (VOID.has(text.slice(k, k + width)) || CODES.has(text.substring(k, k + width))) n++; return n; }
function grown(): string {
  let out = "";
  for (const k of ["one", "two", "three", "four"]) out += GROWS.has(("<" + k + ">").slice(1, -1)) ? 1 : 0;
  for (const k of ["one", "two", "three"]) out += SHRINKS.get(("<" + k + ">").slice(1, -1)) ?? "n";
  return out;
}
function kept(): string { const held: string[] = []; for (let k = 0; k < 200; k++) { const piece = text.slice(k % 140, (k % 140) + 4); VOID.has(piece); CODES.get(piece); held.push(piece); } return held.join("|").length + "." + new Set(held).size; }
for (let turn = 0; turn < 20; turn++) {
  const line = [lookUp(words(text)), lookUp(words(latin)), ...[0, 1, 2, 3, 4, 5].map(w => lookUp(cut(text, w))), ...[2, 4].map(w => lookUp(cut(latin, w))), fresh(2), fresh(4), fresh(44), grown(), kept()].join(" ");
  if (turn < 2 || turn === 19) console.log(line, digest);
  if (turn === 5) { GROWS.add("three"); SHRINKS.delete("one"); }
  if (turn === 9) { (VOID as Set<string>).add("ab"); (VOID as Set<string>).delete("hr"); (CODES as Map<string, number>).set("x", 7); }
}
