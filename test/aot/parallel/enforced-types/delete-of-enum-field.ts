// delete-of a field that is written `Flags`: the slot is held to what is written, and whoever breaks it pays by the object. Every answer is that of plain Bun.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
enum Flags { None, Union = 1, Object = 2 }
class Holder { field: Flags; other: number; constructor(field: Flags) { this.field = field; this.other = 1; } }
function attempt(read: () => unknown): string { try { return String(read()); } catch (error) { return (error as Error).name; } }
function read(h: Holder): string { return attempt(() => (h.field & 3) + 1) + " " + typeof h.field + " " + Object.keys(h).join(); }
function deed(h: Holder, lie: any): Holder { delete (h as any).field; return h; }
function tryDeed(h: Holder, lie: any): Holder { try { return deed(h, lie); } catch (error) { console.log((error as Error).name); return h; } }
const lie = JSON.parse("\"text\"");
const straight = new Holder(Flags.Union);
console.log("before", read(straight));
console.log("behind", read(tryDeed(straight, lie)), "|", read(straight));
straight.field = Flags.Object;
console.log("honest again", read(straight));
for (let turn = 0; turn < 3; turn++) {
  const h = new Holder(turn % 2 ? Flags.Object : Flags.Union);
  console.log(turn, read(h), "|", read(turn === 1 ? tryDeed(h, lie) : h), "|", read(h));
}
