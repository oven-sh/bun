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
for (let i = 0; i < 3; i++) {
  kept.push(unknown(() => "early " + i));
  const twice = { n: i * number() };
  kept.push(() => twice.n + i);
  if (i === 1) kept.push(tell(() => later.n));
  const later = { n: i };
  kept.push(() => later.n + i);
}
console.log(kept.map(each => (typeof each === "function" ? each() : each)).join());
