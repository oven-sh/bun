// What is printed is what plain Bun prints.
function never() { const big = {}; const o = {}; o.__defineGetter__("hasIndices", Array.prototype.fill.bind(big)); o.__defineGetter__("x", Object.getOwnPropertyDescriptors(RegExp.prototype).flags.get); big.length = 300000000; return o.x; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
