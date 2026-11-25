// the entry point is an ES module: it calls import() of a file that always throws, requires the file twice, then awaits the call: three runs
const told = [];
const waits = import("./thrower.cjs");
try { require("./thrower.cjs"); told.push("required"); } catch (error) { told.push("first: " + error.message); }
try { require("./thrower.cjs"); told.push("required"); } catch (error) { told.push("second: " + error.message); }
try { await waits; told.push("imported"); } catch (error) { told.push("import: " + error.message); }
console.log(told.join(" | "), globalThis.runs);
