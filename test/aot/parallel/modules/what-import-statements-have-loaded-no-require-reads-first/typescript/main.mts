// The same in TypeScript: plain.cts says nothing of CommonJS.
import "./plain.cts";
const plain: unknown = require("./plain.cts");
console.log((globalThis as any).seen.join(" "), typeof plain);
