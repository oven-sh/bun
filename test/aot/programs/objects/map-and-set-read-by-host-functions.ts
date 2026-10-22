// Bun's native functions read a Map or a Set of a compiled program like any other: `structuredClone`, a message port, the serializers of node:v8 and bun:jsc, `Bun.deepEquals`, `util.isDeepStrictEqual`, `assert.deepStrictEqual`, `Bun.inspect`, `util.inspect` and `console.log`, for tables of every size, after deletions and after `clear`.
import assert from "node:assert";
import util from "node:util";
import v8 from "node:v8";
import { deserialize, serialize } from "bun:jsc";

const objects = Array.from({ length: 700 }, (_, index) => ({ id: index }));

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + shorten(value.map(show)) + "]";
  if (value instanceof Map) return "Map{" + shorten(Array.from(value, ([key, item]) => show(key) + "=>" + show(item))) + "}";
  if (value instanceof Set) return "Set{" + shorten(Array.from(value, show)) + "}";
  if (typeof value === "object" && value !== null) return "#" + (value as { id: number }).id;
  return String(value);
}
function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
}
function shorten(parts: string[]): string {
  if (parts.length <= 6) return parts.join(",");
  return parts.slice(0, 2).join(",") + ",..(" + parts.length + " in all, checksum " + checksum(parts.join()) + ")..," + parts.slice(-2).join(",");
}
function outcome(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
}
const passes = (run: () => void): boolean => {
  try {
    run();
    return true;
  } catch {
    return false;
  }
};
const inspected = (text: string): string => (text.length <= 160 ? text.replaceAll("\n", " ") : text.length + " characters, checksum " + checksum(text));

type Table = Map<unknown, unknown> | Set<unknown>;
type KeyAt = (index: number) => unknown;
const put = (table: Table, key: unknown, value: unknown): void => void (table instanceof Map ? table.set(key, value) : table.add(key));
const copyOf = (table: Table): Table => (table instanceof Map ? new Map(table) : new Set(table));

function read(label: string, table: Table, absentKey: unknown): void {
  const say = (what: string, ...values: string[]) => console.log(label + " " + what + ": " + values.join(" "));
  say("clones", outcome(() => structuredClone(table)), outcome(() => v8.deserialize(v8.serialize(table))), outcome(() => deserialize(serialize(table))), outcome(() => structuredClone({ id: 1, table }).table), outcome(() => structuredClone([table, table]).map((clone, _, all) => clone === all[0])));

  const same = copyOf(table);
  const larger = copyOf(table);
  put(larger, absentKey, "more");
  const reordered = copyOf(table);
  const firstKey = table.keys().next();
  if (!firstKey.done) {
    const firstValue = table instanceof Map ? table.get(firstKey.value) : firstKey.value;
    reordered.delete(firstKey.value);
    put(reordered, firstKey.value, firstValue);
  }
  for (const [name, other] of [["a copy", same], ["a larger one", larger], ["a reordered one", reordered], ["a clone", structuredClone(table)]] as [string, Table][]) {
    say("equal to " + name, String(Bun.deepEquals(table, other)), String(Bun.deepEquals(other, table, true)), String(util.isDeepStrictEqual(table, other)), String(passes(() => assert.deepStrictEqual(table, other))), String(passes(() => assert.deepEqual(other, table))));
  }
  say("inspected", inspected(Bun.inspect(table)), "|", inspected(util.inspect(table)), "|", inspected(util.inspect(table, { maxArrayLength: 3, breakLength: Infinity })), "|", inspected(util.format("%o", table.keys())), "|", inspected(Bun.inspect(table.entries())));
}

const kinds: [string, KeyAt][] = [
  ["strings", index => "k" + index],
  ["integers", index => index],
  ["doubles", index => index + 0.5],
  ["objects", index => objects[index]],
  ["bigints", index => BigInt(index) << 70n],
  ["mixed", index => (index === 0 ? undefined : index === 1 ? null : ["k" + index, index, index + 0.5, objects[index], BigInt(index), index % 4 === 0][index % 6])],
];
for (const [kind, keyAt] of kinds) {
  for (const count of kind === "strings" ? [0, 1, 4, 5, 8, 9, 254, 255, 300] : [5, 9, 255]) {
    for (const isMap of [true, false]) {
      const label = (isMap ? "map" : "set") + " of " + count + " " + kind;
      const table: Table = isMap ? new Map() : new Set();
      for (let index = 0; index < count; index++) put(table, keyAt(index), index % 3 === 0 ? index / 2 : keyAt(count - 1 - index));
      read(label, table, keyAt(600));
      if (count < 5) continue;
      for (let index = 0; index < count; index += 2) table.delete(keyAt(index));
      read(label + ", every second deleted", table, keyAt(600));
      table.clear();
      read(label + ", cleared", table, keyAt(600));
      put(table, keyAt(1), "after clear");
      read(label + ", cleared and given one entry", table, keyAt(600));
    }
  }
}

const shared = { id: 7 };
const nested = new Map<unknown, unknown>([["set", new Set([shared, new Map([[shared, shared]])])], [shared, new Set([new Set([1])])]]);
nested.set("itself", nested);
const clone = structuredClone(nested) as Map<unknown, unknown>;
const clonedKeys = [...clone.keys()];
const clonedSet = [...(clone.get("set") as Set<unknown>)];
const clonedInner = [...(clonedSet[1] as Map<unknown, unknown>)][0];
console.log("nested:", clone !== nested, clone.get("itself") === clone, clonedKeys[1] !== shared, clonedKeys[1] === clonedSet[0], clonedInner[0] === clonedSet[0], clonedInner[1] === clonedSet[0], show(clone.get(clonedKeys[1])));
console.log("not cloneable:", outcome(() => structuredClone(new Set([Symbol("s")]))), outcome(() => structuredClone(new Map([["f", () => 1]]))), outcome(() => structuredClone(new Map([[() => 1, "f"]]))));

class Registry extends Map<string, number> {
  label = "registry";
}
const registry = structuredClone(new Registry([["a", 1]]));
console.log("a subclass:", registry instanceof Registry, registry instanceof Map, show(registry), "label" in registry);
const withProperties = Object.assign(new Set(["a"]), { extra: "property" });
console.log("own properties:", "extra" in structuredClone(withProperties), inspected(Bun.inspect(withProperties)), Bun.deepEquals(withProperties, new Set(["a"])), Bun.deepEquals(withProperties, new Set(["a"]), true));

console.log(new Map<unknown, unknown>([["a", 1], [2, "b"], [shared, new Set([1, "two"])]]), new Set<unknown>(["a", 2, shared, new Map([["k", "v"]])]), new Map(), new Set());
console.log(new Map([["a", 1]]).keys(), new Map([["a", 1]]).values(), new Map([["a", 1]]).entries(), new Set(["a"]).values(), new Set(["a"]).entries());
console.log(JSON.stringify([new Map([["a", 1]]), new Set([1])]), JSON.stringify([...new Map([["a", 1]])]), String(new Map()), String(new Set()));

const { port1, port2 } = new MessageChannel();
const received = new Promise<unknown>(resolve => {
  port2.onmessage = event => resolve(event.data);
});
const sent = new Map<unknown, unknown>();
for (let index = 0; index < 300; index++) sent.set("k" + index, new Set([index, "v" + index]));
for (let index = 0; index < 300; index += 3) sent.delete("k" + index);
port1.postMessage(sent);
console.log("through a message port:", show(await received), Bun.deepEquals(await received, sent, true));
port1.close();
port2.close();
