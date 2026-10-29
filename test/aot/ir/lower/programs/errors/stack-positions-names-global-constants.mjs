// RUN: lower
// OPTIONS: builtin-modules

// FILE: stack-positions-names-global-constants.mjs
// @bun
// Each line: the frame under a conversion that stands behind `undefined`, `NaN` or `Infinity` in a text that runs as it is written: the engine reads each as a name.
function fail() {
  throw new Error("fail");
}
function pass() {}
function show(label, run) {
  try {
    run();
    console.log(label, "no error");
  } catch (error) {
    const frames = String(error.stack).split("\n").slice(1, 4);
    console.log(label, "|", frames.map(line => /:(\d+:\d+)\)?$/.exec(line)?.[1]).join(" < "));
  }
}
show("undefined", () => {
  pass(undefined, `${{ toString: () => fail() }}`);
});
show("Infinity", () => {
  pass(Infinity, `${{ toString: () => fail() }}`);
});
show("NaN", () => {
  pass(NaN, `${{ toString: () => fail() }}`);
});
show("a statement", () => {
  undefined;
  return `${{ toString: () => fail() }}`;
});
show("a local name", () => {
  const undefined = 1;
  pass(undefined, `${{ toString: () => fail() }}`);
});
show("void 0", () => {
  pass(void 0, `${{ toString: () => fail() }}`);
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: fail show
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Error" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="fail"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Error"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="no error"
// CHECK-NEXT: v9 = Call v7, v5, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=String
// CHECK-NEXT: v12 = PropGet v10 key="stack"
// CHECK-NEXT: v13 = Call v11, -, v12 calleeName="String"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="split"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="\n"
// CHECK-NEXT: v18 = Call v16, v14, v17 calleeKey="split" calleeName="split"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="slice"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Integer integer=4
// CHECK-NEXT: v24 = Call v21, v19, v22, v23 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="|"
// CHECK-NEXT: v32 = PropGet v25 key="map"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v34 = NewClosure function=[[f_4]]
// CHECK-NEXT: v35 = Call v33, v25, v34 calleeKey="map" calleeName="frames.map"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="join"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v39 = String string=" < "
// CHECK-NEXT: v40 = Call v38, v36, v39 calleeKey="join" calleeName="join"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v42 = Call v30, v28, v0, v31, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v43 = Undefined
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
