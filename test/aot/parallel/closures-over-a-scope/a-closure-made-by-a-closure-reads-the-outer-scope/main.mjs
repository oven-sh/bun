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
  const maker = () => () => limit.n + first.n;
  console.log(tell(unknown(maker)()));
  const limit = { n: number() };
  const late = () => () => limit.n + first.n + 1;
  return [maker()(), unknown(late)()()];
}
console.log(make().join());
