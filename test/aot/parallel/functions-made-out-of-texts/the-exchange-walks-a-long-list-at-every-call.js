// What is printed is what plain Bun prints.
function never() { const holder = { a: Array(1000000) }; let seen = 0; for (let i = 0; i < 20000; i++) seen += Object.values(holder).length; return seen; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`SAID ok`);
