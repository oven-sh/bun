export type Tree = number | string | { children: Tree[] } | Tree[];
export function save(items: Tree[]): number { return items.length; }
