// RUN: lower
// OPTIONS: builtin-modules

// Members declared on maps sets promises dates and errors are never written.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface Map<K, V> {
    firstKey(): K;
    capacity: number;
  }
  interface Set<T> {
    pick(): T;
    capacity: number;
  }
  interface Promise<T> {
    label: string;
    settled: boolean;
  }
  interface Date {
    quarter: number;
    tomorrow(): Date;
  }
  interface Error {
    status: number;
    retry(): boolean;
  }
  interface RegExp {
    hits: number;
  }
  interface Uint8Array {
    checksum: number;
    hex(): string;
  }
  interface Boolean {
    flipped: boolean;
  }
  interface Symbol {
    rank: number;
  }
  interface BigInt {
    digits: number;
  }
}

function statusOf(error: Error): number {
  return error.status;
}

function capacityOf(map: Map<string, number>): number {
  return map.capacity;
}

const map = new Map([["k", 1]]);
show("a map: the number", () => [map.capacity, capacityOf(map), capacityOf(map) + 1, map.size]);
show("a map: the method", () => map.firstKey());
show("a set: the number", () => [new Set([1]).capacity, new Set([1]).size]);
show("a set: the method", () => new Set([1]).pick());
show("a promise", () => [Promise.resolve(1).label, Promise.resolve(1).settled, Promise.resolve(1).settled === false]);
show("a date: the number", () => [new Date(0).quarter, new Date(0).quarter + 1, new Date(0).getTime()]);
show("a date: the method", () => new Date(0).tomorrow());
show("an error: the number", () => [new Error("e").status, statusOf(new RangeError("r")), statusOf(new Error("e")) + 1]);
show("an error: the method", () => new Error("e").retry());
show("an error that was caught", () => {
  try {
    null_();
    return "no error";
  } catch (error) {
    return error instanceof Error ? [error.status, typeof error.message] : "not an error";
  }
});
show("a regular expression", () => [/a/.hits, /a/.hits + 1, /a/.lastIndex]);
show("bytes: the number", () => [new Uint8Array(2).checksum, new Uint8Array(2).checksum + 1, new Uint8Array(2).length]);
show("bytes: the method", () => new Uint8Array(2).hex());
show("a boolean", () => [true.flipped, true.flipped === false, !true.flipped]);
show("a symbol", () => [Symbol.iterator.rank, Symbol.iterator.rank + 1]);
show("a bigint", () => [5n.digits, 5n.digits + 1]);

function null_(): void {
  throw new TypeError("thrown");
}

const failed = new Error("stored");
failed.status = 404;
let sum = 0;
for (let i = 0; i < 2000; i++) sum += statusOf(failed);
show("2000 reads of an error that has it", () => sum);
show("one that has not", () => [statusOf(new Error("e")), Object.keys(failed), Object.keys(new Error("e"))]);

export {};

// GENERATED: capacityOf null_ show
// CHECK-LABEL: function {{*}}name="capacityOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: v1 = PropGet v0 key="capacity"
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="null_"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="TypeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="thrown"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="TypeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|TypeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=": threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
