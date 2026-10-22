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

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function note(what, value) {
  log.push(what);
  return value;
}

function holding(f) {
  return { get f() { log.push("get f"); return f; } };
}

function* counted() {
  log.push("first item");
  yield 1;
  log.push("second item");
  yield 2;
}

const forms = [
  ["f(a, b)", f => f(note("a"), note("b"))],
  ["f?.(a)", f => f?.(note("a"))],
  ["new f(a)", f => new f(note("a"))],
  ["new f", f => new f],
  ["holder.f(a)", f => holding(f).f(note("a"))],
  ["holder.f?.(a)", f => holding(f).f?.(note("a"))],
  ["holder?.f(a)", f => holding(f)?.f(note("a"))],
  ["holder[key](a)", f => holding(f)[note("key", "f")](note("a"))],
  ["new holder.f(a)", f => new (holding(f).f)(note("a"))],
  ["f(...list)", f => f(...note("list", [1, 2]))],
  ["f(...generator)", f => f(...counted())],
  ["new f(...generator)", f => new f(...counted())],
  ["f`${a}`", f => f`x${note("a")}y`],
  ["holder.f`${a}`", f => holding(f).f`x${note("a")}y`],
  ["f.call(self, a)", f => f.call(note("self"), note("a"))],
  ["f.apply(self, list)", f => f.apply(note("self"), note("list", [1]))],
  ["f.bind(self)", f => typeof f.bind(note("self"))],
  ["Reflect.apply(f, self, list)", f => Reflect.apply(f, note("self"), note("list", [1]))],
  ["Reflect.construct(f, list)", f => Reflect.construct(f, note("list", [1]))],
  ["(callee, f)(a)", f => (note("callee"), f)(note("a"))],
  ["f(a)(b)", f => f(note("a"))(note("b"))],
  ["f(g(a))", f => f(f(note("a")))],
  ["f(a) || b", f => f(note("a")) || note("b")],
  ["[f(a), b]", f => [f(note("a")), note("b")]],
  ["a + f(b)", f => note("a", 1) + f(note("b"))],
  ["f(a, throws)", f => f(note("a"), (() => { throw new RangeError("from an argument"); })())],
  ["list.map(f)", f => note("list", [1, 2]).map(f)],
  ["empty.map(f)", f => note("list", []).map(f)],
  ["value instanceof f", f => note("value", {}) instanceof f],
];

const values = [
  ["a function", () => function (value) { log.push("called"); return value; }],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a string", () => "text"],
  ["a number", () => 5],
  ["an object", () => ({})],
  ["a class", () => class { constructor() { log.push("constructed"); } }],
  ["an arrow function", () => value => (log.push("called"), value)],
];

for (const [form, run] of forms) {
  for (const [name, make] of values) attempt(form + " with " + name, () => run(make()));
}
