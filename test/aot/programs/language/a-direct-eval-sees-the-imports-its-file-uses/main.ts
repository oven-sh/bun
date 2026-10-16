// In a TypeScript file a direct eval sees an imported binding that the file's own code uses as a value, and what the file itself exports. An import that only the eval's text names is dropped, as in plain Bun.
import fallback, { bump, count, name } from "./other";
import * as all from "./other";
import type { Shape } from "./other";
import { onlyInTheText } from "./other";
export const own: number = 3;
export let stored: string = "before";
export enum Color { Red, Green }
export function twice(n: number): number { return n * 2; }
const shape: Shape = { size: 1 };

console.log(typeof name, typeof fallback, typeof all, typeof bump, count, shape.size);
console.log(eval("typeof name"), eval("typeof fallback"), eval("typeof all"), eval("typeof bump"), eval("typeof count"));
console.log(eval("typeof own"), eval("typeof stored"), eval("typeof Color"), eval("typeof twice"), eval("typeof Shape"), eval("typeof onlyInTheText"));
console.log(eval("name"), eval("fallback()"), eval("all.name"), eval("own + 1"), eval("Color.Green"), eval("twice(own)"));
bump(); console.log(count, eval("count"));
eval("stored = 'behind'"); console.log(stored);
try { eval("name = 1"); } catch (error) { console.log((error as Error).name, name); }
try { eval("own = 1"); } catch (error) { console.log((error as Error).name, own); }
function inside(text: string): unknown { return eval(text); }
class Holder { method(text: string): unknown { return eval(text); } }
console.log(inside("name + own"), new Holder().method("fallback() + all.count"));
