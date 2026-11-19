const values = [0, 1, -0, NaN, "", "a", "0", null, undefined, true, false, 0n, 7n, {}, [], Symbol("s"), () => 0, new String(""), new Number(0), 1e-320, Infinity];
const pick = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]");
const records = values.map(value => JSON.parse("{}")); records.forEach((record, k) => { record.flag = values[k]; });
function f(x, t) { const record = records[pick[t % pick.length]]; let s = 0; for (let i = 0; i < 20; i++) { s += record.flag ? 2 : 1; s += (record.flag || "none") === "none" ? 3 : 5; if (i === 11 && t % 4 === 1) record.flag = record.flag ? 0 : "turned"; } return s; }
const said = []; const rounds = Number(process.argv[2] ?? 42);
for (let t = 0; t < rounds; t++) said.push(f(values[pick[t % pick.length]], t));
console.log(said.join(" "));
