function show(object: object): string {
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(object)) {
    const found = Object.getOwnPropertyDescriptor(object, key)!;
    const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
    parts.push(`${String(key)}=${"value" in found ? String(found.value) : "accessor"}:${flags}`);
  }
  const prototype = Object.getPrototypeOf(object);
  return `{${parts.join(",")}} ${prototype === Object.prototype ? "plain" : prototype === null ? "null" : "other"}`;
}
const lines: string[] = [];
function extended(all: Record<string, number>, key: string, value: number): Record<string, number> {
  return { ...all, [key]: value };
}
function named(all: Record<string, number>, value: number): Record<string, number> {
  return { ...all, fixed: value, other: value + 1 };
}
function twice(first: Record<string, number>, second: Record<string, number>): Record<string, number> {
  return { ...first, ...second };
}
function maybe(all: Record<string, number> | undefined | null, key: string): Record<string, number> {
  return { ...all, [key]: 1 };
}
function behind(all: Record<string, number>, key: string): Record<string, number> {
  return { [key]: 0, ...all };
}
let grown: Record<string, number> = {};
for (let k = 0; k < 12; k++) grown = extended(grown, "k" + (k % 9), k);
lines.push(show(grown) + " " + show(named(grown, 5)) + " " + show(twice(grown, { k1: -1, z: 9 })));
lines.push(show(maybe(undefined, "a")) + " " + show(maybe(null, "b")) + " " + show(maybe({ c: 3 }, "c")) + " " + show(behind({ a: 1, b: 2 }, "b")));
const bare: Record<string, number> = Object.create(null);
bare.x = 1;
bare.__proto__ = 2;
lines.push(show(bare) + " > " + show(extended(bare, "y", 3)));
const indexed: Record<string, number> = { b: 1, 2: 2, a: 3, 1: 4, [-1]: 5, "01": 6 };
lines.push(show(extended(indexed, "0", 7)) + " " + Object.keys(extended(indexed, "c", 8)).join("|"));
const marked: Record<string | symbol, number> = { plain: 1, [Symbol.for("mark")]: 2 };
lines.push(show({ ...marked, more: 3 } as Record<string | symbol, number>));
const reads: string[] = [];
const watched: Record<string, number> = {};
Object.defineProperty(watched, "got", { enumerable: true, configurable: true, get: () => (reads.push("got"), 7) });
Object.defineProperty(watched, "hidden", { enumerable: false, value: 8 });
Object.defineProperty(watched, "fixed", { enumerable: true, writable: false, configurable: false, value: 9 });
lines.push(show(extended(watched, "fixed", 10)) + " " + reads.join("") + " " + show(watched));
const frozen: Record<string, number> = Object.freeze({ a: 1, b: 2 });
const thawed = extended(frozen, "a", 5);
thawed.b = 6;
delete thawed.a;
lines.push(show(thawed) + " " + Object.isFrozen(thawed) + " " + Object.isExtensible(thawed) + " " + show(frozen));
class Counts {
  [key: string]: number;
}
const instance = new Counts();
instance.one = 1;
lines.push(show(extended(instance, "two", 2)) + " " + (extended(instance, "two", 2) instanceof Counts));
const source: Record<string, number> = { a: 1 };
const copy = extended(source, "b", 2);
source.a = 100;
copy.a! += 1;
lines.push(show(source) + " " + show(copy));
const entries = [["a", 1], ["b", 2], ["c", 3], ["a", 4]] as [string, number][];
let total = 0;
for (let turn = 0; turn < 300; turn++) {
  const object = entries.reduce<Record<string, number>>((all, [key, value]) => ({ ...all, [key]: value + turn }), {});
  total += object.a! + object.c! + Object.keys(object).length;
}
lines.push("total " + total);
console.log(lines.join("\n"));
