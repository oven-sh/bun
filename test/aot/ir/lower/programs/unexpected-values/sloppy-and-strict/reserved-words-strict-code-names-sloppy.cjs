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
// CHECK-LABEL: function {{*}}name="drive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = String string="(1)"
// CHECK-NEXT: v4 = Add v0, v3
// CHECK-NEXT: v5 = PropGet v1 key="bind"
// CHECK-NEXT: v6 = Null
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Integer integer=3
// CHECK-NEXT: v10 = Call v5, v1, v6, v7, v8, v9 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v11 = Call v2, -, v4, v10 calleeName="attempt"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = String string="('ab')"
// CHECK-NEXT: v14 = Add v0, v13
// CHECK-NEXT: v15 = PropGet v1 key="bind"
// CHECK-NEXT: v16 = Null
// CHECK-NEXT: v17 = String string="ab"
// CHECK-NEXT: v18 = Call v15, v1, v16, v17 calleeKey="bind" calleeName="callee.bind"
// CHECK-NEXT: v19 = Call v12, -, v14, v18 calleeName="attempt"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v21 = String string="()"
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Call v20, -, v22, v1 calleeName="attempt"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="yield"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v0, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asParameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = NewArray v0, v1, v2 contents=anything
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
