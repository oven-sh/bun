// STATISTIC: MapEntryIndicesSurvivingInserts >= 1
const turns = Number(process.argv[2] ?? 3);
const said = [];
const tell = (...words) => said.push(words.map(word => (typeof word === "object" && word !== null ? JSON.stringify(word) : String(word))).join(" "));
const keys = JSON.parse('[1,2,3,1,2,9,4,4,1,7,3,9,12,1,5]');
const every = [0, -0, NaN, 1.5, "1", 1, "", null, undefined, true, 2 ** 40, "a" + JSON.parse('"b"'), "ab", Symbol.iterator, 1n, 0, NaN, "1", null, undefined];
function run(turn) { const a = new Map([[NaN, "nan"], ["ab", "text"]]); let s = ""; for (let i = 0; i < every.length; i++) { const k = every[i]; if (!a.has(k)) a.set(k, i); s += String(a.get(k)) + ","; } tell(s, a.size); }
for (let turn = 0; turn < turns; turn++) run(turn);
for (const line of said) console.log("SAID", line);
