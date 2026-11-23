// The class declares a field under a key that is made at run time and spells constructor.
const name = ["con", "structor"].join("");
class Ash { k = 1; [name] = 5; }
(globalThis as any).held = Ash;
const list: any[] = []; for (let i = 0; i < 300; i++) list.push(new Ash());
function ask(all: any[]): number { let hits = 0; for (let i = 0; i < all.length; i++) if (all[i].constructor === Ash) hits++; return hits; }
console.log(ask(list));
