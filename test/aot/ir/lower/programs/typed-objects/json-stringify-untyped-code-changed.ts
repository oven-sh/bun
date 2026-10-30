// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Untyped code changes objects that have a layout (adds, deletes, hides, freezes, gives them toJSON, other prototypes, cycles),
// and code that does not know their type writes them as JSON. Every change succeeds as in plain Bun, and what is written must be exact.
// ENV JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
const slowPaths = () => (typeof aotRuntimeCounters === "function" ? Number(/(\d+)\tcounter:JSONStringifySlowPaths/.exec(aotRuntimeCounters())?.[1] ?? 0) : 0);
import { deeds } from "./deeds.js";
declare const aotOperationCount: undefined | ((name: string) => number);
const count = (name: string) => (typeof aotOperationCount === "function" ? aotOperationCount(name) : 0);
const writers: Record<string, (value: unknown) => string> = {
  write: (value) => { try { return JSON.stringify(value) as string; } catch (error) { return (error as Error).constructor.name; } },
};
let coverage = "";
function write(value: unknown): string {
  // W : nothing was left to the engine's own writer and nothing handed to the run time.
  const entered = count("operationAOTJSONAppendValue") + count("operationAOTStringBuilderAppendJSON"), left = slowPaths();
  const text = writers["write"]!(value);
  coverage += slowPaths() > left ? "-" : count("operationAOTJSONAppendValue") + count("operationAOTStringBuilderAppendJSON") > entered ? "f" : "W";
  return text;
}
interface Row { id: number; text: string; on: boolean; ratio: number; next: Row | null; list: number[]; maybe?: string }
interface Holds { value: unknown }
class Point { x: number; text: string; id: number; constructor(x: number) { this.x = x; this.text = "p" + x; this.id = x; } }
function row(id: number): Row { return { id, text: "t" + id, on: id % 2 === 0, ratio: id / 8, next: null, list: [id, id + 1] }; }
function holds(value: unknown): Holds { return { value }; }
interface Open { id: unknown; text: unknown; on: unknown; ratio: unknown; next: unknown; list: unknown }
function open(id: number): Open { return { id, text: "t" + id, on: true, ratio: id / 8, next: null, list: [id] }; }
function attempt(label: string, make: () => unknown): void {
  let value: unknown;
  try { value = make(); } catch (error) { coverage += "x"; console.log(label, "the deed is refused:", (error as Error).constructor.name); return; }
  console.log(label, write(value));
}
let turn = 0;
for (const [name, deed] of Object.entries(deeds as Record<string, (o: unknown) => unknown>)) {
  const id = ++turn * 10;
  attempt(name, () => deed(row(id)));
  attempt(name + " in a list", () => [row(id + 1), deed(row(id + 2)), row(id + 3)]);
  attempt(name + " held", () => holds(deed(row(id + 4))));
  attempt(name + " held in a list", () => holds([deed(row(id + 5))]));
  attempt(name + " of a class", () => deed(new Point(id + 6)));
  attempt(name + " in an open field", () => deed(open(id + 7)));
  attempt(name + " afterwards", () => row(id + 8));
}
if (typeof aotOperationCount === "function") {
  const written = coverage.split("W").length - 1;
  if (written < 100) throw new Error("only " + written + " values were written without the engine's own writer: " + coverage);
}

// FILE: deeds.js
export const deeds = {
  nothing: (o) => o,
  addProperty: (o) => { o.added = "later"; return o; },
  addNumberedProperty: (o) => { o[3] = "indexed"; return o; },
  addSymbol: (o) => { o[Symbol("s")] = 1; return o; },
  removeFirst: (o) => { delete o.id; return o; },
  removeMiddle: (o) => { delete o.text; return o; },
  removeAndAddAgain: (o) => { delete o.text; o.text = "after the others"; return o; },
  getter: (o) => Object.defineProperty(o, "text", { get() { return "from a getter"; }, enumerable: true, configurable: true }),
  getterWithEffect: (o) => Object.defineProperty(o, "text", { get() { o.id = -1; return "changes id"; }, enumerable: true, configurable: true }),
  getterFirstChangesLater: (o) => Object.defineProperty(o, "id", { get() { o.text = "changed by the getter of id"; return 0; }, enumerable: true, configurable: true }),
  extraGetter: (o) => Object.defineProperty(o, "extra", { get() { return "from a getter"; }, enumerable: true, configurable: true }),
  extraGetterWithEffect: (o) => Object.defineProperty(o, "extra", { get() { o.text = "changed while it was written"; return 1; }, enumerable: true, configurable: true }),
  extraGetterThatThrows: (o) => Object.defineProperty(o, "extra", { get() { throw new RangeError("thrown by a getter"); }, enumerable: true, configurable: true }),
  extraHidden: (o) => Object.defineProperty(o, "extra", { value: 1, enumerable: false }),
  hide: (o) => Object.defineProperty(o, "text", { enumerable: false }),
  readOnly: (o) => Object.defineProperty(o, "text", { writable: false }),
  ownToJSON: (o) => { o.toJSON = function () { return { replaced: this.id }; }; return o; },
  hiddenToJSON: (o) => Object.defineProperty(o, "toJSON", { value() { return "hidden toJSON"; }, enumerable: false }),
  toJSONThatIsNoFunction: (o) => { o.toJSON = 5; return o; },
  prototypeWithToJSON: (o) => Object.setPrototypeOf(o, { toJSON() { return "by the prototype"; } }),
  prototypeTwoUp: (o) => Object.setPrototypeOf(o, Object.create({ toJSON() { return "two steps up"; } })),
  prototypeWithoutToJSON: (o) => Object.setPrototypeOf(o, { other: 1 }),
  nullPrototype: (o) => Object.setPrototypeOf(o, null),
  proxyPrototype: (o) => Object.setPrototypeOf(o, new Proxy({}, { get(target, key) { return key === "toJSON" ? () => "through a proxy" : undefined; } })),
  freeze: (o) => Object.freeze(o),
  seal: (o) => Object.seal(o),
  preventExtensions: (o) => Object.preventExtensions(o),
  otherKinds: (o) => { o.id = "a text"; o.text = 7; o.on = null; o.ratio = { object: 1 }; return o; },
  undefinedEverywhere: (o) => { o.id = undefined; o.text = undefined; o.on = undefined; return o; },
  functionsAndSymbols: (o) => { o.id = () => 1; o.text = Symbol("t"); return o; },
  bigint: (o) => { o.id = 10n; return o; },
  itself: (o) => { o.next = o; return o; },
  itselfInAList: (o) => { o.list = [o]; return o; },
  wideText: (o) => { o.text = "wide 日本語 😀"; return o; },
  loneSurrogate: (o) => { o.text = "lone \ud800"; return o; },
  escapes: (o) => { o.text = "q \" b \\ n \n u \u0001"; return o; },
  rope: (o) => { let t = "r"; for (let i = 0; i < 9; i++) t = t + "o" + i; o.text = t; return o; },
  boxed: (o) => { o.id = new Number(5); o.text = new String("boxed"); o.on = new Boolean(false); return o; },
  date: (o) => { o.next = new Date(0); return o; },
  listWithHole: (o) => { o.list = [1, , 3]; return o; },
  listWithToJSON: (o) => { o.list = [1]; o.list.toJSON = () => "list toJSON"; return o; },
  listOfPlain: (o) => { o.list = [{ p: 1 }, { p: 2 }]; return o; },
  plainInside: (o) => { o.next = { plain: true, deep: { a: [1, { b: 2 }] } }; return o; },
  plainWithToJSONInside: (o) => { o.next = { toJSON() { return "inner toJSON"; } }; return o; },
  numbers: (o) => { o.id = -0; o.ratio = NaN; return o; },
  moreNumbers: (o) => { o.id = 2147483648.5; o.ratio = -Infinity; return o; },
  edgeNumbers: (o) => { o.id = -2147483648; o.ratio = 5e-324; return o; },
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: open Point slowPaths
// CHECK-LABEL: function {{*}}name="open"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="t"
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Integer integer=8
// CHECK-NEXT: v5 = Div v0, v4
// CHECK-NEXT: v6 = Null
// CHECK-NEXT: v7 = NewArray v0 contents=anything
// CHECK-NEXT: v8 = NewObject -, v0, v2, v3, v5, v6, v7 layout=[[L_2]] fields=[0, 5, 3, 4, 2, 1]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_4]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_6]]
// CHECK-NEXT: v6 = Convert v1 declared={type=number site=[[w_7]]}
// CHECK-NEXT: PropSet v4, v6 key="x"
// CHECK-NEXT: v8 = String string="p"
// CHECK-NEXT: v9 = Add v8, v1
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v10 key="text"
// CHECK-NEXT: v12 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: PropSet v4, v12 key="id"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = TypeTest v14 testedType=object
// CHECK-NEXT: Branch v15 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="slowPaths"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="aotRuntimeCounters" [isFreeName, isForTypeOf]
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Builtin builtin=Number
// CHECK-NEXT: v5 = NewRegExp pattern="(\\d+)\\tcounter:JSONStringifySlowPaths"
// CHECK-NEXT: v6 = PropGet v5 key="exec"
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="aotRuntimeCounters" [isFreeName]
// CHECK-NEXT: v9 = Call v8 calleeName="aotRuntimeCounters"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = Call v6, v5, v10 calleeKey="exec" calleeName="exec"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined|null
// CHECK-NEXT: Branch v13 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b7(v15)
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = ElemGet v16, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b7(v19)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined|null
// CHECK-NEXT: Branch v21 -> taken b8(| 0), notTaken b10(| 0)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v23 = Integer
// CHECK-NEXT: Jump -> next b11(v23)
// CHECK-NEXT: b10(v24):
// CHECK-NEXT: Jump -> next b11(v24)
// CHECK-NEXT: b11(v25):
// CHECK-NEXT: v26 = Call v4, -, v25 calleeName="Number"
// CHECK-NEXT: ReturnCall v26 casts=[{declared={type=number site=[[w_14]]}}, {declared={type=number site=[[w_10]]}}]
// CHECK-NEXT: b12(v27):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v28 = Integer
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
