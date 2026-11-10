// STATISTIC: PlacesOfKeysThatStandBehindStoresWhereTestsFoundNoKey >= 1
const turns = Number(process.argv[2] ?? 3);
const said = [];
const tell = (...words) => said.push(words.map(word => (typeof word === "object" && word !== null ? JSON.stringify(word) : String(word))).join(" "));
const keys = JSON.parse('[1,2,3,1,2,9,4,4,1,7,3,9,12,1,5]');
function run(turn) { const a = new Map(); let s = 0; for (let i = 0; i < 3000; i++) { const k = (i * 7919) % 1501; if (!a.has(k)) a.set(k, i); s = (s * 31 + a.get(k)) | 0; } tell(s, a.size); }
for (let turn = 0; turn < turns; turn++) run(turn);
for (const line of said) console.log("SAID", line);
