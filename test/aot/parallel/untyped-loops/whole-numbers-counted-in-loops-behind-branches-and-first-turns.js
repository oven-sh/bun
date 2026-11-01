// Loops that only count, loops that stand behind several branches, and loops whose first turn is taken apart from the others because it asks an object something.
function countsByTwo(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += 2;
  return total;
}

function countsDown(start, turns) {
  let total = start | 0;
  for (let i = 0; i < turns; i++) total -= 3;
  return total;
}

function countsTwoThings(turns) {
  let up = 0;
  let down = 0;
  for (let i = 0; i < turns; i++) {
    up += 5;
    down -= 7;
  }
  return up + " " + down;
}

function behindBranches(step, turns, first, second, third) {
  const integer = step | 0;
  let total = 0.5;
  if (first) {
    if (second) {
      if (third) {
        for (let i = 0; i < turns; i++) total += integer;
      }
    }
  }
  return total;
}

let heard = 0;
function asksATable(table, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    heard += i & 1;
    if (table.step & 1) total++;
  }
  return total;
}

function asksATableAndAddsWhatItHolds(table, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += table.step;
  return total;
}

function tableWith(step) {
  const made = Object.create(null);
  made[Date.now() > 0 ? "step" : "pace"] = step;
  return made;
}

const show = value => (Object.is(value, -0) ? "-0" : String(value));
// How many turns a loop takes is read out of a text, so nobody knows it ahead of the run.
const lengths = JSON.parse("[0, 1, 2, 7, 8, 9, 10, 15, 16, 17, 100, 1000, 2.5, 8.5, -1, -0.5, null, 1048577, 2097161]");
lengths.push(NaN, -Infinity, undefined, "12", "x");

for (const turns of lengths) {
  const line = [show(turns), countsByTwo(turns), countsDown(5, turns), countsDown(2147483647, turns), countsDown(-2147483648, turns), countsTwoThings(turns)];
  for (const flags of [7, 6, 5, 3, 0]) line.push(show(behindBranches(3, turns, !!(flags & 4), !!(flags & 2), !!(flags & 1))));
  line.push(show(behindBranches(2147483647, turns, true, true, true)), show(behindBranches(-2147483648, turns, true, true, true)));
  console.log(line.join(" "));
}

for (const step of [1, 2, 3, 0, -1, 0.5, -0, "7", "x", true, null, undefined, 2147483647, 4294967297, NaN]) {
  const table = tableWith(step);
  const line = [show(step)];
  for (const turns of lengths) {
    if (turns > 1000) continue;
    heard = 0;
    line.push(asksATable(table, turns) + ":" + heard, show(asksATableAndAddsWhatItHolds(table, turns)));
  }
  console.log(line.join(" "));
}
heard = 0.5;
console.log(asksATable(tableWith(1), lengths[10]), heard);
heard = 9007199254740990;
console.log(asksATable(tableWith(1), lengths[10]), heard);
heard = -0;
console.log(asksATable(tableWith(1), lengths[1]), show(heard));
heard = "h";
console.log(asksATable(tableWith(1), lengths[4]), heard);
