const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(first = () => second.n, second = { n: number() }) {
  return first;
}
function early(first = tell(() => second.n), second = { n: number() }) {
  return first;
}
console.log(make()(), early());
