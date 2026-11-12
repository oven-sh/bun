// The text of a class, evaluated again, stores its parameter properties as the class does.
class Point { constructor(public x: number, readonly y: number = 2) {} }
const text = String(Point);
console.log(text.includes("this.x"), new Point(5).x);
let again: unknown;
try { const Again = (0, eval)("(" + text + ")"); again = new Again(5).x; } catch (error) { again = (error as Error).name; }
console.log(again);
