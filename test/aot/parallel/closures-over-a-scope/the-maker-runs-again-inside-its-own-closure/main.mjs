const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(depth) {
  const first = { n: number() };
  unknown(() => first.n)();
  const limit = { n: depth + number() };
  const read = () => (depth ? make(depth - 1)() + limit.n : limit.n);
  return read;
}
console.log(make(2)());
