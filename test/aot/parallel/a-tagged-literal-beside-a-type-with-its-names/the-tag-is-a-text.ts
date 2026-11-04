interface Named { name: string }
type Shape = { type: "circle"; name: string; r: number } | { type: "square"; name: string; side: number };
function area(s: Shape): number { return s.type === "circle" ? 3 * s.r * s.r : s.side * s.side; }
function greet(n: Named): string { return "hello " + n.name; }
const shapes: Shape[] = [{ type: "circle", name: "c", r: 2 }, { type: "square", name: "s", side: 3 }];
let sum = 0; let said = ""; for (let i = 0; i < 4; i++) { sum += area(shapes[i % 2]); said += greet(shapes[i % 2]) + ";"; }
console.log(sum, said, greet({ name: "plain" }));
