setTimeout(() => { try { console.log("timer", readLimit()); } catch (error) { console.log("timer threw", error.constructor.name + ":", error.message); } }, 1);
if (process.argv.length < 99) throw new Error("in the middle");
const limit = process.argv.length + 40;
function readLimit() { return limit; }
