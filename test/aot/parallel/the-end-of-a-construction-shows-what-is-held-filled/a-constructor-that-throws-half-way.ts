class Fuse { a: number; b: number; constructor(a: number) { this.a = a; if (a === 7) throw new RangeError("seven"); this.b = a * 2; } }
function FuseF(this: { a: number; b: number }, a: number) { this.a = a; if (a === 7) throw new RangeError("seven"); this.b = a * 2; }
const Fuse2 = FuseF as unknown as { new (a: number): { a: number; b: number } };
function sum(x: { a: number; b: number }): number { return x.a + x.b; }
let total = 0; let caught = 0;
for (let i = 0; i < 300; i++) { try { total += sum(new Fuse(i % 10)) + sum(new Fuse2(i % 10)); } catch (e) { caught += (e as Error).message.length; } }
console.log(total, caught);
export {};
