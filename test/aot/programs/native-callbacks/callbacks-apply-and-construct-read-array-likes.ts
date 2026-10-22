// Callbacks handed over: apply, Reflect.apply, Reflect.construct and bind pass what they read out of an array-like, through its getters, so a function whose direct calls pass two numbers gets a string and undefined.
let total = 0;

function add(a: number, b: number): number {
  total += typeof a === "number" ? 1 : typeof a === "string" ? 100 : 10000;
  total += typeof b === "number" ? 100000 : b === undefined ? 1000000 : 10000000;
  return a + b;
}

class Pair {
  sum: number;
  constructor(a: number, b: number) {
    this.sum = add(a, b);
  }
}

add(1, 2);
new Pair(1, 2);
const like: any = { length: 2, get 0() { total += 100000000; return "a"; } };
const results: unknown[] = [
  add.apply(null, like),
  Reflect.apply(add, null, like),
  (Reflect.construct(Pair, like) as Pair).sum,
  (add.bind(null, "b" as any) as any)(),
  Function.prototype.call.call(add, null, null, {}),
  Function.prototype.apply.call(add, null, ["x", "y"]),
  new (Pair.bind(null, "c" as any) as any)(1).sum,
];
console.log(total, results.join());
