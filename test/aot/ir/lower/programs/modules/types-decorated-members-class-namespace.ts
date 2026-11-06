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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[IsExpected]}, {type=number site=[[w_4]]}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="Object"
// CHECK-NEXT: Jump -> next b14(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = Builtin builtin=Number
// CHECK-NEXT: v7 = StrictEq v5, v6
// CHECK-NEXT: Branch v7 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v9 = String string="Number"
// CHECK-NEXT: Jump -> next b14(v9)
// CHECK-NEXT: b8(v10):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="Function" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v14 = StrictEq v10, v13
// CHECK-NEXT: Branch v14 -> taken b10(| 0), notTaken b12(| 0)
// CHECK-NEXT: b10(v15):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v16 = String string="Function"
// CHECK-NEXT: Jump -> next b14(v16)
// CHECK-NEXT: b12(v17):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v19 = Construct v18 calleeName="it"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="v"
// CHECK-NEXT: Jump -> next b14(v21)
// CHECK-NEXT: b14(v22):
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
