export interface Factory {
  create(): { value: number };
}
export const table: { factory: Factory | null; count: number } = { factory: null, count: 1 };
export function make(factory: Factory): number {
  table.factory = factory;
  return table.factory.create().value + table.count;
}
