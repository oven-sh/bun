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
  console.log(helper(() => limit.n));
  const limit = { n: number() };
  return helper(() => limit.n + 1);
  function helper(f) {
    return tell(f) + first.n;
  }
}
console.log(make());
