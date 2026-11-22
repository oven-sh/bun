const out: string[] = [];
const enum Flags { None = 0, A = 1, B = 2 }
class Mark { tag: string; constructor(tag: string) { this.tag = tag; } }
interface Links { flags: Flags; more: Flags; last: Flags; first?: Mark; second?: Mark; third?: Mark; fourth?: Mark; fifth?: Mark; note?: string; }
const LinksMaker = function (this: Links) { this.flags = Flags.None; this.more = Flags.A; this.last = Flags.B; } as unknown as new () => Links;
const all: Links[] = [];
function linksOf(i: number): Links { return all[i] || (all[i] = new LinksMaker()); }
function firstOf(i: number): Mark { const links = linksOf(i); return links.first || (links.first = new Mark("first " + i)); }
function secondOf(i: number): Mark { const links = linksOf(i); return links.second || (links.second = new Mark("second " + i)); }
function thirdOf(i: number): Mark | undefined { const links = linksOf(i); if (i & 1) links.third = new Mark("third " + i); return links.third; }
function fourthOf(i: number): Mark | undefined { const links = linksOf(i); if (i & 2) links.fourth = new Mark("fourth " + i); return links.fourth; }
function fifthOf(i: number): Mark | undefined { const links = linksOf(i); if (i & 4) links.fifth = new Mark("fifth " + i); return links.fifth; }
function show(links: Links) { return Object.keys(links).join() + "|" + [links.flags, links.more, links.last, links.first?.tag, links.second?.tag, links.third?.tag, links.fourth?.tag, links.fifth?.tag, links.note].join(); }
(globalThis as any).kept = [linksOf, firstOf, secondOf, thirdOf, fourthOf, fifthOf, show];
for (let i = 0; i < 9; i++) { if (i % 3) firstOf(i); if (i % 2) secondOf(i); thirdOf(i); fourthOf(i); fifthOf(i); firstOf(i); firstOf(i); secondOf(i); if (i === 5) linksOf(i).note = "n"; if (i === 6) { delete linksOf(i).first; linksOf(i).second = undefined; } if (i === 7) Object.freeze(linksOf(i)); out.push(show(linksOf(i))); }
(kept => { const odd = kept[0](8) as any; odd.third = 7; odd.first = "a text"; odd.second = null; out.push([odd.third, odd.first, odd.second, Object.keys(odd).join()].join("|")); odd.third = new Mark("back"); out.push(show(odd)); })((globalThis as any).kept);
out.push(JSON.stringify(all[3]), String("first" in all[6]), String("second" in all[6]), String(Object.getOwnPropertyDescriptor(all[1], "first")?.writable));
console.log(out.join("\n"));
