// The class above lists a method under the computed key "constructor"; its heir has the class object there.
class Tree { k = 1; ["constructor"](): string { return "method"; } again(): any { return new (this as any).constructor(); } }
class Ash extends Tree { k = 2; }
(globalThis as any).held = [Tree, Ash];
const list: any[] = []; for (let i = 0; i < 300; i++) list.push(i % 3 ? new Ash() : new Tree());
function ask(all: any[]): string { let ashes = 0, trees = 0; for (let i = 0; i < all.length; i++) { if (all[i].constructor === Ash) ashes++; if (all[i].constructor === Tree) trees++; } return ashes + " " + trees; }
function make(all: any[]): string { let made = 0, thrown = 0; for (let i = 0; i < all.length; i++) { try { made += all[i].again().k; } catch { thrown++; } } return made + " " + thrown; }
console.log(ask(list), make(list));
