// Exit code: 1
const report = [reportError, queueMicrotask][process.argv.length > 9 ? 1 : 0];
try { report(console); } catch (e) { console.log(e.name); }
console.log("done");
