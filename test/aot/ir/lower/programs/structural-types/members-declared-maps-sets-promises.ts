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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="capacity"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="null_"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="TypeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="thrown"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="TypeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|TypeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
