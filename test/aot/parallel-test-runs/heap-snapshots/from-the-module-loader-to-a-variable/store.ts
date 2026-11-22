const shelf = new Map<string, number>();
let ledger = new Set<number>();
var crate = [1, 2, 3];
class Keeper { kept = 1; }
export const use = () => shelf.size + ledger.size + crate.length + new Keeper().kept;
export function fill(key: string) { shelf.set(key, 1); ledger.add(shelf.size); }
