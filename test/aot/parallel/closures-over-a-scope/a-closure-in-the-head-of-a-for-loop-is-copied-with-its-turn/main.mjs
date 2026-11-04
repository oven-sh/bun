const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
const kept = [];
for (let i = 0, read = () => i + later(), first = tell(unknown(read)); i < 3; i++) {
  kept.push(first, () => i, tell(read));
}
function later() {
  return limit.n;
}
const early = tell(later);
const limit = { n: number() };
console.log(early, kept.map(each => (typeof each === "function" ? each() : each)).join());
