// What is printed is what plain Bun prints.
function never() { return /^(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)(?:a|aa)b/.test("a".repeat(60)); }
process.on("made-up-event", never); const started = new RegExp("x" + process.argv.length); console.log("SAID ok");
