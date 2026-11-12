// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="show"
// CHECK-LABEL: function {{*}}name="look"

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
