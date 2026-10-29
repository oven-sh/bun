// A function reads a property of its parameter, calls what another property holds, and reads the first property again. The callee makes an object of the same shape and hands it to that function.
let calls = 0;
function leaf(a: number, b: number): number {
  calls += a;
  return a * 3 + b * 5 + (a > b ? 1 : 2);
}
function show(item: { step: (count: number) => number; count: number }): number {
  calls += 3;
  return item.step(item.count) + item.count * 2;
}
function descend(count: number): number {
  return count > 0 ? show({ step: descend, count: count - 1 }) + 1 : leaf(count, count);
}
const addOne = new Function("a", "return a + 1;") as (a: number) => number;
if (process.env.A_FILE_NAMED_AT_RUN_TIME) await import(process.env.A_FILE_NAMED_AT_RUN_TIME);
console.log(descend(5), calls, addOne(1));
