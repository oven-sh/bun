// What is printed is what plain Bun prints.
function never() { const big = {}; Object.defineProperty(big, "toString", Object.getOwnPropertyDescriptor(Array.prototype, "fill")); big.length = 300000000; return [big].join(); }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
