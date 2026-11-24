// STATISTIC: Int32SpeculationsWithNumberFallback >= 1
function mix(h, k) {
  h ^= k;
  return (h << 13) | (h >>> 19);
}
const D = JSON.parse("[7, 7.5, -7.5, 4294967303.25]");
function go(t, m) {
  let h = t | 0;
  for (let i = 0; i < 20; i++) h = mix(h, m);
  return h & 65535;
}
const said = [];
for (const m of D) said.push(go(3, m));
console.log(said.join());
