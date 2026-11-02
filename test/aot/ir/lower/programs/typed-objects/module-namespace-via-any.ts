// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// `(ns as any).Name` is the binding `Name` or `undefined`: a module namespace object is immutable.
import * as ns from "./req/ns_any_a"
import { atLoad, early } from "./req/ns_any_c"
export const lateBinding = "late"
const show = (label: string, f: () => unknown) => { try { console.log(label + ":", String(f())) } catch (e) { console.log(label + ":", (e as Error).constructor.name) } }
show("an enum", () => (ns as any).Kind.B + " " + (ns as any).Kind[1])
show("a function", () => (ns as any).bump(2) + " " + ns.counter + " " + (ns as any).counter)
show("a live binding", () => { ns.bump(5); return (ns as any).counter })
show("a constant", () => (ns as any).table.b + " " + ((ns as any).table === ns.table))
show("through export *", () => (ns as any).fromStar() + " " + (ns as any).deep)
show("renamed", () => (ns as any).renamed)
show("the default", () => (ns as any).default())
show("a class", () => { new (ns as any).Late(); return ns.Late.made })
show("as unknown as", () => (ns as unknown as { deep: string }).deep)
// Doors.
show("not exported", () => (ns as any).nothingOfTheKind)
show("only a type", () => (ns as any).OnlyAType)
show("of Object.prototype", () => typeof (ns as any).toString + " " + typeof (ns as any).hasOwnProperty + " " + typeof (ns as any).__proto__)
show("a computed key", () => { const k = ["de", "ep"].join(""); return (ns as any)[k] + " " + (ns as any)["Kind"].A })
show("in", () => ("bump" in ns) + " " + ("nope" in (ns as any)))
const sameObject: any = ns
try { sameObject.replaceable = () => "replaced" } catch {}
show("and nothing has changed", () => ns.replaceable() + " " + (ns as any).replaceable())
show("the same, afterwards", () => early())

// FILE: req/ns_any_a.ts
export enum Kind { A = 1, B = 2 }
export const enum Hidden { X = 7 }
export interface OnlyAType { n: number }
export let counter = 0
export function bump(by: number): number { counter += by; return counter }
export function replaceable(): string { return "original" }
export const table = { a: 1, b: 2 }
export * from "./ns_any_b"
export { deep as renamed } from "./ns_any_b"
export default function theDefault(): string { return "default" }

// FILE: req/ns_any_b.ts
export const deep = "deep"
export function fromStar(): string { return "star" }
export class Late { static made = 0; constructor() { Late.made++ } }

// FILE: req/ns_any_c.ts
import * as main from "../main"
export function early(): string { try { return String((main as any).lateBinding) } catch (e) { return (e as Error).constructor.name } }
export const atLoad = early()

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="f"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Call v6, v4, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=":"
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Convert v14 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v23 = PropGet v22 key="constructor"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v25 = PropGet v24 key="name"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = Call v19, v17, v21, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
