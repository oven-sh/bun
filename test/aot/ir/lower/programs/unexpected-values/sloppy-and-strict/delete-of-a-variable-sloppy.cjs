// RUN: lower
// OPTIONS: builtin-modules

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

globalThis.removable = "a member of the global object";

var written = {
  local: function () {
    var local = 1;
    return [delete local, typeof local];
  },
  parameter: function (parameter) {
    return [delete parameter, typeof parameter];
  },
  parameterThenUsed: function (parameter) {
    delete parameter;
    return parameter + 1;
  },
  aLet: function () {
    let local = 1;
    return [delete local, typeof local];
  },
  aFunction: function () {
    function local() {}
    return [delete local, typeof local];
  },
  operands: function () {
    return [delete arguments, typeof arguments];
  },
  absent: function () {
    return delete neverDeclaredAnywhere;
  },
  memberOfTheGlobalObject: function () {
    globalThis.removable = "made again";
    return [delete removable, typeof removable];
  },
  madeByAnAssignment: function () {
    madeHere = 1;
    return [delete madeHere, typeof madeHere];
  },
  declaredByEval: function () {
    eval("var declared = 1");
    return [delete declared, typeof declared];
  },
  declaredByEvalOverAParameter: function (parameter) {
    eval("var parameter = 'declared again'");
    return [delete parameter, parameter];
  },
  catchParameter: function () {
    try {
      throw 1;
    } catch (caught) {
      return [delete caught, typeof caught];
    }
  },
  aBuiltIn: function () {
    return [delete undefined, delete NaN, delete Infinity];
  },
  inParentheses: function () {
    var local = 1;
    return [delete (local), typeof local];
  },
};

var texts = {
  local: "function () { var local = 1; return [delete local, typeof local]; }",
  parameter: "function (parameter) { return [delete parameter, typeof parameter]; }",
  parameterThenUsed: "function (parameter) { delete parameter; return parameter + 1; }",
  aLet: "function () { let local = 1; return [delete local, typeof local]; }",
  aFunction: "function () { function local() {} return [delete local, typeof local]; }",
  operands: "function () { return [delete arguments, typeof arguments]; }",
  absent: "function () { return delete neverDeclaredAnywhere; }",
  memberOfTheGlobalObject: "function () { globalThis.removable = \"made again\"; return [delete removable, typeof removable]; }",
  madeByAnAssignment: "function () { madeHere = 1; return [delete madeHere, typeof madeHere]; }",
  declaredByEval: "function () { eval(\"var declared = 1\"); return [delete declared, typeof declared]; }",
  declaredByEvalOverAParameter: "function (parameter) { eval(\"var parameter = 'declared again'\"); return [delete parameter, parameter]; }",
  catchParameter: "function () { try { throw 1; } catch (caught) { return [delete caught, typeof caught]; } }",
  aBuiltIn: "function () { return [delete undefined, delete NaN, delete Infinity]; }",
  inParentheses: "function () { var local = 1; return [delete (local), typeof local]; }",
};

var ways = {
  "direct eval": function (text) {
    return eval("(" + text + ")");
  },
  "indirect eval": function (text) {
    return (0, eval)("(" + text + ")");
  },
  "new Function": function (text) {
    return new Function("return (" + text + ")")();
  },
};

function drive(label, callee) {
  attempt(label, callee.bind(null, 1));
  attempt(label + " once more", callee.bind(null, 1));
}

Object.keys(written).forEach(function (name) {
  drive("written " + name, written[name], name);
});
Object.keys(ways).forEach(function (way) {
  Object.keys(texts).forEach(function (name) {
    var made;
    try {
      made = ways[way](texts[name]);
    } catch (error) {
      console.log(way + " " + name, "is refused:", error.constructor.name);
      return;
    }
    drive(way + " " + name, made, name);
  });
});

// GENERATED: drive madeByAnAssignment declaredByEvalOverAParameter
// CHECK-LABEL: function {{*}}name="drive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = PropGet v1 key="bind"
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Call v3, v1, v4, v5 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v7 = Call v2, -, v0, v6 calleeName="attempt"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = String string=" once more"
// CHECK-NEXT: v10 = Add v0, v9
// CHECK-NEXT: v11 = PropGet v1 key="bind"
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Call v11, v1, v12, v13 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v15 = Call v8, -, v10, v14 calleeName="attempt"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="madeByAnAssignment"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: PropSet v1, v0 key="madeHere" mode=Sloppy [isFreeName]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropDelete v3 key="madeHere" mode=Sloppy [isFreeName]
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="madeHere" [isFreeName, isForTypeOf]
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = NewArray v4, v7 contents=anything
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declaredByEvalOverAParameter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: int[0, 4294967295], v4: anything, v5: Array):
// CHECK-NEXT: v6 = CreateMappedArguments v1, v3, v5, v4
// CHECK-NEXT: v7 = ToThis v0
// CHECK-NEXT: v8 = NewObject layout=[[L_2]]
// CHECK-NEXT: v9 = Null
// CHECK-NEXT: SetLiteralPrototype v8, v9
// CHECK-NEXT: v11 = FinishObject v8
// CHECK-NEXT: v12 = NewObject -, v6 layout=[[L_3]] fields=[0]
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
// CHECK-NEXT: v26 = String string="var parameter = 'declared again'"
// CHECK-NEXT: v27 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v28 = StrictEq v25, v27
// CHECK-NEXT: Branch v28 -> taken b7(), notTaken b8(| 0)
// CHECK-NEXT: b7():
// CHECK-NEXT: v29 = DirectEval v26, v7, v2, v6, v11, v12 evalScope=e1
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = Call v30, v17, v26 calleeName="eval"
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = Boolean
// CHECK-NEXT: v34 = GetMappedArgument v6
// CHECK-NEXT: v35 = NewArray v33, v34 contents=anything
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
