export type Grow<T> = (T | Grow<T[]>)[];
export function save(items: Grow<number | string>): number { return (items as unknown[]).length; }
