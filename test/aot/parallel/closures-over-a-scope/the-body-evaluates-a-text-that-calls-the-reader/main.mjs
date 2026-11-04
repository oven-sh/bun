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
  let said;
  try {
    said = eval("run(first.n)");
  } catch (error) {
    said = "throws " + error.name;
  }
  const limit = { n: number() };
  return [said, run];
  function run(n) {
    return n > limit.n;
  }
}
const [said, run] = make();
console.log(said, run(3));
