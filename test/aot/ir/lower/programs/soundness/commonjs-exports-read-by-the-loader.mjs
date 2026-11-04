// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 15

// FILE: main.mjs
// The loader reads every own enumerable property of what a CommonJS module exports when an ES module imports it, by a declaration or by a call: getters run, whichever names the importer uses.
import { a, b } from "./getters.cjs";
import * as star from "./passes-on.mjs";
import * as computed from "./functions.cjs";
import callable, { helper } from "./callable.cjs";
import marked, { named } from "./marked.cjs";
import { inner } from "./as-namespace.mjs";
import styles, { red } from "./accessor-for-exports.cjs";
import * as trapped from "./proxy.cjs";
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
show("1", a, typeof b, globalThis.gettersLog.join());
show("2", Object.keys(star).join(), typeof star.a, star.own, globalThis.passedOnLog.join());
for (const name of ["f", "g"]) show("3", name, computed[name]("x"));
for (const key in computed) show("4", key, typeof computed[key]);
show("5", callable(1), helper("s"), callable.helper === helper);
show("6", typeof marked, marked && marked.k, named);
show("7", typeof inner.f, inner.f("s"), Object.keys(inner).join());
show("8", typeof styles, styles.red.open, red.close, globalThis.assembled);
show("9", globalThis.trapLog.join(), typeof trapped.a);
await import("./only-for-its-effects.cjs");
show("10", globalThis.effects.join());
const { default: library } = await import("./default-only.cjs");
show("11", library.used(), globalThis.defaultOnlyLog.join());
const all = await Promise.all([import("./first-of-two.cjs"), import("./second-of-two.cjs")]);
show("12", all.length, globalThis.twoLog.sort().join());

// FILE: accessor-for-exports.cjs
"use strict";
globalThis.assembled = 0;
function assembleStyles() {
  globalThis.assembled++;
  return { red: { open: "<red>", close: "</red>" } };
}
Object.defineProperty(module, "exports", { enumerable: true, get: assembleStyles });

// FILE: as-namespace.mjs
export * as inner from "./inner.cjs";

// FILE: callable.cjs
function callable(x) { return typeof x; }
callable.helper = function (x) { return typeof x + "?"; };
module.exports = callable;

// FILE: default-only.cjs
globalThis.defaultOnlyLog = [];
exports.used = function () { return "used"; };
Object.defineProperty(exports, "unused", { enumerable: true, get() { globalThis.defaultOnlyLog.push("unused getter ran"); return 1; } });

// FILE: first-of-two.cjs
globalThis.twoLog = globalThis.twoLog || [];
Object.defineProperty(exports, "a", { enumerable: true, get() { globalThis.twoLog.push("a"); return 1; } });

// FILE: functions.cjs
exports.f = function (x) { return typeof x; };
exports.g = function (x) { return x + "!"; };

// FILE: getters.cjs
globalThis.gettersLog = [];
Object.defineProperty(exports, "a", { enumerable: true, get() { globalThis.gettersLog.push("a"); return "A"; } });
Object.defineProperty(exports, "b", { enumerable: true, get() { globalThis.gettersLog.push("b"); return { k: 1 }; } });
Object.defineProperty(exports, "c", { enumerable: true, get() { globalThis.gettersLog.push("c"); return 3; } });

// FILE: inner.cjs
exports.f = function (x) { return typeof x; };
Object.defineProperty(exports, "g", { enumerable: true, get() { return 2; } });

// FILE: marked.cjs
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = { k: "default member" };
exports.named = "named";

// FILE: only-for-its-effects.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const implementation = { helper() { return 1; } };
globalThis.effects = ["body"];
Object.defineProperty(exports, "helper", { enumerable: true, get: function () { globalThis.effects.push("getter"); return implementation.helper; } });

// FILE: passed-on.cjs
globalThis.passedOnLog = [];
Object.defineProperty(exports, "a", { enumerable: true, get() { globalThis.passedOnLog.push("a"); return function () {}; } });
exports.z = 1;

// FILE: passes-on.mjs
export * from "./passed-on.cjs";
export const own = "own";

// FILE: proxy.cjs
globalThis.trapLog = [];
module.exports = new Proxy({ a: 1 }, {
  ownKeys(target) { globalThis.trapLog.push("ownKeys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { globalThis.trapLog.push("descriptor"); return Reflect.getOwnPropertyDescriptor(target, key); },
  get(target, key) { globalThis.trapLog.push("get"); return target[key]; },
});

// FILE: second-of-two.cjs
globalThis.twoLog = globalThis.twoLog || [];
Object.defineProperty(exports, "b", { enumerable: true, get() { globalThis.twoLog.push("b"); return 1; } });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = ToBoolean v6
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = String string=" | "
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = String string=""
// CHECK-NEXT: Jump -> next b5(v14)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = ElemGet v0, v6
// CHECK-NEXT: v18 = Call v16, -, v17 calleeName="String"
// CHECK-NEXT: v19 = Add v15, v18
// CHECK-NEXT: v20 = Add v5, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = Increment v6
// CHECK-NEXT: v23 = Convert v22 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v21, v23)
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v28, v26, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
