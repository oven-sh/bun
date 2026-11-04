class Failure extends Error { constructor() { super("no"); this.code = 1; } }
const kept = new Failure();
function next(failure) { return failure.code + 1; }
process.on("uncaughtException", error => { error.code = "text"; });
setTimeout(() => { throw kept; }, 0);
setTimeout(() => { console.log(next(kept)); }, 5);
console.log(next(kept));
