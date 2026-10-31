// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// A cycle of commonjs modules hands over exports before they are set.
const first = require("./first.cjs");

first.uses("after both modules ran,");
for (const line of first.report) console.log(line);

// FILE: first.cjs
const report = [];
function outcome(run) {
  try {
    const value = run();
    return typeof value === "number" ? String(value) : (JSON.stringify(value) ?? "undefined");
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
exports.report = report;
exports.uses = function (when) {
  const second = require("./second.cjs");
  report.push(when + " n + 1 -> " + outcome(() => second.n + 1));
  report.push(when + " n | 0 -> " + outcome(() => second.n | 0));
  report.push(when + " a.push(1) -> " + outcome(() => (second.a.push(1), second.a.length)));
  report.push(when + " s.charCodeAt(0) -> " + outcome(() => second.s.charCodeAt(0)));
  report.push(when + " f(1) -> " + outcome(() => second.f(1)));
  report.push(when + " o.x + o.y -> " + outcome(() => second.o.x + second.o.y));
  report.push(when + " keys -> " + outcome(() => Object.keys(second)));
};
const second = require("./second.cjs");
exports.uses("after the second module ran,");
report.push("what the first module took at once -> " + outcome(() => Object.keys(second)));

// FILE: second.cjs
const first = require("./first.cjs");

first.uses("before anything is exported,");
exports.n = 7;
exports.a = [5, 6];
first.uses("halfway,");
exports.s = "abc";
exports.f = x => x + 1;
exports.o = { x: 1, y: 2 };
first.uses("at the end of the second module,");
module.exports = { ...exports, n: "7", replaced: true };
first.uses("after the exports object was replaced,");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = String string="after both modules ran,"
// CHECK-NEXT: v9 = Call v6, v7, v8 calleeName="first.uses"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v12 = IteratorOpen v11
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v22, v20, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v12:
// CHECK-NEXT: v24 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v24
// CHECK-NEXT: }
