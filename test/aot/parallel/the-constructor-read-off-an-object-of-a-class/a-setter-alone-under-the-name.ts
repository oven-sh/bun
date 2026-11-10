// The class lists a setter alone under the computed key "constructor", so that the name reads as undefined.
class Ash { k = 1; set ["constructor"](value: unknown) { this.k = 2; } }
(globalThis as any).held = Ash;
const list: any[] = []; for (let i = 0; i < 300; i++) list.push(new Ash());
function ask(all: any[]): number { let hits = 0; for (let i = 0; i < all.length; i++) if (all[i].constructor === Ash) hits++; return hits; }
console.log(ask(list), typeof list[0].constructor);
