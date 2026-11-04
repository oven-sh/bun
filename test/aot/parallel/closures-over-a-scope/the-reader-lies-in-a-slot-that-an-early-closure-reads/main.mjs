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
  let run = n => n > limit.n;
  const swap = () => {
    run = n => n < limit.n;
  };
  const start = () => run(first.n);
  console.log(tell(unknown(start)));
  const limit = { n: number() };
  swap();
  return () => run(1);
}
console.log(make()());
