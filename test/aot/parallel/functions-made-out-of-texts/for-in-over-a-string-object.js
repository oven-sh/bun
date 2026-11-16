// What is printed is what plain Bun prints.
function never() { const text = new String("x".repeat(100000)); let n = 0; for (let i = 0; i < 100000; i++) { for (const k in text) { n++; break; } } return n; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
