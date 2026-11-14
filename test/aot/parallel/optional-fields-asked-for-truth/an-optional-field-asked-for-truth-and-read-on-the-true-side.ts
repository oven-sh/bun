// STATISTIC: EmptySlotConversionsSkipped >= 2
class Thing { n: number; constructor(n: number) { this.n = n; } }
interface Links { type?: Thing; a0?: Thing; a1?: Thing; a2?: Thing; a3?: Thing; a4?: Thing; a5?: Thing; a6?: Thing; a7?: Thing; a8?: Thing; a9?: Thing; a10?: Thing; a11?: Thing; }
class LinksObject { declare _brand: any; }
class Owner { links: Links | undefined = undefined; id = 0; }
function linksOf(owner: Owner): Links { return owner.links ??= new LinksObject() as Links; }
let made = 0;
function make(owner: Owner): Thing { made++; return new Thing(owner.id); }
function fill(owner: Owner): void { const links = linksOf(owner); links.a0 = make(owner); links.a1 = make(owner); links.a2 = make(owner); links.a3 = make(owner); links.a4 = make(owner); links.a5 = make(owner); links.a6 = make(owner); links.a7 = make(owner); links.a8 = make(owner); links.a9 = make(owner); links.a10 = make(owner); links.a11 = make(owner); }
function typeOf(links: Links, owner: Owner): Thing { if (!links.type) { links.type = make(owner); } if (!links.a0) { links.a0 = make(owner); } if (!links.a1) { links.a1 = make(owner); } if (!links.a2) { links.a2 = make(owner); } return links.type; }
function flags(links: Links, thing: Thing): number { if (!links.a1) { links.a1 = thing; return 0; } return 1; }
function nOrLess(links: Links, thing: Thing): number { const type = links.a0; if (!type) { links.a0 = thing; return -3; } return type.n; }
function numberOf(links: Links, owner: Owner): number { const type = links.type; if (type) { links.a0 = type; return type.n; } links.a0 = make(owner); return -1; }
function showOrFill(links: Links, owner: Owner): string { const type = links.type; if (!type) { links.type = make(owner); return String(type); } return "thing " + type.n; }
function listOrFill(links: Links, owner: Owner): unknown { const type = links.a1; if (!type) { links.a1 = make(owner); return [type]; } return type.n; }
Object.assign(globalThis, { typeOf, flags, nOrLess, numberOf, showOrFill, listOrFill, fill, linksOf });
const outside: ((owner: unknown) => any)[] = (0, eval)("[(owner) => flags(linksOf(owner), new Thing(1)), (owner) => nOrLess(linksOf(owner), new Thing(2)), (owner) => numberOf(linksOf(owner), owner), (owner) => showOrFill(linksOf(owner), owner), (owner) => JSON.stringify(listOrFill(linksOf(owner), owner)), (owner) => typeOf(linksOf(owner), owner).n, (owner) => fill(owner), (owner) => flags(linksOf(owner), new Thing(3)), (owner) => nOrLess(linksOf(owner), new Thing(4)), (owner) => numberOf(linksOf(owner), owner), (owner) => showOrFill(linksOf(owner), owner), (owner) => JSON.stringify(listOrFill(linksOf(owner), owner))]");
(globalThis as any).Thing = Thing;
const prepare: ((links: unknown) => void)[] = (0, eval)("[() => {}, (links) => { links.type = new Thing(50); }, (links) => { links.type = undefined; links.a1 = null; }, (links) => { links.type = null; }, (links) => { links.type = new Thing(51); delete links.type; }, (links) => { links.type = 'text'; links.a1 = ''; }, (links) => { links.type = 0; links.a1 = 7; }, (links) => { Object.defineProperty(links, 'type', { get() { return new Thing(52); }, set() {} }); }, (links) => { Object.freeze(links); }]");
const owners = [new Owner()];
for (let id = 0; id < prepare.length; id++) { const one = new Owner(); one.id = id + 1; one.links = new LinksObject() as Links; prepare[id](one.links); owners.push(one); }
const said: string[] = [];
for (const one of owners) said.push(outside.map((ask) => { try { return String(ask(one)); } catch (error) { return (error as Error).name; } }).join(" | "));
console.log(said.join("\n") + "\n" + made);
