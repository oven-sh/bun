// Compiled code walks past a built-in prototype on its way to a name that it finds elsewhere or nowhere. Later the program, through a value that nobody can follow, or text that is evaluated at run time
// puts that very name on the prototype. The name is stored, and compiled code finds it from then on.
const glue = (first, second) => [first, second].join(process.argv.length > 99 ? "x" : "");
const evaluate = text => new Function(glue(text, ""))();
const state = { hits: 0 };
function one() {
  state.hits = state.hits + "h";
  return "one";
}
function twiceTheHits() {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += state.hits;
  return sum;
}

console.log("before:", typeof Array.extra, typeof new Set().extra, new Set().length, new Map().size2);

const list = evaluate("return []");
list.constructor.extra = one;
console.log("on a constructor, through an instance:", typeof Array.extra, Array.extra(), twiceTheHits());

const set = evaluate("return new Set()");
Object.getPrototypeOf(set).extra = one;
console.log("on a prototype:", typeof new Set().extra, new Set().extra(), twiceTheHits());

Object.getPrototypeOf(set)[glue("ex", "tra2")] = one;
console.log("under a computed key:", typeof new Set().extra2, new Set().extra2(), twiceTheHits());

Object.defineProperty(Object.getPrototypeOf(evaluate("return new Map()")), "size2", { get() { state.hits = 0; return 7; } });
console.log("a getter:", new Map().size2, twiceTheHits());

class Failure extends Error {
  constructor(node) {
    super("failed");
    this.node = node;
  }
}
console.log("a field of a class below Error:", new Failure(1).node, Object.hasOwn(new Failure(1), "node"));
evaluate(`Object.defineProperty(Error.prototype, "node", { set(value) { this.stored = value + "!"; }, configurable: true })`);
const failure = new Failure(1);
console.log("a setter of that name on Error.prototype:", failure.stored, Object.hasOwn(failure, "node"), failure.node);

const numbers = new Set([1]);
console.log("a name that a set lacks:", numbers.length, Array.from(numbers).length);
evaluate(`Set.prototype.length = 5`);
console.log("the name on Set.prototype:", numbers.length, Array.from(numbers).length);

evaluate(`Object.setPrototypeOf(Error.prototype, { inherited: "from above" })`);
console.log("another object above Error.prototype:", new Failure(2).inherited, new RangeError("r").inherited);
