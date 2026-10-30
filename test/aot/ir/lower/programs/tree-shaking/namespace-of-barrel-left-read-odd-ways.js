// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.js
// "sideEffects": false, and index.js only has `export *`, so the imports go past it and the file is not in the executable. Its namespace object is read by constant names in every way there is; a name that it lacks asks the object itself.
import * as ns from "stars";

console.log(ns?.a(), ns["a"](), ns.a?.(), (0, ns.a)());
console.log(typeof ns.a, new ns.Klass().m(), ns.value + 1, `${ns.value}`);
const kept = ns.a;
console.log(kept());
class Sub extends ns.Klass {}
console.log(new Sub().m(), new Sub() instanceof ns.Klass);

// FILE: node_modules/stars/a.js
export function a() { return "a"; }
export const value = 7;
export class Klass { m() { return "m"; } }

// FILE: node_modules/stars/b.js
export function b() { return "b"; }

// FILE: node_modules/stars/index.js
export * from "./a.js";
export * from "./b.js";

// FILE: node_modules/stars/package.json
{ "name": "stars", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: Sub
// CHECK-LABEL: function {{*}}name="Sub"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
