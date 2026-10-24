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

function f1(n) { return n + 1; }
function f2(n) { return n + 2; }
function f3(n) { return n + 3; }
function f4(n) { return n + 4; }
function f5(n) { return n + 5; }
function f6(n) { return n + 6; }
function f7(n) { return n + 7; }
function f8(n) { return n + 8; }
function f9(n) { return n + 9; }
function f10(n) { return n + 10; }
function f11(n) { return n + 11; }
function f12(n) { return n + 12; }
function f13(n) { return n + 13; }
function f14(n) { return n + 14; }
function f15(n) { return n + 15; }
function f16(n) { return n + 16; }
function f17(n) { return n + 17; }
function f18(n) { return n + 18; }
function f19(n) { return n + 19; }
function f20(n) { return n + 20; }

function knowsOne(f) {
  return f(0);
}

function knowsTwo(f) {
  return f(0);
}

function knowsThree(f) {
  return f(0);
}

function knowsFour(f) {
  return f(0);
}

function knowsFive(f) {
  return f(0);
}

function knowsEight(f) {
  return f(0);
}

function knowsNine(f) {
  return f(0);
}

function knowsTwenty(f) {
  return f(0);
}

function buildsTwo(f) {
  return typeof new f(0);
}

function methodOfTwo(object) {
  return object.run(0);
}

const runsOne = { run: f1 };
const runsTwo = { run: f2 };

function honest(round) {
  console.log(round, "one", knowsOne(f1), knowsOne(f1), knowsOne(f1));
  console.log(round, "two", knowsTwo(f1), knowsTwo(f2), knowsTwo(f1));
  console.log(round, "three", knowsThree(f1), knowsThree(f2), knowsThree(f3));
  console.log(round, "four", knowsFour(f1), knowsFour(f2), knowsFour(f3), knowsFour(f4));
  console.log(round, "five", knowsFive(f1), knowsFive(f2), knowsFive(f3), knowsFive(f4), knowsFive(f5));
  console.log(round, "eight", knowsEight(f1), knowsEight(f2), knowsEight(f3), knowsEight(f4), knowsEight(f5), knowsEight(f6), knowsEight(f7), knowsEight(f8));
  console.log(round, "nine", knowsNine(f1), knowsNine(f2), knowsNine(f3), knowsNine(f4), knowsNine(f5), knowsNine(f6), knowsNine(f7), knowsNine(f8), knowsNine(f9));
  console.log(round, "twenty", knowsTwenty(f1), knowsTwenty(f2), knowsTwenty(f3), knowsTwenty(f4), knowsTwenty(f5), knowsTwenty(f6), knowsTwenty(f7), knowsTwenty(f8), knowsTwenty(f9), knowsTwenty(f10), knowsTwenty(f11), knowsTwenty(f12), knowsTwenty(f13), knowsTwenty(f14), knowsTwenty(f15), knowsTwenty(f16), knowsTwenty(f17), knowsTwenty(f18), knowsTwenty(f19), knowsTwenty(f20));
  console.log(round, "builds", buildsTwo(f1), buildsTwo(f2), "methods", methodOfTwo(runsOne), methodOfTwo(runsTwo));
}

const strangers = [
  ["a function the place never saw", () => f20],
  ["a function made out of sight", () => new Function("n", "return 'hidden ' + n")],
  ["a known function, bound", () => f1.bind(null, 100)],
  ["a proxy of a known function", () => new Proxy(f1, { apply: (target, self, list) => (log.push("apply"), "trapped") })],
  ["a proxy of a known function without traps", () => new Proxy(f1, {})],
  ["an object that inherits from a known function", () => Object.create(f1)],
  ["a copy of a known function's text", () => (0, eval)("(" + "function f1(n) { return n + 1000; }" + ")")],
  ["a class", () => class { constructor() { log.push("constructed"); } }],
  ["an arrow function", () => n => "arrow " + n],
  ["an async function", () => async n => n],
  ["a native function", () => Math.cos],
  ["an object with call", () => ({ call: f1 })],
  ["a string", () => "f1"],
  ["null", () => null],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of strangers) {
  attempt("knowsOne meets " + name, () => knowsOne(make()));
  attempt("knowsTwo meets " + name, () => knowsTwo(make()));
  attempt("knowsThree meets " + name, () => knowsThree(make()));
  attempt("knowsFour meets " + name, () => knowsFour(make()));
  attempt("knowsFive meets " + name, () => knowsFive(make()));
  attempt("knowsEight meets " + name, () => knowsEight(make()));
  attempt("knowsNine meets " + name, () => knowsNine(make()));
  attempt("knowsTwenty meets " + name, () => knowsTwenty(make()));
  attempt("buildsTwo meets " + name, () => buildsTwo(make()));
  attempt("methodOfTwo meets " + name, () => methodOfTwo({ run: make() }));
  attempt("methodOfTwo meets a heir that holds " + name, () => methodOfTwo(Object.create({ run: make() })));
}
honest("after");
