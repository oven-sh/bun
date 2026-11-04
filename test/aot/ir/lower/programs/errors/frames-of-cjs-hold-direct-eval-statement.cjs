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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
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
// CHECK-NEXT: v14 = PropGet v13 key="stack"
// CHECK-NEXT: v15 = Call v9, -, v14 calleeName="framesOf"
// CHECK-NEXT: v16 = Call v6, v4, v1, v7, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Data data=[[d_1]]
// CHECK-NEXT: v18 = IteratorOpen v17
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v20 = IteratorResume v18
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Branch v21 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = Integer integer=10
// CHECK-NEXT: PropSet v25, v26 key="stackTraceLimit" mode=Sloppy
// CHECK-NEXT: v28 = Data data=[[d_2]]
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="Error" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="captureStackTrace"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ErrorCaptureStackTrace) flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v33, v31, v28, v0 calleeKey="captureStackTrace" calleeName="Error.captureStackTrace"
// CHECK-NEXT: v35 = Builtin builtin=GlobalThis
// CHECK-NEXT: v36 = PropGet v35 key="console" [isFreeName]
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="log"
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v40 = String string="below show |"
// CHECK-NEXT: v41 = Builtin builtin=GlobalThis
// CHECK-NEXT: v42 = PropGet v41 key="framesOf" [isFreeName]
// CHECK-NEXT: v43 = PropGet v28 key="stack"
// CHECK-NEXT: v44 = Call v42, -, v43 calleeName="framesOf"
// CHECK-NEXT: v45 = Call v39, v37, v1, v40, v44 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: Return v46
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v47 = Builtin builtin=GlobalThis
// CHECK-NEXT: v48 = PropGet v47 key="Error" [isFreeName]
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: PropSet v49, v22 key="stackTraceLimit" mode=Sloppy
// CHECK-NEXT: v51 = Builtin builtin=GlobalThis
// CHECK-NEXT: v52 = PropGet v51 key="console" [isFreeName]
// CHECK-NEXT: v53 = Convert v52 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v54 = PropGet v53 key="log"
// CHECK-NEXT: v55 = Convert v54 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v56 = String string="|"
// CHECK-NEXT: v57 = Builtin builtin=GlobalThis
// CHECK-NEXT: v58 = PropGet v57 key="framesOf" [isFreeName]
// CHECK-NEXT: v59 = Builtin builtin=GlobalThis
// CHECK-NEXT: v60 = PropGet v59 key="Error" [isFreeName]
// CHECK-NEXT: v61 = Convert v60 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v62 = Construct v61 calleeName="Error"
// CHECK-NEXT: v63 = PropGet v62 key="stack"
// CHECK-NEXT: v64 = Call v58, -, v63 calleeName="framesOf"
// CHECK-NEXT: v65 = Call v55, v53, v1, v22, v56, v64 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v18:
// CHECK-NEXT: v66 = CatchException
// CHECK-NEXT: IteratorClose v18 completion=Throw
// CHECK-NEXT: Rethrow v66
// CHECK-NEXT: }
