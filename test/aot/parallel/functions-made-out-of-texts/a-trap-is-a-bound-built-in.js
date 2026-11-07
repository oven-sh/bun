// What is printed is what plain Bun prints.
function never() { const big = {}; const p = new Proxy({}, { has: Array.prototype.fill.bind(big) }); big.length = 300000000; return "x" in p; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
