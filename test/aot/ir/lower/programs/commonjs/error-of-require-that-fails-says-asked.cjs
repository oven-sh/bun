// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100150 2
// DIAGNOSTIC: TS100151 2
// DIAGNOSTIC: TS100152 2

// FILE: error-of-require-that-fails-says-asked.cjs
// A `require` and a `require.resolve` that find nothing fail with errors of their own: the kind, and behind `node:` also the code and the words. It makes no difference whether the name is written or put together.
const show = (label, run) => {
  try {
    console.log(label, "answers", typeof run());
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", error.code, "|", error.importKind, "|", error.specifier, "|", String(error.message).split("\n")[0]);
  }
};
const joined = text => [text].join("");
show("require, written, a package", () => require("no-such-package"));
show("require, joined, a package", () => require(joined("no-such-package")));
show("require, written, a file", () => require("./no-such-file.js"));
show("require, joined, a file", () => require(joined("./no-such-file.js")));
show("require, written, node:", () => require("node:no-such-module"));
show("require, joined, node:", () => require(joined("node:no-such-module")));
show("resolve, written, a package", () => require.resolve("no-such-package"));
show("resolve, joined, a package", () => require.resolve(joined("no-such-package")));
show("resolve, written, a file", () => require.resolve("./no-such-file.js"));
show("resolve, joined, a file", () => require.resolve(joined("./no-such-file.js")));
show("resolve, written, node:", () => require.resolve("node:no-such-module"));
show("resolve, joined, node:", () => require.resolve(joined("node:no-such-module")));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show joined
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="answers"
// CHECK-NEXT: v8 = Call v1 calleeName="run"
// CHECK-NEXT: v9 = TypeOf v8
// CHECK-NEXT: v10 = Call v6, v4, v0, v7, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="|"
// CHECK-NEXT: v18 = PropGet v11 key="constructor"
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = String string="|"
// CHECK-NEXT: v21 = PropGet v11 key="code"
// CHECK-NEXT: v22 = String string="|"
// CHECK-NEXT: v23 = PropGet v11 key="importKind"
// CHECK-NEXT: v24 = String string="|"
// CHECK-NEXT: v25 = PropGet v11 key="specifier"
// CHECK-NEXT: v26 = String string="|"
// CHECK-NEXT: v27 = Builtin builtin=String
// CHECK-NEXT: v28 = PropGet v11 key="message"
// CHECK-NEXT: v29 = Call v27, -, v28 calleeName="String"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="split"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v33 = String string="\n"
// CHECK-NEXT: v34 = Call v32, v30, v33 calleeKey="split" calleeName="split"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v36 = Integer
// CHECK-NEXT: v37 = ElemGet v35, v36
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v16, v14, v0, v17, v19, v20, v21, v22, v23, v24, v25, v26, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewArray v0 contents=anything
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="join"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string=""
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
