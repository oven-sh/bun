// Constants, module variables and the fields of an object that a module holds.
const constant: number = 8;
var variable: number = 8;
class Point { x: number; constructor(x: number) { this.x = x; } }
const point: Point = new Point(3);
const numbers: Map<number, number> = new Map([[0, 5], [1, 6]]);
const entries: number[] = [5, 6];
const loops: Record<string, (n: number) => number> = {
  "a const": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + constant) | 0; } return s; },
  "a var": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + variable) | 0; } return s; },
  "a field of a local object": n => { let s = 0; const p = new Point(3); for (let i = 0, end = n | 0; i < end; i++) { p.x = i; s = (s + p.x) | 0; } return s; },
  "a field of a module's object": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { point.x = i; s = (s + point.x) | 0; } return s; },
  "an element of an array": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + entries[i & 1]!) | 0; } return s; },
  "an entry of a Map": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + numbers.get(i & 1)!) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name]!(40));
else console.log(loops[loop]!(Number(iterations)));
export {};
