// What is printed is what plain Bun prints.
function never() { const s = "a".repeat(60); let n = 0, kept; for (let i = 0; i < 180; i++) { n += /^(?:a|aa)+b/.test(s) ? 1 : 0; kept = new RegExp("x" + i); } return [n, kept]; }
process.on("made-up-event", never); const started = new RegExp("x" + process.argv.length); console.log("SAID ok");
