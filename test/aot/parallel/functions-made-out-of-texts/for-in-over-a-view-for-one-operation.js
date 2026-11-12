// What is printed is what plain Bun prints.
function never() { const view = new Uint8Array(1000000); let n = 0; for (let i = 0; i < 100000; i++) { for (const k in view) { n++; break; } } return n; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
