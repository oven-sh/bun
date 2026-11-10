type User = { id: number; name: string };
export type Rows = Pick<User, "id">[];
export function save(items: Rows): number { return items.length; }
