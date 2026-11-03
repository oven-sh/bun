// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: polymorphic-field-reads.ts
// Fields of unions of string literals, at other places in each of many classes, are read by name by code that knows nothing of the classes.
import { kindOf, kindsOf, lengthsOf, callKind, countOf } from "./polymorphic-field-reads-helper.js";
type Kind = "circle" | "square" | "ring" | "";
type Mode = "on" | "off";
class A { constructor(public kind: Kind) {} }
class B { constructor(public id: number, public kind: Kind) {} }
class C { constructor(public id: number, public name: string, public kind: Kind) {} }
class D { constructor(public mode: Mode, public kind: Kind | undefined) {} }
class E { constructor(public mode: Mode, public id: number, public kind: Kind | null) {} }
class F { kind?: Kind; constructor(public mode: Mode) {} }
class G { constructor(public a: number, public b: number, public c: number, public d: number, public kind: Kind, public mode: Mode) {} }
class H { constructor(public kind: string) {} }
interface Tagged { kind: Kind; weight: number }
const kinds: Kind[] = ["circle", "square", "ring", ""];
const fromOutside: any[] = JSON.parse('[{"kind":"ring","weight":1},{"kind":"nobody knows this one","weight":2}]');
function make(i: number): unknown[] {
    const kind = kinds[i % 4];
    const f = new F("off");
    if (i % 3) f.kind = kind;
    const literal: Tagged = { kind, weight: i };
    const stranger: Tagged = { kind: "", weight: i };
    (stranger as any).kind = fromOutside[1].kind;
    return [new A(kind), new B(i, kind), new C(i, "n" + i, kind), new D("on", i % 2 ? kind : undefined), new E("off", i, i % 2 ? null : kind), f, new G(1, 2, 3, 4, kind, "on"), new H("free " + i), literal, stranger, { kind: "plain " + kind }, fromOutside[i % 2]];
}
const all: unknown[] = [];
for (let i = 0; i < 12; i++) all.push(...make(i));
let digest = 0;
for (let round = 0; round < 200; round++) {
    const text = kindsOf(all);
    digest = (digest * 31 + text.length + lengthsOf(all)) % 1000003;
    if (round % 50 === 0) console.log(round, text.slice(0, 150), countOf(all, "ring"), countOf(all, ""), countOf(all, undefined), countOf(all, null));
}
console.log(digest, all.map(kindOf).slice(0, 24).join("|"));
console.log(all.slice(0, 12).map(callKind).join("|"));

// FILE: polymorphic-field-reads-helper.js
export function kindOf(o) { return o.kind; }
export function kindsOf(all) { let text = ""; for (const o of all) text += o.kind + ","; return text; }
export function lengthsOf(all) { let sum = 0; for (const o of all) { const kind = o.kind; if (typeof kind === "string") sum += kind.length; const mode = o.mode; if (mode === "on") sum += 100; else if (mode !== undefined) sum += mode.length; } return sum; }
export function countOf(all, kind) { let n = 0; for (const o of all) if (o.kind === kind) n++; return n; }
export function callKind(o) { try { return o.kind(); } catch (error) { return error.constructor.name; } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: B H
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=undefined|null|""|"circle"|"ring"|"square" site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|""|"circle"|"ring"|"square"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: PropSet v5, v1 key="id"
// CHECK-NEXT: PropSet v5, v2 key="kind"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="H"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_7]]
// CHECK-NEXT: PropSet v4, v1 key="kind"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
