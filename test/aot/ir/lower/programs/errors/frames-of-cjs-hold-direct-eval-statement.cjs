// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.cjs
// Each of these CommonJS files holds a direct eval or a `with` statement, so its text looks names up while it runs. Each prints every frame of the stacks that it reads, whole, under four limits and below a function.
globalThis.framesOf = function framesOf(stack) {
  return String(stack)
    .split("\n")
    .filter(line => /^\s*at /.test(line))
    .map(line =>
      line
        .trim()
        .slice(3)
        .replace(/[^ ()]*[\\/]([\w.-]+:\d+:\d+)/, "$1")
        .replace(/native:\d+:\d+/, "native"),
    )
    .join(" < ");
};
globalThis.show = function show(label) {
  console.log(label, "|", framesOf(new Error().stack));
  for (const limit of [1, 2, 3, 4]) {
    Error.stackTraceLimit = limit;
    console.log(label, limit, "|", framesOf(new Error().stack));
  }
  Error.stackTraceLimit = 10;
  const target = {};
  Error.captureStackTrace(target, show);
  console.log(label, "below show |", framesOf(target.stack));
};
show("the entry point");
require("./runs-a-direct-eval.cjs");
require("./runs-a-direct-eval-in-strict-code.cjs");
require("./holds-a-direct-eval-in-an-arrow-function.cjs");
require("./holds-a-direct-eval-that-never-runs.cjs");
require("./reads-a-stack-in-the-text.cjs");
require("./holds-a-with-statement.cjs");
require("./does-none-of-these.cjs");

// FILE: does-none-of-these.cjs
show("does none of these, at the top");
function inner() {
  show("does none of these, in a function");
}
inner();
[0].forEach(() => show("does none of these, in a callback"));
exports.done = true;

// FILE: holds-a-direct-eval-in-an-arrow-function.cjs
show("holds a direct eval in an arrow function, at the top");
function inner() {
  show("holds a direct eval in an arrow function, in a function");
}
inner();
[0].forEach(() => show("holds a direct eval in an arrow function, in a callback"));
exports.later = () => eval("2");

// FILE: holds-a-direct-eval-that-never-runs.cjs
show("holds a direct eval that never runs, at the top");
function inner() {
  show("holds a direct eval that never runs, in a function");
}
inner();
[0].forEach(() => show("holds a direct eval that never runs, in a callback"));
function never() {
  return eval("3");
}
exports.done = true;

// FILE: holds-a-with-statement.cjs
show("holds a with statement, at the top");
function inner() {
  show("holds a with statement, in a function");
}
inner();
[0].forEach(() => show("holds a with statement, in a callback"));
with ({ inside: 1 }) {
  exports.inside = inside;
}

// FILE: reads-a-stack-in-the-text.cjs
show("reads a stack in the text, at the top");
function inner() {
  show("reads a stack in the text, in a function");
}
inner();
[0].forEach(() => show("reads a stack in the text, in a callback"));
eval('show("in the text")');
exports.done = true;

// FILE: runs-a-direct-eval-in-strict-code.cjs
"use strict";
show("runs a direct eval in strict code, at the top");
function inner() {
  show("runs a direct eval in strict code, in a function");
}
inner();
[0].forEach(() => show("runs a direct eval in strict code, in a callback"));
exports.answer = eval("1 + 1");

// FILE: runs-a-direct-eval.cjs
show("runs a direct eval, at the top");
function inner() {
  show("runs a direct eval, in a function");
}
inner();
[0].forEach(() => show("runs a direct eval, in a callback"));
exports.answer = eval("1 + 1");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="|"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="framesOf" [isFreeName]
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Error" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v13 = Construct v12 calleeName="Error"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="stack"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v9, -, v16 calleeName="framesOf"
// CHECK-NEXT: v18 = Call v6, v4, v1, v7, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Data data=[[d_2]]
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v21 = IteratorOpen v20
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v23 = IteratorResume v21
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: Branch v24 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="Error" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v29 = Integer integer=10
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v28, v30 key="stackTraceLimit" mode=Sloppy
// CHECK-NEXT: v32 = Data data=[[d_3]]
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="Error" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="captureStackTrace"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ErrorCaptureStackTrace) flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v37, v35, v32, v0 calleeKey="captureStackTrace" calleeName="Error.captureStackTrace"
// CHECK-NEXT: v39 = Builtin builtin=GlobalThis
// CHECK-NEXT: v40 = PropGet v39 key="console" [isFreeName]
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v41 key="log"
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v44 = String string="below show |"
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="framesOf" [isFreeName]
// CHECK-NEXT: v47 = PropGet v32 key="stack"
// CHECK-NEXT: v48 = Call v46, -, v47 calleeName="framesOf"
// CHECK-NEXT: v49 = Call v43, v41, v1, v44, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Undefined
// CHECK-NEXT: Return v50
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v51 = Convert v25 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v52 = Builtin builtin=GlobalThis
// CHECK-NEXT: v53 = PropGet v52 key="Error" [isFreeName]
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: PropSet v54, v51 key="stackTraceLimit" mode=Sloppy
// CHECK-NEXT: v56 = Builtin builtin=GlobalThis
// CHECK-NEXT: v57 = PropGet v56 key="console" [isFreeName]
// CHECK-NEXT: v58 = Convert v57 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v59 = PropGet v58 key="log"
// CHECK-NEXT: v60 = Convert v59 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v61 = String string="|"
// CHECK-NEXT: v62 = Builtin builtin=GlobalThis
// CHECK-NEXT: v63 = PropGet v62 key="framesOf" [isFreeName]
// CHECK-NEXT: v64 = Builtin builtin=GlobalThis
// CHECK-NEXT: v65 = PropGet v64 key="Error" [isFreeName]
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v67 = Construct v66 calleeName="Error"
// CHECK-NEXT: v68 = Convert v67 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v69 = PropGet v68 key="stack"
// CHECK-NEXT: v70 = Convert v69 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v71 = Call v63, -, v70 calleeName="framesOf"
// CHECK-NEXT: v72 = Call v60, v58, v1, v51, v61, v71 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v21:
// CHECK-NEXT: v73 = CatchException
// CHECK-NEXT: IteratorClose v21 completion=Throw
// CHECK-NEXT: Rethrow v73
// CHECK-NEXT: }
