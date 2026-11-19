export type Deep = Deep[];
export function save(items: Deep): number { return (items as unknown[]).length; }
