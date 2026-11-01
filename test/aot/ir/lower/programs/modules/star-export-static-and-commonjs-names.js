// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 17

// FILE: main.js
// `export *` of an ES module and of a CommonJS module that export the same name: the name is ambiguous, so importing it is a SyntaxError and the namespace object does not have it. A local export wins, a name that reaches one binding on two paths is not ambiguous, and a module reached on two paths counts on each.
async function attempt(label, run) {
  try {
    console.log(label + ":", await run());
  } catch (error) {
    console.log(label + ":", error.constructor.name, error.message.replace(/'[^']*[\\/]([^'\\/]+)'/g, "'$1'"));
  }
}
const describe = namespace => [Object.keys(namespace).join(), "both" in namespace, namespace.both, namespace.onlyDynamic];

await attempt("names in one module only", async () => (await import("./imports-unambiguous.mjs")).seen);
await attempt("name in both", () => import("./imports-both.mjs"));
await attempt("name in both again", () => import("./imports-both.mjs"));
await attempt("name in both, one level up", () => import("./imports-both-from-outer.mjs"));
await attempt("namespace", async () => describe(await import("./stars.mjs")));
await attempt("namespace one level up", async () => describe(await import("./outer.mjs")));
await attempt("local export wins", async () => describe(await import("./shadows.mjs")));
await attempt("local export wins by name", async () => (await import("./imports-shadowed.mjs")).seen);
await attempt("hidden on one of two paths", async () => describe(await import("./diamond.mjs")));
await attempt("hidden on one of two paths by name", () => import("./imports-from-diamond.mjs"));
await attempt("star cycle", async () => describe(await import("./star-cycle-b.mjs")));

// FILE: deep.mjs
export * from "./dynamic.cjs";

// FILE: diamond.mjs
export * from "./hides.mjs";
export * from "./passes.mjs";

// FILE: dynamic.cjs
exports.both = "both from dynamic";
exports.onlyDynamic = "only dynamic";
exports.shared = "shared";

// FILE: hides.mjs
export * from "./deep.mjs";
export const onlyDynamic = "only dynamic from hides";

// FILE: imports-both-from-outer.mjs
import { both } from "./outer.mjs";
console.log("imports-both-from-outer runs", both);

// FILE: imports-both.mjs
import { both } from "./stars.mjs";
console.log("imports-both runs", both);

// FILE: imports-from-diamond.mjs
import { onlyDynamic } from "./diamond.mjs";
console.log("imports-from-diamond runs", onlyDynamic);

// FILE: imports-shadowed.mjs
import { both, onlyDynamic } from "./shadows.mjs";
export const seen = [both, onlyDynamic];

// FILE: imports-unambiguous.mjs
import { onlyStatic, onlyDynamic, shared } from "./stars.mjs";
export const seen = [onlyStatic, onlyDynamic, shared];

// FILE: outer.mjs
export * from "./stars.mjs";

// FILE: passes.mjs
export * from "./deep.mjs";

// FILE: shadows.mjs
export * from "./stars.mjs";
export const both = "both from shadows";

// FILE: star-cycle-a.mjs
export * from "./star-cycle-b.mjs";
export * from "./dynamic.cjs";

// FILE: star-cycle-b.mjs
export * from "./star-cycle-a.mjs";
export const fromB = "from b";

// FILE: stars.mjs
export * from "./static.mjs";
export * from "./dynamic.cjs";

// FILE: static.mjs
export const both = "both from static";
export const onlyStatic = "only static";
export { shared } from "./dynamic.cjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt describe
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=":"
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = Call v2 calleeName="run"
// CHECK-NEXT: v11 = Await v10, v1, v2
// CHECK-NEXT: v12 = Call v7, v5, v9, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string=":"
// CHECK-NEXT: v20 = Add v1, v19
// CHECK-NEXT: v21 = PropGet v13 key="constructor"
// CHECK-NEXT: v22 = PropGet v21 key="name"
// CHECK-NEXT: v23 = PropGet v13 key="message"
// CHECK-NEXT: v24 = PropGet v23 key="replace"
// CHECK-NEXT: v25 = NewRegExp pattern="'[^']*[\\\\/]([^'\\\\/]+)'" regExpFlags=[Global]
// CHECK-NEXT: v26 = String string="'$1'"
// CHECK-NEXT: v27 = Call v24, v23, v25, v26 calleeKey="replace" calleeName="error.message.replace"
// CHECK-NEXT: v28 = Call v18, v16, v20, v22, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = PropHas v0 key="both"
// CHECK-NEXT: v10 = PropGet v0 key="both"
// CHECK-NEXT: v11 = PropGet v0 key="onlyDynamic"
// CHECK-NEXT: v12 = NewArray v8, v9, v10, v11 contents=anything
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
