// Two loops step a variable of the file and store elements. An exit handler reads the variable.
var steps = 0;
const held = JSON.parse("[0.5,2.5]");
process.on("exit", () => { console.log("exit", steps); });
const count = +process.argv[2] || 6;
function pair() { return [1, 2].map(each => each + 1); }
const pairs = [];
for (let i = 0; i < count; i++) { steps = steps + 1; held[0] = held[0] + 1.5; pairs.push(pair()); }
for (let i = 0; i < count; i++) { steps = steps + 1; held[0] = held[0] + 1.5; pairs.push(pair()); }
console.log(pairs.length);
module.exports = { pairs };
