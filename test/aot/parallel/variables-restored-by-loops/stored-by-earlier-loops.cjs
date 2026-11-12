// Three loops store a variable before its declaration has run, and an iteration fails behind the store.
const count = +process.argv[2] || 6;
const held = JSON.parse('["x",null]'), mixed = JSON.parse('["p",2,3,4]'), counter = JSON.parse('{"k":1}');
let sum = 0;
const seen = [];
function look() { return JSON.stringify(flag) + " " + JSON.stringify(record); }
process.on("exit", () => { console.log("exit", sum); });
let flag = true;
for (let i = count; i-- > 0; ) { record = { k: i }; held[0] = held[0] + 1.5; held[0] = mixed[i & 3] | 0; if (mixed[i & 3] === "late") break; sum += held[0] & 3; }
try { for (let i = 0; i < count; i++) { record = { k: i }; held[i & 1] = held[(i + 1) & 1] - 1; sum += mixed[i & 3] & 7; seen.push(i); } } catch (error) { console.log("caught", error.name); }
for (let i = count; i-- > 0; ) { counter.k = counter.k + 1; held[0] = counter.k; if (i !== 1) { record = { k: i }; } }
var record = { k: -1 };
console.log(sum, seen.length, look(), held.join(), mixed.join(), JSON.stringify(counter));
for (let i = 0; i < count; i++) { flag = i > 2; record = { k: i }; mixed[i & 3] = mixed[i & 3] + held[0]; seen.push(i); sum += record.k; }
console.log(sum, seen.length, look(), held.join(), mixed.join());
