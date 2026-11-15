// Two types of the file have the same names, so their objects have one layout, and its fields are declared numbers. What is read through the type that says int32 is an int32, as an operand too.
import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
type Other = { x: number; y: number };
function sum(o: Other): number { return o.x + o.y; }
function largest(point: Point): int32 { return Math.max(point.x, point.y); }
function smallest(point: Point): int32 { return Math.min(point.x, point.y); }
function countTo(point: Point): int32 { let n: int32 = 0; for (let i: int32 = 0; i < point.x; i++) n = i; return n; }
console.log(largest({ x: 1, y: 2 }), smallest({ x: 1, y: 2 }), countTo({ x: 3, y: 0 }), sum({ x: 0.5, y: 1.5 }));
