// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// In a TypeScript file a direct eval sees an imported binding that the file's own code uses as a value, and what the file itself exports. An import that only the eval's text names is dropped, as in plain Bun.
import fallback, { bump, count, name } from "./other";
import * as all from "./other";
import type { Shape } from "./other";
import { onlyInTheText } from "./other";
export const own: number = 3;
export let stored: string = "before";
export enum Color { Red, Green }
export function twice(n: number): number { return n * 2; }
const shape: Shape = { size: 1 };

console.log(typeof name, typeof fallback, typeof all, typeof bump, count, shape.size);
console.log(eval("typeof name"), eval("typeof fallback"), eval("typeof all"), eval("typeof bump"), eval("typeof count"));
console.log(eval("typeof own"), eval("typeof stored"), eval("typeof Color"), eval("typeof twice"), eval("typeof Shape"), eval("typeof onlyInTheText"));
console.log(eval("name"), eval("fallback()"), eval("all.name"), eval("own + 1"), eval("Color.Green"), eval("twice(own)"));
bump(); console.log(count, eval("count"));
eval("stored = 'behind'"); console.log(stored);
try { eval("name = 1"); } catch (error) { console.log((error as Error).name, name); }
try { eval("own = 1"); } catch (error) { console.log((error as Error).name, own); }
function inside(text: string): unknown { return eval(text); }
class Holder { method(text: string): unknown { return eval(text); } }
console.log(inside("name + own"), new Holder().method("fallback() + all.count"));

// FILE: other.ts
export interface Shape { size: number }
export const name: string = "the import";
export const onlyInTheText: string = "named by nothing but the text of an eval";
export let count: number = 0;
export function bump(): void { count++; }
export default function fallback(): string { return "the default"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: twice inside Holder method
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inside"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: undefined|null|string, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateUnmappedArguments v2, v4, v3
// CHECK-NEXT: v6 = NewObject -, v3 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="eval" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v10 = GetEnvironmentField v6 layout=[[L_5]]
// CHECK-NEXT: v11 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v12 = StrictEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v14 = DirectEval v10, v0, v1, v6, v13, v5 evalScope=e21
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = Call v15, -, v10 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] length=1 thisType={type=[[L_8]] site=[[w_9]]} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_8]], v1: int[0, 4294967295], v2: undefined|null|string, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = NewObject -, v2 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="eval" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v9 = GetEnvironmentField v5 layout=[[L_11]]
// CHECK-NEXT: v10 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v11 = StrictEq v8, v10
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v15 = PropGet v14 key="prototype"
// CHECK-NEXT: v16 = DirectEval v9, v0, v12, v5, v13, v4, v15 evalScope=e22
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: v18 = Call v17, -, v9 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
