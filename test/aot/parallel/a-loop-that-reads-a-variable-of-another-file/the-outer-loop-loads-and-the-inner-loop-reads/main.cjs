let sum = 0;
for (let outer = 0; outer < Number("2"); outer++) { const helper = require("./helper.cjs"); for (let turn = 0; turn < 3; turn++) sum += helper.read(turn); }
console.log(String(sum));
