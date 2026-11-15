// What is printed is what plain Bun prints.
function never() { const big = new Array(1000000); for (let i = 0; i < 100000; i++) Math.max.apply(null, big); return 0; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
