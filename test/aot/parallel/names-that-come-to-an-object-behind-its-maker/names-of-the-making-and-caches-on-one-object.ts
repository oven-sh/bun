const out: string[] = [];
const enum Flags { None = 0, A = 1, B = 2 }
class Mark { tag: string; constructor(tag: string) { this.tag = tag; } }
interface Links { flags: Flags; more: Flags; last: Flags; cached?: Mark; found?: Mark; origin?: Mark; mapper?: Mark; owner?: Mark; note?: string; }
function LinksMaker(this: Links) { this.flags = Flags.None; this.more = Flags.A; this.last = Flags.B; }
interface Allocator { getLinksMaker(): new () => Links }
const allocator: Allocator = { getLinksMaker: () => LinksMaker as any };
function setAllocator(other: Partial<Allocator>) { Object.assign(allocator, other); }
const Maker = allocator.getLinksMaker();
function makeLinks(): Links { const made = new Maker(); return made; }
function cachedOf(links: Links): Mark { return links.cached || (links.cached = new Mark("cached")); }
function foundOf(links: Links): Mark { return links.found || (links.found = new Mark("found")); }
function copyOf(origin: Mark, mapper: Mark | undefined): Links { const made = makeLinks(); made.origin = origin; made.mapper = mapper; return made; }
function ownedBy(owner: Mark): Links { const made = makeLinks(); made.owner = owner; return made; }
function show(links: Links) { return Object.keys(links).join() + "|" + [links.flags, links.more, links.last, links.cached?.tag, links.found?.tag, links.origin?.tag, links.mapper?.tag, links.owner?.tag, links.note].join(); }
(globalThis as any).kept = [setAllocator, makeLinks, cachedOf, foundOf, copyOf, ownedBy, show];
const all: Links[] = [];
for (let i = 0; i < 8; i++) {
    const links = i & 1 ? copyOf(new Mark("origin " + i), i & 2 ? new Mark("mapper " + i) : undefined) : i & 2 ? ownedBy(new Mark("owner " + i)) : makeLinks();
    if (i & 4) cachedOf(links);
    if (i % 3 === 0) foundOf(links);
    if (i === 5) links.note = "n";
    if (i === 6) links.origin = links.owner;
    all.push(links); out.push(show(links));
}
(kept => {
    const odd = kept[4](new Mark("o"), new Mark("m")) as any;
    odd.origin = 7; odd.mapper = "a text"; odd.owner = null; odd.cached = 1.5;
    out.push([odd.origin, odd.mapper, odd.owner, odd.cached, Object.keys(odd).join()].join("|"));
    odd.origin = new Mark("back"); delete odd.mapper; out.push(kept[6](odd), String("mapper" in odd), String("origin" in odd));
    odd.mapper = new Mark("again"); out.push(kept[6](odd));
    Object.defineProperty(odd, "owner", { get() { return new Mark("got"); }, enumerable: false, configurable: true }); out.push(kept[6](odd));
    const frozen = Object.freeze(kept[5](new Mark("f"))); try { "use strict"; frozen.mapper = new Mark("no"); } catch (error) { out.push((error as Error).name); } out.push(kept[6](frozen));
})((globalThis as any).kept);
out.push(JSON.stringify(all[3]), JSON.stringify({ ...all[7] }), String("mapper" in all[1]), String(all[1].mapper), String(Object.getOwnPropertyDescriptor(all[3], "mapper")?.writable), String(Object.getOwnPropertyDescriptor(all[0], "origin")));
for (const key in all[5]) out.push(key);
console.log(out.join("\n"));
