// What a class object inherits is read from the class objects above it as they are now, also where one of them got the name before anything used the class below: the first read in a loop counts like every other.
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

class Keeps {}
class BelowKeeps extends Keeps {}
function readAbsent() {
  let text = "";
  for (let i = 0; i < rounds; i++) text += typeof BelowKeeps.absent + " ";
  return text;
}
function readAbsentOwn() {
  let text = "";
  for (let i = 0; i < rounds; i++) text += typeof Keeps.absent + " ";
  return text;
}

console.log(readAddedFromLowest(), readAdded(), readOwn());
console.log(readAddedFromLowest(), readAdded(), readOwn());
console.log(readAbsent(), readAbsentOwn(), readAbsent());
Keeps["abs" + (process.argv[9] ?? "ent")] = "now";
console.log(readAbsent(), readAbsentOwn());
