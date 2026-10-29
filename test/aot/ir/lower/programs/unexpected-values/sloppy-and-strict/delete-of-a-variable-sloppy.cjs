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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v2 key="bind"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v7 = Null
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Call v6, v2, v7, v8 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v4, -, v1, v10 calleeName="attempt"
// CHECK-NEXT: v12 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v14 = String string=" once more"
// CHECK-NEXT: v15 = Add v1, v14
// CHECK-NEXT: v16 = PropGet v2 key="bind"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v18 = Null
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Call v17, v2, v18, v19 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v13, -, v15, v21 calleeName="attempt"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="madeByAnAssignment"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: PropSet v1, v0 key="madeHere" mode=Sloppy [isFreeName]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropDelete v3 key="madeHere" mode=Sloppy [isFreeName]
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="madeHere" [isFreeName, isForTypeOf]
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = NewArray v4, v7 contents=undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declaredByEvalOverAParameter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: anything, v6: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = CreateMappedArguments v2, v4, v6, v5
// CHECK-NEXT: v8 = ToThis v1
// CHECK-NEXT: v9 = NewObject layout=[[L_6]]
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: SetLiteralPrototype v9, v10
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = NewObject -, v7 layout=[[L_7]] fields=[0]
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
// CHECK-NEXT: v27 = String string="var parameter = 'declared again'"
// CHECK-NEXT: v28 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v29 = StrictEq v26, v28
// CHECK-NEXT: Branch v29 -> taken b8(), notTaken b9(| 0)
// CHECK-NEXT: b8():
// CHECK-NEXT: v30 = DirectEval v27, v8, v3, v7, v0, v12, v13 evalScope=e1
// CHECK-NEXT: Jump -> next b10(v30)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = Call v31, v18, v27 calleeName="eval"
// CHECK-NEXT: Jump -> next b10(v32)
// CHECK-NEXT: b10(v33):
// CHECK-NEXT: v34 = Boolean
// CHECK-NEXT: v35 = GetMappedArgument v7
// CHECK-NEXT: v36 = NewArray v34, v35 contents=anything
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
