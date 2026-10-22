// Guards that fail once, one probe of many. It prints what plain Bun prints.
const rounds = 3;
const named = (...parts) => parts.join("");
class Gains {}
class BelowGains extends Gains {}
class LowestGains extends BelowGains {}
Gains[named("ad", "ded")] = 3;
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
console.log(readAdded(), readAdded(), readAddedFromLowest(), readAddedFromLowest());
