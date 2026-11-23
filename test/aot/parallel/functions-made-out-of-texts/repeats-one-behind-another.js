// What is printed is what plain Bun prints.
function never() { let s = "a"; for (let i = 0; i < 15; i++) s += s; return /a*a*a*a*a*c/.test(s); }
process.on("made-up-event", never);
console.log(new RegExp("x" + process.argv.length).source.length > 0);
