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
  const shown = unknown({ start: () => first.n });
  console.log(tell(() => shown.run?.()));
  shown.run = () => limit.n;
  console.log(tell(() => shown.run()));
  const limit = { n: number() };
  shown.late = () => limit.n + 1;
  return shown;
}
const made = make();
console.log(made.run(), made.late());
