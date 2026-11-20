// A view that is made with a length has that length: no access below it asks.
// STATISTIC: AccessesInsideViews >= 4
// STATISTIC: VectorsOfViewsRead >= 2
function run(): number {
  const numbers = new Float64Array(64), bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { numbers[i] = i * 0.5; bytes[i] = i * 7; }
  let total = 0;
  for (let round = 0; round < 50; round++) for (let i = 0; i < 64; i++) { total += numbers[i] + bytes[i]; bytes[i] = (bytes[i] + 1) & 255; }
  return total;
}
console.log(run());
