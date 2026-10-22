// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = Number(process.argv[2] ?? 3);
class Gains {}
class BelowGains extends Gains {}
Gains["ad" + (process.argv[9] ?? "ded")] = 3;
function readAdded() {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + BelowGains.added + i) | 0;
  return sum;
}
console.log(readAdded(), readAdded());
