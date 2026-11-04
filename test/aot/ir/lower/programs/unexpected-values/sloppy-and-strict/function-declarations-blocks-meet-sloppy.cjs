// RUN: lower
// OPTIONS: builtin-modules

// Function declarations in blocks meet names that are taken sloppy.
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

function parameterOfTheSameName(taken) {
  {
    function taken() {
      return "the function";
    }
  }
  return typeof taken;
}
function parameterUsedLikeANumber(taken) {
  {
    function taken() {}
  }
  return taken + 1;
}
function parameterUsedLikeAList(taken) {
  if (taken.length > 1) {
    function taken() {}
  }
  return taken.length;
}
function letOfTheSameName() {
  let taken = "the let";
  {
    function taken() {}
  }
  return typeof taken;
}
function constInAnOuterBlock() {
  {
    const taken = "the const";
    {
      function taken() {}
    }
    var seen = typeof taken;
  }
  return [seen, typeof taken];
}
function varOfTheSameName() {
  var taken = "the var";
  {
    function taken() {}
  }
  return typeof taken;
}
function varDeclaredLater() {
  {
    function taken() {}
  }
  var taken;
  return typeof taken;
}
function catchParameter() {
  try {
    throw "thrown";
  } catch (taken) {
    {
      function taken() {}
    }
    var seen = typeof taken;
  }
  return [seen, typeof taken];
}
function loopVariable() {
  var kinds = [];
  for (let taken = 0; taken < 2; taken++) {
    {
      function taken() {}
    }
    kinds.push(typeof taken);
  }
  return [kinds, typeof taken];
}
function functionOfTheSameNameOutside() {
  function taken() {
    return "outside";
  }
  {
    function taken() {
      return "inside";
    }
  }
  return taken();
}
function ownName() {
  {
    function ownName() {
      return "inside";
    }
  }
  return ownName === globalThis.keptOwnName;
}
globalThis.keptOwnName = ownName;

var uses = { parameterOfTheSameName, parameterUsedLikeANumber, letOfTheSameName, constInAnOuterBlock, varOfTheSameName, varDeclaredLater, catchParameter, loopVariable, functionOfTheSameNameOutside, ownName };
for (var name in uses) attempt(name, uses[name].bind(null, 1));
attempt("parameterUsedLikeAList, short", () => parameterUsedLikeAList([1]));
attempt("parameterUsedLikeAList, long", () => parameterUsedLikeAList([1, 2]));
var sum = 0;
for (var i = 0; i < 2000; i++) sum += parameterUsedLikeAList([i]);
console.log("sum", sum);
attempt("parameterUsedLikeAList, long, after 2000 short ones", () => parameterUsedLikeAList([1, 2, 3]));
delete globalThis.keptOwnName;

// GENERATED: attempt parameterUsedLikeANumber parameterUsedLikeAList constInAnOuterBlock
// CHECK-LABEL: function {{*}}name="parameterUsedLikeAList"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Greater v1, v2
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = PropGet v0 key="length"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v8 = Call v1 calleeName="run"
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="show"
// CHECK-NEXT: v10 = Call v6, v4, v0, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="threw"
// CHECK-NEXT: v18 = PropGet v11 key="constructor"
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Call v16, v14, v0, v17, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameterUsedLikeANumber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constInAnOuterBlock"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = String string="the const"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = String string="string"
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="taken" [isFreeName, isForTypeOf]
// CHECK-NEXT: v6 = TypeOf v5
// CHECK-NEXT: v7 = NewArray v3, v6 contents=anything
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
