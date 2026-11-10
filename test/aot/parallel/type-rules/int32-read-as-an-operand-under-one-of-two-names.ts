// What bounds the variable of the loop is read out of an int32 under a key that is one of two names: it enters no position, and the step of the loop is proven by it all the same.
import type { int32 } from "bun";
class Point { x: int32 = 7; y: int32 = 12; }
function countTo(point: Point, key: "x" | "y"): int32 { let sum: int32 = 0; for (let i: int32 = 0; i < point[key]; i++) sum = (sum + i) | 0; return sum; }
function countDown(point: Point, key: "x" | "y"): int32 { let n: int32 = 0; for (let i: int32 = 0; point[key] > i; i++) n = i; return n; }
function largest(point: Point, key: "x" | "y"): int32 { return Math.max(point[key], point.x); }
const key: "x" | "y" = Date.now() > 0 ? "y" : "x";
console.log(countTo(new Point(), key), countDown(new Point(), key), largest(new Point(), key));
