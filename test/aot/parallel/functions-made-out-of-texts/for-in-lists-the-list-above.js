// What is printed is what plain Bun prints.
function never() { const list = "x".repeat(100000).split(""); let n = 0; for (let i = 0; i < 100000; i++) { for (const k in { __proto__: list }) { n++; break; } } return n; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
