export type Nested = number | (string | Nested[])[];
export function save(items: Nested[]): number { return items.length; }
