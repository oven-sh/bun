// RUN: lower
// OPTIONS: builtin-modules

// FILE: typescript-syntax-build-reports-syntax.ts
// @ts-nocheck
// Typescript syntax beside what a build reports as a syntax error.
var a = 1;
export { a as "b c", a as if, a as default };
function withThis(this: any, x) { return x; }
class Accessors {
  get x(this: Accessors) { return 1; }
  set x(this: Accessors, v) { console.log("set", v); }
  method(this: Accessors, y) { return y; }
}
class Properties {
  constructor(public readonly p, readonly public q, public public r = 3, override s?) {}
}
class Merged { static own = 1; }
namespace Merged { export var added = 2; }
function merged() { return 3; }
namespace merged { export var added = 4; }
enum Twice { A }
enum Twice { B = 1 }
enum WithNamespace { A }
namespace WithNamespace { export var added = 5; }
namespace Empty {}
let Empty = 6;
namespace OnlyTypes { export type T = 1; export interface I {} }
const OnlyTypes = 7;
namespace Outer.Inner { export var deep = 8; }
namespace TypeExports { export type { T } from "x"; }
declare namespace Ambient { export default 1; import z = require("z"); }
declare enum AmbientEnum { A }
let AmbientEnum = 9;
function holdsGlobal() { declare global {} return 10; }
function newTarget() { enum E { A = new.target === undefined ? 1 : 2 } return E.A; }
enum Names { "quoted", "a-b" = 2, if, NaN }
import fs = require("node:fs");
let definite!: number;
class Modifiers { static public x = 11; readonly readonly y = 12; readonly m() { return 13; } }
for (var using of [14]) console.log(using);
const accessors = new Accessors();
accessors.x = 0;
const properties = new Properties(1, 2);
console.log(withThis(1), accessors.x, accessors.method(3), withThis.length);
console.log(properties.p, properties.q, properties.r, properties.s, Object.keys(properties).join());
console.log(Merged.own, Merged.added, merged(), merged.added, Twice.A, Twice.B, Twice[1], WithNamespace.A, WithNamespace.added);
console.log(Empty, OnlyTypes, Outer.Inner.deep, AmbientEnum, holdsGlobal(), newTarget(), typeof TypeExports);
console.log(Names.quoted, Names["a-b"], Names.if, Names.NaN, typeof fs.readFileSync, definite);
console.log(Modifiers.x, new Modifiers().y, new Modifiers().m());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: newTarget x method Modifiers
// CHECK-LABEL: function {{*}}name="newTarget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: v3 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: PropSet v2, v8 key="A"
// CHECK-NEXT: v10 = ToPropertyKey v8
// CHECK-NEXT: v11 = String string="A"
// CHECK-NEXT: ElemSet v2, v10, v11
// CHECK-NEXT: v13 = Convert v2 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="A"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=undefined|null|[[L_2]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=undefined|null|[[L_2]] flags=[IsExpected]} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="set"
// CHECK-NEXT: v8 = Call v6, v4, v7, v1 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=undefined|null|[[L_2]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Modifiers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
