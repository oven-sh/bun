// What is printed is what plain Bun prints.
function never() { let s = "a"; for (let i = 0; i < 15; i++) s += s; return s.search(/a*a*a*a*a*c/); }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
