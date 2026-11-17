const rounds = Number(process.argv[2] || 2000), inner = JSON.parse("64");
const list = JSON.parse("[3,1,4,1,5,9,2,6]");
let sum = 0;
for (let outer = 0; outer < rounds; outer++) { const helper = require("./helper.cjs"); for (let turn = 0; turn < inner; turn++) sum = helper.add(sum, list[turn & 7] * 3) | 0; }
console.log("SAID", sum);
