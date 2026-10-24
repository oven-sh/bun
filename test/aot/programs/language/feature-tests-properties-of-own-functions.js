// Feature tests that polyfills (core-js, es6-sham) run when they load, on function objects of the program: the name of a function expression, and `length`, `name` and `prototype` defined anew. Function.prototype is only read. Each answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("the name of a function expression", () => function foo() {}.name === "foo");
attempt("names given by the place", () => {
  const inConstant = function () {};
  const arrow = () => {};
  const holder = { member: function () {}, method() {}, get got() { return 1; } };
  return [inConstant.name, arrow.name, holder.member.name, holder.method.name, Object.getOwnPropertyDescriptor(holder, "got").get.name, (function () {}).name === "", class Named {}.name].join();
});
attempt("name is an own property that can be configured", () => {
  const descriptor = Object.getOwnPropertyDescriptor(function something() {}, "name");
  return [descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable].join();
});

attempt("length defined anew", () => Object.defineProperty(function () {}, "length", { value: 8 }).length);
attempt("name defined anew", () => Object.defineProperty(function before() {}, "name", { value: "after", configurable: true }).name);
attempt("name defined on a function that has none", () => { const f = function () {}; delete f.name; return [Object.hasOwn(f, "name"), f.name === "", Object.defineProperty(f, "name", { value: "given", configurable: true }).name].join(); });
attempt("a name of a symbol's description, a getter, a setter", () => ["[iterator]", "get size", "set size"].map(name => Object.defineProperty(function () {}, "name", { value: name, configurable: true }).name).join());
attempt("prototype defined as a value that cannot be written", () => Object.defineProperty(function () {}, "prototype", { value: 42, writable: false }).prototype);
attempt("prototype made read-only", () => {
  function Made() {}
  const before = Made.prototype;
  Object.defineProperty(Made, "prototype", { writable: false });
  let outcome;
  try { Made.prototype = {}; outcome = "stored"; } catch (error) { outcome = error.constructor.name; }
  return [outcome, Made.prototype === before, new Made() instanceof Made].join();
});
attempt("prototype set to undefined", () => { const f = function () {}; f.prototype = undefined; return [f.prototype, Object.getPrototypeOf(new f()) === Object.prototype].join(); });
attempt("a store to name and length does nothing or throws", () => {
  const f = function named(a, b) {};
  const outcomes = [];
  for (const key of ["name", "length"]) { try { f[key] = 9; outcomes.push("stored"); } catch (error) { outcomes.push(error.constructor.name); } }
  return [outcomes, f.name, f.length].join();
});
attempt("what was defined is what callers see", () => {
  const f = Object.defineProperty(Object.defineProperty(function (a) { return a; }, "length", { value: 3 }), "name", { value: "wrapped", configurable: true });
  return [f.bind(null).name, f.bind(null, 1).length, f(7), String(f).includes("wrapped")].join();
});
