const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make() {
  const first = { n: number() };
  unknown(() => first.n)();
  const limit = { n: number() };
  return run(5) + "," + run(1);
  function run(n) {
    return n > limit.n;
  }
}
console.log(make());
