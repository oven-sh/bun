// RUN: lower
// OPTIONS: builtin-modules

// Every closure here is called by name on the usual path, so its entry for calls by value looks unused. Each is also reached by value some rarer way: in the untyped copy of a function whose argument did not fit, through call, apply, bind and Reflect.apply, as an accessor, by a protocol of the language, as a callback of a built-in, out of a table that is too large to test for.
const log: string[] = [];
const say = (...parts: unknown[]) => void log.push(parts.join(" "));

// The typed copy names `twice`. The argument that does not fit sends the call to the untyped copy, which has the closure as a value only.
interface Job { run: (n: number) => number; times: number }
function twice(n: number): number { return n * 2; }
function perform(job: Job, start: number): number {
  let result = start;
  for (let i = 0; i < job.times; i++) result = job.run(result);
  return result;
}
say("fits", perform({ run: twice, times: 3 }, 1));
try {
  say("does not fit", perform({ run: twice, times: "2" } as any, 5));
} catch (error) {
  say("does not fit", (error as Error).constructor.name);
}
try {
  say("start does not fit", (perform as any)({ run: twice, times: 2 }, "7"));
} catch (error) {
  say("start does not fit", (error as Error).constructor.name);
}

function add(this: { base: number } | void, a: number, b: number): number { return (this ? this.base : 0) + a + b; }
say("by name", add(1, 2));
say("call", add.call({ base: 10 }, 1, 2), "apply", add.apply({ base: 20 }, [1, 2]), "Reflect.apply", Reflect.apply(add, { base: 30 }, [1, 2]));
const bound = add.bind({ base: 40 }, 1);
say("bind", bound(2), bound.name, bound.length);

function readSize(this: { items: number[] }): number { return this.items.length; }
const bag = { items: [1, 2, 3] };
say("by name", readSize.call(bag));
Object.defineProperty(bag, "size", { get: readSize, configurable: true });
say("accessor", (bag as any).size, Object.getOwnPropertyDescriptor(bag, "size")!.get === readSize);

function describe(this: { id: number }): string { return "#" + this.id; }
function weigh(this: { id: number }): number { return this.id * 100; }
function* walk(this: { id: number }) { yield this.id; yield this.id + 1; }
function toJSON(this: { id: number }) { return { json: this.id }; }
const thing = { id: 7, toString: describe, valueOf: weigh, [Symbol.iterator]: walk, toJSON };
say("by name", describe.call(thing), weigh.call(thing), [...walk.call(thing)].join(), toJSON.call(thing).json);
say("protocols", `${thing}`, +thing, (thing as any) + 1, [...thing].join(), JSON.stringify(thing), String(thing));

function descending(a: number, b: number): number { return b - a; }
function shout(match: string): string { return match.toUpperCase(); }
function isOdd(n: number): boolean { return n % 2 === 1; }
say("by name", descending(1, 2), shout("a"), isOdd(3));
say("callbacks", [3, 1, 2].sort(descending).join(), "abcabc".replace(/b/g, shout), [1, 2, 3, 4, 5].filter(isOdd).join(), Array.from([1, 2, 3], isOdd).join(), new Map([[1, 2]]).forEach(descending));

function settle(this: void, resolve: (value: number) => void) { resolve(42); }
function later(value: number) { say("then", value); return value + 1; }
settle(value => say("by name", value));
later(0);
say("awaited", await new Promise(settle).then(later), await { then: settle });
await new Promise<void>(done => queueMicrotask(function tick() { say("microtask"); done(); }));

const table: ((n: number) => number)[] = [
  n => n + 1, n => n + 2, n => n + 3, n => n + 4, n => n + 5, n => n + 6, n => n + 7, n => n + 8, n => n + 9, n => n + 10,
  n => n + 11, n => n + 12, n => n + 13, n => n + 14, n => n + 15, n => n + 16, n => n + 17, n => n + 18, n => n + 19, n => n + 20,
];
let total = table[0](0) + table[19](0);
for (let i = 0; i < table.length * 3; i++) total += table[(i * 7) % table.length](i);
say("table", total);

function tag(strings: TemplateStringsArray, ...values: number[]): string { return strings.raw.join("|") + values.join(); }
say("tag", tag`a${1}b${2}c`, tag(Object.assign(["x"], { raw: ["x"] }) as any));

function chosen(flag: boolean) { return flag ? twice : isOdd; }
say("chosen", chosen(true)(4), chosen(false)(4), chosen(log.length > 3) === twice, [twice, isOdd].indexOf(chosen(false) as any));
console.log(log.join("\n"));

// GENERATED: isOdd walk toJSON descending shout say
// CHECK-LABEL: function {{*}}name="isOdd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=boolean site=[[w_2]]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mod v0, v1
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_2]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="walk"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = PropGet v0 key="id"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = PropGet v0 key="id"
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v12 = Yield v11
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b7():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toJSON"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] thisType={type=undefined|null|[[L_4]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} results=[{type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="id"
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="descending"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_11]]}, {type=number site=[[w_12]]}] results=[{type=number site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Sub v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shout"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="toUpperCase"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="toUpperCase" calleeName="match.toUpperCase"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array site=[[w_19]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined site=[[w_20]]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = PropGet v0 key="join"
// CHECK-NEXT: v5 = String string=" "
// CHECK-NEXT: v6 = Call v4, v0, v5 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Call v3, v2, v7 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_24]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined site=[[w_20]]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
