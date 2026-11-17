// The class declares a field under the computed key "constructor", which every object then has of its own.
class Ash { k = 1; ["constructor"] = 5; }
(globalThis as any).held = Ash;
const list: any[] = []; for (let i = 0; i < 300; i++) list.push(new Ash());
function ask(all: any[]): number { let hits = 0; for (let i = 0; i < all.length; i++) if (all[i].constructor === Ash) hits++; return hits; }
function make(all: any[]): unknown { let last: unknown; for (let i = 0; i < all.length; i++) last = new all[i].constructor(); return last; }
console.log(ask(list));
try { console.log(typeof make(list)); } catch (error) { console.log((error as Error).name); }
