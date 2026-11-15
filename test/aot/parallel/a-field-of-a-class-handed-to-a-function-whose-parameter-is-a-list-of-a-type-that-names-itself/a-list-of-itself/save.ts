export type Json = null | string | number | Json[];
export function save(items: Json[]): number { return items.length; }
