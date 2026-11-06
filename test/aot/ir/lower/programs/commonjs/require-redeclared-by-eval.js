// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.js one.cjs
// DIAGNOSTIC: TS100150 1
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// A sloppy direct eval can declare `var require` or `var module` in the function that calls it, and the calls after it reach the new value. Without such a declaration they load the file they name. Plain Bun rewrites `module.require("..")` and `require?.("..")` to a load when it transpiles, whatever the names mean at run time, so the output is stored.
const ownRequire = "var require = name => 'own: ' + name";

function load(source) {
  eval(source);
  return require("./one.cjs");
}
console.log(load("").n, load("var other = 1").n);
console.log(load(ownRequire));

function loadThroughModule(source) {
  eval(source);
  return module.require("./one.cjs");
}
console.log(loadThroughModule("").n);
console.log(loadThroughModule("var module = { owner: 'own', require(name) { return this.owner + ': ' + name; } }"));

function resolve(source) {
  eval(source);
  return require.resolve("./one.cjs");
}
console.log(typeof resolve(""));
console.log(resolve("var require = { resolve: name => 'own: ' + name }"));

function loadLater(source) {
  eval(source);
  return () => require("./one.cjs");
}
console.log(loadLater("")().n);
console.log(loadLater(ownRequire)());

function declareInArgument() {
  const loaded = require((eval(ownRequire), "./one.cjs"));
  return [loaded.n, require("./one.cjs")];
}
console.log(declareInArgument().join());

function loadComputed(source, name) {
  eval(source);
  return require(name);
}
console.log(loadComputed("", "./one.cjs").n);
console.log(loadComputed(ownRequire, "./one.cjs"));

function loadIfPresent(source) {
  eval(source);
  return require?.("./one.cjs");
}
console.log(loadIfPresent("").n);
console.log(loadIfPresent("var require = null"));

function loadMissing(source) {
  eval(source);
  try {
    return require("./missing.cjs");
  } catch (error) {
    return error.code;
  }
}
console.log(loadMissing(""));
console.log(loadMissing(ownRequire));

// FILE: one.cjs
exports.n = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: loadLater
// CHECK-LABEL: function {{*}}name="loadLater"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: int[0, 4294967295], v4: undefined|null|string, v5: Array):
// CHECK-NEXT: v6 = CreateMappedArguments v1, v3, v5, v4
// CHECK-NEXT: v7 = ToThis v0
// CHECK-NEXT: v8 = NewObject layout=[[L_1]]
// CHECK-NEXT: v9 = Null
// CHECK-NEXT: SetLiteralPrototype v8, v9
// CHECK-NEXT: v11 = FinishObject v8
// CHECK-NEXT: v12 = NewObject -, v6 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v13 = ScopeHasBinding v11 key="eval"
// CHECK-NEXT: Branch v13 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Jump -> next b3(v11, v14)
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b3(v15, v15)
// CHECK-NEXT: b3(v16, v17):
// CHECK-NEXT: v18 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = PropGet v19 key="eval"
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="eval" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v24)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = GetMappedArgument v6
// CHECK-NEXT: v27 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v28 = StrictEq v25, v27
// CHECK-NEXT: Branch v28 -> taken b7(), notTaken b8(| 0)
// CHECK-NEXT: b7():
// CHECK-NEXT: v29 = DirectEval v26, v7, v2, v6, v11, v12 evalScope=e4
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = Call v30, v17, v26 calleeName="eval"
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = NewClosure v11 function=[[f_3]]
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
