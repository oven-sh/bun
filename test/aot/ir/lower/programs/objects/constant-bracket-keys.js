// RUN: lower
// OPTIONS: builtin-modules

function show(label, value) {
  console.log(label, typeof value === "function" ? "function" : JSON.stringify(value));
}

function made() {
  return {
    alpha: 1,
    beta: 2,
    gamma(step) { return this.alpha + step; },
    delta: 4,
    eta: 5,
    theta: 6,
    iota: 0,
    nested: { inner: { last: "deep" } },
    "with-a-dash": 7,
    "": 8,
    0: "zero",
    "-0": "minus zero",
    "1.5": "a fraction",
    Infinity: "endless",
    NaN: "none",
    "#hash": "no private name",
  };
}

for (const spelling of ["dotted", "bracketed"]) {
  const x = made();
  const y = { mu: "from mu", 0: "first" };
  if (spelling === "dotted") {
    show("read", x.alpha);
    x.beta = 20;
    show("stored", x.beta);
    show("called", x.gamma(1));
    show("deleted", delete x.delta && !("delta" in x));
    show("chained", x?.alpha);
    show("chained call", x?.gamma?.(2));
    show("chain that stops", (void 0)?.alpha);
    x.eta += 3;
    x.theta++;
    x.iota ||= 4;
    x.iota &&= x.iota + 1;
    x.kappa ??= "new";
    show("compound", [x.eta, x.theta, x.iota, x.kappa]);
    show("typeof", typeof x.missing);
    [x.lambda] = ["from an array"];
    ({ mu: x.nu } = y);
    for (x.xi in y) break;
    show("targets", [x.lambda, x.nu, x.xi]);
    show("nested", x.nested.inner.last);
    show("length", ["a", "b"].length + "abc".length);
    show("prototype", Object.getPrototypeOf(new (function Made() {})()).constructor.name);
  } else {
    show("read", x["alpha"]);
    x["beta"] = 20;
    show("stored", x["beta"]);
    show("called", x["gamma"](1));
    show("deleted", delete x["delta"] && !("delta" in x));
    show("chained", x?.["alpha"]);
    show("chained call", x?.["gamma"]?.(2));
    show("chain that stops", (void 0)?.["alpha"]);
    x["eta"] += 3;
    x["theta"]++;
    x["iota"] ||= 4;
    x["iota"] &&= x["iota"] + 1;
    x["kappa"] ??= "new";
    show("compound", [x["eta"], x["theta"], x["iota"], x["kappa"]]);
    show("typeof", typeof x["missing"]);
    [x["lambda"]] = ["from an array"];
    ({ mu: x["nu"] } = y);
    for (x["xi"] in y) break;
    show("targets", [x["lambda"], x["nu"], x["xi"]]);
    show("nested", x["nested"][`inner`][("last")]);
    show("length", ["a", "b"]["length"] + "abc"["length"]);
    show("prototype", Object["getPrototypeOf"](new (function Made() {})())["constructor"]["name"]);
  }
}

const odd = made();
show("a dash", odd["with-a-dash"]);
show("the empty name", odd[""]);
show("an index", [odd["0"], ["first"]["0"], "text"["1"]]);
show("like a number", [odd["-0"], odd["1.5"], odd["Infinity"], odd["NaN"]]);
show("typed arrays", [new Uint8Array(2)["-0"], new Uint8Array(2)["1.5"], new Uint8Array(2)["Infinity"], new Uint8Array(2)["0"]]);
show("no private name", odd["#hash"]);

class Counter {
  #hash = "private";
  static ["made"] = 0;
  ["count"] = 1;
  get ["twice"]() { return this["count"] * 2; }
  read() { return [this.#hash, this["#hash"], this["count"], this["twice"], Counter["made"]]; }
}
show("a class", new Counter().read());

function Shape() {}
Shape["prototype"].area = function () { return 12; };
Shape["prototype"]["sides"] = function () { return 4; };
show("methods added to the prototype", [new Shape().area(), new Shape().sides()]);

function order() {
  const seen = [];
  const object = () => (seen.push("object"), { key: 0 });
  const value = () => (seen.push("value"), 1);
  object()["key"] = value();
  object()["key"] += value();
  return seen;
}
show("order", order());

function thrown(run) {
  try { return run(); } catch (error) { return error.constructor.name; }
}
show("of undefined", [thrown(() => (void 0)["alpha"]), thrown(() => null["alpha"]), thrown(() => { (void 0)["alpha"] = 1; }), thrown(() => ({})["alpha"]())]);
show("the receiver", { name: "receiver", who() { return this.name; } }["who"]());
show("the receiver in parentheses", ({ name: "kept", who() { return this.name; } }["who"])());
show("super", new (class extends Shape { area() { return super["area"]() + 1; } })().area());
show("globals", [typeof globalThis["Array"], typeof globalThis["Object"]["keys"], typeof Math["max"], JSON["stringify"]([1])]);

// GENERATED: show Counter twice read area
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = String string="function"
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = NarrowByTest v1, v10
// CHECK-NEXT: v12 = Builtin builtin=JSON
// CHECK-NEXT: v13 = PropGet v12 key="stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12, v11 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = Call v6, v4, v0, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName, IsNamedByComputedKey] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_1]] field=1
// CHECK-NEXT: v3 = PropGet v0 key="#hash"
// CHECK-NEXT: v4 = PropGet v0 key="count"
// CHECK-NEXT: v5 = PropGet v0 key="twice"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="Counter"
// CHECK-NEXT: v8 = PropGet v7 key="made"
// CHECK-NEXT: v9 = NewArray v2, v3, v4, v5, v8 contents=anything
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_5]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="area"
// CHECK-NEXT: v4 = Call v3, v0 calleeName="super.area"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
