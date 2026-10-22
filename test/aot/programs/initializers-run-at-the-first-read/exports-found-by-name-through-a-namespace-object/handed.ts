export const table = new Map<string, number>([["a", 1], ["b", 2]]);
export const list = ["x", "y"].map(s => s + s);
export function grow(k: string) { table.set(k, k.length); return table.size; }
export function size() { return table.size; }
