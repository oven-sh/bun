const log = [];
function* numbers() { try { yield 1; yield 2; yield 3; } finally { log.push("closed"); } }
for await (const number of numbers()) { log.push(number); if (number === 2) break; }
console.log(log.join());
