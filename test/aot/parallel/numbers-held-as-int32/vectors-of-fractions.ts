// vectors of fractions
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Vector { x: number; y: number; z: number; constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } dot(o: Vector) { return this.x * o.x + this.y * o.y + this.z * o.z; } plus(o: Vector) { return new Vector(this.x + o.x, this.y + o.y, this.z + o.z); } times(s: number) { return new Vector(this.x * s, this.y * s, this.z * s); } }
let sum = new Vector(0, 0, 0); const step = new Vector(hidden<number>("0.1"), hidden<number>("0.25"), 1);
for (let i = 0; i < 1000; i++) sum = sum.plus(step.times(i % 3));
(globalThis as any).kept = sum;
console.log(sum.x.toFixed(6), sum.y.toFixed(6), sum.z, sum.dot(step).toFixed(6));
