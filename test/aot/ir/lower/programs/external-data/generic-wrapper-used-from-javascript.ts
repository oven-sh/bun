// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A generic class whose generic methods mention the class applied to their own type parameter, used from an untyped file: the class keeps its layout, and still accepts what untyped code hands it.
import { idOf, make } from "./model.ts";
import { run } from "./use.js";
declare const console: { log(...values: unknown[]): void };
console.log(run().join(" "));
const typed = make(20);
typed.put({ id: 21 });
typed.put(make(22));
console.log(idOf(typed), typed.same(typed.value));

// FILE: model.ts
export type Row = { id: number };
export type Held<T extends object> = Wrapper<T> | (Wrapper<T> & { readonly tag: T });
export class Wrapper<T extends object> {
  constructor(public value: T) {}
  put<Inner extends T>(next: Inner | Held<Inner>): void { this.value = next instanceof Wrapper ? next.value : next; }
  putTwice<Inner extends T>(first: Inner | Held<Inner>, second: Inner | Held<Inner>): void { this.put(first); this.put(second); }
  take<Inner extends T>(from: Held<Inner>): Inner { const taken = from.value; this.value = taken; return taken; }
  wrap<Inner extends T>(next: Inner): Wrapper<Inner> { return new Wrapper<Inner>(next); }
  pick<Inner extends T>(first: Held<Inner>, second: Held<Inner>, useFirst: boolean): Held<Inner> { return useFirst ? first : second; }
  same<Inner extends T>(other: Inner | Held<Inner>): boolean { return (other instanceof Wrapper ? other.value : other) === this.value; }
}
export function make(id: number): Wrapper<Row> { return new Wrapper<Row>({ id }); }
export function idOf(wrapper: Wrapper<Row>): number { return wrapper.value.id; }

// FILE: use.js
import { Wrapper, idOf, make } from "./model.ts";
export function run() {
  const lines = [];
  const wrapper = make(1);
  lines.push(idOf(wrapper));
  wrapper.put({ id: 2, extra: "two" });
  lines.push(idOf(wrapper), wrapper.value.extra);
  wrapper.put(new Wrapper({ id: 3 }));
  lines.push(idOf(wrapper));
  wrapper.putTwice({ id: 4 }, make(5));
  lines.push(idOf(wrapper));
  lines.push(wrapper.take(make(6)).id, idOf(wrapper));
  const inner = wrapper.wrap({ id: 7, more: [1, 2] });
  lines.push(inner.value.id, inner.value.more.length, inner instanceof Wrapper);
  lines.push(idOf(wrapper.pick(make(8), make(9), false)));
  const tagged = Object.assign(make(10), { tag: { id: 11 } });
  lines.push(idOf(wrapper.pick(tagged, make(12), true)), tagged.tag.id);
  lines.push(wrapper.same(wrapper), wrapper.same(wrapper.value), wrapper.same({ id: 6 }));
  return lines;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="run"
// CHECK-NEXT: v7 = Call v6 calleeName="run"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Call v4, v2, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="make"
// CHECK-NEXT: v16 = Integer integer=20
// CHECK-NEXT: v17 = Call v15, -, v16 calleeName="make"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = PropGet v18 key="put"
// CHECK-NEXT: v20 = Data data=[[d_6]]
// CHECK-NEXT: v21 = Call v19, v18, v20 calleeKey="put" calleeName="typed.put"
// CHECK-NEXT: v22 = PropGet v18 key="put"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="make"
// CHECK-NEXT: v25 = Integer integer=22
// CHECK-NEXT: v26 = Call v24, -, v25 calleeName="make"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_4]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v28 = Call v22, v18, v27 calleeKey="put" calleeName="typed.put"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v35 = CheckInitialized v34 name="idOf"
// CHECK-NEXT: v36 = Call v35, -, v18 calleeName="idOf"
// CHECK-NEXT: v37 = Convert v36 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v38 = PropGet v18 key="same"
// CHECK-NEXT: v39 = PropGet v18 key="value"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[L_10]] site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v41 = Call v38, v18, v40 calleeKey="same" calleeName="typed.same"
// CHECK-NEXT: v42 = Convert v41 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: v43 = Call v33, v31, v37, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
