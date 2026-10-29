// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// A `declare` field is left out of the layout of its class where the name of a method is computed and could be the field's own. A key read through `import * as` from a module that exports it as a const with a constant value is known, so the field keeps its place. A key that is reassigned, or is read from a TypeScript namespace, is not known.
import * as Keys from "./keys.ts";
import { inspectKey } from "./keys.ts";
declare const console: { log(...values: unknown[]): void };
abstract class Base {
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  abstract [Keys.equalKey](that: unknown): boolean;
  abstract [Keys.hashKey](): number;
  [inspectKey](): string { return `<${this.tag}>`; }
}
class Keyed extends Base {
  declare readonly payload: number;
  constructor(payload: number) {
    super("keyed");
    this.payload = payload;
  }
  [Keys.equalKey](that: unknown): boolean { return that instanceof Keyed && that.payload === this.payload; }
  [Keys.hashKey](): number { return this.payload * 31; }
}
class Group {
  declare readonly reasons: readonly Keyed[];
  constructor(reasons: readonly Keyed[]) {
    this.reasons = reasons;
  }
  [Keys.equalKey](that: unknown): boolean {
    return that instanceof Group && that.reasons.length === this.reasons.length && that.reasons.every((reason, i) => reason[Keys.equalKey](this.reasons[i]));
  }
  [Keys.hashKey](): number { return this.reasons.reduce((sum, reason) => sum + reason[Keys.hashKey](), 0); }
}
Keys.change("hidden");
class Unknown {
  declare hidden: unknown;
  [Keys.changing](): string { return "the method"; }
}
Keys.change("another");
namespace Local {
  export const key = "localKey";
}
class ByNamespace {
  declare viaNamespace: number;
  constructor(value: number) {
    this.viaNamespace = value;
  }
  [Local.key](): string { return "named by a namespace"; }
}
function show(value: any): string {
  return `${Object.getPrototypeOf(value).constructor.name} {${Reflect.ownKeys(value).map((key) => `${String(key)}=${JSON.stringify(value[key])}`).join()}}`;
}

const one = new Keyed(1);
const same = new Keyed(1);
const other = new Keyed(2);
console.log(show(one), one.payload, one[Keys.equalKey](same), one[Keys.equalKey](other), one[Keys.hashKey](), one[inspectKey](), "payload" in one, Object.keys(one).join());
console.log((one as any)["~kernel/Equal"](same), Object.getOwnPropertyNames(Keyed.prototype).join(), JSON.stringify(one));
const group = new Group([one, other]);
console.log(show(group), group[Keys.equalKey](new Group([same, new Keyed(2)])), group[Keys.equalKey](new Group([same])), group[Keys.hashKey](), group.reasons.length);

const unknown = new Unknown();
console.log(typeof unknown.hidden, (unknown.hidden as () => string)(), Object.keys(unknown).join(), "hidden" in unknown, Object.getOwnPropertyNames(Unknown.prototype).join());
unknown.hidden = 5;
console.log(unknown.hidden, Object.keys(unknown).join(), typeof Unknown.prototype.hidden);

const named = new ByNamespace(9);
console.log(show(named), named.viaNamespace, named[Local.key]());

let total = 0;
const kept: Keyed[] = [];
for (let i = 0; i < 500; i++) kept.push(new Keyed(i));
for (let i = 0; i < kept.length; i++) total += kept[i]!.payload + (kept[i]![Keys.equalKey](kept[(i * 7) % 500]) ? 1 : 0);
console.log(total);

// FILE: keys.ts
export const equalKey = "~kernel/Equal";
export const hashKey = "~kernel/Hash";
export const inspectKey = Symbol.for("nodejs.util.inspect.custom");
export let changing = "first";
export function change(to: string): void {
  changing = to;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show Keyed Unknown
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v4 = PropGet v3 key="constructor"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: v7 = ToString v6
// CHECK-NEXT: v8 = String string=" {"
// CHECK-NEXT: v9 = Builtin builtin=Reflect
// CHECK-NEXT: v10 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = PropGet v13 key="map"
// CHECK-NEXT: v15 = NewClosure v11 function=[[f_4]]
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="map" calleeName="map"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = Call v18, v17 calleeKey="join" calleeName="join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = ToString v20
// CHECK-NEXT: v22 = String string="}"
// CHECK-NEXT: v23 = Strcat v7, v8, v21, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keyed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_5]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = String string="keyed"
// CHECK-NEXT: v6 = SuperConstruct v4, v1, v5 layout=[[L_7]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v2 declared={type=number site=[[w_8]]}
// CHECK-NEXT: PropSet v13, v14 key="payload"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b10(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: v22 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: b11(v27) frequency=Unlikely:
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="Keyed"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b12(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Unknown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
