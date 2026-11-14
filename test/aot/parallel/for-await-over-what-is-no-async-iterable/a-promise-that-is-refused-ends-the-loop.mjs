const log = [];
function* numbers() { try { yield 1; yield Promise.reject(new RangeError("too far")); yield 3; } finally { log.push("closed"); } }
try { for await (const number of numbers()) log.push(number); } catch (error) { log.push(error.name, error.message); }
console.log(log.join());
