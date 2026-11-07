// RUN: lower
// OPTIONS: builtin-modules

// Arguments and parameters by kind of function sloppy.
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

function declared(a) {
  arguments[0] = "stored";
  return a;
}
var expression = function (a) {
  arguments[0] = "stored";
  return a;
};
var holder = {
  method(a) {
    arguments[0] = "stored";
    return a;
  },
  property: function (a) {
    arguments[0] = "stored";
    return a;
  },
  seen: undefined,
  set setter(a) {
    arguments[0] = "stored";
    this.seen = a;
  },
  *generator(a) {
    arguments[0] = "stored";
    yield a;
  },
  async asynchronous(a) {
    arguments[0] = "stored";
    return a;
  },
  ["comp" + "uted"](a) {
    arguments[0] = "stored";
    return a;
  },
};
class Klass {
  constructor(a) {
    arguments[0] = "stored";
    this.seen = a;
  }
  method(a) {
    arguments[0] = "stored";
    return a;
  }
  static method(a) {
    arguments[0] = "stored";
    return a;
  }
  field = function (a) {
    arguments[0] = "stored";
    return a;
  };
}
function Constructor(a) {
  arguments[0] = "stored";
  this.seen = a;
}
function* generator(a) {
  var before = a;
  arguments[0] = "stored";
  yield [before, a];
  arguments[0] = "stored after a yield";
  yield a;
  a = "assigned after a yield";
  yield arguments[0];
}
async function asynchronous(a) {
  arguments[0] = "stored";
  var before = a;
  await null;
  arguments[0] = "stored after an await";
  return [before, a];
}
async function* asynchronousGenerator(a) {
  arguments[0] = "stored";
  yield a;
  await null;
  a = "assigned after an await";
  yield arguments[0];
}
function withAnArrow(a) {
  return (() => {
    arguments[0] = "stored";
    return a;
  })();
}
function withAnInnerFunction(a) {
  return (function () {
    arguments[0] = "stored";
    return a;
  })("inner");
}
var madeOfText = new Function("a", "arguments[0] = 'stored'; return a;");
var madeOfStrictText = new Function("a", "'use strict'; arguments[0] = 'stored'; return a;");
var bound = declared.bind(null);
var boundWithAnOperand = declared.bind(null, "bound operand");

attempt("declared", () => declared(1));
attempt("expression", () => expression(1));
attempt("method", () => holder.method(1));
attempt("property", () => holder.property(1));
attempt("setter", () => ((holder.setter = 1), holder.seen));
attempt("generator method", () => holder.generator(1).next().value);
attempt("computed method", () => holder.computed(1));
attempt("class constructor", () => new Klass(1).seen);
attempt("class method", () => new Klass(1).method(1));
attempt("static method", () => Klass.method(1));
attempt("a function in a field", () => new Klass(1).field(1));
attempt("constructor function", () => new Constructor(1).seen);
attempt("generator", () => Array.from(generator(1)));
attempt("with an arrow", () => withAnArrow(1));
attempt("with an inner function", () => withAnInnerFunction(1));
attempt("made of text", () => madeOfText(1));
attempt("made of strict text", () => madeOfStrictText(1));
attempt("bound", () => bound(1));
attempt("bound with an operand", () => boundWithAnOperand(1));
var sum = 0;
for (var i = 0; i < 2000; i++) sum += String(declared(i)).length + String(holder.method(i)).length + String(Klass.method(i)).length;
console.log("sum", sum);
(async function () {
  console.log("async method", show(await holder.asynchronous(1)));
  console.log("async", show(await asynchronous(1)));
  var seen = [];
  for await (var item of asynchronousGenerator(1)) seen.push(item);
  console.log("async generator", show(seen));
})();

// GENERATED: asynchronousGenerator Klass setter computed
// CHECK-LABEL: function {{*}}name="asynchronousGenerator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, IsSloppy, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|AsyncGenerator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: int[0, 4294967295], v3: undefined|null|string, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateMappedArguments v1, v2, v4, v3
// CHECK-NEXT: v6 = ToThis v0
// CHECK-NEXT: InitialYield v5
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = String string="stored"
// CHECK-NEXT: ElemSet v5, v8, v9 mode=Sloppy
// CHECK-NEXT: v11 = GetMappedArgument v5
// CHECK-NEXT: v12 = Await v11, v5
// CHECK-NEXT: v13 = Yield v12, v5
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Switch v15 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v14
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = Null
// CHECK-NEXT: v17 = Await v16, v5
// CHECK-NEXT: v18 = String string="assigned after an await"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: SetMappedArgument v5, v19
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = ElemGet v5, v21
// CHECK-NEXT: v23 = Await v22, v5
// CHECK-NEXT: v24 = Yield v23, v5
// CHECK-NEXT: v25 = ResultAt v24
// CHECK-NEXT: v26 = ResultAt v24 index=1
// CHECK-NEXT: Switch v26 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v25
// CHECK-NEXT: b7():
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Klass"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v5 = NewObject v4 layout=[[L_1]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = CallDirect v6 function=[[f_2]]
// CHECK-NEXT: v8 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = String string="stored"
// CHECK-NEXT: ElemSet v8, v9, v10
// CHECK-NEXT: v12 = Convert v6 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v2 key="seen"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = TypeTest v14 testedType=object
// CHECK-NEXT: Branch v15 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsSloppy, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: int[0, 4294967295], v3: anything, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateMappedArguments v1, v2, v4, v3
// CHECK-NEXT: v6 = ToThis v0
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = String string="stored"
// CHECK-NEXT: ElemSet v5, v7, v8 mode=Sloppy
// CHECK-NEXT: v10 = Convert v6 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = GetMappedArgument v5
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined flags=[IsExpected]}
// CHECK-NEXT: PropSet v10, v12 key="seen" mode=Sloppy
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest, IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateMappedArguments v0, v1, v3, v2
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = String string="stored"
// CHECK-NEXT: ElemSet v4, v5, v6 mode=Sloppy
// CHECK-NEXT: v8 = GetMappedArgument v4
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
