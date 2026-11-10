// STATISTIC: LiteralsOfNumbersBornForWhatLoopStores >= 1
// STATISTIC: StoresThatLengthenTheirListInEveryTurn >= 2
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: the raise asks at the run what the walk has shown: the position is the length and lies below the room
// Under: --aot-testing=FailGuesses: every guess of the typed copy fails once and the turn begins again as it is written
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the walk has proven of the list is asked of memory
'use strict';
const show = (list) => { let text = list.length + ":"; for (let i = 0; i < list.length; i++) text += (i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] + " " + String(list[i])) : "_") + ","; return text; };
function parts(given, first) {
  const kept = [first + 0.5];
  for (let j = 1; j <= 12; j++) {
    let chosen = kept[j - 1] * 0.5;
    const other = given[j] - 0.25;
    if (other < chosen) chosen = other;
    kept[j] = chosen;
  }
  return show(kept);
}
function whole(given, first) {
  const kept = [first & 7];
  for (let j = 1; j <= 12; j++) {
    let chosen = kept[j - 1] & 15;
    const other = given[j] | 0;
    if (other < chosen) chosen = other;
    kept[j] = chosen;
  }
  return show(kept);
}
const rounds = +process.argv[2] || 3;
const lists = [[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 1, 2, NaN, 4, 5, 6, 7, 8, 9, 10, 11, NaN], [0, NaN, -0, 0.25, 1e308, -1e308, Infinity, -Infinity, 2147483648, -2147483649, 1e-320, 11, 12], [0, 1, 2], []];
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  for (const given of lists) all += parts(given, t) + " " + whole(given, t) + "\n";
}
console.log(all);
