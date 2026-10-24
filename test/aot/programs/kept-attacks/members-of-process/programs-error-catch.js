// Members of process: programs error catch. It prints what plain Bun prints.
if (process.argv.length > 99) { try { JSON.parse(process.argv[2]); } catch (e) { console.log(e.message); } }
console.log("hello");
