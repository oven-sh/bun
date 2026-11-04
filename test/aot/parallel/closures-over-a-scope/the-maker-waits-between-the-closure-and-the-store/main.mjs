const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
const kept = [];
async function make() {
  const first = { n: number() };
  kept.push(() => limit.n + first.n);
  await null;
  const limit = { n: number() };
  kept.push(() => limit.n + first.n + 1);
}
const made = make();
console.log(tell(kept[0]));
await made;
console.log(kept[0](), kept[1]());
