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
