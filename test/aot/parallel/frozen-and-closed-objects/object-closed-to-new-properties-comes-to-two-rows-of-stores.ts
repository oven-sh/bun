// an object that is closed to new properties comes to two rows of stores with a call between them: the first row stores into a property that it has, the second creates one
type Point = { x: number; y?: number };
function between() { return 1; }
function make(v: number): Point { return { x: v }; }
function subject(o: Point, v: number) { o.x = v; between(); o.y = v; return Object.keys(o).join() + " " + o.x + "," + o.y; }
function deed(o: Point, v: number) { try { return subject(o, v); } catch (e) { return (e as Error).name + " " + Object.keys(o).join() + " " + o.x; } }
console.log(deed(make(1), 2));
let text = "";
for (let i = 0; i < 300; i++) text = deed(make(i), i + 1);
console.log(text);
console.log(deed(Object.preventExtensions(make(3)), 4));
console.log(deed(Object.seal(make(5)), 6));
console.log(deed(make(7), 8));
