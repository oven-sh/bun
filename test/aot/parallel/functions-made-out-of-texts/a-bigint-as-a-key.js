// What is printed is what plain Bun prints.
function never() { const b = BigInt("0x" + "f".repeat(100000)); const o = {}; let n = 0; for (let i = 0; i < 5000; i++) n += o[b] === undefined ? 1 : 0; return n; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
