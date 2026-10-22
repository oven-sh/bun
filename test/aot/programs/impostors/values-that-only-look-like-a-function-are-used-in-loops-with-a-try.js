import vm from "node:vm";

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];
const atFirst = new Map();
let same = 0;

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  if (log.length) line += ", log " + log.join(" ");
  if (!atFirst.has(label)) console.log(label + ":", line);
  else if (atFirst.get(label) === line) same++;
  else console.log("changed, " + label + ":", line);
  atFirst.set(label, line);
}

function callIt(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f(1, 2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function callItIfThere(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f?.(1, 2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function buildIt(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(new f(1, 2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function callItAsAMethod(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      const holder = { name: "holder", f };
      out.push(holder.f(1, 2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function handItToMap(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push([1, 2].map(f));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function throughCall(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f.call("self", 1, 2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function throughApply(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f.apply("self", [1, 2]));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function throughBind(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f.bind("self", 1)(2));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function throughReflect(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(Reflect.apply(f, "self", [1, 2]));
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function tagWithIt(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f`a${1}b`);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function testAnInstance(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push({} instanceof f);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function lengthOf(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f.length);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function nameOf(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(f.name);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function prototypeOf(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(typeof f.prototype);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function kindOf(f) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    try {
      out.push(typeof f);
    } catch (error) {
      out.push(error.constructor.name);
    }
  }
  return out;
}

function plus(a, b) {
  return a + b;
}

function minus(a, b) {
  return a - b;
}

function first(a) {
  return a;
}

function honest(round) {
  console.log(round, "callIt", show(callIt(plus)), show(callIt(minus)), show(callIt(first)), show(callIt(function (a, b) { return [a, b]; })));
  console.log(round, "callItIfThere", show(callItIfThere(plus)), show(callItIfThere(minus)), show(callItIfThere(first)), show(callItIfThere(function (a, b) { return [a, b]; })));
  console.log(round, "buildIt", show(buildIt(plus)), show(buildIt(minus)), show(buildIt(first)), show(buildIt(function (a, b) { this.a = a; this.b = b; })));
  console.log(round, "callItAsAMethod", show(callItAsAMethod(plus)), show(callItAsAMethod(minus)), show(callItAsAMethod(first)), show(callItAsAMethod(function () { return this.name; })));
  console.log(round, "handItToMap", show(handItToMap(plus)), show(handItToMap(minus)), show(handItToMap(first)), show(handItToMap(function (a, b) { return [a, b]; })));
  console.log(round, "throughCall", show(throughCall(plus)), show(throughCall(minus)), show(throughCall(first)), show(throughCall(function () { return String(this); })));
  console.log(round, "throughApply", show(throughApply(plus)), show(throughApply(minus)), show(throughApply(first)), show(throughApply(function () { return String(this); })));
  console.log(round, "throughBind", show(throughBind(plus)), show(throughBind(minus)), show(throughBind(first)), show(throughBind(function () { return String(this); })));
  console.log(round, "throughReflect", show(throughReflect(plus)), show(throughReflect(minus)), show(throughReflect(first)), show(throughReflect(function () { return String(this); })));
  console.log(round, "tagWithIt", show(tagWithIt(plus)), show(tagWithIt(minus)), show(tagWithIt(first)), show(tagWithIt(function (strings) { return strings.raw; })));
  console.log(round, "testAnInstance", show(testAnInstance(plus)), show(testAnInstance(minus)), show(testAnInstance(first)), show(testAnInstance(Object)));
  console.log(round, "lengthOf", show(lengthOf(plus)), show(lengthOf(minus)), show(lengthOf(first)), show(lengthOf(function () {})));
  console.log(round, "nameOf", show(nameOf(plus)), show(nameOf(minus)), show(nameOf(first)), show(nameOf(function () {})));
  console.log(round, "prototypeOf", show(prototypeOf(plus)), show(prototypeOf(minus)), show(prototypeOf(first)), show(prototypeOf(function () {})));
  console.log(round, "kindOf", show(kindOf(plus)), show(kindOf(minus)), show(kindOf(first)), show(kindOf(function () {})));
}

const impostors = [
  ["a callable proxy", () => new Proxy(plus, { apply: (target, self, list) => (log.push("apply"), "trapped"), construct: () => (log.push("construct"), {}) })],
  ["a revoked proxy", () => { const { proxy, revoke } = Proxy.revocable(plus, {}); revoke(); return proxy; }],
  ["a bound function", () => plus.bind(null, 10)],
  ["a class", () => class { constructor(a) { this.a = a; } }],
  ["an arrow function", () => (a, b) => a * b],
  ["an async function", () => async (a, b) => a + b],
  ["a generator function", () => function* (a) { yield a; }],
  ["a native function", () => Math.max],
  ["a native constructor", () => String],
  ["an object with call, apply and bind", () => ({ call: () => "its own call", apply: () => "its own apply", bind: () => () => "its own bind" })],
  ["a function with its own call", () => Object.assign(function (a, b) { return a + b; }, { call: () => "its own call" })],
  ["a function without a prototype chain", () => Object.setPrototypeOf(function (a, b) { return a + b; }, null)],
  ["a function of another realm", () => vm.runInNewContext("(function (a, b) { return a + b; })")],
  ["a string", () => "plus"],
  ["undefined", () => undefined],
];

function meetTheImpostors() {
  for (const [name, make] of impostors) {
    attempt("callIt, " + name, () => callIt(make()));
    attempt("callItIfThere, " + name, () => callItIfThere(make()));
    attempt("buildIt, " + name, () => buildIt(make()));
    attempt("callItAsAMethod, " + name, () => callItAsAMethod(make()));
    attempt("handItToMap, " + name, () => handItToMap(make()));
    attempt("throughCall, " + name, () => throughCall(make()));
    attempt("throughApply, " + name, () => throughApply(make()));
    attempt("throughBind, " + name, () => throughBind(make()));
    attempt("throughReflect, " + name, () => throughReflect(make()));
    attempt("tagWithIt, " + name, () => tagWithIt(make()));
    attempt("testAnInstance, " + name, () => testAnInstance(make()));
    attempt("lengthOf, " + name, () => lengthOf(make()));
    attempt("nameOf, " + name, () => nameOf(make()));
    attempt("prototypeOf, " + name, () => prototypeOf(make()));
    attempt("kindOf, " + name, () => kindOf(make()));
  }
}

meetTheImpostors();
honest("after the impostors came first");
for (let i = 0; i < 2000; i++) {
  const f = i % 2 ? plus : minus;
  callIt(f);
  callItIfThere(f);
  buildIt(f);
  callItAsAMethod(f);
  handItToMap(f);
  throughCall(f);
  throughApply(f);
  throughBind(f);
  throughReflect(f);
  tagWithIt(f);
  testAnInstance(f);
  lengthOf(f);
  nameOf(f);
  prototypeOf(f);
  kindOf(f);
}
meetTheImpostors();
console.log("the same after 2000 honest calls:", same);
honest("at the end");
