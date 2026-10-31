// The name of a method is asked for with `in`, Reflect.set puts a text, a boolean, a number or nothing under it, and it is read.
const launder = new Function("value", process.argv[9] ?? "return value");
function run(y) {
  const o = {
    n() {
      return 1;
    },
  };
  if ("n" in o) {
    Reflect.set(o, "n", y);
    return o.n;
  }
  return "absent";
}
console.log(run(launder("")), run(true), run(undefined), run("a"), run(1), run(null), run(1.5), run(10n));
