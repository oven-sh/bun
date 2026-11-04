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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = ToBoolean v0
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(v1)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewObject layout=[[L_1]]
// CHECK-NEXT: v5 = NewClosure v4 function=[[f_2]]
// CHECK-NEXT: PutEnvironmentField v4, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = GetEnvironmentField v4 layout=[[L_1]]
// CHECK-NEXT: Jump -> next b2(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = TypeOf v8
// CHECK-NEXT: v10 = Call v8 calleeName="f"
// CHECK-NEXT: v11 = TypeOf v8
// CHECK-NEXT: v12 = Call v8 calleeName="f"
// CHECK-NEXT: v13 = NewArray v9, v10, v11, v12 contents=anything
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storedByEvaluatedText"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = NewObject -, v0 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v3 = GetEnvironmentField v2 layout=[[L_3]]
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(v1)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = NewObject layout=[[L_4]]
// CHECK-NEXT: v7 = NewClosure v2, v6 function=[[f_5]]
// CHECK-NEXT: PutEnvironmentField v6, v7 layout=[[L_4]]
// CHECK-NEXT: v9 = GetEnvironmentField v6 layout=[[L_4]]
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = Call v10 calleeName="f"
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="atTheTop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="top"
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_6]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = TypeOf v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
