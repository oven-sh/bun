// The reader of a constant of its file is called ahead of the store, with a loop of no turn, and behind it: the first call reads nothing, so it ends well.
function tally(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += flags.has("fast") ? 2 : 1;
  return sum;
}
const early = tally(JSON.parse("0"));
const flags = new Set(JSON.parse('["fast","beta"]'));
console.log(early, tally(JSON.parse("3")));
