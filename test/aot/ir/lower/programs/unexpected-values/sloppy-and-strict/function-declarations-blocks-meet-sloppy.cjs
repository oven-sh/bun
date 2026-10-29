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
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v9 = Call v2 calleeName="run"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|number|string|bigint|object flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v8, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v7, v5, v1, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string="threw"
// CHECK-NEXT: v21 = PropGet v14 key="constructor"
// CHECK-NEXT: v22 = PropGet v21 key="name"
// CHECK-NEXT: v23 = Call v19, v17, v1, v20, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameterUsedLikeANumber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameterUsedLikeAList"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Greater v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constInAnOuterBlock"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = String string="the const"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|"the const" flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = TypeOf v2
// CHECK-NEXT: v6 = String string="string"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="taken" [isFreeName, isForTypeOf]
// CHECK-NEXT: v10 = TypeOf v9
// CHECK-NEXT: v11 = NewArray v7, v10 contents=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
