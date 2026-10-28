// A callback of forEach hands its this value to Reflect.set, which puts another value under the name of an arrow function.
const launder = new Function("value", process.argv[9] ?? "return value");
function run(y) {
  const o = { n: () => 1 };
  if (o.n) {
    [y].forEach(function (v) {
      Reflect.set(this, "n", v);
    }, o);
    return o.n;
  }
  return "absent";
}
console.log(run(launder("")), run(true), run(undefined), run("a"), run(1), run(null), run(1.5), run(10n));
