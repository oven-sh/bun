// RUN: lower
// OPTIONS: builtin-modules

// Timers, events, streams, inspection, conversions and text run outside the module call closures that store into variables of the module.
const out = [];
function target() { return new Error("e").stack; }
Error.prepareStackTrace = (e, sites) => sites.map(s => { const f = s.getFunction && s.getFunction(); return typeof f === "function" ? f.name : String(f); }).slice(0, 2).join();
target(); Error.prepareStackTrace = undefined;
let v1 = 1; const r1 = () => v1; process.on("exit", () => { v1 = 2; console.log("exit", r1()); });
let v2 = 1; const r2 = () => v2; process.nextTick(() => { v2 = 2; }); setImmediate(() => console.log("immediate", r2()));
let v3 = 1; const r3 = () => v3; queueMicrotask(() => { v3 = 2; }); Promise.resolve().then(() => console.log("micro", r3()));
let v4 = 1; const r4 = () => v4; const ee = new (require("node:events"))(); ee.on("e", x => { v4 = x; }); ee.emit("e", 2); ee.emit("e", 3); out.push(r4());
let v5 = 1; const r5 = () => v5; const et = new EventTarget(); et.addEventListener("e", () => { v5++; }); et.dispatchEvent(new Event("e")); et.dispatchEvent(new Event("e")); out.push(r5());
let v6 = 1; const r6 = () => v6; const o6 = { [Symbol.for("nodejs.util.inspect.custom")]() { v6++; return "c"; } }; require("node:util").inspect(o6); require("node:util").inspect(o6); out.push(r6());
let v7 = 1; const r7 = () => v7; const o7 = { toJSON() { v7++; return 1; } }; JSON.stringify([o7, o7]); out.push(r7());
let v8 = 1; const r8 = () => v8; const fr = new FinalizationRegistry(() => { v8 = 2; }); out.push(r8());
let v9 = 1; const r9 = () => v9; const vm = require("node:vm"); globalThis.setV9 = x => { v9 = x; }; vm.runInThisContext("setV9(5)"); out.push(r9());
let v10 = 1; const r10 = () => v10; new Function("f", "f(6)")(x => { v10 = x; }); out.push(r10());
let v11 = 1; const r11 = () => v11; (0, eval)("(f) => f(7)")(x => { v11 = x; }); out.push(r11());
let v12 = 1; const r12 = () => v12; const als = new (require("node:async_hooks").AsyncLocalStorage)(); als.run(1, () => { v12 = 8; }); out.push(r12());
let v13 = 1; const r13 = () => v13; structuredClone({ get a() { v13 = 9; return 1; } }); out.push(r13());
let v14 = 1; const r14 = () => v14; Array.from({ length: 2 }, (_, i) => { v14 = i + 10; }); out.push(r14());
let v15 = 1; const r15 = () => v15; Object.defineProperty({}, "a", { get value() { v15 = 12; return 1; } }); out.push(r15());
let v16 = 1; const r16 = () => v16; new Intl.NumberFormat("en", { get style() { v16 = 13; return "decimal"; } }); out.push(r16());
let v17 = 1; const r17 = () => v17; Buffer.from({ valueOf() { v17 = 14; return "a"; } }); out.push(r17());
let v18 = 1; const r18 = () => v18; try { new URL({ toString() { v18 = 15; return "http://a"; } }); } catch {} out.push(r18());
let v19 = 1; const r19 = () => v19; console.log("%s", { toString() { v19 = 16; return "s"; } }); out.push(r19());
let v20 = 1; const r20 = () => v20; class T extends require("node:stream").Transform { _transform(c, e, cb) { v20++; cb(); } } const t = new T(); t.write("a"); t.write("b"); out.push(r20());
console.log(JSON.stringify(out));

// GENERATED: target r1 style T _transform
// CHECK-LABEL: function {{*}}name="target"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Error" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="e"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Error"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="stack"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="r1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="v1"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="style"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]] field=15
// CHECK-NEXT: v2 = CheckInitialized v1 name="v16"
// CHECK-NEXT: v3 = Integer integer=13
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_1]] field=15
// CHECK-NEXT: v6 = String string="decimal"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="T"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="_transform"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything, v3: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=19
// CHECK-NEXT: v5 = CheckInitialized v4 name="v20"
// CHECK-NEXT: v6 = Increment v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_1]] field=19
// CHECK-NEXT: v9 = CheckInitialized v8 name="v20"
// CHECK-NEXT: PutEnvironmentField v0, v7 layout=[[L_1]] field=19
// CHECK-NEXT: v11 = Call v3 calleeName="cb"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
