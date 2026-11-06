// RUN: lower
// OPTIONS: builtin-modules

// Eval changes the kind of a local between two uses sloppy.
console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function size(list, text) {
  var before = list.length;
  eval(text);
  return [before, list.length];
}
function total(list, text) {
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    sum += list[i];
    if (i === 0) eval(text);
  }
  return sum;
}
function next(n, text) {
  var before = n + 1;
  eval(text);
  return [before, n + 1];
}
function counted(n, text) {
  var count = 0;
  for (var i = 0; i < n; i++) {
    count++;
    eval(text);
  }
  return count;
}
function called(callee, text) {
  var before = callee();
  eval(text);
  return [before, callee()];
}
function member(object, text) {
  var before = object.a;
  eval(text);
  return [before, object.a];
}
function afterACheck(value, text) {
  if (typeof value !== "number") return "no number";
  eval(text);
  return value * 2;
}
function aConst(text) {
  const fixed = 1;
  eval(text);
  return fixed;
}
function throughAnArrow(list, text) {
  var run = () => eval(text);
  run();
  return list.length;
}
function throughAnAlias(list, text) {
  var alias = eval;
  alias(text);
  return list.length;
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += size([i], "")[1] + total([i, 1], "") + next(i, "")[1] + member({ a: i }, "")[1] + afterACheck(i, "");
console.log("sum", sum);
attempt("size", () => size([1, 2, 3], "list = 'ab'"));
attempt("size, null", () => size([1, 2, 3], "list = null"));
attempt("total", () => total([1, 2, 3], "list = [10, 20, 30, 40]"));
attempt("total, a text", () => total([1, 2, 3], "list = 'abc'"));
attempt("total, the index", () => total([1, 2, 3], "i = 1.5"));
attempt("next", () => next(1, "n = '1'"));
attempt("next, a bigint", () => next(1, "n = 1n"));
attempt("counted", () => counted(3, "n = 1"));
attempt("counted, a text", () => counted(3, "n = '2'"));
attempt("counted, the counter", () => counted(3, "count = 'x'"));
attempt("called", () => called(() => "honest", "callee = () => 'replaced'"));
attempt("called, no function", () => called(() => "honest", "callee = 5"));
attempt("member", () => member({ a: 1 }, "object = { get a() { return 'from a getter'; } }"));
attempt("member, changed in place", () => member({ a: 1 }, "delete object.a"));
attempt("after a check", () => afterACheck(1, "value = 'ab'"));
attempt("a const", () => aConst("fixed = 2"));
attempt("through an arrow", () => throughAnArrow([1, 2, 3], "list = 'ab'"));
attempt("through an alias", () => throughAnAlias([1, 2, 3], "globalThis.list = 'ab'"));
delete globalThis.list;
attempt("honest again", () => [size([1], ""), total([1, 2], ""), next(1, "")]);

// GENERATED: aConst throughAnArrow
// CHECK-LABEL: function {{*}}name="aConst"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: undefined|null|string, v6: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = CreateMappedArguments v2, v4, v6, v5
// CHECK-NEXT: v8 = ToThis v1
// CHECK-NEXT: v9 = NewObject layout=[[L_3]]
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: SetLiteralPrototype v9, v10
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = NewObject -, v7 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Convert v14 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v16 = ScopeHasBinding v12 key="eval"
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b4(v12, v17)
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b4(v18, v18)
// CHECK-NEXT: b4(v19, v20):
// CHECK-NEXT: v21 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v21 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v22):
// CHECK-NEXT: v23 = PropGet v22 key="eval"
// CHECK-NEXT: Jump -> next b7(v23)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="eval" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v27)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: v29 = GetMappedArgument v7
// CHECK-NEXT: v30 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v31 = StrictEq v28, v30
// CHECK-NEXT: Branch v31 -> taken b8(), notTaken b9(| 0)
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = DirectEval v29, v8, v3, v7, v15, v0, v12, v13 evalScope=e7
// CHECK-NEXT: Jump -> next b10(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: v34 = Call v33, v20, v29 calleeName="eval"
// CHECK-NEXT: Jump -> next b10(v34)
// CHECK-NEXT: b10(v35):
// CHECK-NEXT: v36 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="throughAnArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: undefined|null|Array<number>, v6: undefined|null|string, v7: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = CreateMappedArguments v2, v4, v7, v5, v6
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = ToThis v1
// CHECK-NEXT: v11 = NewObject -, v9, v8 layout=[[L_6]] fields=[0, 1]
// CHECK-NEXT: v12 = NewClosure v0, v11, v10, v3, v8 function=[[f_7]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v11, v13 layout=[[L_6]]
// CHECK-NEXT: v15 = GetEnvironmentField v11 layout=[[L_6]]
// CHECK-NEXT: v16 = Call v15 calleeName="run"
// CHECK-NEXT: v17 = GetMappedArgument v8
// CHECK-NEXT: v18 = PropGet v17 key="length"
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
