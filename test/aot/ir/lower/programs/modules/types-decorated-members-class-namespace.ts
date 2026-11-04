// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

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

// GENERATED: decorated A m show
// CHECK-LABEL: function {{*}}name="decorated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]]}
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: Jump -> next b2(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=number}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: number):
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="Object"
// CHECK-NEXT: Jump -> next b7(v3)
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = Builtin builtin=Number
// CHECK-NEXT: v5 = StrictEq v0, v4
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = String string="Number"
// CHECK-NEXT: Jump -> next b7(v6)
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Function" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v10 = StrictEq v0, v9
// CHECK-NEXT: Branch v10 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = String string="Function"
// CHECK-NEXT: Jump -> next b7(v11)
// CHECK-NEXT: b6():
// CHECK-NEXT: v12 = Construct v0 calleeName="it"
// CHECK-NEXT: v13 = PropGet v12 key="v"
// CHECK-NEXT: Jump -> next b7(v13)
// CHECK-NEXT: b7(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
