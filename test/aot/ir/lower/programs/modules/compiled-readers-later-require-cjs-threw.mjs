// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// Compiled readers of a later require of a commonjs file that threw behind a graph that imports its names.
import "./late.cjs";
import "./during.cjs";
import { first, count } from "./file.cjs";
console.log("main begins", first, count());
await 0;
console.log("main ends");

// FILE: during.cjs
globalThis.whileFileRuns = () => {
  const file = require("./file.cjs");
  console.log("while it runs", Object.prototype.toString.call(file), Object.keys(file).join());
};

// FILE: file.cjs
console.log("file begins");
let calls = 0;
exports.first = 1;
exports.count = () => ++calls;
exports.box = { value: 10 };
globalThis.whileFileRuns?.();
require("./main.mjs");
exports.second = 2;
console.log("file ends");

// FILE: late.cjs
function sum(file) {
  let total = 0;
  for (let index = 0; index < 1000; index++) total += file.first + file.box.value;
  return total;
}
function read() {
  return require("./file.cjs");
}
setTimeout(() => {
  const file = read();
  const { first, second, count } = require("./file.cjs");
  console.log(Object.prototype.toString.call(file), Object.keys(file).join(), first, second, count(), sum(file));
  console.log(file === read(), typeof file.default, Object.keys(file.default).join(), file.second, "second" in file, "first" in file);
  const name = "./file" + (globalThis.never ? "s" : "") + ".cjs";
  console.log("by a computed name", require(name) === file);
  file.first = 5;
  console.log(file.first, Object.isFrozen(file), Reflect.set(file, "first", 6));
  console.log(file.__esModule, "__esModule" in file, Reflect.ownKeys(file).map(String).join(), JSON.stringify(Object.getOwnPropertyDescriptor(file, "__esModule")));
  file.default.first = 7;
  console.log(file.first, file.default.first, sum(file.default), sum(file));
  for (const key in file) console.log(key, typeof file[key]);
  import("./file.cjs").then(names => console.log("import() finds the same object", names === file));
}, 1);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="main begins"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="first"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="count"
// CHECK-NEXT: v10 = Call v9 calleeName="count"
// CHECK-NEXT: v11 = Call v4, v2, v5, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Await v12
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="main ends"
// CHECK-NEXT: v20 = Call v18, v16, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = ThrowModuleFailure failure=q0
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = ThrowModuleFailure failure=q1
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
