// Arrays by new Array(length), their last element, and arrays as stacks.
const constLength: number = 8;
let letLength: number = 8;
var varLength: number = 8;
function make(n: number): number[] { return new Array(n); }
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
const points: Point[] = []; for (let i = 0; i < 100; i++) points.push(new Point(i, 1));
const stack: Point[] = []; for (let i = 0; i < 100; i++) stack.push(new Point(i, 1));
const nested: number[][] = [[1, 2], [3]];
const loops: Record<string, (n: number) => number> = {
  "new Array(a const)": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const a: number[] = new Array(constLength); a[0] = i; s = (s + a[0]!) | 0; } return s; },
  "new Array(a let)": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const a: number[] = new Array(letLength); a[0] = i; s = (s + a[0]!) | 0; } return s; },
  "new Array(a var)": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const a: number[] = new Array(varLength); a[0] = i; s = (s + a[0]!) | 0; } return s; },
  "new Array(a parameter)": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const a = make(8 + (i & 1)); a[0] = i; a[1] = 2; s = (s + a[0]! + a[1]!) | 0; } return s; },
  "an array of nine literal elements": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const a = [i, 2, 0, 0, 0, 0, 0, 0, 0]; a[1] = i & 1; s = (s + a[0]! + a[1]!) | 0; } return s; },
  "the last element by its index": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const p = points[points.length - 1]!; p.x = i; s = (s + p.x + p.y) | 0; } return s; },
  "the last element by at(-1)": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const p = points.at(-1)!; p.x = i; s = (s + p.x + p.y) | 0; } return s; },
  "a push and a shorter length": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { stack.push(stack[i % 50]!); const p = stack[stack.length - 1]!; stack.length = stack.length - 1; s = (s + p.x) | 0; } return s; },
  "a push and a pop": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { stack.push(stack[i % 50]!); const p = stack.pop()!; s = (s + p.x) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name]!(40));
else console.log(loops[loop]!(Number(iterations)));
export {};
