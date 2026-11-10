// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 1
// STATISTIC: ReadsByNameThatAskTheirSitesAlone >= 1
const rounds = +process.argv[2] || 3;
const data = JSON.parse('{"rows":[3,1,4,1,5,9,2,6,5,3,5]}');
let s = rounds & 1;
for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i];
console.log(s);
