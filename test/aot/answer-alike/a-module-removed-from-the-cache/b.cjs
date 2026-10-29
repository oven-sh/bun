// a.cjs, and a second place requires the module in a loop.
const first = require("./counted.cjs");
let answer; try { delete require.cache[require.resolve("./counted.cjs")]; const second = require("./counted.cjs"); answer = [first.run, second.run, first === second].join(" "); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); }
console.log(answer);
for (let i = 0; i < 2; i++) require("./counted.cjs");
