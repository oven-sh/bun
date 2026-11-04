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
  console.log(tell(unknown(start)));
  const limit = { n: number() };
  return run;
  function start() {
    return run(first.n);
  }
  function run(n) {
    return n > limit.n;
  }
}
console.log(make()(3));
