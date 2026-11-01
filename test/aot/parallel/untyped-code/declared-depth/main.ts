// A JavaScript file has a declaration file of its own, which declares a class whose method takes a number. Only the exports themselves are paired with what the file writes.
// Flags: --aot-limit=MaxDeclaredSignatureDepth:1
// STATISTIC: MaxDeclaredSignatureDepthHits >= 1
import { Counter, add } from "./lib/index.js";
const counter = new Counter(1);
let last = 0;
for (let i = 0; i < 300; i++) last = counter.step(i);
console.log(last, add(2, 3), (counter.step as any)("text"), (add as any)("a", 1));
