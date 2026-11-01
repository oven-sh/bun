// Text made at run time stores on an object that a constant holds, reads elements of arrays and constructs, each as plain Bun does it.
const nothing = String(Date.now()).slice(99);
const text = (parameters, body) => new Function(...parameters, body + nothing);
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
};

// The object is read before the value is computed, and the name of a store in brackets is no expression that runs.
const log = [];
const note = (label, value) => (log.push(label), value);
console.log(
  text(
    ["note"],
    "const o = {}; o['first'] = note('a', 1); o.second = note('b', 2); o['third'] = o['first'] + note('c', 3); return JSON.stringify(o);",
  )(note),
  log.join(),
);
console.log(
  text(
    [],
    "const seen = []; const o = { set name(v) { seen.push('set ' + v); } }; o['name'] = (seen.push('value'), 5); const r = (o['name'] = 6); return seen.join() + ' ' + r;",
  )(),
);
console.log(
  attempt(text([], "o['name'] = f(); const o = {}; function f() { return 1; } return 'not reached';")),
  attempt(text([], "'use strict'; o.name = f(); const o = {}; function f() { throw new Error('the value ran'); }")),
  attempt(text([], "const o = null; o['name'] = f(); function f() { return 1; }")),
  attempt(text([], "const o = undefined; o.name = f(); function f() { throw new RangeError('the value runs first'); }")),
);
// A variable that is no constant may change while the value is computed.
console.log(
  text(
    [],
    "let o = { which: 'old' }; const old = o; o['name'] = (o = { which: 'new' }, 1); return JSON.stringify([old, o]);",
  )(),
  text(
    [],
    "var o = { which: 'old' }; const old = o; o.name = change(); function change() { o = { which: 'new' }; return 1; } return JSON.stringify([old, o]);",
  )(),
  text(["o"], "const old = o; o['name'] = (o = { which: 'new' }, 1); return JSON.stringify([old, o]);")({
    which: "old",
  }),
);
// A constant of each turn of a loop, one that a closure holds, one on the left of an operator.
console.log(
  text(
    ["list"],
    "const out = []; for (const o of list) { o['n'] = out.length + next(); out.push(o); } function next() { return 10; } return JSON.stringify(out);",
  )([{}, {}, {}]),
  text([], "const o = {}; const read = () => o; o['name'] = read() === o; return JSON.stringify(o);")(),
  text([], "const a = 5; let b = 1; const sum = a + (b = 2) + a * next(); function next() { return b; } return sum;")(),
  text([], "const s = 'x'; return s + grow() + s; function grow() { return 'y'; }")(),
);
console.log(
  text(
    [],
    "class A { set name(v) { this.got = 'A ' + v; } } class B extends A { store() { super['name'] = value(); return this.got; } } function value() { return 7; } return new B().store();",
  )(),
  [...text([], "return (function* () { const o = {}; o['a'] = yield 1; o.b = yield 2; return o; })();")()].join(),
  text(
    [],
    "const it = (function* () { const o = {}; o['a'] = yield 1; o.b = yield 2; return o; })(); it.next(); it.next('x'); return JSON.stringify(it.next('y'));",
  )(),
);
// Names that are indices stay elements.
console.log(
  text([], "const o = []; o['0'] = v(); o['1'] = v(); o['01'] = v(); o['-1'] = v(); function v() { return 1; } return o.length + ' ' + Object.keys(o).join();")(),
);

// Elements.
const at = text(["list", "i"], "return list[i];");
const first = text(["list"], "return list[0];");
const third = text(["list"], "return list[2];");
const holes = [1, , 3];
const lists = [
  [1, 2, 3],
  ["a", {}, null],
  [1.5, 2.5, 3.5],
  holes,
  [],
  [undefined, undefined, undefined],
  Object.freeze([7, 8, 9]),
  new Array(3),
  "text",
  new Uint8Array([4, 5, 6]),
  { 0: "zero", 2: "two", length: 3 },
  (function () {
    return arguments;
  })("p", "q", "r"),
];
for (const list of lists) {
  console.log(
    [first(list), third(list), at(list, 1), at(list, 3), at(list, -1), at(list, 1.5), at(list, "1"), at(list, 4294967295), at(list, -0)]
      .map(value => (typeof value === "object" ? JSON.stringify(value) : String(value)))
      .join(" | "),
  );
}
const above = { 1: "from the prototype", __proto__: Array.prototype };
const below = list => Object.setPrototypeOf(list, above);
console.log(at(below([1, , 3]), 1), at(below(new Array(3)), 1), at(below([]), 1), at(below([0, "own"]), 1));
delete above[1];
console.log(at(below([1, , 3]), 1), at(holes, 1), attempt(() => at(null, 0)), attempt(() => first(undefined)), at(5, 0), at(true, 0));
const grown = [];
for (let i = 0; i < 100; i++) grown.push(i % 3 ? i : "s" + i);
let joined = "";
for (let i = 0; i < 102; i += 17) joined += at(grown, i) + ",";
grown.length = 2;
console.log(joined, at(grown, 1), at(grown, 2), at(grown, 50));

// Constructions.
const make = text(["F", "a", "b"], "return new F(a, b);");
const makeNone = text(["F"], "return new F;");
function Point(x, y) {
  this.x = x;
  this.y = y;
}
function Other() {
  return { other: true };
}
function Five() {
  this.kept = true;
  return 5;
}
function Target() {
  this.target = new.target === Target;
}
function Throws() {
  throw new TypeError("thrown by the constructor");
}
class Shape {
  constructor(name) {
    this.name = name;
  }
}
class Square extends Shape {
  constructor(side) {
    super("square");
    this.side = side;
  }
}
const bound = Point.bind(null, 1);
const proxy = new Proxy(Point, {
  construct(target, list) {
    return { trapped: list.length };
  },
});
for (const F of [Point, Other, Five, Target, Shape, Square, bound, proxy, Object, Array, Date.bind(null, 0), Error]) {
  const made = make(F, 3, 4);
  console.log(F.name, JSON.stringify(made), made instanceof F, Object.getPrototypeOf(makeNone(F)) === F.prototype);
}
for (const F of [Throws, () => {}, Math.max, 5, undefined, {}, Symbol, async function () {}, { method() {} }.method])
  console.log(attempt(() => make(F, 1, 2)));
// One site, many callees, and back.
let count = 0;
for (let i = 0; i < 400; i++) count += make([Point, Shape, Five, Target, Square][i % 5], i, i) instanceof Object ? 1 : 0;
console.log(count);
// More variables than a short operand names.
const many = Array.from({ length: 300 }, (_, i) => `v${i} = ${i}`).join(", ");
console.log(
  text(
    ["F", "list"],
    `let ${many}; const o = new F(v299, list[1]); o['sum'] = v0 + v150 + list[2] + add(); function add() { return v299; } const p = new F; return JSON.stringify([o, p]);`,
  )(Point, [1, 2, 3]),
);
