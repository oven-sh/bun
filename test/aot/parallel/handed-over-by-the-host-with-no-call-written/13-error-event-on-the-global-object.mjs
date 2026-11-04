class Failure extends Error { constructor() { super("no"); this.code = 1; } }
const kept = new Failure();
function next(failure) { return failure.code + 1; }
globalThis.addEventListener("error", event => { if (event.error) event.error.code = "text"; event.preventDefault(); });
process.on("uncaughtException", () => {});
setTimeout(() => { reportError(kept); }, 0);
setTimeout(() => { console.log(next(kept)); }, 5);
console.log(next(kept));
