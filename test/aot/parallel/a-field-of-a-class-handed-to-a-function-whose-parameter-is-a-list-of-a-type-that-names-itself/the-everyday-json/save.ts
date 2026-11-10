export type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
export function save(items: Json[]): number { return items.length; }
