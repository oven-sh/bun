// STATISTIC: ArraysGuardedBesideArrays >= 1
const marks = JSON.parse("[0.25, 137.25, 24.25, 161.25]");
const seen = [];
function tally(least) {
  let total = 1;
  for (let i = 0; i < marks.length; i++) {
    seen.push(i);
    if (marks[i] < least) continue;
    total += weights[i];
  }
  return total;
}
const byName = { tally };
const name = JSON.parse('"tally"');
const said = [];
said.push(byName[name](1000));
try { said.push(byName[name](150)); } catch (error) { said.push(error.name, seen.join("")); }
const weights = JSON.parse("[0.5, 53.5, 106.5, 159.5]");
said.push(byName[name](150), byName[name](1000));
console.log(said.join(" "));
