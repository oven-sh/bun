import "../jsc-shell-functions.ts";

function invoke0(f) { return f(); }
function invoke1(f, a) { return f(a); }
function invoke2(f, a, b) { return f(a, b); }
function invoke3(f, a, b, c) { return f(a, b, c); }
function invoke4(f, a, b, c, d) { return f(a, b, c, d); }
function invoke5(f, a, b, c, d, e) { return f(a, b, c, d, e); }

const invokers = [
  f => invoke0(f),
  f => invoke1(f, 1),
  f => invoke2(f, 1, 2),
  f => invoke3(f, 1, 2, 3),
  f => invoke4(f, 1, 2, 3, 4),
  f => invoke5(f, 1, 2, 3, 4, 5),
];

const receiver = { tag: "receiver" };
const owner = { tag: "owner", method(a, b) { return ["method", this, a, b]; } };

function fewer(a) { return ["fewer", this, a]; }
function more(a, b, c, d, e, f, g) { return ["more", this, a, b, c, d, e, f, g]; }
function usesArguments() { return ["arguments", this, arguments.length, ...arguments]; }
function withProperty(a, b) { return ["property", this, a, b, withProperty.extra]; }
withProperty.extra = "extra";
async function asyncFunction(a, b) { return ["async", this, a, b]; }
function* generatorFunction(a, b) { yield ["generator", this, a, b]; }
function boundTarget(a, b, c, d, e, f) { return ["bound", this, a, b, c, d, e, f]; }

const revocable = Proxy.revocable(boundTarget, {});
revocable.revoke();
const otherGlobal = createGlobalObject();
const identity = result => result;
const firstYield = result => result.next().value;

const kinds = [
  ["arrow", (a, b) => ["arrow", a, b], identity],
  ["fewer parameters", fewer, identity],
  ["more parameters", more, identity],
  ["arguments", usesArguments, identity],
  ["added property", withProperty, identity],
  ["async", asyncFunction, identity],
  ["generator", generatorFunction, firstYield],
  ["method", owner.method, identity],
  ["bind this", boundTarget.bind(receiver), identity],
  ["bind one", boundTarget.bind(receiver, 1), identity],
  ["bind three", boundTarget.bind(receiver, 1, 2, 3), identity],
  ["bind four", boundTarget.bind(receiver, 1, 2, 3, 4), identity],
  ["bind arguments", usesArguments.bind(receiver, 1), identity],
  ["bind bound", boundTarget.bind(receiver, 1).bind(null, 2), identity],
  ["bind call", Function.prototype.call.bind(boundTarget), identity],
  ["host", Math.max, identity],
  ["bind host", Math.max.bind(null, 7), identity],
  ["bind map get", Map.prototype.get.bind(new Map([[1, 2]])), identity],
  ["proxy", new Proxy(boundTarget, {}), identity],
  ["proxy with trap", new Proxy(boundTarget, { apply(target, thisValue, list) { return ["trap", thisValue, target === boundTarget, ...list]; } }), identity],
  ["other global", otherGlobal.Function("a", "b", "return ['other', typeof this, a, b]"), identity],
  ["other global host", otherGlobal.Math.max, identity],
];

function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (value !== null && typeof value === "object") return value.tag ?? "object";
  return String(value);
}

async function describeCalls(kind, read, invoke) {
  return show(await read(invoke(kind)));
}

async function printCalleeKinds() {
  for (const [name, callee, read] of kinds) {
    for (let count = 0; count < invokers.length; count++) {
      const first = await describeCalls(callee, read, invokers[count]);
      let agrees = true;
      for (let round = 0; round < 20; round++)
        agrees &&= first === await describeCalls(callee, read, invokers[count]);
      console.log(name, count, first, agrees);
    }
  }
}

function describeError(error) {
  return error.name;
}

function printFailure(label, call) {
  try {
    console.log(label, "returned", show(call()));
  } catch (error) {
    console.log(label, describeError(error));
  }
}

function printNotCallable() {
  const values = [
    ["undefined", undefined],
    ["null", null],
    ["number", 1],
    ["string", "s"],
    ["object", {}],
    ["class", class K {}],
    ["revoked proxy", revocable.proxy],
  ];
  for (const [label, f] of values) {
    const o = { name: f };
    printFailure(label + " by value", () => { const result = f(); return result; });
    printFailure(label + " by value, one argument", () => { const result = f(1); return result; });
    printFailure(label + " by name", () => { const result = o.name(); return result; });
    printFailure(label + " by name, one argument", () => { const result = o.name(1); return result; });
    printFailure(label + " through parameter", () => invoke1(f, 1));
  }
}

const recursionKinds = [
  ["closure", f => f],
  ["added property", f => { const g = function () { return 1 + f(); }; g.extra = 1; return g; }],
  ["arguments", f => function () { return arguments.length + 1 + f(); }],
  ["bound", f => f.bind(null)],
  ["bound with arguments", f => f.bind(null, 1, 2)],
  ["bound call", f => Function.prototype.call.bind(f)],
  ["proxy", f => new Proxy(f, {})],
  ["proxy with trap", f => new Proxy(f, { apply(target, thisValue, list) { return 1 + Reflect.apply(target, thisValue, list); } })],
  ["host", f => () => 1 + Reflect.apply(f, undefined, [])],
  ["generator", f => () => (function* () { yield 1 + f(); })().next().value],
];

function printDeepRecursion() {
  for (const [label, wrap] of recursionKinds) {
    let step;
    const body = function () { return 1 + step(); };
    step = wrap(body);
    try {
      console.log(label, "returned", step());
    } catch (error) {
      console.log(label, error.name);
    }
    console.log(label, "afterwards", invoke1(x => x + 1, 1));
  }
}

await printCalleeKinds();
printNotCallable();
printDeepRecursion();
