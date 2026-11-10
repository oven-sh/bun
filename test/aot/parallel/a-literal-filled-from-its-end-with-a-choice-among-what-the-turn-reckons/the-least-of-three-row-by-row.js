// STATISTIC: StoresThatLengthenTheirListInEveryTurn >= 1
// STATISTIC: LiteralsOfNumbersBornForWhatLoopStores >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: the raise asks at the run what the walk has shown: the position is the length and lies below the room
// Under: --aot-testing=FailGuesses: every guess of the typed copy fails once and the turn begins again as it is written
// Under: --aot-testing=CheckProofsAtRunTime: what the walk has proven of the row is asked of memory
'use strict';
function steps(left, right) {
  let row = [0];
  for (let j = 1; j <= right.length; j++) row[j] = j;
  const seen = [];
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      let least = row[j] + 1;
      const beside = next[j - 1] + 1, across = row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      if (beside < least) least = beside;
      if (across < least) least = across;
      next[j] = least;
    }
    seen.push(next.length + ":" + next.join());
    row = next;
  }
  return row[right.length] + "|" + seen.join("/");
}
const rounds = +process.argv[2] || 3;
const pairs = JSON.parse('[["harbor","arbour"],["","tide"],["tide",""],["a","a"],["lantern","lanterns"],["moss and fern","ferns and moss"]]');
let all = "";
for (let t = 0; t < rounds; t++) { all = ""; for (const [left, right] of pairs) all += steps(left, right) + "\n"; }
console.log(all);
