// An interface of optional members. One literal lists them all; the default of a parameter is `{}`. Nobody deletes, redefines or retypes a member, and no object leaves typed code.
// Each function reads objects of one interface alone, so what it finds in an object that was born empty is its own answer.
declare const console: { log(...values: unknown[]): void };
const lines: string[] = [];
function say(label: string, value: unknown) { lines.push(label + ": " + JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : v)); }

interface Handlers { isKnown?: (name: string) => boolean; onEnter?: (depth: number) => number; onLeave?: (depth: number) => number; rename?: (name: string) => string }
interface Sizes { width?: number; height?: number; depth?: number }
interface Names { first?: string; last?: string }
interface Links { next?: Links; owner?: Names }

function plainEnter(depth: number) { return depth + 1; }
function plainRename(name: string) { return name; }

function createWalker(handlers: Handlers = {}) {
  const { isKnown, onEnter = plainEnter, onLeave, rename = plainRename } = handlers;
  return function walk(name: string, depth: number): string {
    const known = isKnown ? isKnown(name) : false;
    const left = onLeave ? onLeave(depth) : -1;
    return rename(name) + ":" + known + ":" + onEnter(depth) + ":" + left;
  };
}
function area(sizes: Sizes = {}): number { return (sizes.width ?? 2) * (sizes.height ?? 3) * (sizes.depth ?? 5); }
function rawArea(sizes: Sizes = {}): number { return sizes.width! * sizes.height! * sizes.depth!; }
function fullName(names: Names = {}): string { return names.first + " " + names.last; }
function lengthOfFirst(names: Names = {}): unknown { try { return names.first!.length; } catch (error) { return (error as Error).constructor.name; } }
function ownerOf(links: Links = {}): unknown { try { return links.next!.owner!.first; } catch (error) { return (error as Error).constructor.name; } }
function has(sizes: Sizes = {}): string { return ("width" in sizes) + "," + Object.keys(sizes).join() + "," + (sizes.height === undefined); }

const full = createWalker({ isKnown: name => name.length > 1, onEnter: depth => depth * 2, onLeave: depth => depth - 1, rename: name => name.toUpperCase() });
const empty = createWalker();
let tally = 0;
for (let i = 0; i < 3000; i++) {
  tally += full("ab", i).length + empty("ab", i).length;
  tally += area({ width: i, height: 2, depth: 1 }) + area();
  tally += fullName({ first: "a" + i, last: "b" }).length + fullName().length;
  const raw = rawArea();
  if (raw === raw) tally += 1e9;
  tally += rawArea({ width: 1, height: i, depth: 1 });
}
say("tally", tally);
say("full", full("name", 4));
say("empty", empty("name", 4));
say("area", [area(), area({ width: 7, height: 1, depth: 1 }), rawArea(), rawArea({ width: 7, height: 1, depth: 1 })]);
say("names", [fullName(), fullName({ first: "x", last: "y" }), lengthOfFirst(), lengthOfFirst({ first: "xyz", last: "" })]);
say("links", [ownerOf(), ownerOf({ next: { next: undefined, owner: { first: "o", last: "p" } }, owner: undefined })]);
say("has", [has(), has({ width: 1, height: 2, depth: 3 })]);
console.log(lines.join("\n"));
