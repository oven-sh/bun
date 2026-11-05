// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// An import, a namespace object, a required namespace and a proxy above it all show what the exporting file stored last.
import * as ns from "./a.mjs";
import { x, inc, setX, y as why, def, late } from "./a.mjs";
import dflt, { reassignDefault } from "./a.mjs";
import { createRequire } from "node:module";
const out = [];
out.push(x, ns.x); inc(); out.push(x, ns.x); [1, 2].forEach(inc); out.push(x, ns.x);
setX(10); out.push(x, ns.x, ns["x"]); const k = ["x"][0]; out.push(ns[k]);
out.push(why, ns.y); out.push(typeof dflt, dflt()); reassignDefault(); out.push(typeof dflt, typeof ns.default);
out.push(def);
try { const any = [ns][0]; any.x = 5; } catch (e) { out.push(e.name); } out.push(Reflect.set(ns, "x", 5), x);
out.push(Reflect.defineProperty(ns, "x", { value: 10 }), Reflect.defineProperty(ns, "x", { value: 11 }), x);
out.push(Reflect.deleteProperty(ns, "x"), Reflect.deleteProperty(ns, "nope"));
out.push(Object.getOwnPropertyDescriptor(ns, "x")); inc(); out.push(Object.getOwnPropertyDescriptor(ns, "x").value, Object.values(ns).length, JSON.stringify(ns), { ...ns }.x, Object.entries(ns).find(e => e[0] === "x")[1]);
out.push(late); ns.setLate(3); out.push(late, ns.late);
const m = await import("./a.mjs"); out.push(m === ns, m.x); m.inc(); out.push(x);
const require = createRequire(import.meta.url); const r = require("./a.mjs"); out.push(r.x); r.inc(); out.push(x, r.x);
const p = new Proxy(ns, {}); out.push(p.x); inc(); out.push(p.x, Reflect.get(ns, "x"), Reflect.get(Object.create(ns), "x"));
with_(ns); function with_(o) { out.push(Object.keys(o).join()); }
console.log(JSON.stringify(out));
console.log(ns);

// FILE: a.mjs
export let x = 1; export function inc() { x++; } export function setX(v) { x = v; }
let z = 2; export { z as y }; z = 3;
export default function d() { return "d"; } export function reassignDefault() { d = 5; }
export let def; export let late; export function setLate(v) { late = v; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: with_
// CHECK-LABEL: function {{*}}name="with_"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="out"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v7 = Call v6, v5, v0 calleeName="Object.keys"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v8 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v4, v2, v12 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
