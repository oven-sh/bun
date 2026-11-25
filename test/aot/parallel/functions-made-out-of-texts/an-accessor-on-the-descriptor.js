// What is printed is what plain Bun prints.
function never() { const big = {}; const d = {}; d.__defineGetter__("value", Array.prototype.fill.bind(big)); big.length = 300000000; return Object.defineProperty({}, "k", d); }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
