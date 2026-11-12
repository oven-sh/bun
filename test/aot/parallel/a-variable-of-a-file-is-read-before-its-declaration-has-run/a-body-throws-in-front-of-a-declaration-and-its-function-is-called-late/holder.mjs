globalThis.readLate = readLimit;
if (process.argv.length < 99) throw new Error("in the middle");
const limit = process.argv.length + 40;
function readLimit() { return limit; }
