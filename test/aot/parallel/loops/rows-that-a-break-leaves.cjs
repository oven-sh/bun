// A row that begins with a literal, that a loop inside fills and a break leaves with, is the row of the next turn, also turned round or copied.
"use strict";
function turned(from, to) {
  const n = to.length, m = from.length;
  const kept = [];
  let last = [0, 2, 4, 6];
  for (let i = m; i > 0; i--) {
    const row = [i];
    let j = 1;
    while (j <= n) { row.push(last[j - 1]); j++; }
    last = row.reverse();
    if (i === 3) { kept.push(row); break; }
  }
  return last[n];
}
function kept(from, to) {
  const n = to.length, m = from.length;
  let last = [0, 2, 4, 6];
  for (let i = 1; i <= m; i++) {
    const row = [i, i];
    for (let j = 1; j <= n; j++) row.push(last[j]);
    last = row;
    if (i > 2 && row.length > 4) break;
  }
  return last;
}
function copied(from, to) {
  const n = to.length, m = from.length;
  let last = [0, 2, 4, 6];
  outer: for (let i = 1; i <= m; ++i) {
    const row = [i];
    for (let j = 1; j <= n; ++j) row.push(last[j - 1]);
    last = i & 1 ? [...row] : row.slice();
    if (i > 2) break outer;
  }
  return last;
}
const held = JSON.parse("{}");
held["turned" + process.pid] = turned;
held["kept" + process.pid] = kept;
held["copied" + process.pid] = copied;
for (const [from, to] of [["kitten", "sitting"], ["abc", "abcabcab"], ["xyabxyabxyabxyabxyabxyabxyabxyabxyabxyab", "aybaybaybayb"], ["ccccc", "cbc"], ["2bx2wc2a1wb2,zya", "ab"]]) {
  console.log(JSON.stringify(turned(from, to)), JSON.stringify(held["turned" + process.pid](from, to)));
  console.log(JSON.stringify(kept(from, to)), JSON.stringify(held["kept" + process.pid](from, to)));
  console.log(JSON.stringify(copied(from, to)), JSON.stringify(held["copied" + process.pid](from, to)));
}
