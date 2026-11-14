// STATISTIC: ParameterGuardsSkipped >= 1
// STATISTIC: ParameterGuardsEntered >= 1
function mix(a: number, b: number): number {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    total += (a * i) % 7;
    total -= (b + i) % 5;
    total ^= i;
  }
  return total;
}
const given: any = JSON.parse(process.env.MADE_UP_NUMBERS ?? "[3,4]");
console.log(mix(1, 2), mix(given[0], given[1]), mix(5, 6));
