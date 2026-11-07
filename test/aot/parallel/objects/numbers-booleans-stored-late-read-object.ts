// A number or a boolean that is stored once the object is out in the world, or never, read by typed code.
// What a filled slot holds is the answer, whatever has become of the other members and whatever lies above the object: a number, a boolean, undefined or null.
// An empty one is undefined only while nothing above the object has the name and the member lies nowhere else.
declare const console: { log(...values: unknown[]): void };

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : Object.is(v, -0) ? "#-0" : typeof v === "number" && v !== v ? "#NaN" : v)));
}

interface Links { id: number; flags?: number; ratio?: number; seen?: boolean; done?: boolean | null; depth?: number | null; }
const Links = function (this: Links, id: number) { this.id = id; } as unknown as new (id: number) => Links;

// What is done to the objects from outside is done under names that only the run knows.
const names = ["flags", "ratio", "seen", "done", "depth", "id"];
function nameAt(index: number): string { return names[index % names.length]; }
function redefine(object: any, index: number, descriptor: PropertyDescriptor) { Object.defineProperty(object, nameAt(index), descriptor); }
function remove(object: any, index: number) { delete object[nameAt(index)]; }
function put(object: any, index: number, value: unknown) { object[nameAt(index)] = value; }
const FLAGS = 0, RATIO = 1, SEEN = 2, DONE = 3, DEPTH = 4;

// Each reads one late member of its argument, as a checker's small functions do.
function flagsOf(links: Links): number { const flags = links.flags; if (flags !== undefined) return flags; return -1; }
function ratioOf(links: Links): number | undefined { return links.ratio; }
function isSeen(links: Links): boolean { if (links.seen) return true; return false; }
function seenOf(links: Links): boolean | undefined { return links.seen; }
function doneOf(links: Links): boolean | null | undefined { return links.done; }
function depthOf(links: Links): number { return links.depth ?? -7; }
function depthAsItIs(links: Links): number | null | undefined { return links.depth; }
function mark(links: Links): number { return links.flags === undefined ? (links.flags = links.id & 7) : links.flags; }
function show(links: Links) { return [flagsOf(links), ratioOf(links), isSeen(links), seenOf(links), doneOf(links), depthOf(links), depthAsItIs(links)]; }

const all: Links[] = [];
for (let i = 0; i < 400; i++) {
  const links = new Links(i);
  all.push(links);
  if (i % 2) links.flags = i * 3;
  if (i % 3 === 0) links.ratio = i / 4;
  if (i % 5 === 0) links.seen = i % 10 === 0;
  if (i % 7 === 0) links.done = i % 14 === 0 ? null : true;
  if (i % 11 === 0) links.depth = i % 22 === 0 ? null : i;
}
function tally() {
  let t = 0;
  for (const links of all) t += flagsOf(links) + (ratioOf(links) ?? 0.5) + (isSeen(links) ? 2 : 1) + (doneOf(links) === null ? 5 : doneOf(links) ? 7 : 0) + depthOf(links);
  return t;
}
for (let round = 0; round < 40; round++) tally();
say("tally", tally());
say("some", [0, 1, 3, 5, 7, 10, 11, 14, 22, 35, 77, 385].map(i => show(all[i])));
say("mark", [mark(all[2]), mark(all[2]), mark(all[3]), Object.keys(all[2]).join()]);

// undefined and null stored: the member is there and holds them.
{
  const a = new Links(1000), b = new Links(1001), c = new Links(1002);
  a.flags = undefined; a.ratio = undefined; a.seen = undefined; a.done = undefined; a.depth = undefined;
  put(b, FLAGS, null); put(b, RATIO, null); put(b, SEEN, null); b.done = null; b.depth = null;
  say("undefined stored", [show(a), "flags" in a, Object.keys(a).join(), Object.hasOwn(a, "seen")]);
  say("null stored", [show(b), "flags" in b, Object.keys(b).join(), (b as any).flags === null, (b as any).seen === null]);
  say("nothing stored", [show(c), "flags" in c, Object.keys(c).join(), Object.hasOwn(c, "seen")]);
  a.flags = 9; a.seen = true; a.ratio = -0; a.depth = 0; say("then filled", [show(a), Object.keys(a).join()]);
}
// One member leaves its slot: the others are read as before, and it is read where it lies now.
{
  const a = new Links(2000); a.flags = 5; a.ratio = 1.5; a.seen = false; a.done = true; a.depth = 3;
  let reads = 0;
  redefine(a, FLAGS, { get() { reads++; return 77; }, configurable: true, enumerable: true });
  say("an accessor for one", [show(a), show(a), reads]);
  redefine(a, SEEN, { value: true, writable: false, configurable: true });
  say("a constant for another", [show(a), Object.getOwnPropertyDescriptor(a, "seen")]);
  remove(a, RATIO); remove(a, FLAGS); say("deleted", [show(a), Object.keys(a).join()]);
  a.flags = 6; a.ratio = 2.25; say("stored again", [show(a), Object.keys(a).join()]);
  const empty = new Links(2001);
  redefine(empty, DEPTH, { get() { return 41; }, configurable: true });
  redefine(empty, SEEN, { get() { return true; }, configurable: true });
  say("accessors where nothing was", show(empty));
  const frozen = Object.freeze(new Links(2002)); say("frozen and empty", show(frozen));
  const full = new Links(2003); full.flags = 8; full.seen = true; say("frozen and filled", show(Object.freeze(full)));
}
// Other values than the types allow.
{
  const a = new Links(3000); a.flags = 1; a.seen = true; a.ratio = 0.5; a.depth = 2;
  put(a, FLAGS, "text"); say("a string for the number", [show(a), typeof (a as any).flags]);
  put(a, SEEN, 1); say("a number for the boolean", [show(a), typeof (a as any).seen]);
  put(a, RATIO, { valueOf() { return 4; } }); say("an object for the number", [typeof ratioOf(a), isSeen(a), depthOf(a)]);
  put(a, DEPTH, true); say("a boolean for the number", show(a).slice(5));
  const b = new Links(3001);
  put(b, FLAGS, 2 ** 31); put(b, DEPTH, -(2 ** 31)); put(b, RATIO, NaN); say("numbers at the edges", show(b));
  put(b, FLAGS, -2147483647); put(b, DEPTH, -2147483646); say("numbers where markers may lie", show(b));
  put(b, FLAGS, 0.5); put(b, DEPTH, -0); put(b, RATIO, Infinity); say("fractions", show(b));
  put(b, FLAGS, 10n); say("a bigint", [typeof (b as any).flags, String(flagsOf(b))]);
}
// The name arrives above the object: an empty slot finds it, a filled one hides it.
{
  const filled = new Links(4000); filled.flags = 3; filled.seen = false; filled.depth = null;
  const empty = new Links(4001);
  say("before", [show(filled), show(empty)]);
  put(Links.prototype, FLAGS, 1234); put(Links.prototype, SEEN, true);
  say("on the prototype", [show(filled), show(empty), tally()]);
  redefine(Links.prototype, DEPTH, { get(this: Links) { return this.id; }, configurable: true });
  say("an accessor on the prototype", [show(filled), show(empty)]);
  remove(Links.prototype, FLAGS); remove(Links.prototype, SEEN); remove(Links.prototype, DEPTH);
  say("gone again", [show(filled), show(empty), tally()]);
  const other = Object.setPrototypeOf(new Links(4002), { flags: 55, seen: true, done: null });
  say("another prototype", show(other));
  const none = Object.setPrototypeOf(new Links(4003), null); none.seen = true;
  say("no prototype", show(none));
}
// A namespace that replaces one of its own functions under a computed name: its variables are read as before.
namespace Debug {
  export let level = 0;
  export let isDebugging = false;
  export let limit: number | undefined;
  export function check(value: unknown): void { if (level < 1) (Debug as any)[["check"][0]] = quiet; else if (!value) throw new Error("no value"); }
}
function quiet(): void {}
function debugging(): number { return (Debug.isDebugging ? 1 : 0) + (Debug.limit ?? 10) + Debug.level; }
{
  let t = 0;
  for (let i = 0; i < 3000; i++) { if (i === 100) Debug.check(i); if (i === 2000) Debug.limit = 20; if (i === 2500) Debug.isDebugging = true; t += debugging(); }
  say("namespace", [t, Debug.check === quiet, Object.keys(Debug).join()]);
  delete (Debug as any)[["limit"][0]]; say("a variable deleted", debugging());
  Object.defineProperty(Debug, ["isDebugging"][0], { get() { return false; }, configurable: true }); say("a variable redefined", debugging());
}
console.log(lines.join("\n"));
