// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: checksum passes copyOf Registry
// CHECK-LABEL: function {{*}}name="checksum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Less v6, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Builtin builtin=Math
// CHECK-NEXT: v13 = Builtin builtin=MathImul
// CHECK-NEXT: v14 = Integer integer=31
// CHECK-NEXT: v15 = Call v13, v12, v5, v14 calleeName="Math.imul"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = PropGet v0 key="charCodeAt"
// CHECK-NEXT: v18 = Call v17, v0, v11 calleeKey="charCodeAt" calleeName="text.charCodeAt"
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = Add v16, v19
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = BitOr v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v24 = Increment v11
// CHECK-NEXT: v25 = Convert v24 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v23, v25)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v27 = Convert v5 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="passes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_10]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = Boolean
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean site=[[w_10]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="copyOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map|Set site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Map|Set site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|Map|Set):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Map
// CHECK-NEXT: v2 = InstanceOf v0, v1 writtenExpression="table instanceof Map"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Builtin builtin=Map
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|Map} illTypedCause=Assertion
// CHECK-NEXT: v7 = Construct v5, -, v6 calleeName="Map"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Map site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = Builtin builtin=Set
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|Set} illTypedCause=Assertion
// CHECK-NEXT: v12 = Construct v10, -, v11 calleeName="Set"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Set site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Map|Set site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Registry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_17]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_18]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
