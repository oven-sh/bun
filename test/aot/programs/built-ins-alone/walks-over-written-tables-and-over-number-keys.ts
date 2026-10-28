// A Map or a Set that is written as a literal of texts lies in the image until something is stored in it, or until it is walked: the first step of a walk moves it to the heap.
// A table that holds a number has wide keys, and the step of a walk in fast code reads the width that the type of the keys promises. Every walk here is also changed while it runs.
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map((v) => (Object.is(v, -0) ? "-0" : String(v))).join(" ")); }

function writtenMap(): Map<string, number> { return new Map([["alpha", 1], ["bravo", 2], ["charlie", 3], ["delta", 4]]); }
function writtenSet(): Set<string> { return new Set(["alpha", "bravo", "charlie", "delta"]); }
const shared = new Map([["one", 1], ["two", 2], ["three", 3]]);
const sharedSet = new Set(["x", "y", "z"]);

function keysOf(map: Map<string, number>): string { let text = ""; for (const [k, v] of map) text += k + v + ","; return text; }
function valuesOf(map: Map<string, number>): number { let total = 0; for (const v of map.values()) total += v; return total; }
function textsOf(set: Set<string>): string { let text = ""; for (const v of set) text += v + ","; return text; }
function sumOf(set: Set<number>): number { let total = 0; for (const v of set) total += v; return total; }
function listOf(set: Set<number>): string { let text = ""; for (const v of set) text += (Object.is(v, -0) ? "-0" : String(v)) + ","; return text; }
function keySum(map: Map<number, string>): string { let text = ""; for (const [k, v] of map) text += k + v + ","; return text; }
function mixedOf(set: Set<number | undefined | null | boolean>): string { let text = ""; for (const v of set) text += String(v) + ","; return text; }

for (let round = 0; round < 3; round++) {
  say("shared walked again", keysOf(shared), valuesOf(shared), textsOf(sharedSet), [...shared.keys()].join(), [...sharedSet].join());
}
say("still finds", shared.get("two"), shared.has("four"), sharedSet.has("y"), sharedSet.has("w"), shared.size, sharedSet.size);
shared.set("four", 4); sharedSet.add("w");
say("stored behind a walk", keysOf(shared), textsOf(sharedSet));

{
  const map = writtenMap();
  const held = map.entries();
  say("an iterator from before the walk", String(held.next().value));
  say("the walk", keysOf(map));
  say("the iterator goes on", String(held.next().value), String(held.next().value), String(held.next().value), held.next().done);
}
{
  const map = writtenMap();
  let text = "";
  for (const [k] of map) { text += k + ":"; for (const [inner] of map) text += inner[0]; text += ","; }
  say("a walk inside a walk", text);
}
{
  const map = writtenMap();
  let text = "";
  for (const [k, v] of map) { text += k + v + ","; if (v < 3) map.set(k + k, v + 10); }
  say("stored in the first walk", text, map.size);
}
{
  const map = writtenMap();
  let text = "";
  for (const [k] of map) { text += k + ","; map.delete("charlie"); if (k === "bravo") map.delete("alpha"); }
  say("deleted in the first walk", text, map.size, keysOf(map));
}
{
  const map = writtenMap();
  let text = "";
  for (const [k] of map) { text += k + ","; if (k === "bravo") { map.clear(); map.set("late", 9); } }
  say("cleared in the first walk", text, keysOf(map));
}
{
  const set = writtenSet();
  let text = "";
  for (const v of set) { text += v + ","; if (v.length === 5 && set.size < 8) set.add(v + "!"); if (v === "charlie") set.delete("delta"); }
  say("a written set changed in its walk", text, textsOf(set));
}
{
  const set = writtenSet();
  let count = 0;
  set.forEach((v, again, whole) => { count += v === again && whole === set ? 1 : 100; });
  say("forEach first", count, textsOf(set), [...set.entries()].join("|"));
}
{
  const a = writtenMap(), b = writtenMap();
  keysOf(a); a.set("alpha", 100);
  say("two from one literal", keysOf(a), keysOf(b));
}

{
  const set = new Set([1, 2, 3, 4]);
  say("numbers", sumOf(set), listOf(set));
  set.delete(2); say("one deleted", sumOf(set), listOf(set));
  let text = "";
  for (const v of set) { text += v + ","; if (v < 100 && set.size < 40) set.add(v * 7 + 100); }
  say("grown in its walk", text.length, set.size, sumOf(set));
  let seen = 0;
  for (const v of set) { seen++; set.delete(v); }
  say("emptied in its walk", seen, set.size, sumOf(set));
  set.add(5); say("filled again", listOf(set));
  let after = "";
  for (const v of set) { after += v + ","; if (v === 5) { set.clear(); set.add(6); set.add(7); } }
  say("cleared in its walk", after, listOf(set));
}
say("odd numbers", listOf(new Set([0, -0, NaN, NaN, 1.5, -1.5, 2 ** 31, -(2 ** 31), 2 ** 53, Infinity, -Infinity, 1e-300])));
say("an empty set", sumOf(new Set<number>()), listOf(new Set<number>()), keySum(new Map<number, string>()));
{
  const map = new Map<number, string>();
  for (let i = 0; i < 20; i++) map.set(i * 3, "v" + i);
  say("number keys, text values", keySum(map));
  for (let i = 0; i < 20; i += 2) map.delete(i * 3);
  say("every other one deleted", keySum(map));
  const numbers = new Map<number, number>([[1, 1.5], [2, 2 ** 40], [3, -0]]);
  let text = ""; for (const [k, v] of numbers) text += k + "=" + (Object.is(v, -0) ? "-0" : v) + ",";
  say("number keys, number values", text);
  const objects = new Map<number, { n: number } | undefined>([[1, { n: 1 }], [2, undefined]]);
  let found = ""; for (const [k, v] of objects) found += k + "=" + (v ? v.n : "none") + ",";
  say("number keys, object values", found);
}
say("no number among them", mixedOf(new Set<number | undefined | null | boolean>([undefined, null, true, false])));
say("a number comes last", mixedOf(new Set<number | undefined | null | boolean>([undefined, null, true, 7])));
{
  const set = new Set<number | undefined | null | boolean>([undefined, true]);
  let text = "";
  for (const v of set) { text += String(v) + ","; if (v === true) set.add(3); if (v === 3) set.add(null); }
  say("the first number is stored in the walk", text, mixedOf(set));
}
{
  const liar = new Set<number>();
  (liar as Set<unknown>).add("text"); (liar as Set<unknown>).add({ toString() { return "object"; } });
  let text = ""; for (const v of liar) text += String(v) + ",";
  say("texts in a set of numbers", text);
  (liar as Set<unknown>).add(1);
  text = ""; for (const v of liar) text += String(v) + ",";
  say("and a number", text);
  const other = new Set<string>(["a"]);
  (other as Set<unknown>).add(2.5);
  say("a number in a set of texts", textsOf(other));
}
for (let round = 0; round < 200; round++) {
  const set = new Set<number>(); for (let i = 0; i < round % 9; i++) set.add(i + round);
  if (sumOf(set) !== [...set].reduce((a, b) => a + b, 0)) say("WRONG", round);
  if (keysOf(writtenMap()) !== "alpha1,bravo2,charlie3,delta4,") say("WRONG MAP", round);
}
console.log(lines.join("\n"));
