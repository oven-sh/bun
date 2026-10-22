// When the entry point has run, Bun looks at what it exports for a server to start. For a CommonJS file that reads every enumerable property of module.exports, so the getters among them run, once each, behind the last statement.
class Validator {}
module.exports = exports = Validator;
let reads = 0;
Object.defineProperty(exports, "shown", { enumerable: true, get: function () { console.log("shown is read", ++reads); return 1; } });
Object.defineProperty(exports, "hidden", { enumerable: false, get: function () { console.log("hidden is read", ++reads); return 2; } });
Object.defineProperty(exports, "failing", { enumerable: true, get: function () { console.log("failing is read", ++reads); throw new Error("from a getter"); } });
Object.defineProperty(exports, "last", { enumerable: true, get() { console.log("last is read", ++reads); return this === Validator; } });
process.on("exit", () => console.log("reads at the exit", reads));
console.log("the last statement");
