// A module is taken out of require.cache and required again.
const first = require("./counted.cjs");
let answer; try { delete require.cache[require.resolve("./counted.cjs")]; const second = require("./counted.cjs"); answer = [first.run, second.run, first === second].join(" "); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); }
console.log(answer);
