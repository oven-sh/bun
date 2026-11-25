// What is printed is what plain Bun prints.
function never() { const l = "a".repeat(30000).split(""); return l.map(Array.prototype.concat.bind([])).length; }
process.on("made-up-event", never);
console.log(new RegExp("x" + process.argv.length).source.length > 0);
