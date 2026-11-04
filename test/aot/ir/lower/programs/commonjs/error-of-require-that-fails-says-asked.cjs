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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
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
// CHECK-NEXT: b2() role=CatchHandler:
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
// CHECK-NEXT: v30 = PropGet v29 key="split"
// CHECK-NEXT: v31 = String string="\n"
// CHECK-NEXT: v32 = Call v30, v29, v31 calleeKey="split" calleeName="split"
// CHECK-NEXT: v33 = Integer
// CHECK-NEXT: v34 = ElemGet v32, v33
// CHECK-NEXT: v35 = Call v16, v14, v0, v17, v19, v20, v21, v22, v23, v24, v25, v26, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = NewArray v0 contents=anything
// CHECK-NEXT: v2 = PropGet v1 key="join"
// CHECK-NEXT: v3 = String string=""
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="join" calleeName="join"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
