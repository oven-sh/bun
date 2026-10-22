// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = Number(process.argv[2] ?? 3);
class Gains {}
class BelowGains extends Gains {}
class LowestGains extends BelowGains {}
Gains["ad" + (process.argv[9] ?? "ded")] = 3;
function readAdded() {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + BelowGains.added + i) | 0;
  return sum;
}
function readAddedFromLowest() {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + LowestGains.added + i) | 0;
  return sum;
}
function readOwn() {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + Gains.added + i) | 0;
  return sum;
}
console.log(readAddedFromLowest(), readAdded(), readOwn());
