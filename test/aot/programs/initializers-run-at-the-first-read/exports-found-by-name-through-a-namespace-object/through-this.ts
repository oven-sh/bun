export const table = new Map<string, number>([["a", 1], ["b", 2]]);
export function sizeOfMine(this: { table: Map<string, number> }) { return this.table.size; }
export function growMine(this: { table: Map<string, number> }, k: string) { this.table.set(k, k.length); return this.table.size; }
