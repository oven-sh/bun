// between two rows of stores into an object a function of the program puts a prototype above it that has a setter for the property which the second row creates
type Point = { x: number; y?: number };
const log: string[] = [];
const above = { set y(v: number) { log.push("setter " + v); } };
let held: Point | undefined;
function between() { if (held) Object.setPrototypeOf(held, above); }
function make(v: number): Point { return { x: v }; }
function subject(o: Point, v: number) { o.x = v; between(); o.y = v; return Object.keys(o).join() + " " + o.x; }
function deed(o: Point, v: number) { return subject(o, v); }
console.log(deed(make(1), 2));
let text = "";
for (let i = 0; i < 300; i++) text = deed(make(i), i);
console.log(text);
held = make(5);
console.log(deed(held, 6), log.join());
console.log(deed(make(7), 8), log.join());
