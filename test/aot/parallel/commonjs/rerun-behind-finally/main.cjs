// A file whose first run threw runs again at the next require(). A `finally` that leaves by itself swallows the throw as a `catch` does.
const again = name => { const { v } = require(name); return v; };
out: { try { require("./by-a-break.cjs"); } finally { break out; } }
console.log("a break", again("./by-a-break.cjs"));
function load() { try { return require("./by-a-return.cjs").v; } finally { return "swallowed"; } }
console.log("a return", load(), again("./by-a-return.cjs"));
for (const turn of [1, 2]) { try { console.log("a continue", turn, require("./by-a-continue.cjs").v); } finally { continue; } }
try { try { require("./by-a-throw.cjs"); } finally { throw new RangeError("of the finally"); } } catch (e) { console.log("a throw", e.name); }
console.log("a throw", again("./by-a-throw.cjs"));
try { try { require("./passed-on.cjs"); } finally { console.log("passed on"); } } catch (e) { console.log("passed on", e.message); }
console.log("passed on", again("./passed-on.cjs"));
