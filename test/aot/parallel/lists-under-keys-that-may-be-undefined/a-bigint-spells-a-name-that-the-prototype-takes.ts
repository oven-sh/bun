// 123456789012345678901234567890n as a key spells a text that is no number's name, so Array.prototype takes it. The getter there gets the list as `this` and writes a text into a list of numbers and into a field of numbers.
class Arc { to: number; cap: number; constructor(to: number, cap: number) { this.to = to; this.cap = cap; } }
Object.defineProperty(Array.prototype, "123456789012345678901234567890", { get(this: unknown[]) { const first = this[0]; if (first instanceof Arc) (first as unknown as { cap: unknown }).cap = "text"; else this[0] = "text"; return this.length; }, configurable: true });
const list: number[] = [1, 2, 3], arcs: Arc[] = [new Arc(1, 5), new Arc(2, 7)];
const keys: (bigint | undefined)[] = [undefined, 1n, 123456789012345678901234567890n, 123456789012345678901234567890n];
console.log(list[keys.pop() as unknown as number], arcs[keys.pop() as unknown as number], list[keys.pop() as unknown as number], list[keys.pop() as unknown as number], list[keys.pop() as unknown as number]);
let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]!;
let caps = 0; for (const a of arcs) caps += a.cap;
console.log(sum, caps, typeof list[0], typeof arcs[0]!.cap);
