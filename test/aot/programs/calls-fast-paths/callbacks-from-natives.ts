// Built-in functions that call a callback in a loop call a compiled function efficiently.
declare const console: any;
const numbers: number[] = []; for (let i = 0; i < 2000; i++) numbers.push((i * 7919) % 2003);
const floats = new Float64Array(numbers);
let text = ""; for (let i = 0; i < 500; i++) text += "ab" + (i % 10);
class Box { constructor(private v: number) {} get value(): number { return this.v; } }
const box = new Box(2);
let sum = 0;
for (let round = 0; round < 50; round++) { const copy = numbers.slice(); copy.sort((a: number, b: number): number => a - b); sum += copy[round]; }
for (let round = 0; round < 125; round++) { floats.forEach((v: number): void => { sum += v; }); sum += floats.every((v: number): boolean => v >= 0) ? 1 : 0; sum += floats.reduce((s: number, v: number): number => s + v, 0); sum += floats.map((v: number, i: number): number => v + i)[round]; }
for (let round = 0; round < 2000; round++) sum += text.replace(/b\d/g, (b: string, at: number): string => at > 100 ? "x" : b).length;
for (let i = 0; i < 1_000_000; i++) sum += Reflect.get(box, "value") as number;
console.log(sum);
export {};
