// Functions of text made at run time are called and constructed with too few, enough and too many arguments, by the program, by each other and by built-ins, at the end of the stack and between collections.
const vm = require("node:vm");
const nothing = String(Date.now()).slice(99);
const text = (parameters, body) => new Function(...parameters, body + nothing);
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
const say = (name, ...values) =>
  console.log(
    name + ":",
    values.map(value => (typeof value === "string" ? value : (JSON.stringify(value) ?? String(value)))).join(" "),
  );

const three = text(["a", "b", "c"], "return [a, b, c, arguments.length];");
say(
  "arguments",
  three(),
  three(1),
  three(1, 2),
  three(1, 2, 3),
  three(1, 2, 3, 4),
  three(...[1, 2, 3, 4, 5, 6, 7, 8, 9]),
);
const none = text([], "return arguments.length;");
say("no parameters", none(), none(1), none(1, 2, 3, 4, 5, 6));
const defaults = text(["a = 1", "b = a + 1", "...rest"], "return [a, b, rest];");
say("defaults and rest", defaults(), defaults(5), defaults(5, undefined, 7), defaults(undefined, 2, 3, 4));
const mapped = text(
  ["a", "b"],
  "arguments[0] = 'first'; arguments[1] = 'second'; b = 'b'; return [a, b, arguments[0], arguments[1], arguments.length];",
);
say("mapped arguments", mapped(), mapped(1), mapped(1, 2), mapped(1, 2, 3));

const variables = text(
  ["n"],
  "var " +
    Array.from({ length: 40 }, (_, i) => "v" + i).join(", ") +
    "; const before = [v0, v17, v39]; v0 = n; v39 = n + 1; let late = v0 + v39; return [before, late];",
);
say("variables start undefined", variables(1), variables(2));
const wide = text(
  ["f"],
  "return f(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20) + f(f(1, 2), f(3), f());",
);
say(
  "many temporaries",
  wide(text([], "let sum = 0; for (let i = 0; i < arguments.length; i++) sum += arguments[i]; return sum;")),
);

const counters = text(
  ["start"],
  "let count = start; return { up() { return ++count; }, down: () => --count, read: function () { return count; } };",
);
const [first, second] = [counters(10), counters(20)];
say("scopes", first.up(), first.up(), second.down(), first.read(), second.read());
say(
  "this",
  text([], "return typeof this;")(),
  text([], "'use strict'; return typeof this;")(),
  text([], "return this.tag;").call({ tag: "given" }),
  text([], "return typeof this;").call(5),
);

const Point = text(
  ["x", "y"],
  "this.x = x; this.y = y; this.target = new.target === undefined ? 'none' : new.target.name;",
);
say(
  "constructed",
  new Point(),
  new Point(1),
  new Point(1, 2),
  new Point(1, 2, 3),
  Reflect.construct(Point, [4], Array) instanceof Array,
);
const classes = text(
  [],
  "class Base { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } } class Derived extends Base { constructor(a) { super(a, 2); this.c = new.target.name; } } class Implicit extends Derived {} return { Base, Derived, Implicit };",
)();
say(
  "classes",
  new classes.Base(),
  new classes.Base(1, 2).sum(),
  new classes.Derived(3),
  new classes.Implicit(),
  attempt(() => classes.Base()),
);

const generator = text(
  ["n"],
  "return (function* (from, to) { for (let i = from; i < (to ?? from + n); i++) yield i; });",
)(3);
say("generators", [...generator(1)], [...generator(1, 3)], [...generator()]);
const asynchronous = text(
  [],
  "return { plain: async function (a, b) { return [a, await b]; }, arrow: async a => a, each: async function* (n) { for (let i = 0; i < n; i++) yield i; } };",
)();

const double = text(["value", "index"], "return value * 2 + (index === undefined ? 100 : 0);");
say(
  "built-ins call",
  [1, 2, 3].map(double),
  [3, 1, 2].sort(text(["a", "b"], "return a - b;")),
  "a-b".replace(/[a-z]/g, text(["found"], "return found.toUpperCase();")),
);
say(
  "call, apply, bind",
  double.call(null, 1),
  double.apply(null, [1, 0]),
  double.bind(null, 2)(),
  double.bind(null, 2, 0)(),
  Reflect.apply(double, null, []),
);
say(
  "revived",
  JSON.parse('{"a":1,"b":[2,3]}', text(["key", "value"], "return typeof value === 'number' ? value + 1 : value;")),
);
const accessors = Object.defineProperty({ held: 1 }, "twice", {
  get: text([], "return this.held * 2;"),
  set: text(["value"], "this.held = value;"),
});
accessors.twice = 21;
say(
  "accessors",
  accessors.twice,
  `${{ toString: text([], "return 'as text';") }}`,
  +{ valueOf: text([], "return 7;") },
);
const proxy = new Proxy(
  {},
  { get: text(["target", "key"], "return 'read ' + String(key);"), has: text([], "return true;") },
);
say("proxy", proxy.anything, "x" in proxy);

const descend = text(["self", "depth"], "return self(self, depth + 1) + 1;");
say(
  "end of the stack",
  attempt(() => descend(descend, 0)),
  attempt(() => descend(descend, 0)),
  three(1, 2, 3),
);
const descendWithFewer = text(["self", "a", "b", "c", "d"], "return self(self) + 1;");
say(
  "end of the stack with arguments missing",
  attempt(() => descendWithFewer(descendWithFewer)),
  three(1),
);
const Nested = text(["Self"], "this.inner = new Self(Self);");
say(
  "end of the stack in a constructor",
  attempt(() => new Nested(Nested)),
  new Point(1, 2),
);

const pair = text(["a", "b"], "return { a, b, list: [a, b] };");
const build = text(
  ["pair", "n"],
  "let sum = 0, kept = []; for (let i = 0; i < n; i++) { const made = pair(i, String(i)); sum += made.list[0] + made.b.length; if (i % 5000 === 0) kept.push(made); } return [sum, kept.length, kept[kept.length - 1].b];",
);
const collected = [];
for (let round = 0; round < 4; round++) {
  collected.push(build(pair, 60000));
  Bun.gc(true);
  collected.push(pair(round).a, new Point(round).x);
}
say("between collections", collected);

const direct = (function (outer) {
  return eval("(function (a, b) { return [outer, a, b]; })" + nothing);
})("outer");
say("eval", direct(), direct(1, 2, 3), (0, eval)("(function (a) { return typeof outer + a; })" + nothing)("!"));
const foreign = vm.runInNewContext("(function (a, b) { return [a, b, arguments.length].join(); })" + nothing);
say(
  "another realm",
  foreign(),
  foreign(1, 2),
  foreign(1, 2, 3),
  new (vm.runInNewContext("(function F(a) { this.a = a; })" + nothing))(1).a,
);

Promise.all([
  asynchronous.plain(),
  asynchronous.plain(1, Promise.resolve(2)),
  asynchronous.arrow(),
  Array.fromAsync(asynchronous.each(3)),
  Promise.resolve(4).then(double),
]).then(values => say("asynchronous", values));
