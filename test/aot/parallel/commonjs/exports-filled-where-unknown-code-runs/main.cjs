// The program evaluates text, and a file re-exports what another exports, as TypeScript writes it: nothing about that object is proven. Its body still fills it as a constructor fills
// `this`: a store there expects an empty slot and creates the field behind its tests, and stores that follow each other do so in one step. A store that expected a filled slot went by name.
// STATISTIC: SlotStoreRunGroups >= 6
const made = require("./index.cjs");
console.log(made.NAME_0, made.NAME_59, Object.keys(made).length, Object.keys(made).slice(0, 3).join(), made.__esModule);
console.log((0, eval)(process.argv[9] || "1 + 1"));
const source = require("./made.cjs");
source.NAME_0 = "changed";
console.log(made.NAME_0);
