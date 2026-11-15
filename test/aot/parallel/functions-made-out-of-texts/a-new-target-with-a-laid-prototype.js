// What is printed is what plain Bun prints.
function never() { const big = {}; const t = {}; t.__defineGetter__("prototype", Array.prototype.fill.bind(big)); big.length = 300000000; return Reflect.construct(function () {}, [], t); }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
