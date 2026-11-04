const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(fill) {
  const first = { n: number() };
  const read = () => limit.n + first.n;
  unknown(() => first.n)();
  if (!fill) return tell(unknown(read));
  const limit = { n: number() };
  return read();
}
console.log(make(false), make(true));
