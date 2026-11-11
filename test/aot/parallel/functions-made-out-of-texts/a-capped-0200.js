// What is printed is what plain Bun prints.
function never() { const s = "a".repeat(60); let n = 0; for (let i = 0; i < 200; i++) n += /^(?:a|aa)+b/.test(s) ? 1 : 0; return n; }
process.on("made-up-event", never); const started = new RegExp("x" + process.argv.length); console.log("SAID ok");
