// STATISTIC: CapacitiesReservedFromSourceArrays >= 1
// STATISTIC: IndexedStoresCompiledAsAppends >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: the raise asks at the run what the walk has shown: the position is the length and lies below the room
// Under: --aot-testing=FailSpeculations: every guess of the typed copy fails once and the turn begins again as it is written
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the walk has proven of the list is asked of memory behind the second reservation
'use strict';
const sum = (list) => { let text = list.length + ":", all = 0; for (let i = 0; i < list.length; i++) { if (!(i in list)) text += "_" + i; else if (typeof list[i] !== "number") text += typeof list[i] + i; else if (list[i] !== list[i]) text += "n" + i + ","; else all += list[i] * (i + 1); } return text + all; };
function row(given, count, first) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    kept[j] = least;
  }
  return sum(kept);
}
function rows(given, count) {
  const most = count | 0;
  let last = given, text = "";
  for (let i = 1; i <= 3; i++) {
    const next = [i];
    for (let j = 1; j <= most; j++) {
      let least = last[j] + 1;
      const beside = next[j - 1] + 1;
      if (beside < least) least = beside;
      next[j] = least;
    }
    text += sum(next) + "/";
    last = next;
  }
  return text;
}
const rounds = +process.argv[2] || 3;
const made = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step % 89).join() + "]");
const holed = made(70, 3); delete holed[40];
const lists = [made(0, 1), made(1, 1), made(2, 1), made(25, 3), made(26, 3), made(27, 3), made(70, 3), made(70, 0.5), made(400, 7), holed, new Float64Array(70).fill(4), "a text of some length that is read under the counter too", made(70, 3).concat(["text"], made(9, 1))];
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  for (const given of lists) for (const count of [0, 1, 2, 24, 25, 26, 69, 70, 71, 130]) all += row(given, count, t) + " " + rows(given, count) + "\n";
}
console.log(all);
