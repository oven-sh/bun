// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// `open: false` in a literal without `as const` keeps the type `false` where the literal is checked against a type that names literal types. That type is inferred, not annotated, so untyped code may store `true`.
import { open, store } from "./untyped.js";

type State = { open: boolean; items: string[] };
function describe(s: State): string {
  return (s.open ? "open" : "closed") + " " + s.items.length;
}

function create<T extends State>(init: T): T {
  return init;
}
const created = create({ open: false, items: [] });
console.log("a bound that names it:", open(created), created.open, describe(created));

function keep<T extends { [name: string]: U | object }, U extends boolean | string | number>(init: T): T {
  return init;
}
const kept = keep({ open: false, mode: "a", count: 0, items: [] as string[] });
console.log("an index signature of primitives:", open(kept), store(kept, "mode", "b"), store(kept, "count", 2), kept.open, kept.mode, kept.count);

const INITIAL = Object.freeze({ open: false, items: [] as string[] });
function fresh() {
  return { ...INITIAL };
}
const copy = fresh();
console.log("a copy of a frozen literal:", open(copy), copy.open, describe(copy), INITIAL.open);

const again = { ...fresh(), items: ["x"] };
console.log("a copy of the copy:", open(again), again.open, describe(again));

function holder<T extends { open: boolean | null }>(init: T): { current: T } {
  return { current: init };
}
const held = holder({ open: null });
console.log("null alone:", open(held.current), held.current.open);

const list = [create({ open: false, items: [] }), create({ open: false, items: ["y"] })];
for (const each of list) console.log("in an array:", open(each), each.open ? "open" : "closed", describe(each));

const read = create({ open: false, items: [] });
open(read);
const { open: taken } = read;
const chosen = read.open || "closed";
console.log("read by typed code:", taken, chosen, `${read.open}`, [read.open].join(), read.open === false, read.open ?? "none");

// FILE: untyped.js
export function store(object, name, value) {
  object[name] = value;
  return object[name];
}
export function open(object) {
  object.open = true;
  return object.open;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: describe fresh holder
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="open"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="open"
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = String string="closed"
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b6(v7):
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = PropGet v0 key="items"
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="INITIAL"
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v2, v1
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] site=[[w_8]]}] results=[{type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_11]]|[[L_7]]}
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
