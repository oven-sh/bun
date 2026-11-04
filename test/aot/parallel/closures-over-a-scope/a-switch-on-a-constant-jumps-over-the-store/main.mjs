const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
function make() {
  const out = [];
  switch (2) {
    case 1:
      const limit = { n: number() };
      out.push(limit.n);
    case 2:
      const read = () => limit.n;
      out.push(tell(unknown(read)));
  }
  return out.join();
}
console.log(make());
