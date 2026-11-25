import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
function name(x: int32): string { switch (x) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; default: return "other"; } }
const seen: Record<string, number> = {};
for (let i = 0; i < 300; i++) { const k = name(f(new Box())); seen[k] = (seen[k] ?? 0) + 1; }
console.log("SAID", JSON.stringify(seen));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
