// The header of a loop stores the variable that its iterations read.
const count = +process.argv[2] || 9, list = [0, 1, 2, 3, 4, 5].slice(0, count + 1);
const held = JSON.parse('["x","y"]'), mixed = JSON.parse("[1,2]"), steps = JSON.parse("[1,0.5]"), counter = JSON.parse('{"k":1}');
let sum = 0;
const seen = [];
function size(x) { return typeof x === "number" ? x & 1023 : typeof x === "string" ? x.length : typeof x === "bigint" ? Number(x) & 7 : x === undefined ? 1e6 : x.length; }
function look() { return String(large) + " " + String(either); }
process.on("exit", () => { console.log("exit", sum, 0); });
for (let i = 0; i < count; i++) { mixed[i & 3] += steps[i & 1] * 2; if (mixed[i & 3] === "late") break; for (let k = 0; k < 2; k++) { held[0] = held[0] + 1.5; } }
try { for (let i = count; i-- > 0; ) { mixed[i & 3] = mixed[i & 3] + held[0]; mixed[i] = i; sum += mixed[i & 3] & 7; sum += held[0] & 3; } } catch (error) { console.log("caught", error.name); }
for (let i = 0; (large = BigInt(i), i < count); i++) { held[0] = mixed[i & 3] | 0; sum += size(large); if (i === 4) continue; }
var large;
for (let i = 0; (either = i & 1 ? i : "s" + i, i < count); i++) { held[0] = held[0] + 1.5; sum += size(either); if (i === 4) continue; }
var either;
console.log(sum, seen.length, look(), held.join(), mixed.join(), JSON.stringify(counter));
for (let i = 0; i < list.length; i++) { mixed[i] = i; sum += held[0] & 3; large = BigInt(i); sum += size(large); }
console.log(sum, seen.length, look(), held.join(), mixed.join());
module.exports = { seen };
