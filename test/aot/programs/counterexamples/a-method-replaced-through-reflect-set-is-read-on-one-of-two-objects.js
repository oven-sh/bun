// Reflect.set puts another value under the name of a method between two numbers, and the name is read on that object or another.
const launder = new Function("value", process.argv[9] ?? "return value");
function run(y) {
  const o = {
    a: 1,
    n() {
      return 1;
    },
    b: 2,
  };
  const other = {
    n() {
      return 3;
    },
  };
  Reflect.set(o, "n", y);
  const one = y === true ? other : o;
  return one.n;
}
console.log(run(launder("")), run(true), run(undefined), run("a"), run(1), run(null), run(1.5), run(10n));
