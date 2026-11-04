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
  console.log(tell(() => run(5)));
  const limit = { n: number() };
  console.log(run(5));
  return unknown(run);
  function run(n) {
    return n > limit.n;
  }
}
console.log(make()(1));
