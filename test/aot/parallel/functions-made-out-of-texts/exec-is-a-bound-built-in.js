// What is printed is what plain Bun prints.
function never() { const big = {}; const r = { exec: Array.prototype.fill.bind(big) }; big.length = 300000000; return RegExp.prototype.test.call(r, "x"); }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
