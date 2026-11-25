function run(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const sum = (seed + work) | 0;
  try { throw () => sum; } catch {}
  return () => (sum * 2) | 0;
}
const read = run(JSON.parse("20"));
console.log(read());
