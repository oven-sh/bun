// reflect-set-on a field that is written `Point`: the slot is held to what is written, and whoever breaks it pays by the object. Every answer is that of plain Bun.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class Point { x: number; constructor(x: number) { this.x = x; } }
class Holder { field: Point; other: number; constructor(field: Point) { this.field = field; this.other = 1; } }
function attempt(read: () => unknown): string { try { return String(read()); } catch (error) { return (error as Error).name; } }
function read(h: Holder): string { return attempt(() => h.field.x + 1) + " " + typeof h.field + " " + Object.keys(h).join(); }
function deed(h: Holder, lie: any): Holder { Reflect.set(h, "field", lie); return h; }
function tryDeed(h: Holder, lie: any): Holder { try { return deed(h, lie); } catch (error) { console.log((error as Error).name); return h; } }
const lie = JSON.parse("{ \"x\": \"ordinary\" }");
const straight = new Holder(new Point(1));
console.log("before", read(straight));
console.log("behind", read(tryDeed(straight, lie)), "|", read(straight));
straight.field = new Point(2);
console.log("honest again", read(straight));
for (let turn = 0; turn < 3; turn++) {
  const h = new Holder(turn % 2 ? new Point(2) : new Point(1));
  console.log(turn, read(h), "|", read(turn === 1 ? tryDeed(h, lie) : h), "|", read(h));
}
