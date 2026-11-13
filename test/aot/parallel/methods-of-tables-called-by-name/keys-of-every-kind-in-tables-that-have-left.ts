const said: unknown[] = [];
const shelf: unknown[] = [0, "text", new WeakMap<object, number>()];
function from<T extends object>(value: T): T { shelf[3] = value; return shelf[3 + (said.length & 0)] as T; }
const handle = { id: 1 }; const mark = Symbol("mark"); const long = "x".repeat(40);
function byText(table: Map<string, number>, seen: Set<string>, key: string): void {
  said.push(table.get(key), table.has(key), table.set(key, (table.get(key) ?? 0) + 1).size, seen.has(key), seen.add(key).size, table.get(key));
}
function byTextOrNothing(table: Map<string | undefined | null, number>, seen: Set<string | undefined | null>, key: string | undefined | null): void {
  said.push(table.get(key), table.has(key), table.set(key, (table.get(key) ?? 0) + 1).size, seen.has(key), seen.add(key).size, table.get(key));
}
function byObject(table: Map<object, number>, seen: Set<object>, key: object): void {
  said.push(table.get(key), table.has(key), table.set(key, (table.get(key) ?? 0) + 1).size, seen.has(key), seen.add(key).size, table.delete(key), seen.delete(key), table.has(key));
}
function byMarkOrFlag(table: Map<symbol | boolean | undefined, number>, key: symbol | boolean | undefined): void {
  said.push(table.get(key), table.set(key, (table.get(key) ?? 0) + 1).size, table.has(key), table.get(key));
}
function byNumber(table: Map<number, number>, seen: Set<number>, key: number): void {
  said.push(table.get(key), table.has(key), table.set(key, (table.get(key) ?? 0) + 1).size, seen.has(key), seen.add(key).size, table.get(key));
}
function byWhole(table: Map<bigint, number>, key: bigint): void { said.push(table.get(key), table.set(key, (table.get(key) ?? 0) + 1).size, table.has(key)); }
function byAnything(table: Map<unknown, number>, seen: Set<unknown>, key: unknown): void {
  said.push(table.get(key), table.has(key), table.set(key, (table.get(key) ?? 0) + 1).size, seen.has(key), seen.add(key).size, table.get(key));
}
for (let turn = 0; turn < 120; turn++) { said.length = 0;
  const texts = from(new Map<string, number>()); const seenTexts = from(new Set<string>());
  const part = "k" + (turn & 1);
  for (const key of ["", "a", "a", part + "," + part, part + "," + part, long, long + part, (long + part).slice(0, 41), "é", "中" + part, "中" + part, String(turn & 1), "0", "-0", "NaN", "undefined", "null", "__proto__", "constructor"]) byText(texts, seenTexts, key);
  const loose = from(new Map<string | undefined | null, number>()); const seenLoose = from(new Set<string | undefined | null>());
  for (const key of [undefined, null, "undefined", "null", undefined, null, "", part + part, part + part]) byTextOrNothing(loose, seenLoose, key);
  const objects = from(new Map<object, number>()); const seenObjects = from(new Set<object>());
  for (const key of [handle, { id: 1 }, handle, [], byText, objects, new String("a"), new String("a"), /a/]) byObject(objects, seenObjects, key);
  const marks = from(new Map<symbol | boolean | undefined, number>());
  for (const key of [mark, Symbol("mark"), mark, Symbol.for("mark"), Symbol.for("mark"), true, false, true, undefined, undefined, Symbol.iterator]) byMarkOrFlag(marks, key);
  const numbers = from(new Map<number, number>()); const seenNumbers = from(new Set<number>());
  for (const key of [0, -0, 1, 1.0, 1.5, 1.5, NaN, NaN, 0 / (turn - turn), Infinity, -Infinity, 2 ** 31, 2 ** 31, -(2 ** 31), 2 ** 32 + 0.5, 4294967296, 1e300, 5e-324, (turn & 1) + 0.5 - 0.5, 7 / 7]) byNumber(numbers, seenNumbers, key);
  const wholes = from(new Map<bigint, number>());
  for (const key of [0n, -0n, 1n, 1n, 2n ** 70n, 2n ** 70n, BigInt(turn & 1)]) byWhole(wholes, key);
  const all = from(new Map<unknown, number>()); const seenAll = from(new Set<unknown>());
  for (const key of ["a", part + part, part + part, 1, 1.0, "1", 1n, true, "true", null, "null", undefined, NaN, -0, 0, handle, mark, 1.5, 2 ** 40]) byAnything(all, seenAll, key);
  said.push(texts.size, seenTexts.size, loose.size, seenLoose.size, objects.size, seenObjects.size, marks.size, numbers.size, seenNumbers.size, wholes.size, all.size, seenAll.size, [...numbers.keys()].map(k => Object.is(k, -0) ? "-0" : String(k)).join("|"));
}
console.log(said.map(String).join(" "));
