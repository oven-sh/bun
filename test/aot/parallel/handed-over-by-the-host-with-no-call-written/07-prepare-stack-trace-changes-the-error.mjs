class Failure extends Error { constructor() { super("no"); this.code = 1; } }
function next(failure) { return failure.code + 1; }
Error.prepareStackTrace = (error, sites) => { error.code = "text"; return "trace"; };
const kept = new Failure();
console.log(next(kept));
console.log(typeof kept.stack);
console.log(next(kept));
