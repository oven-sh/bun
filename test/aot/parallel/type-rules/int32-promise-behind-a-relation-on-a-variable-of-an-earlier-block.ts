// The value that enters the int32 has no int32 written. It is made in an earlier block; the test that bounds it stands on the way to the block in which the promise is made.
import type { int32 } from "bun";
class Point { x: int32 = 7; y: int32 = 12; }
function take(n: int32): int32 { return n; }
function upTo(point: Point, key: "x" | "y"): number { let s = 0; for (let i = 0; i < point[key]; i++) s += take(i); return s; }
function upToAndWith(point: Point, key: "x" | "y"): number { let s = 0; for (let i = 0; i <= point[key]; i++) s += take(i); return s; }
function behindATest(point: Point, key: "x" | "y", list: number[]): number { const n = list.length; if (n < point[key]) return take(n); return -1; }
function behindTwoTests(point: Point, key: "x" | "y", list: number[]): number { const n = 5 - list.length; if (n > -100) { if (n < point[key]) return take(n); } return -1; }
const key: "x" | "y" = Date.now() > 0 ? "y" : "x";
console.log(upTo(new Point(), key), upToAndWith(new Point(), key), behindATest(new Point(), key, [1, 2, 3]), behindATest(new Point(), key, new Array(99)), behindTwoTests(new Point(), key, [1]));
