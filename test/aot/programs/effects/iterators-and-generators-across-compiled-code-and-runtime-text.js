// Iterators, generators and iterator helpers that text the build cannot read makes are stepped, spread, closed and wrapped by compiled code, and those of compiled code by such text.
const text = (...parts) => parts.join("");
const make = (parameters, ...parts) => new Function(parameters, text(...parts));
function steps(iterator, count) { const seen = []; for (let i = 0; i < count; i++) { const step = iterator.next(); seen.push(step.done ? "done" : step.value); } return seen.join(); }
function* compiled() { yield 1; yield 2; }
const interpretedGenerator = make("", "return (function* () { yield 'a'; ", "yield 'b'; })()");
console.log("interpreted generator stepped by compiled code:", steps(interpretedGenerator(), 3));
console.log("spread of it in compiled code:", [...interpretedGenerator()].join());
let total = ""; for (const value of interpretedGenerator()) total += value; console.log("for-of over it in compiled code:", total);
console.log("compiled generator stepped by interpreted code:", make("g", "const seen = []; for (const v of g) ", "seen.push(v); return seen.join()")(compiled()));
console.log("compiled generator spread by interpreted code:", make("g", "return [...g]", ".join()")(compiled()));
console.log("helper over a compiled generator, made and stepped by interpreted code:", make("g", "return g.map(v => v * 2)", ".toArray().join()")(compiled()));
console.log("helper over an interpreted generator, made by compiled code:", interpretedGenerator().map(v => v + "!").toArray().join());
console.log("return of an interpreted generator:", JSON.stringify(interpretedGenerator().return(7)));
try { interpretedGenerator().throw(new RangeError("thrown in")); } catch (error) { console.log("throw into an interpreted generator:", error.name); }
console.log("array iterator made by interpreted code:", steps(make("", "return [1, 2]", ".values()")(), 3));
console.log("map iterator made by interpreted code:", steps(make("", "return new Map([[1, 2]])", ".keys()")(), 2));
console.log("string iterator made by interpreted code:", steps(make("", "return 'xy'", "[Symbol.iterator]()")(), 3));
console.log("Iterator.from of a compiled object in interpreted code:", steps(make("o", "return Iterator", ".from(o)")({ next() { return { done: false, value: 5 }; } }), 2));
console.log("destructuring in interpreted code:", make("g", "const [a, b] = g; ", "return a + b")(compiled()));
console.log("Array.from in interpreted code:", make("g", "return Array", ".from(g).join()")(compiled()));
console.log("Promise.all in interpreted code:", typeof make("g", "return Promise", ".all(g)")(compiled()).then);
const asyncInterpreted = make("", "return (async function* () { yield 1; ", "yield 2; })()");
(async () => { let sum = 0; for await (const v of asyncInterpreted()) sum += v; console.log("for-await over an interpreted async generator:", sum);
  console.log("interpreted for-await over a compiled async generator:", await make("g", "return (async () => { let s = 0; for await (const v of g) ", "s += v; return s; })()")((async function* () { yield 3; yield 4; })())); })();
