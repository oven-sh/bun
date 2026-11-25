// What is printed is what plain Bun prints.
function never() { const big = {}; const part = { toString: Array.prototype.fill.bind(big) }; const e = new Error("x"); e.message = part; big.length = 300000000; return String(e); }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
