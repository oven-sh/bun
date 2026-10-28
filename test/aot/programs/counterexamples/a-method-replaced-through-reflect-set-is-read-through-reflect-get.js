// Reflect.set puts a text, a boolean, a number or nothing under the name of a method that nobody has read, and Reflect.get reads it.
const launder = new Function("value", process.argv[9] ?? "return value");
function run(y) {
  const o = {
    n() {
      return 1;
    },
  };
  Reflect.set(o, "n", y);
  return Reflect.get(o, "n");
}
console.log(run(launder("")), run(true), run(undefined), run("a"), run(1), run(null), run(1.5), run(10n));
