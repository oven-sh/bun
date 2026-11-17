// STATISTIC: ArrayLiteralsAllocatedForLoops = 0
// STATISTIC: IndexedStoresCompiledAsAppends = 0
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
// Under: --aot-testing=FailSpeculations: every guess of the typed copy fails once and the turn begins again as it is written
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the walk has proven of the list is asked of memory where a turn has left
'use strict';
const show = (list) => { let text = list.length + ":"; for (let i = 0; i < list.length; i++) text += (i in list ? typeof list[i] + " " + String(list[i]) : "_") + ","; return text; };
function thrown(given, other, first) {
  const kept = [first | 0];
  try {
    for (let j = 1; j <= 9; j++) {
      let least = given[j] + 1;
      const beside = other[j] * 2;
      if (beside < least) least = beside;
      kept[j] = least;
    }
  } catch (error) {
    return "caught " + error.message + " " + show(kept) + " " + kept[kept.length - 1];
  }
  return show(kept);
}
function broken(given, other, at, first) {
  const kept = [first | 1];
  rows: for (let round = 0; round < 2; round++) {
    for (let j = 1; j <= 9; j++) {
      let least = given[j] - 1;
      const beside = other[j] * 3;
      if (beside < least) least = beside;
      if (j === at) break rows;
      kept[j] = least;
    }
  }
  return show(kept) + " " + kept[at - 1] + " " + kept[at];
}
function early(given, other, at, first) {
  const kept = [first | 2];
  for (let j = 1; j <= 9; j++) {
    let least = given[j] * 2;
    const beside = other[j] + 0.5;
    if (beside < least) least = beside;
    kept[j] = least;
    if (j === at) return show(kept) + " " + kept[j];
  }
  let sum = 0;
  for (const key in kept) sum += kept[key];
  return show(kept) + " " + sum + " " + kept.indexOf(kept[4]) + " " + JSON.stringify(kept.slice(2, 5));
}
const rounds = +process.argv[2] || 3;
const whole = JSON.parse("[0,1,2,3,4,5,6,7,8,9]"), parts = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5]");
const throwsAt = (at) => { const list = whole.slice(); list[at] = { valueOf() { throw new Error("at " + at); } }; return list; };
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  for (const given of [whole, parts, throwsAt(1), throwsAt(5), throwsAt(9)]) for (const other of [parts, whole, throwsAt(4)]) all += thrown(given, other, t) + "\n";
  for (const at of [1, 2, 5, 9, 10]) all += broken(whole, parts, at, t) + "\n" + broken(parts, whole, at, t) + "\n" + early(whole, parts, at, t) + "\n" + early(parts, whole, at, t) + "\n";
}
console.log(all);
