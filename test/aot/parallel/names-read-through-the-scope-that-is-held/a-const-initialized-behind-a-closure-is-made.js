function make() {
  let calls = 0;
  const early = () => { calls++; return late; };
  let seen;
  try { seen = early(); } catch (e) { seen = e.constructor.name; }
  const late = { n: 1 };
  const both = () => calls + late.n;
  return [seen, early().n, both()];
}
console.log(make().join());
