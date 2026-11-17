export type M = number | string | M[][];
export function save(items: M[]): number { return items.length; }
