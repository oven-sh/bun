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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="uses"
// CHECK-NEXT: v7 = String string="after both modules ran,"
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="uses" calleeName="first.uses"
// CHECK-NEXT: v9 = PropGet v5 key="report"
// CHECK-NEXT: v10 = IteratorOpen v9
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = IteratorResume v10
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v20, v18, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v10:
// CHECK-NEXT: v22 = CatchException
// CHECK-NEXT: IteratorClose v10 completion=Throw
// CHECK-NEXT: Rethrow v22
// CHECK-NEXT: }
