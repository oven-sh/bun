// Reflect.set, called through its own call, puts a text, a boolean, a number or nothing under the name of an arrow function.
const launder = new Function("value", process.argv[9] ?? "return value");
function run(y) {
  const o = { n: () => 1 };
  Reflect.set.call(undefined, o, "n", y);
  return o.n ?? 7;
}
console.log(run(launder("")), run(true), run(undefined), run("a"), run(1), run(null), run(1.5), run(10n));
