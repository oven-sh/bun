// What is printed is what plain Bun prints.
function never() { const l = "a".repeat(30000).split(""); return l.flatMap(Array.prototype.concat.bind([])).length; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
