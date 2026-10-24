// Objects inside objects, one probe of many. It prints what plain Bun prints.
import { generateHeapSnapshot } from "bun";
import { writeHeapSnapshot, getHeapSnapshot } from "node:v8";
interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const kept: Outer[] = []; const inners: Inner[] = [];
for (let i = 0; i < 1000; i++) { kept.push(make(i)); inners.push(make(i).c); }
const snapshot: any = generateHeapSnapshot();
console.log(typeof snapshot, Array.isArray(snapshot.nodes), snapshot.nodes.length > 1000);
const v8: any = generateHeapSnapshot("v8");
console.log(typeof v8, v8.length > 1000);
let s = 0; for (const o of kept) s += o.c.d; for (const c of inners) s += c.e;
console.log(s);
