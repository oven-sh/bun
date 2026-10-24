// Untyped programs: h process on exit. It prints what plain Bun prints.
process.on("exit", code => console.log(code + 1));
