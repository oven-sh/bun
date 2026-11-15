export type Even = null | number | Odd[];
export type Odd = string | number | Even[];
export function save(items: Even[] | Odd[]): number { return items.length; }
