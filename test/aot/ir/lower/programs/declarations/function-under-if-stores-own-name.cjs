// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.cjs
// A function declared as the body of `if` in sloppy code is in a block of its own (Annex B.3.3). Its name in that block is an ordinary variable: the function can store to it, the store stays for the next call, each evaluation of the `if` has a variable of its own, and the `var` of the same name around it keeps the function. Plain Bun's transpiler declares no such `var`, so there nothing can call the function: the expected output follows ECMAScript.
function storesOwnName(a) {
  if (a) function f() { f = 1; return f; }
  return [typeof f, f(), typeof f, f()];
}
console.log(storesOwnName(true));

function keepsTheStore(a) {
  if (a) function f() { const before = typeof f; f = "stored"; return before; }
  return [f(), f()];
}
console.log(keepsTheStore(true));

function underElse(a) {
  if (a) ; else function f() { f = 2; return f; }
  return typeof f === "function" ? f() : typeof f;
}
console.log(underElse(false), underElse(true));

function oneVariablePerEvaluation() {
  const made = [];
  for (var i = 0; i < 2; i++) {
    if (i >= 0) function f(value) { if (value !== undefined) f = value; return f; }
    made.push(f);
  }
  const [first, second] = made;
  const before = [first() === first, second() === second, first === second];
  first("only the first");
  return [...before, first(), second() === second];
}
console.log(oneVariablePerEvaluation());

function storedByAnInnerFunction(a) {
  if (a) function f() { (() => { f = "inner"; })(); return f; }
  return f();
}
console.log(storedByAnInnerFunction(true));

function storedByEvaluatedText(a) {
  if (a) function f() { eval("f = 'text'"); return f; }
  return f();
}
console.log(storedByEvaluatedText(true));

function incremented(a) {
  if (a) function f() { f = typeof f === "number" ? f + 1 : 0; return f; }
  return [f(), f(), f()];
}
console.log(incremented(true));

function neverStored(a) {
  if (a) function f() { return f; }
  return f() === f;
}
console.log(neverStored(true));

if (typeof module === "object") function atTheTop() { atTheTop = "top"; return atTheTop; }
console.log(atTheTop(), typeof atTheTop);

const expression = function named() { named = 1; return typeof named; };
console.log(expression());
{
  function inABlock() { inABlock = "block"; return inABlock; }
}
console.log(inABlock(), typeof inABlock);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: storesOwnName storedByEvaluatedText atTheTop named
// CHECK-LABEL: function {{*}}name="storesOwnName"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"|[[f_1]]> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = ToBoolean v0
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = NewObject layout=[[L_3]]
// CHECK-NEXT: v5 = NewClosure v4 function=[[f_4]]
// CHECK-NEXT: PutEnvironmentField v4, v5 layout=[[L_3]]
// CHECK-NEXT: v7 = GetEnvironmentField v4 layout=[[L_3]]
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5(v1)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: v10 = TypeOf v9
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11 calleeName="f"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v14 = TypeOf v11
// CHECK-NEXT: v15 = Call v11 calleeName="f"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v17 = NewArray v10, v13, v14, v16 contents=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"|[[f_1]]
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"|[[f_1]]> flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storedByEvaluatedText"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 captures=[{type=env [[L_5]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=boolean flags=[IsExpected]}] results=[{type=undefined|null|[[f_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = NewObject -, v1 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v4 = GetEnvironmentField v3 layout=[[L_8]]
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = NewObject layout=[[L_9]]
// CHECK-NEXT: v8 = NewClosure v0, v3, v7 function=[[f_10]]
// CHECK-NEXT: PutEnvironmentField v7, v8 layout=[[L_9]]
// CHECK-NEXT: v10 = GetEnvironmentField v7 layout=[[L_9]]
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5(v2)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13 calleeName="f"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="atTheTop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_11]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[f_12]] flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="top"
// CHECK-NEXT: PutEnvironmentField v0, v1 layout=[[L_11]]
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = TypeOf v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
