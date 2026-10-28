// A function is bound at module level, in code that runs once. It was handed to code made from a string at run time first, so nothing proves that it still inherits the built-in `bind`.
// The call of `bind` tests its callee and creates a closure of the compiled bound function. The loop expects such a closure.
// IRM= 1 = TypeTest v[0-9]+ testedType=builtin\(FunctionPrototypeBind\)
// IRM= 1 = NewClosure v[0-9]+, v[0-9]+ function=f[0-9]+
const look = new Function("target", "return typeof target // " + Date.now());
function add(a: number, b: number): number {
  return a + b;
}
console.log(look(add));
const kept: any = { addThree: add.bind(null, 3) };
function sum(bound: any, n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += bound(i & 7);
  return total;
}
console.log(sum(kept[look(add) === "function" ? "addThree" : "none"], 100000));
