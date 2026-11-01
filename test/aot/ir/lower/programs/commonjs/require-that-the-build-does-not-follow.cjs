// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// What the build does not follow to a file finds the entry points and no other file of the executable: `require` in a property or bound, whatever the path, and a path with no constant part, whoever is called.
// `require` as the argument of a function that is called where it is written is followed: that one finds the file.
const other = require("./other.cjs");
const load = require;
function attempt(title, action) {
  try {
    console.log(title, action());
  } catch (error) {
    console.log(title, "threw", error.constructor.name + ":", String(error.message).split("'")[0].trim());
  }
}
const unknown = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST || "./other.cjs";
attempt("a parameter:", () => (r => r("./other.cjs") === other)(require));
attempt("a property:", () => ({ load: require }).load("./other.cjs") === other);
attempt("bound:", () => require.bind(null)("./other.cjs") === other);
attempt("bound, under a name:", () => {
  const bound = require.bind(null);
  return bound("./other.cjs") === other;
});
attempt("a variable that is stored to:", () => {
  let changing = require;
  changing = load;
  return changing("./other.cjs") === other;
});
attempt("apply with a list from elsewhere:", () => {
  const list = ["./other.cjs"];
  return require.apply(null, list) === other;
});
attempt("a path nobody knows:", () => require(unknown) === other);
attempt("a path nobody knows, another name:", () => load(unknown) === other);
attempt("a path nobody knows, module.require:", () => module.require(unknown) === other);
attempt("the entry point is found:", () => (r => r(__filename) === module.exports)(require));
attempt("a built-in module is found:", () => typeof (r => r("node:path"))(require).join);

// FILE: other.cjs
exports.tag = "other";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
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
// CHECK-NEXT: v7 = Call v1 calleeName="action"
// CHECK-NEXT: v8 = Call v6, v4, v0, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="threw"
// CHECK-NEXT: v16 = PropGet v9 key="constructor"
// CHECK-NEXT: v17 = PropGet v16 key="name"
// CHECK-NEXT: v18 = String string=":"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Builtin builtin=String
// CHECK-NEXT: v21 = PropGet v9 key="message"
// CHECK-NEXT: v22 = Call v20, -, v21 calleeName="String"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="split"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v26 = String string="'"
// CHECK-NEXT: v27 = Call v25, v23, v26 calleeKey="split" calleeName="split"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v29 = Integer
// CHECK-NEXT: v30 = ElemGet v28, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="trim"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v33, v31 calleeKey="trim" calleeName="trim"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v36 = Call v14, v12, v0, v15, v19, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
