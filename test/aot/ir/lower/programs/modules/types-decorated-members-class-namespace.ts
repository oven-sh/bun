// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="decorated"
// CHECK-LABEL: function {{*}}name="A"
// CHECK-LABEL: function {{*}}name="m"
// CHECK-LABEL: function {{*}}name="show"

// FILE: main.ts
// With `emitDecoratorMetadata` the type `ns.C` of a parameter, a result and a field is read as a value. `ns` is `import * as ns` of a CommonJS file, and `ns.s` stands beside.
import * as ns from "./lib.cjs";
(Reflect as any).metadata = (key: string, value: any) => (target: any, name?: any) => {
  const show = (it: any) => (it === Object ? "Object" : it === Number ? "Number" : it === Function ? "Function" : new it().v);
  console.log(key, String(name), Array.isArray(value) ? value.map(show).join() : show(value));
};
function decorated(...parts: any[]): any {}
@decorated
class A {
  constructor(c: ns.C) {}
  @decorated m(a: ns.C, b: number): ns.C {
    return a;
  }
  @decorated p!: ns.C;
}
console.log(typeof A, ns.s);

// FILE: lib.cjs
exports.n = 10;
exports.f = function (a) {
  return a + 1;
};
exports.C = class C {
  v = 7;
};
exports.s = "s";

// FILE: lib.d.cts
export const n: number;
export function f(a: number): number;
export class C {
  v: number;
}
export const s: string;

// FILE: tsconfig.json
{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "types": [] } }
