const crates = JSON.parse(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, weight: 1 + (i % 4), label: "crate" + i }))));
let seen = 0;
function look(crate) { seen += crate.id; }
const work = (crates, turn) => { return (crates.forEach(look), seen & 1023); };
const works = new Map([["work", work]]);
const job = JSON.parse('["work"]')[0];
let sum = 0;
for (let turn = 0; turn < 60; turn++) sum = (sum * 31 + works.get(job)(crates, turn) + (turn & 3)) | 0;
console.log(sum);
// STATISTIC: CallsInlined >= 4
