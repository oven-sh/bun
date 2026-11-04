// an object is frozen by a function of the program that is called between two rows of stores into it
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
let held: Point | undefined;
function between() { if (held) Object.freeze(held); }
function subject(o: Point, v: number) { o.x = v; between(); o.y = v; return o.x + "," + o.y; }
function deed(o: Point, v: number) { try { return subject(o, v); } catch (e) { return (e as Error).name + " " + o.x + "," + o.y; } }
const point = new Point(1, 2);
console.log(deed(point, 3));
let text = "";
for (let i = 0; i < 300; i++) text = deed(point, i);
console.log(text);
held = point;
console.log(deed(point, 500));
console.log(deed(point, 501));
console.log(deed(new Point(7, 8), 502));
