const KINDS = Object.freeze(["text", "number", "list"] as const);
const LIMITS = Object.freeze([10, 20, 30]);
function kindOf(value: unknown): number { return KINDS.indexOf(Array.isArray(value) ? "list" : typeof value === "number" ? "number" : "text"); }
function limitFor(value: unknown): number { return LIMITS[kindOf(value)] + KINDS.length + (KINDS.includes("list") ? 1 : 0); }
let sum = 0;
for (const value of ["a", 1, [2], "b", 3.5, []]) sum = sum * 7 + limitFor(value);
console.log(sum, KINDS.join("/"), [...LIMITS].reverse().join());
