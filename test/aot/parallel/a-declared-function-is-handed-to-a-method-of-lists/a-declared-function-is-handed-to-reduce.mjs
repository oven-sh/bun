const crates = JSON.parse(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, weight: 1 + (i % 4), label: "crate" + i }))));
function heavier(total, crate) { return total + crate.weight; }
const work = (crates, turn) => { return crates.reduce(heavier, turn); };
const works = new Map([["work", work]]);
const job = JSON.parse('["work"]')[0];
let sum = 0;
for (let turn = 0; turn < 60; turn++) sum = (sum * 31 + works.get(job)(crates, turn) + (turn & 3)) | 0;
console.log(sum);
// STATISTIC: CallsInlined >= 4
