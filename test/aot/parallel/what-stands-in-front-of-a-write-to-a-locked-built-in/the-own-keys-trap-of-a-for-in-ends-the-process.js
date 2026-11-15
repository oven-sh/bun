// The trap ends the process: the write behind the for-in is never reached.
const other = new Proxy({}, { ownKeys() { console.log("left"); process.exit(Number(process.argv[2] ?? 0)); } });
for (const name in other) { }
Object.keys = function () { return []; };
console.log("came to the end");
