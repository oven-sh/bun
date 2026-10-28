class WithCause {
  cause = "a field";
}

class WithGetter {
  get cause() {
    return "an accessor of the class";
  }
}
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
export function makeError(m) {
  return new Error(m);
}
export function makeTypeError(m) {
  return new TypeError(m);
}
export function makeRangeError(m) {
  return new RangeError(m);
}
export function callError(m) {
  return Error(m);
}
export function makeWithCause(m, c) {
  return new Error(m, { cause: c });
}
export function makeOfAnything(m, o) {
  return new Error(m, o);
}
export function makeAggregate(m) {
  return new AggregateError([1], m);
}
function describe(e) {
  if (!(e instanceof Error))
    return "not an error: " + show(e);
  const own = Object.getOwnPropertyNames(e).filter((n) => n !== "stack" && n !== "line" && n !== "column" && n !== "sourceURL" && n !== "originalLine" && n !== "originalColumn");
  let out = Object.prototype.toString.call(e) + " " + e.name + " " + show(e.message) + " [" + own.join() + "]";
  for (const n of own) {
    const d = Object.getOwnPropertyDescriptor(e, n);
    out += " " + n + ":" + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + "=" + show(d.value);
  }
  return out + " proto " + Object.getPrototypeOf(e).constructor.name + " keys [" + Object.keys(e).join() + "] " + String(e) + " " + Error.isError(e);
}
for (let round = 0;round < 3; round++) {
  for (const m of ["", "m", "a longer message with \xE9 and \u65E5", cat("a ", "rope"), "x".repeat(300)]) {
    print(describe(makeError(m)));
    print(describe(makeTypeError(m)));
    print(describe(makeRangeError(m)));
    print(describe(callError(m)));
    print(describe(makeAggregate(m)));
  }
  for (const c of [undefined, null, 0, "c", {}, makeError("inner")])
    print(describe(makeWithCause("m", c)) + " has cause " + ("cause" in makeWithCause("m", c)));
}
print(describe(new Error));
print(describe(new Error(undefined)));
print(describe(new Error(null)));
print(describe(new Error(12)));
print(describe(new Error(-0)));
print(describe(new Error(1.5)));
print(describe(new Error(true)));
print(describe(new Error(10n)));
print(describe(new EvalError("e")) + " | " + describe(new ReferenceError("r")) + " | " + describe(new SyntaxError("s")) + " | " + describe(new URIError("u")));
print(describe(new EvalError) + " | " + describe(new ReferenceError) + " | " + describe(new SyntaxError) + " | " + describe(new URIError) + " | " + describe(new TypeError) + " | " + describe(new RangeError));
print(describe(Error()) + " | " + describe(Error(undefined)) + " | " + describe(Error("m", { cause: 1 })));
print(attempt(() => describe(new Error(Symbol("s")))));
print(attempt(() => describe(new TypeError(Symbol("s")))));
print(attempt(() => describe(Error(Symbol("s")))));
print(attempt(() => describe(makeOfAnything(Symbol("s"), undefined))));
const log = [];
const message = { toString() {
  log.push("toString");
  return "from toString";
}, valueOf() {
  log.push("valueOf");
  return "from valueOf";
} };
const options = new Proxy({ cause: "proxied" }, {
  has(t, k) {
    log.push("has " + String(k));
    return k in t;
  },
  get(t, k) {
    log.push("get " + String(k));
    return t[k];
  },
  getOwnPropertyDescriptor(t, k) {
    log.push("describe " + String(k));
    return Object.getOwnPropertyDescriptor(t, k);
  }
});
print(describe(makeOfAnything(message, options)) + " :: " + log.join());
log.length = 0;
print(describe(makeOfAnything({ [Symbol.toPrimitive](hint) {
  log.push("toPrimitive " + hint);
  return 5;
} }, { get cause() {
  log.push("getter");
  return;
} })) + " :: " + log.join());
log.length = 0;
print(attempt(() => describe(makeOfAnything({ toString() {
  log.push("throws");
  throw new RangeError("mine");
} }, { get cause() {
  log.push("getter");
  return 1;
} }))) + " :: " + log.join());
log.length = 0;
print(attempt(() => describe(makeOfAnything("m", { get cause() {
  log.push("getter throws");
  throw new EvalError("mine");
} }))) + " :: " + log.join());
print(attempt(() => describe(makeOfAnything({ toString() {
  return {};
}, valueOf() {
  return {};
} }, undefined))));
for (const o of [undefined, null, 1, "cause", true, Symbol.iterator, 1n, [], () => 1, { cause: undefined }, { other: 1 }, Object.create({ cause: "inherited" }), new Error("x", { cause: "of an error" })])
  print(describe(makeOfAnything("m", o)));
print(describe(makeOfAnything("m", new WithCause)) + " | " + describe(makeOfAnything("m", new WithGetter)));
print(describe(new Error("m", { cause: 1 }, "more", "and more")));
print(describe(Error("m", undefined, "more")));

class Mine extends Error {
  constructor(m) {
    super(m);
  }
}

class MineToo extends TypeError {
  kind = "mine";
}
print(describe(new Mine("m")) + " " + (new Mine("m") instanceof Mine) + " | " + describe(new MineToo("m")) + " " + (new MineToo("m") instanceof MineToo));
export function reflected(target) {
  return Reflect.construct(Error, ["m"], target);
}
print(describe(reflected(RangeError)) + " | " + describe(Reflect.construct(TypeError, ["m"], Mine)) + " | " + describe(reflected(Error)) + " | " + describe(reflected(Mine)));
{
  const Error = function(m) {
    this.shadowed = m;
  };
  print(show(new Error("m").shadowed));
}
print(show(makeError("a") === makeError("a")) + " " + show(makeError("a").message === makeError("a").message));
const kept = [];
for (let i = 0;i < 20000; i++) {
  const e = i & 1 ? makeError("n" + i) : makeTypeError("n" + i);
  if (i % 4000 === 1 || i % 4000 === 2)
    kept.push(e);
}
print(kept.map((e) => e.name + ":" + e.message + ":" + typeof e.stack).join());
globalThis.kept = [makeError, makeTypeError, makeRangeError, callError, makeWithCause, makeOfAnything, makeAggregate, reflected];
console.log("number");
