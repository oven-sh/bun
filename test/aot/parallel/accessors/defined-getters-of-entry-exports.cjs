// STATISTIC: AccessesProven >= 3
// The loader reads every enumerable property of the entry's exports once the body has run.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const log = [];
let reads = 0;
class Node4 {
  constructor(kind, flags) { this.kind = kind; this.flags = flags; this.parent = undefined; }
  depth() { let depth = 0; for (let node = this; node; node = node.parent) depth += node.flags; return depth; }
}
function create(kind, parent) { const node = new Node4(kind, 1); node.parent = parent; return node; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let node; for (let k = 0; k < 8; k++) node = create(k & 3, node); sum += node.depth() + node.kind; } return sum; }
Object.defineProperty(exports, "Node4", { enumerable: true, get: function () { log.push("Node4 " + (this === exports)); return Node4; } });
Object.defineProperty(exports, "run", { enumerable: true, get() { reads++; return run; } });
Object.defineProperty(exports, "create", { enumerable: true, get: () => create });
Object.defineProperty(exports, "hidden", { get: () => { log.push("hidden"); return 1; } });
Object.defineProperty(exports, "broken", { enumerable: true, get: () => { log.push("broken"); throw new Error("broken"); } });
Object.defineProperty(exports, "late", { enumerable: true, get: () => late });
Object.defineProperty(exports, "stores", { enumerable: true, get: function () { this.stored = new Node4(7, 2); return this.stored.kind; } });
exports.plain = create(5, create(6));
let late = "late";
log.push("end of body " + run(100) + " " + reads);
setTimeout(() => {
  console.log(log.join("\n"));
  console.log(reads, exports.plain.depth(), exports.plain.parent.kind, exports.stored && exports.stored.kind, Object.keys(exports).join());
  console.log(run(50), exports.run(20), new exports.Node4(3, 4).depth(), exports.create(1).kind, exports.late);
  try { exports.broken; } catch (error) { console.log(error.message); }
}, 0);
