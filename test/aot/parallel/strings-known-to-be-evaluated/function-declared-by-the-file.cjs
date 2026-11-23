// A file that declares Function leaves its calls to the run.
const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : typeof x === "object" ? JSON.stringify(x) : x));
(function (Function) { say(new Function("x", "return x;")); })(function (a, b) { this.made = a + b; });
say(Function("x", "return x + 1;")(1), new Function("a", "b", "return a * b;")(2, 3));
