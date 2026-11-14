// The class lists a method under the computed key "constructor", and the name is read back off the prototype.
class Odd { k = 1; ["constructor"](): string { return "method"; } }
(globalThis as any).held = Odd; const back: any = (globalThis as any).held; back.prototype.other = () => 1; back.extra = 2;
const list: any[] = []; for (let i = 0; i < 300; i++) list.push(new back());
function ask(all: any[]): number { let hits = 0; for (let i = 0; i < all.length; i++) if (all[i].constructor === Odd) hits++; return hits; }
function make(all: any[]): unknown { let last: unknown; for (let i = 0; i < all.length; i++) last = new all[i].constructor(); return last; }
console.log(ask(list));
try { console.log(typeof make(list)); } catch (error) { console.log((error as Error).name); }
console.log(typeof (Odd.prototype as any).constructor, (Odd.prototype as any).constructor === Odd);
