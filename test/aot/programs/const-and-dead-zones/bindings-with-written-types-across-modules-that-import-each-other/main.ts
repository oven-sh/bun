// The same while the module stands at an await, and across modules that import each other.
import { early, later as theirs } from "./other";
function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
const seen: unknown[] = [];
queueMicrotask(() => seen.push(attempt(() => count + 1), attempt(() => name.length), attempt(() => box.v.w)));
await null;
await null;
export const count: number = 5;
export const name: string = "text";
export const box: { v: { w: number } } = { v: { w: 7 } };
console.log(seen.join("|"), count + name.length + box.v.w, early, theirs);
