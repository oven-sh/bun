// The compiler drops the check of a `const` that a read has seen filled earlier in the same function. b.mjs calls each function while this file has not begun, where every read throws.
import { early, setCount, count, Box as Again } from "./b.mjs";
export const V = make();
export class Kind { static of() { return new Kind(); } name() { return "kind " + V; } }
function make() { return 7; }
export function probe(between) {
  let first, second;
  try { first = V; } catch (e) { first = e.name; }
  between();
  try { second = V; } catch (e) { second = e.name; }
  return [first, second];
}
export function twice(between) { const a = V; between(); return a + V; }
export function kinds(between) { const a = Kind.of().name(); between(); return a + "|" + new Kind().name(); }
export function arms(flag, between) { if (flag) { void V; } between(); return V; }
export function loop(n, between) { let sum = 0; for (let i = 0; i < n; i++) { sum += V; between(); } return sum + V; }
console.log("early:", JSON.stringify(early));
console.log(probe(() => {}), twice(() => {}), kinds(() => {}), arms(false, () => {}), arms(true, () => {}), loop(3, () => {}));
console.log("count:", count); setCount(5); console.log("count:", count);
console.log("again:", new Again().size());
try { await import("./throws.mjs"); } catch (e) { console.log("throws:", e.message); }
try { await import("./uses-throws.mjs"); } catch (e) { console.log("uses-throws:", e.message); }
const { kept } = await import("./keeps.mjs"); console.log("kept:", kept());
