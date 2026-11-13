class Mark { tag: string; constructor(tag: string) { this.tag = tag; } }
class Named { kind: number; name: Mark; parent: any; constructor(kind: number, name: Mark) { this.kind = kind; this.name = name; this.parent = undefined; } }
class Arrow { kind: number; name: never; parent: any; constructor(kind: number) { this.kind = kind; this.name = undefined as never; this.parent = undefined; } }
type Any = Named | Arrow;
const g: any = globalThis;
declare function unseenMark(): any;
(globalThis as any).turn = 0;
(globalThis as any).unseenMark = new Function("return () => globalThis.marks[globalThis.turn++ & 1]")();
function rename(node: Any): void { const name = unseenMark(); if (typeof name === "object" && name) node.name = name as never; }
g.rename = rename; g.Named = Named; g.Arrow = Arrow; g.Mark = Mark;
let total = 0; const marks = [new Mark("a"), new Mark("bc")]; g.marks = marks;
for (let k = 0; k < 200; k++) { const made: Any[] = []; for (let i = 0; i < 1000; i++) made.push(i & 1 ? new Named(1, marks[i % 2]) : new Arrow(2)); for (const node of made) { rename(node); total += node.name ? (node.name as any).tag.length : 0; } }


class Above { x: string; y: string; constructor(x: string, y: string) { this.x = x; this.y = y; } }
class Below extends Above { x: any = unseen(); constructor(y: string) { super("a", y); } }
declare function unseen(): any;
g.seen = 0; g.unseen = new Function("return () => { const n = globalThis.seen++ % 6; return n === 0 ? 7 : n === 1 ? { a: 1 } : n === 2 ? 'text' : n === 3 ? undefined : n === 4 ? true : 1.5; }")();
g.make = [Above, Below];
let log = "";
for (let k = 0; k < 200; k++) { const made: any[] = []; for (let i = 0; i < 100; i++) made.push(i & 3 ? new Below("y") : new Above("above", "z")); for (const b of made) { total += typeof b.x === "number" ? b.x : b.y.length; if (k === 1) log += typeof b.x + (typeof b.x === "object" ? b.x.a : b.x) + ","; b.x = k & 1 ? "again" : k; } if (k === 2) for (const b of made) log += b.x + Object.keys(b).join("") + ","; }
for (const odd of [undefined, null, 0, "", "name", 1.5, true, marks[0], [marks[1]], Symbol.iterator] as any[]) { const a: any = new Arrow(1), c: any = new Named(2, marks[0]); a.name = odd; c.name = odd; log += typeof a.name + typeof c.name + (a.name === odd) + (c.name === odd) + ","; }
console.log(total, log);
