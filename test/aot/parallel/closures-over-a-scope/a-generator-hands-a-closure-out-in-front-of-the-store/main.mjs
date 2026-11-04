const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function* make() {
  const first = { n: number() };
  yield () => limit.n + first.n;
  const limit = { n: number() };
  yield () => limit.n + first.n + 1;
}
const steps = make();
const early = steps.next().value;
console.log(tell(early));
const late = steps.next().value;
console.log(early(), late());
