// RUN: lower
// OPTIONS: builtin-modules

// Function declarations in switch cases loops and try blocks strict.
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

function inACase(key) {
  switch (key) {
    case 1:
      function chosen() {
        return "declared under case 1";
      }
      break;
    case 2:
      return typeof chosen === "function" ? chosen() : typeof chosen;
  }
  return typeof chosen;
}
function inALoop(rounds) {
  var made = [];
  for (var i = 0; i < rounds; i++) {
    function counter() {
      return i;
    }
    made.push(counter);
  }
  return [made.length, made.length > 1 && made[0] === made[1], typeof counter, made.map(each => each())];
}
function inALoopWithLet(rounds) {
  var made = [];
  for (let i = 0; i < rounds; i++) {
    function counter() {
      return i;
    }
    made.push(counter);
  }
  return [made.map(each => each()), typeof counter === "function" ? counter() : typeof counter];
}
function inTry(fail) {
  try {
    if (fail) throw new Error("before the declaration is reached");
    function made() {
      return "made in try";
    }
  } catch (error) {
    return typeof made;
  }
  return typeof made;
}
function inCatch() {
  try {
    throw 1;
  } catch (error) {
    function handler() {
      return typeof error;
    }
  }
  return typeof handler === "function" ? handler() : typeof handler;
}
function inFinally() {
  try {
  } finally {
    function last() {
      return "made in finally";
    }
  }
  return typeof last;
}
function underALabel() {
  block: {
    function labelled() {}
    break block;
  }
  return typeof labelled;
}
function deep() {
  {
    {
      {
        function buried() {
          return "buried";
        }
      }
    }
    var halfway = typeof buried;
  }
  return [halfway, typeof buried];
}
function generatorInABlock() {
  {
    function* made() {}
  }
  return typeof made;
}
function asyncInABlock() {
  {
    async function made() {}
  }
  return typeof made;
}
function classInABlock() {
  {
    class Made {}
  }
  return typeof Made;
}

attempt("inACase(1)", () => inACase(1));
attempt("inACase(2)", () => inACase(2));
attempt("inACase(3)", () => inACase(3));
attempt("inALoop(0)", () => inALoop(0));
attempt("inALoop(3)", () => inALoop(3));
attempt("inALoopWithLet(0)", () => inALoopWithLet(0));
attempt("inALoopWithLet(3)", () => inALoopWithLet(3));
attempt("inTry(false)", () => inTry(false));
attempt("inTry(true)", () => inTry(true));
var uses = { inCatch, inFinally, underALabel, deep, generatorInABlock, asyncInABlock, classInABlock };
for (var name in uses) attempt(name, uses[name]);

export {};

// GENERATED: inFinally classInABlock made handler Made
// CHECK-LABEL: function {{*}}name="inFinally"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b5(v0, v1)
// CHECK-NEXT: b4() role=CleanupHandler:
// CHECK-NEXT: v2 = CatchValue
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: Jump -> next b5(v3, v2)
// CHECK-NEXT: b5(v4, v5):
// CHECK-NEXT: v6 = NewClosure function=[[f_2]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Switch v4 cases=[0] -> case b6(), otherwise b8()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="last" [isFreeName, isForTypeOf]
// CHECK-NEXT: v10 = TypeOf v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: b8():
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="classInABlock"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_4]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_5]]
// CHECK-NEXT: v2 = FinishClass v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v2 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="Made" [isFreeName, isForTypeOf]
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="made in try"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="handler"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
