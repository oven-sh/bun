// An object literal with data members and a getter is given more properties later. Names it has, names it lacks and names it inherits are read many times from the same places while it changes.
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
interface Box { size: number; readonly twice: number }
function makeBox(size: number): Box { return { size, get twice() { return this.size * 2; } }; }
function many(run: () => unknown): string { let last: unknown; for (let i = 0; i < 300; i++) last = run(); return String(last); }
function colorOf(from: any): unknown { return from.color; }
function thenOf(from: any): unknown { return from.then; }
function toStringOf(from: any): unknown { return typeof from.toString; }
function sizeOf(from: any): unknown { return from.size; }

const box = makeBox(3);
const other = makeBox(4);
const loose: any = box;
say("a name it lacks", many(() => colorOf(box)) + " " + many(() => thenOf(box)));
say("a name it inherits", many(() => toStringOf(box)));
loose.color = "red";
say("the name is there now", many(() => colorOf(box)) + " " + many(() => colorOf(other)));
loose.color = "green";
say("another value", many(() => colorOf(box)));
loose.weight = 1;
say("one property more", many(() => colorOf(box)) + " " + many(() => thenOf(box)));
delete loose.color;
say("deleted", many(() => colorOf(box)));
Object.defineProperty(loose, "color", { get() { return "from a getter"; }, configurable: true });
say("an accessor by that name", many(() => colorOf(box)));
Object.defineProperty(loose, "color", { value: "a value again", configurable: true, writable: false });
say("a value that cannot be written", many(() => colorOf(box)));
class Holder { size = 1 }
const held: any = new Holder();
Object.defineProperty(held, "twice", { get() { return 2; }, configurable: true });
say("an instance with an accessor of its own lacks the name", many(() => thenOf(held)) + " " + many(() => sizeOf(held)) + " " + held.twice);
loose.then = 5;
say("its own", many(() => thenOf(box)) + " " + many(() => thenOf(other)));
say("fields and the getter are as they were", many(() => sizeOf(box)) + " " + box.twice + " " + other.twice);
const boxes: Box[] = [];
for (let i = 0; i < 100; i++) { const made = makeBox(i); if (i % 3 === 0) (made as any).color = "c" + i; boxes.push(made); }
let seen = "";
for (let round = 0; round < 5; round++) for (const made of boxes) { const color = colorOf(made); if (round === 4 && color !== undefined && made.size < 20) seen += color; }
say("a hundred objects through one place", seen);
let garbage: unknown[] = [];
for (let i = 0; i < 200000; i++) { garbage.push({ i, get half() { return i / 2; } }); if (garbage.length > 1000) garbage = []; if (i % 50000 === 0) say("while garbage is made", String(colorOf(box)) + thenOf(box) + thenOf(other)); }
say("keys", Object.keys(box).join());
console.log(lines.join("\n"));
