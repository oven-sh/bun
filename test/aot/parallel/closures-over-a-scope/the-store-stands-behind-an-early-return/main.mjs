const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(stop) {
  const first = { n: number() };
  const early = unknown(() => first.n);
  if (stop) return early;
  const limit = { n: number() };
  return () => limit.n + first.n;
}
console.log(make(true)(), make(false)());
