// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Objects allocated repeatedly same new target.
import * as core from "./core.ts";
import * as heirs from "./heirs.js";
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));
const look = (o: any) => [o.describe(), Object.keys(o).join(), core.readLate(o), o instanceof core.Core, o.kind, typeof o.helper];

const first = heirs.make(heirs.Heir, 1);
core.fill(first, 7);
(first as any).extra = "of the first alone";
for (let i = 0; i < 6; i++) show("Heir " + i, look(heirs.make(heirs.Heir, i)));
show("the first", [look(first), (first as any).extra]);

for (let i = 0; i < 4; i++) show("Old " + i, [look(heirs.make(heirs.Old, i)), Object.getPrototypeOf(heirs.make(heirs.Old, i)) === heirs.Old.prototype]);
(heirs.Old as any).prototype = heirs.second;
for (let i = 0; i < 4; i++) show("Old with another prototype " + i, [look(heirs.make(heirs.Old, i)), Object.getPrototypeOf(heirs.make(heirs.Old, i)) === heirs.second]);
(heirs.Old as any).prototype = 5;
show("Old with no prototype object", Object.getPrototypeOf(heirs.make(heirs.Old, 1)) === Object.prototype);

let sum = 0;
for (let round = 0; round < 5; round++) {
  for (const C of heirs.many) {
    const o: any = heirs.make(C, round);
    sum += o.which() + o.count + (Object.getPrototypeOf(o) === C.prototype ? 1000 : 0);
  }
}
show("forty heirs in turn", sum);

for (let i = 0; i < 3; i++) {
  show("for one and for another " + i, [look(Reflect.construct(core.Core, [i], heirs.Heir)), look(Reflect.construct(core.Core, [i], heirs.Other)), look(Reflect.construct(heirs.Heir, [i], heirs.Other)), look(Reflect.construct(heirs.Other, [i], heirs.Heir))]);
  show("bound and proxied " + i, [look(heirs.make(heirs.bound, i)), look(heirs.make(heirs.proxied, i)), look(Reflect.construct(core.Core, [i], heirs.bound)), look(Reflect.construct(core.Core, [i], heirs.proxied))]);
}

const nameOfLate = ["la", "te"].join("");
heirs.addGetter(heirs.Heir.prototype, nameOfLate, "added later");
for (let i = 0; i < 3; i++) show("Heir with a getter " + i, look(heirs.make(heirs.Heir, i)));
delete (heirs.Heir.prototype as any)[nameOfLate];
for (let i = 0; i < 3; i++) show("Heir without it " + i, look(heirs.make(heirs.Heir, i)));
Object.setPrototypeOf(heirs.Heir.prototype, heirs.Other.prototype);
for (let i = 0; i < 3; i++) show("Heir below Other " + i, look(heirs.make(heirs.Heir, i)));
Object.setPrototypeOf(heirs.Heir.prototype, core.Core.prototype);
for (let i = 0; i < 3; i++) show("Heir below Core again " + i, look(heirs.make(heirs.Heir, i)));

const kept: any[] = [];
for (let i = 0; i < 3000; i++) {
  const o = heirs.make(heirs.Heir, i);
  if (i % 3 === 0) core.fill(o, i);
  if (i % 100 === 0) kept.push(o);
}
show("many", kept.map(o => o.describe()).join(" | "));

// FILE: core.ts
// A class with fields it is born with and fields it is born without, constructed many times for the same new.target and for many.
export class Core {
  declare late?: unknown;
  count = 0;
  label: string | undefined = undefined;
  list: number[] | undefined;
  constructor(count?: number) {
    if (count !== undefined) this.count = count;
  }
  describe(): string {
    return this.count + " " + String(this.label) + " " + String(this.list) + " " + String(this.late);
  }
}
export const readLate = (core: Core): unknown => core.late;
export const fill = (core: Core, value: number): void => {
  core.label = "l" + value;
  core.list = [value];
  core.late = value;
};

// FILE: heirs.js
import { Core } from "./core.ts";
export class Heir extends Core {
  helper() { return "helper"; }
}
export class Other extends Core {
  get label() { return "inherited from Other"; }
  set label(value) {}
}
export function Old(count) { return Reflect.construct(Core, [count], Old); }
Old.prototype = Object.create(Core.prototype, { kind: { value: "first", configurable: true } });
export const second = Object.create(Core.prototype, { kind: { value: "second", configurable: true } });
export const many = [];
for (let i = 0; i < 40; i++) many.push(class extends Core { which() { return i; } });
export const bound = Heir.bind(null);
export const proxied = new Proxy(Heir, {});
export function make(C, count) {
  return new C(count);
}
export function addGetter(object, name, value) {
  Object.defineProperty(object, name, { get() { return value; }, configurable: true });
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show look
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=JSON
// CHECK-NEXT: v10 = PropGet v9 key="stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9, v1 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Call v6, v4, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="look"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="describe"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="describe" calleeName="o.describe"
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeName="Object.keys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = PropGet v6 key="join"
// CHECK-NEXT: v8 = Call v7, v6 calleeKey="join" calleeName="join"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="readLate"
// CHECK-NEXT: v12 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v13 = Call v11, v12, v0 calleeName="core.readLate"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="Core"
// CHECK-NEXT: v16 = InstanceOf v0, v15
// CHECK-NEXT: v17 = PropGet v0 key="kind"
// CHECK-NEXT: v18 = PropGet v0 key="helper"
// CHECK-NEXT: v19 = TypeOf v18
// CHECK-NEXT: v20 = NewArray v2, v9, v13, v16, v17, v19 contents=anything
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
