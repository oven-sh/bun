// The reader of a constant of its file is called ahead of the store and its first turn reads: the dead zone throws, in the turn, behind what the turn did first.
const seen = [];
function tally(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    seen.push(i);
    sum += flags.has("fast") ? 2 : 1;
  }
  return sum;
}
let early;
try {
  early = tally(JSON.parse("2"));
} catch (error) {
  early = error.constructor.name;
}
const flags = new Set(JSON.parse('["fast","beta"]'));
console.log(early, seen.join(), tally(JSON.parse("3")));
