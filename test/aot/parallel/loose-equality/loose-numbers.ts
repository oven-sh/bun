// Loose equality of numbers and undefined: fields, variables that are stored late, parameters, elements, both ways, as values and as branches; null beside them.
class Task { state: number | undefined; half: number | undefined; link: number | null | undefined; constructor(state?: number, half?: number, link?: number | null) { this.state = state; this.half = half; this.link = link; } }
var EARLY = first(); var ONE = 1; var LATE: any; var HALF: any = 0.5; var NONE: any;
function first() { return [LATE == undefined, LATE == ONE, ONE == undefined, NONE == LATE, HALF == LATE].join(); }
LATE = 1;
function same(t: Task, u: Task) { return [t.state == u.state, t.state != u.state, t.state === u.state, t.half == u.half, t.half == t.state, t.link == u.state, t.link == u.link, u.state == t.link].map(Number).join(""); }
function branch(t: Task, u: Task) { let n = 0; if (t.state == u.state) n += 1; if (t.state != u.state) n += 2; if (t.half == u.half) n += 4; if (t.link == u.half) n += 8; if (t.state == ONE) n += 16; if (t.half == HALF) n += 32; if (t.state == LATE) n += 64; if (t.state == NONE) n += 128; if (undefined == t.state) n += 256; if (t.link == null) n += 512; return n; }
function loop(tasks: Task[], n: number) { let found = 0, missing = 0; for (let r = 0; r < n; r++) for (let i = 0; i < tasks.length; i++) { const t = tasks[i]!, u = tasks[(i + r) % tasks.length]!; if (t.state == u.state) found++; if (t.state == u.half) found += 2; if (t.half == undefined) missing++; if (t.link == u.state) missing += 2; } return found + "," + missing; }
const values = [undefined, 0, -0, 1, 2, -1, NaN, 0.5, 1.5, 2147483647, -2147483648, 4294967296, 1e300, Infinity]; const links = [undefined, null, 0, 1, 0.5];
const tasks = values.flatMap(v => [new Task(v, undefined, null), new Task(undefined, v, v), new Task(v, v, links[values.indexOf(v) % links.length])]);
for (const t of tasks) console.log(tasks.map(u => same(t, u)).join(" "), tasks.map(u => branch(t, u)).join(" "));
console.log(EARLY, loop(tasks, 7), first());
