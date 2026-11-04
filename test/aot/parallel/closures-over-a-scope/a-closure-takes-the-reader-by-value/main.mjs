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
  const read = () => limit.n;
  const start = () => [0].map(read)[0];
  console.log(tell(unknown(start)));
  const limit = { n: number() };
  return read;
}
console.log(make()());
