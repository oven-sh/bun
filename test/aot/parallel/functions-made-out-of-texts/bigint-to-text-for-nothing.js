// What is printed is what plain Bun prints.
function never() { const b = BigInt("0x" + "f".repeat(100000)); let n = 0; for (let i = 0; i < 5000; i++) n += String(b).length; return n; }
process.on("made-up-event", never);
console.log(new RegExp("x" + process.argv.length).source.length > 0);
