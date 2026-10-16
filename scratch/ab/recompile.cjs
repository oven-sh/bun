const util = require("node:util");
const raw = { customInspect: false };
const shape = process.argv[2];
class Point { constructor() { this.x = 1; this.y = 2; } }
const value = shape === "nullProto" ? Object.assign(Object.create(null), { x: 1, y: 2 }) : shape === "classInstance" ? new Point() : { x: 1, y: 2 };
const t0 = performance.now();
for (let i = 0; i < 200000; i++) util.inspect(value, raw);
console.error("ms", Math.round(performance.now() - t0));
