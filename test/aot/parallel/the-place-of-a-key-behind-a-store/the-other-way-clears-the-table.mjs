// STATISTIC: MapEntryIndicesSurvivingInserts >= 1
const turns = Number(process.argv[2] ?? 3);
const said = [];
const tell = (...words) => said.push(words.map(word => (typeof word === "object" && word !== null ? JSON.stringify(word) : String(word))).join(" "));
const keys = JSON.parse('[1,2,3,1,2,9,4,4,1,7,3,9,12,1,5]');
function run(turn) { const a = new Map([[1, 10], [2, 20]]); let s = ""; for (let i = 0; i < keys.length; i++) { const k = keys[i]; if (!a.has(k)) a.set(k, i); else if (i === 8) a.clear(); s += a.get(k) + ","; } tell(s, [...a]); }
for (let turn = 0; turn < turns; turn++) run(turn);
for (const line of said) console.log("SAID", line);
