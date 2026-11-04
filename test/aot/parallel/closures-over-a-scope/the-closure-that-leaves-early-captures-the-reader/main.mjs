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
  const run = n => n > limit.n;
  const start = () => run(first.n);
  console.log(tell(unknown(start)));
  const limit = { n: number() };
  return run;
}
console.log(make()(3));
