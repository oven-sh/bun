// `new LinksClass() as TransientLinks`: the class is empty, and the interface has a member that is stored afterwards.
declare const console: { log(...values: unknown[]): void };
interface Ty { flags: number; id: number }
interface Links { type?: Ty; mapper?: string }
interface TransientLinks extends Links { check: number }
interface Holder { links: TransientLinks }
function row(n: string, f: () => unknown) { try { console.log(n + ": " + String(f())) } catch (e) { console.log(n + ": THROWN: " + (e as Error).message.split("\n")[0].slice(0, 90)) } }
const LinksClass = class implements Links {}
class Named implements Links {}
row("a class expression", () => { const h = {} as Holder; h.links = new LinksClass() as TransientLinks; h.links.check = 3; return h.links.check + " " + h.links.mapper });
row("a class declaration", () => { const h = {} as Holder; h.links = new Named() as TransientLinks; h.links.check = 4; return h.links.check });
row("to a variable", () => { const l = new LinksClass() as TransientLinks; l.check = 6; l.mapper = "m"; return l.check + l.mapper! + (l instanceof LinksClass) });
