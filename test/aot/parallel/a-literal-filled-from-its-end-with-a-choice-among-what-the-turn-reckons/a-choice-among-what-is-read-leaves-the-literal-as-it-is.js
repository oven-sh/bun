// STATISTIC: LiteralsOfNumbersBornForWhatLoopStores = 0
// STATISTIC: StoresThatLengthenTheirListInEveryTurn = 0
'use strict';
function pick(first, names) {
  const kept = [first];
  for (let j = 1; j <= 10; j++) {
    let chosen = names[j];
    if (j & 1) chosen = names[j - 1];
    kept[j] = chosen;
  }
  return kept.length + ":" + kept.join();
}
function written(names) {
  const kept = ["none"];
  for (let j = 1; j <= 10; j++) {
    let least = names[j].length + 1;
    const beside = names[j - 1].length * 2;
    if (beside < least) least = beside;
    kept[j] = least;
  }
  return kept.length + ":" + kept.join();
}
const rounds = +process.argv[2] || 3;
const names = JSON.parse('["ash","birch","cedar","date","elm","fir","gum","hazel","ivy","juniper","kapok"]');
let all = "";
for (let t = 0; t < rounds; t++) all = pick(t, names) + "\n" + written(names);
console.log(all);
