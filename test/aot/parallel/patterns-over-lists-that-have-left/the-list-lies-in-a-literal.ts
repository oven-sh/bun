// The list is stored into the literal that the call hands over, and the pattern of the callee takes it apart: each step is the element.
type Point = { x: number; y: number; tags: number[] };
function norm({ x, y, tags: [first, second = 3] }: Point): number { return x * x + y * y + first + second; }
let total = 0;
for (let i = 0; i < 1000; i++) { const [a, b] = [i & 7, i & 15]; total += norm({ x: a, y: b, tags: [a] }) + norm({ x: a, y: b, tags: [a, b, 9] }); }
console.log(total, norm({ x: 1, y: 2, tags: [] }));
