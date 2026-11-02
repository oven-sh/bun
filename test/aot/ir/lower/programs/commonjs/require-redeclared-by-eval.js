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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: undefined|null|string, v6: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = CreateMappedArguments v2, v4, v6, v5
// CHECK-NEXT: v8 = ToThis v1
// CHECK-NEXT: v9 = NewObject layout=[[L_4]]
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: SetLiteralPrototype v9, v10
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = NewObject -, v7 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v14 = ScopeHasBinding v12 key="eval"
// CHECK-NEXT: Branch v14 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b4(v12, v15)
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Jump -> next b4(v16, v16)
// CHECK-NEXT: b4(v17, v18):
// CHECK-NEXT: v19 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = PropGet v20 key="eval"
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="eval" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v25)
// CHECK-NEXT: b7(v26):
// CHECK-NEXT: v27 = GetMappedArgument v7
// CHECK-NEXT: v28 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v29 = StrictEq v26, v28
// CHECK-NEXT: Branch v29 -> taken b8(), notTaken b9(| 0)
// CHECK-NEXT: b8():
// CHECK-NEXT: v30 = DirectEval v27, v8, v3, v7, v0, v12, v13 evalScope=e3
// CHECK-NEXT: Jump -> next b10(v30)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = Call v31, v18, v27 calleeName="eval"
// CHECK-NEXT: Jump -> next b10(v32)
// CHECK-NEXT: b10(v33):
// CHECK-NEXT: v34 = NewClosure v0, v12 function=[[f_6]]
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
