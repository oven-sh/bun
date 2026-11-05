// RUN: lower
// OPTIONS: builtin-modules

// Reserved words of strict code as names sloppy.
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

var written = {
  let: function (value) {
    var let = value;
    return let + 1;
  },
  static: function (value) {
    var static = value;
    return static.length;
  },
  yield: function (value) {
    var yield = value;
    return yield * 2;
  },
  several: function (value) {
    var implements = value, interface = value, package = value, private = value, protected = value, public = value;
    return [implements, interface, package, private, protected, public].length;
  },
  asParameters: function (let, static, yield) {
    return [let, static, yield];
  },
  asAFunctionName: function () {
    function static() {
      return "called";
    }
    return static();
  },
  asALabel: function () {
    yield: for (;;) break yield;
    return "left the loop";
  },
  letWithAnIndex: function (value) {
    var let = [value];
    return [let[0], let.length];
  },
};

var texts = {
  let: "function (value) { var let = value; return let + 1; }",
  static: "function (value) { var static = value; return static.length; }",
  yield: "function (value) { var yield = value; return yield * 2; }",
  several: "function (value) { var implements = value, interface = value, package = value, private = value, protected = value, public = value; return [implements, interface, package, private, protected, public].length; }",
  asParameters: "function (let, static, yield) { return [let, static, yield]; }",
  asAFunctionName: "function () { function static() { return \"called\"; } return static(); }",
  asALabel: "function () { yield: for (;;) break yield; return \"left the loop\"; }",
  letWithAnIndex: "function (value) { var let = [value]; return [let[0], let.length]; }",
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
  attempt(label + "(1)", callee.bind(null, 1, 2, 3));
  attempt(label + "('ab')", callee.bind(null, "ab"));
  attempt(label + "()", callee);
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

// GENERATED: attempt drive yield asParameters
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
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
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v2 calleeName="run"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|number|string|bigint|object flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v9, -, v11 calleeName="show"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v7, v5, v1, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="threw"
// CHECK-NEXT: v22 = PropGet v15 key="constructor"
// CHECK-NEXT: v23 = PropGet v22 key="name"
// CHECK-NEXT: v24 = Call v20, v18, v1, v21, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="drive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="(1)"
// CHECK-NEXT: v6 = Add v1, v5
// CHECK-NEXT: v7 = PropGet v2 key="bind"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Null
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = Integer integer=3
// CHECK-NEXT: v13 = Call v8, v2, v9, v10, v11, v12 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v4, -, v6, v14 calleeName="attempt"
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="('ab')"
// CHECK-NEXT: v19 = Add v1, v18
// CHECK-NEXT: v20 = PropGet v2 key="bind"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v22 = Null
// CHECK-NEXT: v23 = String string="ab"
// CHECK-NEXT: v24 = Call v21, v2, v22, v23 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v26 = Call v17, -, v19, v25 calleeName="attempt"
// CHECK-NEXT: v27 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v29 = String string="()"
// CHECK-NEXT: v30 = Add v1, v29
// CHECK-NEXT: v31 = Call v28, -, v30, v2 calleeName="attempt"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="yield"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asParameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewArray v0, v1, v2 contents=anything
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
