// What is printed is what plain Bun prints.
function never() { const l = Array(1000000); let n = 0; for (let i = 0; i < 15000; i++) n += [...l].length; return n; }
process.on("made-up-event", never);
console.log(new RegExp("x" + process.argv.length).source.length > 0);
