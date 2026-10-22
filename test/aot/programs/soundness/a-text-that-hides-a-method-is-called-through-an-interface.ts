// An own property hides a method of the class with a text, and the method is called where an interface is declared: a TypeError, as for any call of what is no function.
declare const console: { log(...values: unknown[]): void };
interface Shape { x: number; m(): number }
class K { x = 1; m() { return 3; } }
const o: Shape = new K();
(o as any).m = "text";
let answer; try { answer = o.m(); } catch (e) { answer = (e as Error).name; }
console.log(answer, Object.keys(o).join());
