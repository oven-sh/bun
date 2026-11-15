// The heir lists a method under the computed key "constructor"; nothing is handed out of sight.
class Tree { k = 1; again(): any { return new (this as any).constructor(); } }
class Ash extends Tree { k = 2; ["constructor"](): string { return "method"; } }
const list: Tree[] = []; for (let i = 0; i < 300; i++) list.push(i % 3 ? new Ash() : new Tree());
function make(all: Tree[]): string { let made = 0, thrown = 0; for (let i = 0; i < all.length; i++) { try { made += all[i].again().k; } catch { thrown++; } } return made + " " + thrown; }
console.log(make(list));
